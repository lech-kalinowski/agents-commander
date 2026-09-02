export type CaptureMode = 'off' | 'metadata' | 'protocol';
export type CaptureEventType =
  | 'session.start' | 'session.end' | 'protocol.armed'
  | 'input.submitted' | 'input.unknown'
  | 'frame.accepted' | 'frame.rejected'
  | 'route.queued' | 'route.delivered' | 'route.failed'
  | 'controller.feedback';
export type CaptureVerb = 'send' | 'reply' | 'broadcast' | 'status' | 'query';
export type CaptureInputKind = 'task' | 'template' | 'protocol' | 'controller' | 'demo' | 'routed';
export type CaptureCoverage = 'commander-visible' | 'missing-manual-input' | 'truncated';
export interface CaptureActor {
  sessionId: string;
  panel: number;
  agentType: string;
}
export interface CaptureInput {
  type: CaptureEventType;
  actor?: CaptureActor;
  target?: CaptureActor;
  verb?: CaptureVerb;
  content?: string;
  capabilityRef?: string;
  targetAgent?: string;
  targetPanel?: number;
  emissionId?: string;
  messageId?: string;
  threadId?: string;
  replyToMessageId?: string;
  inputKind?: CaptureInputKind;
  outcome?: string;
  reason?: string;
  coverage?: CaptureCoverage;
}
export interface CaptureEvent extends Omit<CaptureInput, 'content'> {
  schemaVersion: 1;
  captureId: string;
  eventId: string;
  sequence: number;
  at: string;
  elapsedMs: number;
  content?: string;
  contentBytes?: number;
  redactions: Record<string, number>;
  contentOmitted: boolean;
}
export interface CaptureStatus {
  mode: CaptureMode;
  state: 'off' | 'recording' | 'incomplete' | 'complete';
  directory?: string;
  captureId?: string;
  events: number;
  bytes: number;
  pendingBytes: number;
  reason?: string;
}
export interface CaptureSink {
  readonly mode: CaptureMode;
  record(input: CaptureInput): void;
  bindCapability(sessionId: string, key: string): string;
  capabilityRef(sessionId: string): string | undefined;
  markIncomplete(reason: string): void;
  snapshot(): CaptureStatus;
  close(complete?: boolean): Promise<void>;
}
export interface CaptureLimits {
  segmentBytes: number;
  runBytes: number;
  eventBytes: number;
  pendingBytes: number;
  eventCount: number;
}
export interface CaptureSegment {
  file: string;
  bytes: number;
  events: number;
  sha256: string;
}
export interface CaptureManifest {
  schemaVersion: 1;
  captureId: string;
  projectId: string;
  synthetic: boolean;
  mode: 'metadata' | 'protocol';
  status: 'recording' | 'complete' | 'incomplete';
  startedAt: string;
  endedAt?: string;
  reason?: string;
  redactionPolicy: 'commander-local-v1';
  limits: CaptureLimits;
  counts: { events: number; bytes: number };
  segments: CaptureSegment[];
}
export interface CaptureRecorder extends CaptureSink { readonly directory?: string }
export interface CreateCaptureOptions {
  mode: CaptureMode;
  rootDirectory?: string;
  projectId: string;
  synthetic?: boolean;
  knownSecrets?: readonly string[];
  onStatus?: (status: CaptureStatus) => void;
}
export interface ReadCaptureResult {
  manifest: CaptureManifest;
  events: CaptureEvent[];
  complete: boolean;
}
