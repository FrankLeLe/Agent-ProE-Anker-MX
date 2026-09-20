/** Shared local H5 boundaries; synthetic records are always distinguishable from user input. */
import type { ContextBundle, ExportPlan, PreparedArtifact, SkillId } from "./contracts.ts";

export type RecordModule = "work" | "life" | "social" | "inspiration";
export type RecordCover = "commute" | "desk" | "run" | "none";
export interface H5Record {
  id: string;
  contextId: string;
  title: string;
  text: string;
  module: RecordModule;
  recordedAt: string;
  durationSeconds: number | null;
  provenance: "synthetic" | "user_text";
  revision: number;
  state: "active" | "deleted";
  cover: RecordCover;
}
export interface H5Matter {
  id: string;
  title: string;
  goal: string;
  dueAt: string;
  participants: string[];
  durationMinutes: number;
  provenance: "synthetic" | "user_entered";
}
export interface H5Suggestion {
  id: string;
  matterId: string;
  title: string;
  reason: string;
  dueAt: string;
  sourceIds: string[];
  state: "available" | "snoozed" | "dismissed" | "prepared";
  snoozedUntil: string | null;
  artifactId: string | null;
}
export interface H5ExportReceipt {
  operationId: string;
  artifactId: string;
  artifactVersion: number;
  filename: string;
  state: "completed";
  verifiedAt: string;
  byteLength: number;
  downloadUrl: string;
}
export interface H5Snapshot {
  revision: number;
  mode: "local-preview" | "hosted-private";
  now: string;
  records: H5Record[];
  matters: H5Matter[];
  suggestions: H5Suggestion[];
  artifacts: PreparedArtifact[];
  contexts: ContextBundle[];
  exports: H5ExportReceipt[];
}
export interface AddRecordInput {
  requestId: string;
  contextId: string;
  title: string;
  text: string;
  module: RecordModule;
}
export interface AddMatterInput {
  requestId: string;
  title: string;
  goal: string;
  dueAt: string;
  durationMinutes: number;
  participants: string[];
}
export interface ReviseRecordInput {
  requestId: string;
  expectedRevision: number;
  title: string;
  text: string;
}
export interface SuggestionDecisionInput {
  requestId: string;
  decision: "snooze" | "dismiss" | "restore";
}
export interface PrepareInput {
  requestId: string;
  matterId: string;
  skillId: SkillId;
  requirements: string[];
}
export interface ArtifactRevisionInput {
  requestId: string;
  expectedVersion: number;
  sections: { id: string; blocks: { id: string; text: string }[] }[];
}
export interface PreparationResponse {
  snapshot: H5Snapshot;
  artifactId: string;
}
export interface ExportPlanInput { artifactId: string; artifactVersion: number; }
export interface ExportPlanResponse { plan: ExportPlan; planHash: string; }
export interface ConfirmExportInput {
  requestId: string;
  plan: ExportPlan;
  planHash: string;
  decision: "approved";
}
export interface ExportResponse { snapshot: H5Snapshot; receipt: H5ExportReceipt; }
export interface H5ErrorResponse { error: { code: string; message: string }; }
