import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { getCodexMicroNativeAction, isCodexMicroNativeInput } from './codex-micro.js';
import type { CodexMicroAction, CodexMicroNativeInput } from './codex-micro.js';
import { resolveExecutablePath } from '../utils/command-resolution.js';
import {
  resolveCodexMicroBridgePath,
  runtimeAssetLookupForModule,
} from '../utils/runtime-assets.js';
import { logger } from '../utils/logger.js';

export type CodexMicroTransport = 'usb' | 'bluetooth' | 'unknown';
export type CodexMicroConnectionState =
  | 'starting'
  | 'connected'
  | 'busy'
  | 'disconnected'
  | 'permission-denied'
  | 'unavailable'
  | 'error';

export interface CodexMicroDeviceStatus {
  state: CodexMicroConnectionState;
  transport: CodexMicroTransport;
  connectionEpoch: string | null;
  /** The helper continuously verifies that no competing HID event reader is active. */
  ownership?: 'guarded';
  firmware?: string;
  battery?: number;
  charging?: boolean;
  detail?: string;
}

export interface CodexMicroHardwareEvent {
  source: 'native';
  input: CodexMicroNativeInput;
  action: CodexMicroAction;
  connectionEpoch: string;
  sequence: number;
  receivedAt: number;
}

interface NativeBridgeOptions {
  platform?: NodeJS.Platform;
  pythonPath?: string | null;
  helperPath?: string | null;
  spawnProcess?: typeof spawn;
  now?: () => number;
  createEpoch?: () => string;
}

type StatusListener = (status: CodexMicroDeviceStatus) => void;
type InputListener = (event: CodexMicroHardwareEvent) => void;

const MAX_LINE_BYTES = 8 * 1024;
const MAX_BUFFER_BYTES = 64 * 1024;
const MAX_STDERR_BYTES = 8 * 1024;
const STARTUP_TIMEOUT_MS = 5_000;
const HELPER_TERMINATION_GRACE_MS = 500;
const MIN_RESTART_DELAY_MS = 250;
const MAX_RESTART_DELAY_MS = 5_000;
const WIDE_KEY_DEDUPE_MS = 100;
const JOYSTICK_TRIGGER_DISTANCE = 0.6;
const JOYSTICK_REARM_DISTANCE = 0.45;

const INITIAL_STATUS: CodexMicroDeviceStatus = Object.freeze({
  state: 'starting',
  transport: 'unknown',
  connectionEpoch: null,
});

function normalizeTransport(value: unknown): CodexMicroTransport {
  if (value === 'USB' || value === 'usb') return 'usb';
  if (value === 'Bluetooth Low Energy' || value === 'bluetooth' || value === 'ble') {
    return 'bluetooth';
  }
  return 'unknown';
}

function boundedDetail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const detail = value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').trim();
  if (!detail) return undefined;
  return detail.length <= 240 ? detail : `${detail.slice(0, 239)}…`;
}

function finiteBattery(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function safeFirmware(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^v?[0-9]+(?:\.[0-9]+){1,3}$/u.test(value)) return undefined;
  return value;
}

function sameStatus(left: CodexMicroDeviceStatus, right: CodexMicroDeviceStatus): boolean {
  return left.state === right.state
    && left.transport === right.transport
    && left.connectionEpoch === right.connectionEpoch
    && left.ownership === right.ownership
    && left.firmware === right.firmware
    && left.battery === right.battery
    && left.charging === right.charging
    && left.detail === right.detail;
}

function resolveDefaultBridgePath(): string | null {
  try {
    return resolveCodexMicroBridgePath(runtimeAssetLookupForModule(import.meta.url));
  } catch (error) {
    logger.warn('Codex Micro bridge asset lookup failed', error);
    return null;
  }
}

/**
 * Owns the isolated native helper and translates its bounded NDJSON stream into
 * semantic Commander actions. The helper is optional and macOS-only; failure
 * never blocks application startup or terminal input.
 */
