import type { CaptureManifest } from '../capture/types.js';

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface TrainingRow { prompt: ChatMessage[]; completion: { role: 'assistant'; content: string }[] }
export interface Candidate extends TrainingRow {
  schemaVersion: 1;
  id: string;
  captureId: string;
  projectId: string;
  synthetic: boolean;
  syntheticConditioning: boolean;
  sessionId: string;
  emissionId: string;
  eventId: string;
  sequence: number;
  sourceEventIds: string[];
  capabilityRef: string;
  capabilityOwners: Record<string, string>;
  verb: 'send' | 'reply' | 'broadcast' | 'status' | 'query';
  targetAgent?: string;
  targetPanel?: number;
  coverage: 'commander-visible';
}
export interface ReviewDecision {
  candidateId: string;
  candidateSha256: string;
  approved: boolean;
  quality: boolean;
  context: boolean;
  privacy: boolean;
  rights: boolean;
  reviewer: string;
  reviewedAt: string | null;
  notes: string;
}
export interface ReviewFile { schemaVersion: 1; manifestSha256: string; decisions: ReviewDecision[] }
export interface SourceProvenance { captureId: string; manifestSha256: string; manifest: CaptureManifest }
export interface Exclusion { captureId: string; eventId?: string; reason: string }
export interface PreparedManifest {
  schemaVersion: 1;
  kind: 'commander-candidates';
  recipe: 'commander-wire-v1';
  candidates: number;
  candidatesSha256: string;
  sources: SourceProvenance[];
  exclusions: Exclusion[];
  splitGroups: string[][];
  splitAssignments: Record<string, DatasetSplit>;
  warnings: string[];
  files: Record<string, string>;
}
export type DatasetSplit = 'train' | 'validation' | 'test';
export interface Sidecar {
  candidateId: string;
  candidateSha256: string;
  rowSha256: string;
  split: DatasetSplit;
  synthetic: boolean;
  syntheticConditioning: boolean;
  row: number;
  capabilityBindings: Record<string, string>;
  decision: ReviewDecision;
}
export interface ExportManifest {
  schemaVersion: 1;
  kind: 'commander-dataset';
  recipe: 'commander-wire-v1';
  seed: string;
  reviewManifestSha256: string;
  reviewSha256: string;
  sources: SourceProvenance[];
  counts: Record<string, number>;
  splitAssignments: Record<string, DatasetSplit>;
  warnings: string[];
  excludedDuplicates: string[];
  files: Record<string, string>;
}
