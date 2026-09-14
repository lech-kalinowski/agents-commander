import { Socket } from 'node:net';
import { StringDecoder } from 'node:string_decoder';
import { createReadStream, fstatSync, write } from 'node:fs';

// Runtime-only OpenCode 1.18.30 plugin: no provider SDK, files, history queries,
// or model-text edits. The assistant processor calls experimental.text.complete
// at text-end, before terminal wrapping/virtualization. A part is not a message;
// Commander must never guess how to concatenate parts across tool calls.
// https://github.com/anomalyco/opencode/blob/v1.18.30/packages/opencode/src/session/processor.ts
const TOKEN_ENV = 'AGENTS_COMMANDER_OPENCODE_TOKEN';
const FD_ENV = 'AGENTS_COMMANDER_OPENCODE_FD';
const KEY = /^[A-Za-z0-9_-]{43}$/;
const CAPABILITY = /^[A-Za-z0-9_-]{32,64}$/;
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const MAX_INPUT_BYTES = 8192;
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_QUEUE_BYTES = 8 * 1024 * 1024;
const WRITE_TIMEOUT_MS = 2000;
const CAPABILITY_LINE = /^Protocol capability: ([A-Za-z0-9_-]{32,64})\. Include it on every protocol header and footer exactly as shown below\.$/m;

function validID(value) {
  return typeof value === 'string' && ID.test(value);
}

function inheritedSocket() {
  if (!process.versions.bun) return new Socket({ fd: 4, readable: true, writable: true });
  // Bun 1.3.x validates Socket({fd}) but does not adopt the descriptor. Its
  // filesystem streams do support inherited socketpairs. The reader is the
  // single descriptor owner; raw writes never create a second closing stream.
  if (!fstatSync(4).isSocket()) throw new Error('Invalid Commander descriptor');
  const reader = createReadStream('', { fd: 4, autoClose: true, highWaterMark: 8192 });
  reader.write = (text, callback) => {
    const bytes = Buffer.from(text, 'utf8');
    let offset = 0;
    const next = () => {
      if (reader.destroyed) { callback(new Error('Commander transport closed')); return; }
      write(4, bytes, offset, bytes.length - offset, null, (error, count) => {
        if (error || count === 0) { callback(error ?? new Error('Commander transport closed')); return; }
        offset += count;
        if (offset === bytes.length) callback(null);
        else next();
      });
    };
    next();
  };
  reader.unref = () => {};
  return reader;
}