export class CodexMicroNativeBridge {
  private readonly platform: NodeJS.Platform;
  private readonly pythonPath: string | null;
  private readonly helperPath: string | null;
  private readonly spawnProcess: typeof spawn;
  private readonly now: () => number;
  private readonly createEpoch: () => string;
  private readonly statusListeners = new Set<StatusListener>();
  private readonly inputListeners = new Set<InputListener>();
  private readonly pressedInputs = new Set<CodexMicroNativeInput>();
  private readonly helperTerminationDetails = new WeakMap<ChildProcessWithoutNullStreams, string>();
  private child: ChildProcessWithoutNullStreams | null = null;
  private currentStatus: CodexMicroDeviceStatus = { ...INITIAL_STATUS };
  private outputBuffer = '';
  private stderrBuffer = '';
  private sequence = 0;
  private generation = 0;
  private started = false;
  private stopping = false;
  private restartDelayMs = MIN_RESTART_DELAY_MS;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private joystickArmed = true;
  private lastWideActionAt = Number.NEGATIVE_INFINITY;

  constructor(options: NativeBridgeOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.pythonPath = options.pythonPath === undefined
      ? resolveExecutablePath('python3')
      : options.pythonPath;
    this.helperPath = options.helperPath === undefined
      ? resolveDefaultBridgePath()
      : options.helperPath;
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.now = options.now ?? Date.now;
    this.createEpoch = options.createEpoch ?? randomUUID;
  }

