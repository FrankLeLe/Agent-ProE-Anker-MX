/** Versioned boundaries shared by memory, preparation, and confirmed export. */
import { z } from "zod";

export const identifierSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
export const skillIdSchema = z.enum(["report-outline", "requirements-checklist"]);
export type SkillId = z.infer<typeof skillIdSchema>;

export const sourceRefSchema = z.object({
  sourceId: identifierSchema,
  revision: z.number().int().positive(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
}).refine((value) => value.endMs >= value.startMs, { message: "endMs must not precede startMs" });
export type SourceRef = z.infer<typeof sourceRefSchema>;

export const sourceSchema = z.object({
  id: identifierSchema,
  ownerId: identifierSchema,
  contextId: identifierSchema,
  revision: z.number().int().positive(),
  state: z.enum(["active", "deleted"]),
  recordedAt: z.iso.datetime({ offset: true }),
  timezone: z.string().min(1).refine((value) => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; }
    catch (error) { if (error instanceof RangeError) return false; throw error; }
  }, { message: "timezone must be an IANA time zone" }),
  durationMs: z.number().int().nonnegative(),
  provenance: z.enum(["recording", "user_text", "synthetic"]),
});
export type Source = z.infer<typeof sourceSchema>;

export const memorySchema = z.object({
  id: identifierSchema,
  ownerId: identifierSchema,
  contextId: identifierSchema,
  text: z.string().min(1).max(20000),
  kind: z.enum(["fact", "decision", "constraint", "preference", "uncertain"]),
  provenance: z.enum(["ai_extracted", "user_confirmed", "synthetic", "user_entered"]),
  module: z.enum(["work", "life", "social", "inspiration", "unclassified"]),
  validFrom: z.iso.datetime({ offset: true }),
  validUntil: z.iso.datetime({ offset: true }).nullable(),
  supersedesId: identifierSchema.nullable(),
  sources: z.array(sourceRefSchema).min(1),
}).refine((value) => value.validUntil === null || Date.parse(value.validUntil) > Date.parse(value.validFrom), {
  message: "validUntil must be later than validFrom",
});
export type Memory = z.infer<typeof memorySchema>;

export const contextEvidenceScopeSchema = z.object({
  mode: z.enum(["all_active_context_records", "selected_record_ids"]),
  recordIds: z.array(identifierSchema).max(200),
}).superRefine((value, context) => {
  if (value.mode === "all_active_context_records" && value.recordIds.length > 0) {
    context.addIssue({ code: "custom", message: "The full-context scope cannot list individual record IDs" });
  }
}).default({ mode: "all_active_context_records", recordIds: [] });
export type ContextEvidenceScope = z.infer<typeof contextEvidenceScopeSchema>;

export const contextBundleSchema = z.object({
  contract: z.literal("context-bundle.v1"),
  id: identifierSchema,
  ownerId: identifierSchema,
  contextId: identifierSchema,
  createdAt: z.iso.datetime({ offset: true }),
  goal: z.string().min(1).max(10000),
  userRequirements: z.array(z.string().min(1).max(10000)),
  memories: z.array(memorySchema),
  gaps: z.array(z.string().min(1).max(10000)),
  evidenceScope: contextEvidenceScopeSchema,
});
export type ContextBundle = z.infer<typeof contextBundleSchema>;

