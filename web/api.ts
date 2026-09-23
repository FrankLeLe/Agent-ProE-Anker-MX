/** Browser response boundaries are decoded before entering view state. */
import type { ContextBundle, ExportPlan, Memory, PreparedArtifact, SourceRef } from "../src/contracts.ts";
import type { AssistantConfirmation, AssistantEvidence, AssistantEvent, AssistantInputRequest, AssistantMessage, AssistantSession, AssistantSnapshot, AssistantTask, AssistantTaskStep } from "../src/assistant-types.ts";
import type { AssistantOperationResponse, ExportPlanResponse, ExportResponse, H5ExportReceipt, H5Matter, H5Record, H5Snapshot, H5Suggestion, PreparationResponse } from "../src/h5-types.ts";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

function invalid(path: string): never { throw new ApiError("INVALID_RESPONSE", `服务返回的数据不完整：${path}。请刷新以重新读取；你的未保存文字仍保留在此浏览器。`, 502); }
export function object(value: JsonValue | undefined, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid(path);
  return value;
}
export function string(value: JsonValue | undefined, path: string): string {
  if (typeof value !== "string") return invalid(path);
  return value;
}
function integer(value: JsonValue | undefined, path: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) return invalid(path);
  return value;
}
export function array(value: JsonValue | undefined, path: string): JsonValue[] {
  if (!Array.isArray(value)) return invalid(path);
  return value;
}
function strings(value: JsonValue | undefined, path: string): string[] { return array(value, path).map((item, index) => string(item, `${path}[${index}]`)); }
function enumeration<T extends string>(value: JsonValue | undefined, options: readonly T[], path: string): T {
  const result: T | undefined = options.find((option) => option === value);
  if (result === undefined) return invalid(path);
  return result;
}
function date(value: JsonValue | undefined, path: string): string {
  const result: string = string(value, path);
  if (!Number.isFinite(Date.parse(result))) return invalid(path);
  return result;
}
function nullableString(value: JsonValue | undefined, path: string): string | null { return value === null ? null : string(value, path); }
function sourceRef(value: JsonValue): SourceRef {
  const v: JsonObject = object(value, "source");
  const result: SourceRef = { sourceId: string(v.sourceId, "source.sourceId"), revision: integer(v.revision, "source.revision", 1), startMs: integer(v.startMs, "source.startMs", 0), endMs: integer(v.endMs, "source.endMs", 0) };
  if (result.endMs < result.startMs) return invalid("source.endMs");
  return result;
}
function memory(value: JsonValue): Memory {
  const v: JsonObject = object(value, "memory");
  return { id: string(v.id, "memory.id"), ownerId: string(v.ownerId, "memory.ownerId"), contextId: string(v.contextId, "memory.contextId"), text: string(v.text, "memory.text"), kind: enumeration(v.kind, ["fact", "decision", "constraint", "preference", "uncertain"], "memory.kind"), provenance: enumeration(v.provenance, ["ai_extracted", "user_confirmed", "synthetic", "user_entered"], "memory.provenance"), module: enumeration(v.module, ["work", "life", "social", "inspiration", "unclassified"], "memory.module"), validFrom: date(v.validFrom, "memory.validFrom"), validUntil: v.validUntil === null ? null : date(v.validUntil, "memory.validUntil"), supersedesId: nullableString(v.supersedesId, "memory.supersedesId"), sources: array(v.sources, "memory.sources").map(sourceRef) };
}
function contextEvidenceScope(value: JsonValue | undefined): ContextBundle["evidenceScope"] {
  if (value === undefined) return { mode: "all_active_context_records", recordIds: [] };
  const v: JsonObject = object(value, "context.evidenceScope");
  const mode = enumeration(v.mode, ["all_active_context_records", "selected_record_ids"], "context.evidenceScope.mode");
  const recordIds = strings(v.recordIds, "context.evidenceScope.recordIds");
  if (mode === "all_active_context_records" && recordIds.length > 0) return invalid("context.evidenceScope.recordIds");
  return { mode, recordIds };
}
function context(value: JsonValue): ContextBundle {
  const v: JsonObject = object(value, "context");
  return { contract: enumeration(v.contract, ["context-bundle.v1"], "context.contract"), id: string(v.id, "context.id"), ownerId: string(v.ownerId, "context.ownerId"), contextId: string(v.contextId, "context.contextId"), createdAt: date(v.createdAt, "context.createdAt"), goal: string(v.goal, "context.goal"), userRequirements: strings(v.userRequirements, "context.userRequirements"), memories: array(v.memories, "context.memories").map(memory), gaps: strings(v.gaps, "context.gaps"), evidenceScope: contextEvidenceScope(v.evidenceScope) };
}
function record(value: JsonValue): H5Record {
  const v: JsonObject = object(value, "record");
  return { id: string(v.id, "record.id"), contextId: string(v.contextId, "record.contextId"), title: string(v.title, "record.title"), text: string(v.text, "record.text"), module: enumeration(v.module, ["work", "life", "social", "inspiration"], "record.module"), recordedAt: date(v.recordedAt, "record.recordedAt"), durationSeconds: v.durationSeconds === null ? null : integer(v.durationSeconds, "record.durationSeconds", 0), provenance: enumeration(v.provenance, ["synthetic", "user_text"], "record.provenance"), revision: integer(v.revision, "record.revision", 1), state: enumeration(v.state, ["active", "deleted"], "record.state"), cover: enumeration(v.cover, ["commute", "desk", "run", "none"], "record.cover") };
}
function matter(value: JsonValue): H5Matter {
  const v: JsonObject = object(value, "matter");
  return { id: string(v.id, "matter.id"), title: string(v.title, "matter.title"), goal: string(v.goal, "matter.goal"), dueAt: date(v.dueAt, "matter.dueAt"), participants: strings(v.participants, "matter.participants"), durationMinutes: integer(v.durationMinutes, "matter.durationMinutes", 0), provenance: enumeration(v.provenance, ["synthetic", "user_entered"], "matter.provenance") };
}
function suggestion(value: JsonValue): H5Suggestion {
  const v: JsonObject = object(value, "suggestion");
  return { id: string(v.id, "suggestion.id"), matterId: string(v.matterId, "suggestion.matterId"), title: string(v.title, "suggestion.title"), reason: string(v.reason, "suggestion.reason"), dueAt: date(v.dueAt, "suggestion.dueAt"), sourceIds: strings(v.sourceIds, "suggestion.sourceIds"), state: enumeration(v.state, ["available", "snoozed", "dismissed", "prepared"], "suggestion.state"), snoozedUntil: v.snoozedUntil === null ? null : date(v.snoozedUntil, "suggestion.snoozedUntil"), artifactId: nullableString(v.artifactId, "suggestion.artifactId") };
}
function artifact(value: JsonValue): PreparedArtifact {
  const v: JsonObject = object(value, "artifact");
  const result: PreparedArtifact = {
    contract: enumeration(v.contract, ["prepared-artifact.v1"], "artifact.contract"), id: string(v.id, "artifact.id"), ownerId: string(v.ownerId, "artifact.ownerId"), contextId: string(v.contextId, "artifact.contextId"), skillId: enumeration(v.skillId, ["report-outline", "requirements-checklist"], "artifact.skillId"), version: integer(v.version, "artifact.version", 1), previousVersion: v.previousVersion === null ? null : integer(v.previousVersion, "artifact.previousVersion", 1), contextBundleId: string(v.contextBundleId, "artifact.contextBundleId"), title: string(v.title, "artifact.title"), userRequirements: strings(v.userRequirements, "artifact.userRequirements"), savedAt: date(v.savedAt, "artifact.savedAt"),
    sections: array(v.sections, "artifact.sections").map((sectionValue) => {
      const section: JsonObject = object(sectionValue, "section");
      return { id: string(section.id, "section.id"), title: string(section.title, "section.title"), blocks: array(section.blocks, "section.blocks").map((blockValue) => {
        const block: JsonObject = object(blockValue, "block");
        return { id: string(block.id, "block.id"), text: string(block.text, "block.text"), basis: enumeration(block.basis, ["sourced", "user_authored", "inference", "gap"], "block.basis"), memoryIds: strings(block.memoryIds, "block.memoryIds") };
      }) };
    }),
  };
  if (result.sections.length === 0 || result.version !== (result.previousVersion === null ? 1 : result.previousVersion + 1)) return invalid("artifact.version/sections");
  return result;
}
function receipt(value: JsonValue): H5ExportReceipt {
  const v: JsonObject = object(value, "receipt");
  const downloadUrl: string = string(v.downloadUrl, "receipt.downloadUrl");
  if (!downloadUrl.startsWith("/api/") || downloadUrl.includes("\\") || downloadUrl.includes("..")) return invalid("receipt.downloadUrl");
  return { operationId: string(v.operationId, "receipt.operationId"), artifactId: string(v.artifactId, "receipt.artifactId"), artifactVersion: integer(v.artifactVersion, "receipt.artifactVersion", 1), filename: string(v.filename, "receipt.filename"), state: enumeration(v.state, ["completed"], "receipt.state"), verifiedAt: date(v.verifiedAt, "receipt.verifiedAt"), byteLength: integer(v.byteLength, "receipt.byteLength", 1), downloadUrl };
}
function assistantSession(value: JsonValue): AssistantSession {
  const v: JsonObject = object(value, "assistant.session");
  return { id: string(v.id, "assistant.session.id"), ownerId: string(v.ownerId, "assistant.session.ownerId"), mode: enumeration(v.mode, ["auto", "chat", "task"], "assistant.session.mode"), title: string(v.title, "assistant.session.title"), contextId: nullableString(v.contextId, "assistant.session.contextId"), contextRefs: strings(v.contextRefs, "assistant.session.contextRefs"), createdAt: date(v.createdAt, "assistant.session.createdAt"), updatedAt: date(v.updatedAt, "assistant.session.updatedAt") };
}
function assistantMessage(value: JsonValue): AssistantMessage {
  const v: JsonObject = object(value, "assistant.message");
  return { id: string(v.id, "assistant.message.id"), sessionId: string(v.sessionId, "assistant.message.sessionId"), role: enumeration(v.role, ["user", "assistant", "system"], "assistant.message.role"), content: string(v.content, "assistant.message.content"), createdAt: date(v.createdAt, "assistant.message.createdAt") };
}
function assistantTask(value: JsonValue): AssistantTask {
  const v: JsonObject = object(value, "assistant.task");
  return {
    id: string(v.id, "assistant.task.id"), sessionId: string(v.sessionId, "assistant.task.sessionId"), ownerId: string(v.ownerId, "assistant.task.ownerId"), contextId: nullableString(v.contextId, "assistant.task.contextId"), goal: string(v.goal, "assistant.task.goal"), requirements: v.requirements === undefined ? [] : strings(v.requirements, "assistant.task.requirements"),
    deliveryMode: v.deliveryMode === undefined || v.deliveryMode === null ? null : v.deliveryMode === "docx" || v.deliveryMode === "content" ? v.deliveryMode : invalid("assistant.task.deliveryMode"), status: enumeration(v.status, ["draft", "ready", "running", "waiting_input", "waiting_confirmation", "paused", "completed", "failed", "cancelled"], "assistant.task.status"), progress: integer(v.progress, "assistant.task.progress", 0), currentStep: integer(v.currentStep, "assistant.task.currentStep", 0), executor: enumeration(v.executor, ["local-preparation-service", "unavailable-external-tool"], "assistant.task.executor"), etaSeconds: v.etaSeconds === null ? null : integer(v.etaSeconds, "assistant.task.etaSeconds", 0), planVersion: integer(v.planVersion, "assistant.task.planVersion", 1), runVersion: integer(v.runVersion, "assistant.task.runVersion", 1), nextRunAt: v.nextRunAt === null ? null : date(v.nextRunAt, "assistant.task.nextRunAt"), artifactId: nullableString(v.artifactId, "assistant.task.artifactId"), artifactVersion: v.artifactVersion === null ? null : integer(v.artifactVersion, "assistant.task.artifactVersion", 1), exportOperationId: nullableString(v.exportOperationId, "assistant.task.exportOperationId"), errorCode: nullableString(v.errorCode, "assistant.task.errorCode"), createdAt: date(v.createdAt, "assistant.task.createdAt"), updatedAt: date(v.updatedAt, "assistant.task.updatedAt"), completedAt: v.completedAt === null ? null : date(v.completedAt, "assistant.task.completedAt"),
  };
}
function assistantStep(value: JsonValue): AssistantTaskStep {
  const v: JsonObject = object(value, "assistant.step");
  return { id: string(v.id, "assistant.step.id"), taskId: string(v.taskId, "assistant.step.taskId"), title: string(v.title, "assistant.step.title"), detail: string(v.detail, "assistant.step.detail"), status: enumeration(v.status, ["pending", "running", "completed", "waiting", "failed", "skipped"], "assistant.step.status"), startedAt: v.startedAt === null ? null : date(v.startedAt, "assistant.step.startedAt"), finishedAt: v.finishedAt === null ? null : date(v.finishedAt, "assistant.step.finishedAt"), error: nullableString(v.error, "assistant.step.error") };
}
function assistantEvidence(value: JsonValue): AssistantEvidence {
  const v: JsonObject = object(value, "assistant.evidence");
  return { id: string(v.id, "assistant.evidence.id"), taskId: string(v.taskId, "assistant.evidence.taskId"), sourceType: enumeration(v.sourceType, ["record"], "assistant.evidence.sourceType"), sourceRef: string(v.sourceRef, "assistant.evidence.sourceRef"), sourceRevision: integer(v.sourceRevision, "assistant.evidence.sourceRevision", 1), summary: string(v.summary, "assistant.evidence.summary"), included: typeof v.included === "boolean" ? v.included : invalid("assistant.evidence.included"), excludedAt: v.excludedAt === null ? null : date(v.excludedAt, "assistant.evidence.excludedAt") };
}
function assistantInputRequest(value: JsonValue): AssistantInputRequest {
  const v: JsonObject = object(value, "assistant.inputRequest");
  return {
    id: string(v.id, "assistant.inputRequest.id"), taskId: string(v.taskId, "assistant.inputRequest.taskId"), question: string(v.question, "assistant.inputRequest.question"), detail: string(v.detail, "assistant.inputRequest.detail"),
    options: array(v.options, "assistant.inputRequest.options").map((item, index) => {
      const option: JsonObject = object(item, `assistant.inputRequest.options[${index}]`);
      return { id: string(option.id, `assistant.inputRequest.options[${index}].id`), label: string(option.label, `assistant.inputRequest.options[${index}].label`), detail: string(option.detail, `assistant.inputRequest.options[${index}].detail`), recommended: typeof option.recommended === "boolean" ? option.recommended : invalid(`assistant.inputRequest.options[${index}].recommended`) };
    }),
    selectedOptionId: nullableString(v.selectedOptionId, "assistant.inputRequest.selectedOptionId"), status: enumeration(v.status, ["open", "answered", "cancelled"], "assistant.inputRequest.status"), createdAt: date(v.createdAt, "assistant.inputRequest.createdAt"), answeredAt: v.answeredAt === null ? null : date(v.answeredAt, "assistant.inputRequest.answeredAt"),
  };
}
function assistantConfirmation(value: JsonValue): AssistantConfirmation {
  const v: JsonObject = object(value, "assistant.confirmation");
  return { id: string(v.id, "assistant.confirmation.id"), taskId: string(v.taskId, "assistant.confirmation.taskId"), actionType: enumeration(v.actionType, ["artifact.export-docx"], "assistant.confirmation.actionType"), title: string(v.title, "assistant.confirmation.title"), detail: string(v.detail, "assistant.confirmation.detail"), riskLevel: enumeration(v.riskLevel, ["low", "medium", "high"], "assistant.confirmation.riskLevel"), artifactId: nullableString(v.artifactId, "assistant.confirmation.artifactId"), artifactVersion: v.artifactVersion === null ? null : integer(v.artifactVersion, "assistant.confirmation.artifactVersion", 1), planVersion: integer(v.planVersion, "assistant.confirmation.planVersion", 1), status: enumeration(v.status, ["pending", "approved", "rejected", "expired"], "assistant.confirmation.status"), createdAt: date(v.createdAt, "assistant.confirmation.createdAt"), decidedAt: v.decidedAt === null ? null : date(v.decidedAt, "assistant.confirmation.decidedAt") };
}
function assistantEvent(value: JsonValue): AssistantEvent {
  const v: JsonObject = object(value, "assistant.event");
  return { id: string(v.id, "assistant.event.id"), taskId: nullableString(v.taskId, "assistant.event.taskId"), kind: enumeration(v.kind, ["task-created", "task-started", "step-completed", "input-requested", "confirmation-requested", "task-completed", "task-failed", "task-paused", "task-resumed", "task-cancelled", "evidence-updated", "requirement-added", "plan-updated"], "assistant.event.kind"), summary: string(v.summary, "assistant.event.summary"), createdAt: date(v.createdAt, "assistant.event.createdAt") };
}
function assistant(value: JsonValue | undefined): AssistantSnapshot {
  const v: JsonObject = object(value, "snapshot.assistant");
  if (integer(v.schemaVersion, "assistant.schemaVersion", 1) !== 1) return invalid("assistant.schemaVersion");
  return { schemaVersion: 1, sessions: array(v.sessions, "assistant.sessions").map(assistantSession), messages: array(v.messages, "assistant.messages").map(assistantMessage), tasks: array(v.tasks, "assistant.tasks").map(assistantTask), steps: array(v.steps, "assistant.steps").map(assistantStep), evidence: array(v.evidence, "assistant.evidence").map(assistantEvidence), inputRequests: array(v.inputRequests, "assistant.inputRequests").map(assistantInputRequest), confirmations: array(v.confirmations, "assistant.confirmations").map(assistantConfirmation), events: array(v.events, "assistant.events").map(assistantEvent) };
}
export function snapshot(value: JsonValue): H5Snapshot {
  const v: JsonObject = object(value, "snapshot");
  return { revision: integer(v.revision, "snapshot.revision", 0), mode: enumeration(v.mode, ["local-preview", "hosted-private"], "snapshot.mode"), now: date(v.now, "snapshot.now"), records: array(v.records, "snapshot.records").map(record), matters: array(v.matters, "snapshot.matters").map(matter), suggestions: array(v.suggestions, "snapshot.suggestions").map(suggestion), artifacts: array(v.artifacts, "snapshot.artifacts").map(artifact), contexts: array(v.contexts, "snapshot.contexts").map(context), exports: array(v.exports, "snapshot.exports").map(receipt), assistant: assistant(v.assistant) };
}
export function assistantOperation(value: JsonValue): AssistantOperationResponse {
  const v: JsonObject = object(value, "assistant operation");
  const confirmation = v.confirmation;
  if (v.snapshot === undefined || confirmation === undefined) return invalid("assistant operation.snapshot/confirmation");
  return { snapshot: snapshot(v.snapshot), sessionId: nullableString(v.sessionId, "assistant operation.sessionId"), taskId: nullableString(v.taskId, "assistant operation.taskId"), confirmation: confirmation === null ? null : assistantConfirmation(confirmation) };
}
export function preparation(value: JsonValue): PreparationResponse {
  const v: JsonObject = object(value, "preparation");
  if (v.snapshot === undefined) return invalid("preparation.snapshot");
  return { snapshot: snapshot(v.snapshot), artifactId: string(v.artifactId, "preparation.artifactId") };
}
export function exportPlan(value: JsonValue): ExportPlanResponse {
  const v: JsonObject = object(value, "exportPlan");
  const p: JsonObject = object(v.plan, "exportPlan.plan");
  const plan: ExportPlan = { id: string(p.id, "plan.id"), ownerId: string(p.ownerId, "plan.ownerId"), artifactId: string(p.artifactId, "plan.artifactId"), artifactVersion: integer(p.artifactVersion, "plan.artifactVersion", 1), artifactHash: string(p.artifactHash, "plan.artifactHash"), contextBundleId: string(p.contextBundleId, "plan.contextBundleId"), version: integer(p.version, "plan.version", 1), capability: enumeration(p.capability, ["artifact.export-docx"], "plan.capability"), target: enumeration(p.target, ["private-download"], "plan.target"), filename: string(p.filename, "plan.filename") };
  const planHash: string = string(v.planHash, "planHash");
  if (!/^[a-f0-9]{64}$/.test(planHash) || !/^[a-f0-9]{64}$/.test(plan.artifactHash) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.docx$/.test(plan.filename)) return invalid("exportPlan.hash/filename");
  return { plan, planHash };
}
export function exportResult(value: JsonValue): ExportResponse {
  const v: JsonObject = object(value, "exportResult");
  if (v.snapshot === undefined || v.receipt === undefined) return invalid("exportResult");
  return { snapshot: snapshot(v.snapshot), receipt: receipt(v.receipt) };
}
export async function request(path: string, method: "GET" | "POST" | "PATCH", body: string | null): Promise<JsonValue> {
  let response: Response;
  try {
    response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, ...(body === null ? {} : { body }) });
  } catch (error) {
    if (error instanceof TypeError) throw new ApiError("NETWORK_UNAVAILABLE", `${method} ${path} 无法连接。请检查服务与网络后重试；未保存文字已保留。`, 0);
    throw error;
  }
  let value: JsonValue;
  try { value = JSON.parse(await response.text()); }
  catch (error) {
    if (error instanceof SyntaxError) throw new ApiError("INVALID_JSON", `${method} ${path} 返回非 JSON 内容（HTTP ${response.status}）。请检查服务日志后重新加载。`, response.status);
    throw error;
  }
  if (!response.ok) {
    const envelope: JsonObject = object(value, "error response");
    const detail: JsonObject = object(envelope.error, "error");
    throw new ApiError(string(detail.code, "error.code"), `${string(detail.message, "error.message")}（HTTP ${response.status} · ${method} ${path}）`, response.status);
  }
  return value;
}