  get status(): CodexMicroDeviceStatus {
    return { ...this.currentStatus };
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  onInput(listener: InputListener): () => void {
    this.inputListeners.add(listener);
    return () => this.inputListeners.delete(listener);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    this.generation++;

    if (this.platform !== 'darwin') {
      this.setStatus({
        state: 'unavailable',
        transport: 'unknown',
        connectionEpoch: null,
        detail: 'Native Codex Micro input currently requires macOS',
      });
      return;
    }
    if (!this.pythonPath) {
      this.setStatus({
        state: 'unavailable',
        transport: 'unknown',
        connectionEpoch: null,
        detail: 'Python 3 was not found',
      });
      return;
    }
    if (!this.helperPath) {
      this.setStatus({
        state: 'unavailable',
        transport: 'unknown',
        connectionEpoch: null,
        detail: 'Packaged Codex Micro bridge was not found',
      });
      return;
    }

    this.launchHelper(this.generation);
  }

  async stop(): Promise<void> {
    if (!this.started && !this.child) return;
    this.started = false;
    this.stopping = true;
    this.generation++;
    this.clearTimers();
    this.pressedInputs.clear();
    this.joystickArmed = true;
    this.lastWideActionAt = Number.NEGATIVE_INFINITY;
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;

    await new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(forceTimer);
        resolve();
      };
      const forceTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // The process may have exited between the timeout and kill call.
        }
        finish();
      }, 500);
      forceTimer.unref?.();
      child.once('close', finish);
      try {
        child.stdin.end();
        child.kill('SIGTERM');
      } catch {
        finish();
      }
    });
  }

  private launchHelper(generation: number): void {
    if (!this.started || this.stopping || generation !== this.generation) return;
    this.setStatus({
      state: 'starting',
      transport: 'unknown',
      connectionEpoch: null,
    });
    this.outputBuffer = '';
    this.stderrBuffer = '';

    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnProcess(this.pythonPath!, [this.helperPath!, '--watch'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      }) as ChildProcessWithoutNullStreams;
    } catch (error) {
      this.handleHelperFailure(generation, error);
      return;
    }
    this.child = child;
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');

    this.startupTimer = setTimeout(() => {
      if (generation !== this.generation || this.child !== child) return;
      this.terminateHelper(child, 'Native helper did not report readiness');
    }, STARTUP_TIMEOUT_MS);
    this.startupTimer.unref?.();

    child.stdout.on('data', (chunk: Buffer | string) => {
      if (
        generation !== this.generation
        || this.child !== child
        || this.helperTerminationDetails.has(child)
      ) return;
      const text = typeof chunk === 'string' ? chunk : stdoutDecoder.write(chunk);
      this.consumeOutput(text, generation, child);
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      if (
        generation !== this.generation
        || this.child !== child
        || this.helperTerminationDetails.has(child)
      ) return;
      const text = typeof chunk === 'string' ? chunk : stderrDecoder.write(chunk);
      this.stderrBuffer = `${this.stderrBuffer}${text}`.slice(-MAX_STDERR_BYTES);
    });
    child.on('error', (error) => {
      if (
        generation !== this.generation
        || this.child !== child
        || this.helperTerminationDetails.has(child)
      ) return;
      this.handleHelperFailure(generation, error);
    });
    child.on('close', (code, signal) => {
      if (generation !== this.generation || this.child !== child) return;
      this.child = null;
      this.clearStartupTimer();
      if (!this.started || this.stopping) return;
      const detail = this.helperTerminationDetails.get(child)
        ?? boundedDetail(this.stderrBuffer)
        ?? `Native helper exited (${signal ?? code ?? 'unknown'})`;
      this.setStatus({
        state: 'error',
        transport: 'unknown',
        connectionEpoch: null,
        detail,
      });
      this.scheduleRestart(generation);
    });
  }

  private consumeOutput(
    text: string,
    generation: number,
    child: ChildProcessWithoutNullStreams,
  ): void {
    this.outputBuffer += text;
    if (Buffer.byteLength(this.outputBuffer, 'utf8') > MAX_BUFFER_BYTES) {
      logger.error('Codex Micro helper exceeded its bounded output buffer');
      this.outputBuffer = '';
      this.terminateHelper(child, 'Native helper exceeded its bounded output buffer');
      return;
    }

    while (true) {
      const newline = this.outputBuffer.indexOf('\n');
      if (newline < 0) break;
      const line = this.outputBuffer.slice(0, newline).trim();
      this.outputBuffer = this.outputBuffer.slice(newline + 1);
      if (!line) continue;
      if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
        logger.warn('Ignored oversized Codex Micro helper message');
        continue;
      }
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        logger.warn('Ignored malformed Codex Micro helper message');
        continue;
      }
      if (generation === this.generation && this.child === child) this.handleMessage(message);
    }
  }

  private handleMessage(message: unknown): void {
    if (!message || typeof message !== 'object') return;
    const record = message as Record<string, unknown>;
    if (record.version !== 1) return;
    if (record.type === 'status') {
      this.handleStatusMessage(record);
      return;
    }
    if (record.type === 'input') {
      this.handleInputMessage(record);
      return;
    }
    if (record.type === 'joystick') this.handleJoystickMessage(record);
  }

  private handleStatusMessage(record: Record<string, unknown>): void {
    const state = record.state;
    if (state === 'connected') {
      this.clearStartupTimer();
      if (record.ownership !== 'guarded') {
        this.pressedInputs.clear();
        this.joystickArmed = true;
        this.lastWideActionAt = Number.NEGATIVE_INFINITY;
        this.setStatus({
          state: 'error',
          transport: normalizeTransport(record.transport),
          connectionEpoch: null,
          detail: 'Native helper did not confirm the sole-reader guard',
        });
        return;
      }
      this.restartDelayMs = MIN_RESTART_DELAY_MS;
      const transport = normalizeTransport(record.transport);
      const epoch = this.currentStatus.state === 'connected'
        && this.currentStatus.transport === transport
        ? this.currentStatus.connectionEpoch
        : this.createEpoch();
      this.pressedInputs.clear();
      this.joystickArmed = true;
      this.lastWideActionAt = Number.NEGATIVE_INFINITY;
      this.setStatus({
        state: 'connected',
        transport,
        connectionEpoch: epoch,
        ownership: 'guarded',
        firmware: safeFirmware(record.firmware),
        battery: finiteBattery(record.battery),
        charging: typeof record.charging === 'boolean' ? record.charging : undefined,
      });
      return;
    }

    if (
      state === 'disconnected'
      || state === 'busy'
      || state === 'permission-denied'
      || state === 'unavailable'
      || state === 'error'
      || state === 'starting'
    ) {
      this.clearStartupTimer();
      this.pressedInputs.clear();
      this.joystickArmed = true;
      this.lastWideActionAt = Number.NEGATIVE_INFINITY;
      this.setStatus({
        state,
        transport: normalizeTransport(record.transport),
        connectionEpoch: null,
        detail: boundedDetail(record.detail),
      });
    }
  }

  private handleInputMessage(record: Record<string, unknown>): void {
    if (
      this.currentStatus.state !== 'connected'
      || this.currentStatus.ownership !== 'guarded'
      || !this.currentStatus.connectionEpoch
    ) return;
    if (typeof record.input !== 'string' || !isCodexMicroNativeInput(record.input)) return;
    const input = record.input;
    const act = record.act;
    if (input === 'ENC_CW' || input === 'ENC_CC') {
      this.emitInput(input);
      return;
    }
    if (act === 0 || act === false || record.phase === 'release') {
      this.pressedInputs.delete(input);
      return;
    }
    if (!(act === 1 || act === true || record.phase === 'press')) return;
    if (this.pressedInputs.has(input)) return;
    this.pressedInputs.add(input);

    if (input === 'ACT10' || input === 'ACT11') {
      const now = this.now();
      if (now - this.lastWideActionAt < WIDE_KEY_DEDUPE_MS) return;
      this.lastWideActionAt = now;
    }
    this.emitInput(input);
  }

  private handleJoystickMessage(record: Record<string, unknown>): void {
    if (this.currentStatus.state !== 'connected' || this.currentStatus.ownership !== 'guarded') return;
    const angle = record.angle;
    const distance = record.distance;
    if (
      typeof angle !== 'number'
      || !Number.isFinite(angle)
      || angle < 0
      || angle > 1
      || typeof distance !== 'number'
      || !Number.isFinite(distance)
      || distance < 0
      || distance > 1
    ) return;

    if (distance < JOYSTICK_REARM_DISTANCE) {
      this.joystickArmed = true;
      return;
    }
    if (!this.joystickArmed || distance < JOYSTICK_TRIGGER_DISTANCE) return;
    this.joystickArmed = false;
    const directions = ['JOY_RIGHT', 'JOY_DOWN', 'JOY_LEFT', 'JOY_UP'] as const;
    const index = Math.round(angle * directions.length) % directions.length;
    this.emitInput(directions[index]);
  }

  private emitInput(input: CodexMicroNativeInput): void {
    const connectionEpoch = this.currentStatus.connectionEpoch;
    if (
      this.currentStatus.state !== 'connected'
      || this.currentStatus.ownership !== 'guarded'
      || !connectionEpoch
    ) return;
    const event: CodexMicroHardwareEvent = {
      source: 'native',
      input,
      action: getCodexMicroNativeAction(input),
      connectionEpoch,
      sequence: ++this.sequence,
      receivedAt: this.now(),
    };
    for (const listener of this.inputListeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error('Codex Micro input listener failed', error);
      }
    }
  }

  private setStatus(status: CodexMicroDeviceStatus): void {
    if (sameStatus(this.currentStatus, status)) return;
    this.currentStatus = { ...status };
    for (const listener of this.statusListeners) {
      try {
        listener(this.status);
      } catch (error) {
        logger.error('Codex Micro status listener failed', error);
      }
    }
  }

  private handleHelperFailure(generation: number, error: unknown): void {
    if (generation !== this.generation || !this.started || this.stopping) return;
    this.clearStartupTimer();
    this.setStatus({
      state: 'error',
      transport: 'unknown',
      connectionEpoch: null,
      detail: boundedDetail(error instanceof Error ? error.message : String(error)),
    });
    this.scheduleRestart(generation);
  }

  private terminateHelper(child: ChildProcessWithoutNullStreams, detail: string): void {
    if (this.helperTerminationDetails.has(child)) return;
    this.helperTerminationDetails.set(child, detail);
    this.clearStartupTimer();
    this.outputBuffer = '';
    this.pressedInputs.clear();
    this.joystickArmed = true;
    this.lastWideActionAt = Number.NEGATIVE_INFINITY;
    this.setStatus({
      state: 'error',
      transport: 'unknown',
      connectionEpoch: null,
      detail,
    });
    if (child.exitCode !== null || child.signalCode !== null) return;
    const forceTimer = setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      try {
        child.kill('SIGKILL');
      } catch {
        // The process may have exited between the state check and kill call.
      }
    }, HELPER_TERMINATION_GRACE_MS);
    forceTimer.unref?.();
    child.once('close', () => clearTimeout(forceTimer));
    try {
      child.kill('SIGTERM');
    } catch {
      clearTimeout(forceTimer);
    }
  }

  private scheduleRestart(generation: number): void {
    if (!this.started || this.stopping || generation !== this.generation || this.restartTimer) return;
    const delay = this.restartDelayMs;
    this.restartDelayMs = Math.min(MAX_RESTART_DELAY_MS, this.restartDelayMs * 2);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.launchHelper(generation);
    }, delay);
    this.restartTimer.unref?.();
  }

  private clearStartupTimer(): void {
    if (!this.startupTimer) return;
    clearTimeout(this.startupTimer);
    this.startupTimer = null;
  }

  private clearTimers(): void {
    this.clearStartupTimer();
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }
}