// Export only the plugin function. OpenCode's legacy loader invokes every
// exported value, so test helpers/constants must not be separate exports.
export default async function agentsCommanderProtocolPlugin() {
  const token = process.env[TOKEN_ENV];
  const fd = process.env[FD_ENV];
  delete process.env[TOKEN_ENV];
  delete process.env[FD_ENV];
  if (!KEY.test(token ?? '') || fd !== '4') return {};

  let socket;
  try {
    socket = inheritedSocket();
  } catch {
    return {};
  }

  let closed = false;
  let disabled = false;
  let epoch = 0;
  let capability = null;
  let sessionID = null;
  let candidate = null;
  let pendingInput = '';
  let pendingInputBytes = 0;
  let queuedBytes = 0;
  const queue = [];
  let inFlight = null;
  let writeTimer = null;
  const decoder = new StringDecoder('utf8');

  function close() {
    if (closed) return;
    closed = true;
    disabled = true;
    candidate = null;
    capability = null;
    sessionID = null;
    pendingInput = '';
    pendingInputBytes = 0;
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = null;
    for (const record of queue.splice(0)) record.resolve(false);
    inFlight?.resolve(false);
    inFlight = null;
    queuedBytes = 0;
    socket.destroy();
  }

  function pump() {
    if (closed || inFlight || queue.length === 0) return;
    const record = queue.shift();
    inFlight = record;
    writeTimer = setTimeout(close, WRITE_TIMEOUT_MS);
    writeTimer.unref?.();
    try {
      socket.write(record.encoded, (error) => {
        if (closed || inFlight !== record) return;
        clearTimeout(writeTimer);
        writeTimer = null;
        inFlight = null;
        queuedBytes -= record.bytes;
        record.resolve(!error);
        if (error) close();
        else pump();
      });
    } catch {
      close();
    }
  }

  function send(fields) {
    if (closed) return Promise.resolve(false);
    const encoded = JSON.stringify({ v: 1, token, ...fields }) + '\n';
    const bytes = Buffer.byteLength(encoded, 'utf8');
    if (bytes > MAX_QUEUE_BYTES || queuedBytes + bytes > MAX_QUEUE_BYTES) {
      close();
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      queuedBytes += bytes;
      queue.push({ encoded, bytes, resolve });
      pump();
    });
  }

  function report(code) {
    if (!capability || !epoch) {
      close();
      return Promise.resolve(false);
    }
    return send({ type: 'error', code, capability, epoch });
  }

  function bind(boundSessionID) {
    if (closed || disabled || !capability || sessionID) return;
    sessionID = boundSessionID;
    candidate = null;
    void send({ type: 'bound', capability, epoch, sessionID });
  }

  function acceptArm(message) {
    if (!message || message.v !== 1 || message.type !== 'arm' || message.token !== token
      || typeof message.capability !== 'string' || !CAPABILITY.test(message.capability)
      || !Number.isSafeInteger(message.epoch) || message.epoch < 1) {
      close();
      return;
    }
    // Duplicate arm delivery must not reset a binding or release a failed epoch.
    if (message.epoch < epoch || (message.epoch === epoch && message.capability !== capability)) {
      close();
      return;
    }
    const isNewEpoch = message.epoch > epoch;
    if (isNewEpoch) {
      epoch = message.epoch;
      capability = message.capability;
      sessionID = null;
      disabled = false;
    }
    void send({ type: 'armed', capability, epoch });
    if (candidate?.capability === capability && !disabled) bind(candidate.sessionID);
    else if (isNewEpoch) candidate = null;
  }

  socket.on('data', (chunk) => {
    if (closed) return;
    // Parent commands are tiny. Reject the whole oversized chunk rather than
    // allocating or parsing an unbounded series of attacker-controlled records.
    const data = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    if (pendingInputBytes + data.length > MAX_INPUT_BYTES) {
      close();
      return;
    }
    pendingInputBytes += data.length;
    pendingInput += decoder.write(data);
    let newline;
    while (!closed && (newline = pendingInput.indexOf('\n')) !== -1) {
      const line = pendingInput.slice(0, newline);
      pendingInput = pendingInput.slice(newline + 1);
      pendingInputBytes = Buffer.byteLength(pendingInput, 'utf8');
      try { acceptArm(JSON.parse(line)); }
      catch { close(); }
    }
  });
  socket.on('error', close);
  socket.on('end', close);
  socket.on('close', close);
  socket.unref();
  // Do not wait for an arm during plugin initialization. OpenCode must finish
  // registering the hooks before protocol injection can reach chat.message.
  void send({ type: 'hello' });

  return {
    'chat.message': async (input, output) => {
      if (closed || !validID(input?.sessionID)
        || output?.message?.role !== 'user' || output.message.sessionID !== input.sessionID) return;
      if (!Array.isArray(output.parts)) return;
      for (const part of output.parts) {
        if (part?.type !== 'text' || part.synthetic || part.ignored || typeof part.text !== 'string'
          || (part.sessionID !== undefined && part.sessionID !== input.sessionID)
          || !part.text.startsWith('[Agents Commander] You are ')
          || Buffer.byteLength(part.text, 'utf8') > MAX_TEXT_BYTES) continue;
        const match = CAPABILITY_LINE.exec(part.text);
        if (!match) continue;
        if (match[1] !== capability) {
          // A new capability's prompt can beat its arm packet during rotation,
          // including recovery from a failed epoch. Retain one tiny candidate,
          // but never change this epoch's binding/authority without a new arm.
          candidate = { capability: match[1], sessionID: input.sessionID };
          return;
        }
        if (disabled) return;
        if (sessionID) {
          // OpenCode can submit normal child-agent prompts in other sessions.
          // Ignore those, but never silently move Commander authority when a
          // different session explicitly presents this armed capability.
          if (input.sessionID !== sessionID && match[1] === capability) {
            disabled = true;
            candidate = null;
            await report('session-mismatch');
          }
          return;
        }
        bind(input.sessionID);
        return;
      }
    },
    'experimental.text.complete': async (input, output) => {
      if (closed || disabled || !capability || !sessionID || input?.sessionID !== sessionID
        || !validID(input?.messageID) || !validID(input?.partID)
        || typeof output?.text !== 'string' || !output.text.includes('COMMANDER')) return;
      if (Buffer.byteLength(output.text, 'utf8') > MAX_TEXT_BYTES) {
        disabled = true;
        await report('oversized-text');
        return;
      }
      await send({ type: 'text', capability, epoch, sessionID,
        messageID: input.messageID, partID: input.partID, text: output.text });
    },
    'shell.env': async (_input, output) => {
      if (output?.env) {
        delete output.env[TOKEN_ENV];
        delete output.env[FD_ENV];
      }
    },
    dispose: async () => { close(); },
  };
}