export const artifactBlockSchema = z.object({
  id: identifierSchema,
  text: z.string().min(1).max(20000),
  basis: z.enum(["sourced", "user_authored", "inference", "gap"]),
  memoryIds: z.array(identifierSchema),
});
export const artifactSchema = z.object({
  contract: z.literal("prepared-artifact.v1"),
  id: identifierSchema,
  ownerId: identifierSchema,
  contextId: identifierSchema,
  skillId: skillIdSchema,
  version: z.number().int().positive(),
  previousVersion: z.number().int().positive().nullable(),
  contextBundleId: identifierSchema,
  title: z.string().min(1).max(200),
  userRequirements: z.array(z.string().min(1).max(10000)),
  sections: z.array(z.object({
    id: identifierSchema,
    title: z.string().min(1).max(200),
    blocks: z.array(artifactBlockSchema),
  })).min(1),
  savedAt: z.iso.datetime({ offset: true }),
}).refine((value) => value.previousVersion === null ? value.version === 1 : value.version === value.previousVersion + 1, {
  message: "Artifact version must advance exactly once from previousVersion",
});
export type PreparedArtifact = z.infer<typeof artifactSchema>;

export const templateSchema = z.object({
  id: skillIdSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  sections: z.array(z.object({ id: identifierSchema, title: z.string().min(1), required: z.boolean() })).min(1),
});
export type ArtifactTemplate = z.infer<typeof templateSchema>;

export const skillDefinitionSchema = z.object({
  id: skillIdSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  title: z.string().min(1),
  description: z.string().min(1),
  entrypoint: z.string().min(1),
  template: z.string().min(1),
  inputContract: z.literal("context-bundle.v1"),
  outputContract: z.literal("prepared-artifact.v1"),
  allowedTools: z.array(z.enum(["memory.query", "artifact.save"])).min(1),
  exportCapability: z.literal("artifact.export-docx"),
});
export const catalogSchema = z.object({ schemaVersion: z.literal(1), skills: z.array(skillDefinitionSchema).length(2) });
export type SkillDefinition = z.infer<typeof skillDefinitionSchema>;

export const exportPlanSchema = z.object({
  id: identifierSchema,
  ownerId: identifierSchema,
  artifactId: identifierSchema,
  artifactVersion: z.number().int().positive(),
  artifactHash: z.string().regex(/^[a-f0-9]{64}$/),
  contextBundleId: identifierSchema,
  version: z.number().int().positive(),
  capability: z.literal("artifact.export-docx"),
  target: z.literal("private-download"),
  filename: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.docx$/).max(180),
});
export type ExportPlan = z.infer<typeof exportPlanSchema>;

export const confirmationSchema = z.object({
  ownerId: identifierSchema,
  planId: identifierSchema,
  planHash: z.string().regex(/^[a-f0-9]{64}$/),
  confirmedAt: z.iso.datetime({ offset: true }),
  decision: z.enum(["approved", "rejected"]),
});
export type Confirmation = z.infer<typeof confirmationSchema>;

export const toolRunSchema = z.object({
  operationId: identifierSchema,
  ownerId: identifierSchema,
  planId: identifierSchema,
  planHash: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(["executing", "completed", "failed", "result_unknown", "cancelled"]),
  fileHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  storageKey: z.string().min(1).nullable(),
  byteLength: z.number().int().positive().nullable(),
  verifiedAt: z.iso.datetime({ offset: true }).nullable(),
  errorCode: z.string().min(1).nullable(),
}).superRefine((run, context) => {
  const fileFields: (string | number | null)[] = [run.fileHash, run.storageKey, run.byteLength];
  const supplied: number = fileFields.filter((value) => value !== null).length;
  if (supplied !== 0 && supplied !== fileFields.length) context.addIssue({ code: "custom", message: "Expected file identity must include hash, storage key, and length together" });
  if (run.state === "completed" && (supplied !== 3 || run.verifiedAt === null || run.errorCode !== null)) {
    context.addIssue({ code: "custom", message: "Completed operation requires complete file evidence, verifiedAt, and no errorCode" });
  }
  if (run.state !== "completed" && run.verifiedAt !== null) context.addIssue({ code: "custom", message: "Only completed operations can claim verified evidence" });
  if (run.state === "executing" && run.errorCode !== null) context.addIssue({ code: "custom", message: "Executing operations cannot contain a terminal error" });
});
export type ToolRun = z.infer<typeof toolRunSchema>;
