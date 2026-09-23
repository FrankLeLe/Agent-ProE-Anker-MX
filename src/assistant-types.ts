/** Durable assistant session and task contracts used by the local and hosted runtimes. */
import { z } from "zod";
import { identifierSchema } from "./contracts.ts";

const timestampSchema = z.iso.datetime({ offset: true });

export const assistantModeSchema = z.enum(["auto", "chat", "task"]);
export type AssistantMode = z.infer<typeof assistantModeSchema>;

export const assistantMessageRoleSchema = z.enum(["user", "assistant", "system"]);
export type AssistantMessageRole = z.infer<typeof assistantMessageRoleSchema>;

export const assistantSessionSchema = z.object({
  id: identifierSchema,
  ownerId: identifierSchema,
  mode: assistantModeSchema,
  title: z.string().min(1).max(200),
  contextId: identifierSchema.nullable(),
  contextRefs: z.array(identifierSchema).max(200),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type AssistantSession = z.infer<typeof assistantSessionSchema>;

export const assistantMessageSchema = z.object({
  id: identifierSchema,
  sessionId: identifierSchema,
  role: assistantMessageRoleSchema,
  content: z.string().min(1).max(20_000),
  createdAt: timestampSchema,
});
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;

export const assistantTaskStatusSchema = z.enum([
  "draft",
  "ready",
  "running",
  "waiting_input",
  "waiting_confirmation",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);
export type AssistantTaskStatus = z.infer<typeof assistantTaskStatusSchema>;

export const assistantStepStatusSchema = z.enum(["pending", "running", "completed", "waiting", "failed", "skipped"]);
export type AssistantStepStatus = z.infer<typeof assistantStepStatusSchema>;

export const assistantTaskStepSchema = z.object({
  id: identifierSchema,
  taskId: identifierSchema,
  title: z.string().min(1).max(200),
  detail: z.string().min(1).max(2_000),
  status: assistantStepStatusSchema,
  startedAt: timestampSchema.nullable(),
  finishedAt: timestampSchema.nullable(),
  error: z.string().min(1).max(2_000).nullable(),
});
export type AssistantTaskStep = z.infer<typeof assistantTaskStepSchema>;

export const assistantTaskSchema = z.object({
  id: identifierSchema,
  sessionId: identifierSchema,
  ownerId: identifierSchema,
  contextId: identifierSchema.nullable(),
  goal: z.string().min(1).max(10_000),
  requirements: z.array(z.string().min(1).max(2_000)).max(50).default([]),
  deliveryMode: z.enum(["docx", "content"]).nullable().default(null),
  status: assistantTaskStatusSchema,
  progress: z.number().int().min(0).max(100),
  currentStep: z.number().int().min(0),
  executor: z.enum(["local-preparation-service", "unavailable-external-tool"]),
  etaSeconds: z.number().int().nonnegative().nullable(),
  planVersion: z.number().int().positive(),
  runVersion: z.number().int().positive(),
  nextRunAt: timestampSchema.nullable(),
  artifactId: identifierSchema.nullable(),
  artifactVersion: z.number().int().positive().nullable(),
  exportOperationId: identifierSchema.nullable(),
  errorCode: z.string().min(1).max(200).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
});
export type AssistantTask = z.infer<typeof assistantTaskSchema>;

export const assistantEvidenceSchema = z.object({
  id: identifierSchema,
  taskId: identifierSchema,
  sourceType: z.literal("record"),
  sourceRef: identifierSchema,
  sourceRevision: z.number().int().positive(),
  summary: z.string().min(1).max(2_000),
  included: z.boolean(),
  excludedAt: timestampSchema.nullable(),
});
export type AssistantEvidence = z.infer<typeof assistantEvidenceSchema>;

export const assistantInputOptionSchema = z.object({
  id: identifierSchema,
  label: z.string().min(1).max(200),
  detail: z.string().min(1).max(1_000),
  recommended: z.boolean(),
});
export type AssistantInputOption = z.infer<typeof assistantInputOptionSchema>;

export const assistantInputRequestSchema = z.object({
  id: identifierSchema,
  taskId: identifierSchema,
  question: z.string().min(1).max(2_000),
  detail: z.string().min(1).max(2_000),
  options: z.array(assistantInputOptionSchema).min(2).max(3),
  selectedOptionId: identifierSchema.nullable(),
  status: z.enum(["open", "answered", "cancelled"]),
  createdAt: timestampSchema,
  answeredAt: timestampSchema.nullable(),
});
export type AssistantInputRequest = z.infer<typeof assistantInputRequestSchema>;

export const assistantConfirmationSchema = z.object({
  id: identifierSchema,
  taskId: identifierSchema,
  actionType: z.enum(["artifact.export-docx"]),
  title: z.string().min(1).max(200),
  detail: z.string().min(1).max(2_000),
  riskLevel: z.enum(["low", "medium", "high"]),
  artifactId: identifierSchema.nullable(),
  artifactVersion: z.number().int().positive().nullable(),
  planVersion: z.number().int().positive(),
  status: z.enum(["pending", "approved", "rejected", "expired"]),
  createdAt: timestampSchema,
  decidedAt: timestampSchema.nullable(),
});
export type AssistantConfirmation = z.infer<typeof assistantConfirmationSchema>;

export const assistantEventSchema = z.object({
  id: identifierSchema,
  taskId: identifierSchema.nullable(),
  kind: z.enum(["task-created", "task-started", "step-completed", "input-requested", "confirmation-requested", "task-completed", "task-failed", "task-paused", "task-resumed", "task-cancelled", "evidence-updated", "requirement-added", "plan-updated"]),
  summary: z.string().min(1).max(2_000),
  createdAt: timestampSchema,
});
export type AssistantEvent = z.infer<typeof assistantEventSchema>;

export const assistantStateSchema = z.object({
  schemaVersion: z.literal(1),
  sessions: z.array(assistantSessionSchema),
  messages: z.array(assistantMessageSchema),
  tasks: z.array(assistantTaskSchema),
  steps: z.array(assistantTaskStepSchema),
  evidence: z.array(assistantEvidenceSchema),
  inputRequests: z.array(assistantInputRequestSchema),
  confirmations: z.array(assistantConfirmationSchema),
  events: z.array(assistantEventSchema),
});
export type AssistantState = z.infer<typeof assistantStateSchema>;
export type AssistantSnapshot = AssistantState;

export function emptyAssistantState(): AssistantState {
  return {
    schemaVersion: 1,
    sessions: [],
    messages: [],
    tasks: [],
    steps: [],
    evidence: [],
    inputRequests: [],
    confirmations: [],
    events: [],
  };
}
