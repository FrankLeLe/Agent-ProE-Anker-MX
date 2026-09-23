/** Single-owner commands over a request-scoped store with optimistic persistence. */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assistantModeSchema } from "./assistant-types.ts";
import type { AssistantConfirmation, AssistantEvent, AssistantMode, AssistantState, AssistantTask, AssistantTaskStep } from "./assistant-types.ts";
import { beginToolRun, createExportPlan, hashPlan } from "./actions.ts";
import { validateArtifactRevision } from "./artifacts.ts";
import { exportPlanSchema, identifierSchema, skillIdSchema } from "./contracts.ts";
import type { ArtifactTemplate, ContextBundle, ExportPlan, PreparedArtifact, SkillId, ToolRun } from "./contracts.ts";
import type { ArtifactStorage } from "./docx-export.ts";
import { hashBytes } from "./docx-export.ts";
import { DomainError } from "./errors.ts";
import { executeConfirmedExport, reconcileConfirmedExport } from "./export-service.ts";
import type { CurrentEvidence, ExportRequest, RunStore } from "./export-service.ts";
import { fingerprint } from "./h5-state.ts";
import type { H5StateStore, LocalState, SavedRequest } from "./h5-state.ts";
import { assertFullContextCurrent, currentContext, evidenceForContext, matterFromState, prepareFromTemplate, suggestionsFromState } from "./h5-preparation.ts";
import type { AddMatterInput, AddRecordInput, ArtifactRevisionInput, AssistantAnswerInput, AssistantConfirmInput, AssistantCreateSessionInput, AssistantEvidenceInput, AssistantOperationResponse, AssistantPlanInput, AssistantRequirementInput, AssistantStartTaskInput, AssistantTaskActionInput, AssistantUpgradeInput, ConfirmExportInput, ExportPlanInput, ExportPlanResponse, ExportResponse, H5ExportReceipt, H5Matter, H5Record, H5Snapshot, PreparationResponse, PrepareInput, ReviseRecordInput, SuggestionDecisionInput } from "./h5-types.ts";

export const addRecordSchema: z.ZodType<AddRecordInput> = z.object({
  requestId: identifierSchema, contextId: identifierSchema, title: z.string().trim().min(1).max(200), text: z.string().trim().min(1).max(20000), module: z.enum(["work", "life", "social", "inspiration"]),
});
export const addMatterSchema: z.ZodType<AddMatterInput> = z.object({
  requestId: identifierSchema, title: z.string().trim().min(1).max(200), goal: z.string().trim().min(1).max(10000),
  dueAt: z.iso.datetime({ offset: true }), durationMinutes: z.number().int().min(1).max(1440),
  participants: z.array(z.string().trim().min(1).max(100)).max(30),
});
export const reviseRecordSchema: z.ZodType<ReviseRecordInput> = z.object({
  requestId: identifierSchema, expectedRevision: z.number().int().positive(), title: z.string().trim().min(1).max(200), text: z.string().trim().min(1).max(20000),
});
export const suggestionDecisionSchema: z.ZodType<SuggestionDecisionInput> = z.object({
  requestId: identifierSchema,
  decision: z.enum(["snooze", "dismiss", "restore"]),
  snoozeMinutes: z.union([z.literal(60), z.literal(180), z.literal(1440)]).optional(),
}).superRefine((input, context) => {
  if (input.decision !== "snooze" && input.snoozeMinutes !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["snoozeMinutes"], message: "只可在稍后提醒时设置提醒时长" });
});
export const prepareSchema: z.ZodType<PrepareInput> = z.object({ requestId: identifierSchema, matterId: identifierSchema, skillId: skillIdSchema, requirements: z.array(z.string().trim().min(1).max(10000)).max(30) });
export const artifactRevisionSchema: z.ZodType<ArtifactRevisionInput> = z.object({
  requestId: identifierSchema, expectedVersion: z.number().int().positive(),
  sections: z.array(z.object({ id: identifierSchema, blocks: z.array(z.object({ id: identifierSchema, text: z.string().trim().min(1).max(20000) })).min(1).max(200) })).min(1).max(20),
});
export const exportPlanInputSchema: z.ZodType<ExportPlanInput> = z.object({ artifactId: identifierSchema, artifactVersion: z.number().int().positive() });
export const confirmExportSchema: z.ZodType<ConfirmExportInput> = z.object({ requestId: identifierSchema, plan: exportPlanSchema, planHash: z.string().regex(/^[a-f0-9]{64}$/), decision: z.literal("approved") });
export const assistantCreateSessionSchema: z.ZodType<AssistantCreateSessionInput> = z.object({
  requestId: identifierSchema,
  mode: assistantModeSchema,
  content: z.string().trim().min(1).max(10_000),
  contextId: identifierSchema.nullable(),
});
export const assistantUpgradeSchema: z.ZodType<AssistantUpgradeInput> = z.object({ requestId: identifierSchema, contextId: identifierSchema.nullable() });
export const assistantStartTaskSchema: z.ZodType<AssistantStartTaskInput> = z.object({ requestId: identifierSchema });
export const assistantAnswerSchema: z.ZodType<AssistantAnswerInput> = z.object({ requestId: identifierSchema, inputRequestId: identifierSchema, optionId: identifierSchema });
export const assistantPlanSchema: z.ZodType<AssistantPlanInput> = z.object({ requestId: identifierSchema, deliveryMode: z.enum(["docx", "content"]) });
export const assistantConfirmSchema: z.ZodType<AssistantConfirmInput> = z.object({ requestId: identifierSchema, confirmationId: identifierSchema, decision: z.enum(["approved", "rejected"]) });
export const assistantTaskActionSchema: z.ZodType<AssistantTaskActionInput> = z.object({ requestId: identifierSchema, action: z.enum(["pause", "resume", "cancel", "retry"]) });
export const assistantEvidenceSchema: z.ZodType<AssistantEvidenceInput> = z.object({ requestId: identifierSchema, included: z.boolean() });
export const assistantRequirementSchema: z.ZodType<AssistantRequirementInput> = z.object({ requestId: identifierSchema, content: z.string().trim().min(1).max(2_000) });

export interface H5ServiceOptions { workspaceRoot: string; dataRoot: string; now: () => string; }
export interface H5Runtime { now: () => string; mode: H5Snapshot["mode"]; ownerId: string; loadTemplate: (id: SkillId) => Promise<ArtifactTemplate>; storage: ArtifactStorage; }
export interface DownloadResult { bytes: Buffer; filename: string; }

function latestArtifact(state: LocalState, id: string): PreparedArtifact {
  const artifact: PreparedArtifact | undefined = [...state.artifacts].reverse().find((item) => item.id === id);
  if (artifact === undefined) throw new DomainError("ARTIFACT_NOT_FOUND", `成果 ${id} 不存在；请先准备并保存成果。`, 404);
  return artifact;
}

function savedContext(state: LocalState, artifact: PreparedArtifact): ContextBundle {
  const context: ContextBundle | undefined = state.contexts.find((item) => item.id === artifact.contextBundleId);
  if (context === undefined) throw new DomainError("CONTEXT_NOT_FOUND", "成果背景不存在，请重新准备。", 409);
  return context;
}

function checkRequest(state: LocalState, kind: string, input: { requestId: string }, scope: string): SavedRequest | undefined {
  const previous: SavedRequest | undefined = state.requests.find((item) => item.requestId === input.requestId);
  if (previous !== undefined && (previous.kind !== kind || previous.fingerprint !== fingerprint({ scope, input }))) {
    throw new DomainError("REQUEST_ID_CONFLICT", "该 requestId 已用于其他内容；请保留原请求以重试，或为新的操作创建新 requestId。", 409);
  }
  return previous;
}

function appendRequest(state: LocalState, kind: string, input: { requestId: string }, scope: string, artifactId: string | null, operationId: string | null, sessionId: string | null = null, taskId: string | null = null): LocalState {
  return { ...state, requests: [...state.requests, { requestId: input.requestId, fingerprint: fingerprint({ scope, input }), kind, artifactId, operationId, sessionId, taskId }] };
}

function assistantTaskFromState(state: LocalState, id: string): AssistantTask {
  const task: AssistantTask | undefined = state.assistant.tasks.find((item) => item.id === id);
  if (task === undefined) throw new DomainError("ASSISTANT_TASK_NOT_FOUND", "该任务不存在或已经无法访问，请重新读取任务列表。", 404);
  return task;
}

function assistantSessionFromState(state: LocalState, id: string) {
  const session = state.assistant.sessions.find((item) => item.id === id);
  if (session === undefined) throw new DomainError("ASSISTANT_SESSION_NOT_FOUND", "该对话不存在或已经无法访问，请重新返回助手首页。", 404);
  return session;
}

function taskStepsFromState(state: LocalState, taskId: string): AssistantTaskStep[] {
  return state.assistant.steps.filter((item) => item.taskId === taskId);
}

function isTaskIntent(content: string): boolean {
  return /文件|文档|汇报|同步|准备|导出|日历|发送|提交|任务|执行|整理成/.test(content);
}

function updateAssistantTask(assistant: AssistantState, task: AssistantTask): AssistantState {
  return { ...assistant, tasks: assistant.tasks.map((item) => item.id === task.id ? task : item) };
}

function updateAssistantStep(assistant: AssistantState, step: AssistantTaskStep): AssistantState {
  return { ...assistant, steps: assistant.steps.map((item) => item.id === step.id ? step : item) };
}

function appendAssistantEvent(assistant: AssistantState, taskId: string | null, kind: AssistantEvent["kind"], summary: string, createdAt: string): AssistantState {
  return { ...assistant, events: [...assistant.events, { id: `assistant-event-${randomUUID()}`, taskId, kind, summary, createdAt }].slice(-500) };
}

export class H5Service implements RunStore {
  readonly store: H5StateStore;
  readonly options: H5Runtime;
  readonly storage: ArtifactStorage;

  constructor(store: H5StateStore, options: H5Runtime) {
    this.store = store;
    this.options = options;
    this.storage = options.storage;
  }

  private async save(state: LocalState): Promise<void> { await this.store.save({ ...state, revision: state.revision + 1 }); }

  private receipts(state: LocalState): H5ExportReceipt[] {
    return state.runs.filter((run) => run.state === "completed").map((run): H5ExportReceipt => {
      const plan: ExportPlan | undefined = state.plans.find((item) => item.id === run.planId);
      if (plan === undefined || run.verifiedAt === null || run.byteLength === null) throw new DomainError("RECEIPT_EVIDENCE_MISSING", "Export receipt lacks persisted plan or file evidence; inspect the saved state", 500);
      return { operationId: run.operationId, artifactId: plan.artifactId, artifactVersion: plan.artifactVersion, filename: plan.filename, state: "completed", verifiedAt: run.verifiedAt, byteLength: run.byteLength, downloadUrl: `/api/downloads/${run.operationId}` };
    });
  }

  snapshot(): H5Snapshot {
    const state: LocalState = this.store.read();
    const now: string = this.options.now();
    return { revision: state.revision, mode: this.options.mode, now, records: state.records, matters: state.matters, suggestions: suggestionsFromState(state, now), artifacts: state.artifacts, contexts: state.contexts, exports: this.receipts(state), assistant: state.assistant };
  }

  async addRecord(input: AddRecordInput): Promise<H5Snapshot> {
    const state: LocalState = this.store.read();
    if (checkRequest(state, "add-record", input, "records") !== undefined) return this.snapshot();
    matterFromState(state, input.contextId);
    const record: H5Record = { id: `record-${randomUUID()}`, contextId: input.contextId, title: input.title, text: input.text, module: input.module, recordedAt: this.options.now(), durationSeconds: null, provenance: "user_text", revision: 1, state: "active", cover: "none" };
    await this.save(appendRequest({ ...state, records: [...state.records, record] }, "add-record", input, "records", null, null));
    return this.snapshot();
  }

  async addMatter(input: AddMatterInput): Promise<H5Snapshot> {
    const state: LocalState = this.store.read();
    if (checkRequest(state, "add-matter", input, "matters") !== undefined) return this.snapshot();
    if (Date.parse(input.dueAt) <= Date.parse(this.options.now())) throw new DomainError("MATTER_TIME_IN_PAST", "事项时间必须晚于当前时间，请选择未来的准备事项。", 400);
    if (new Set(input.participants).size !== input.participants.length) throw new DomainError("DUPLICATE_PARTICIPANT", "参与者有重复，请每人只填写一次。", 400);
    if (state.matters.some((matter) => matter.title === input.title && Date.parse(matter.dueAt) === Date.parse(input.dueAt))) throw new DomainError("DUPLICATE_MATTER", "同一时间已有同名事项，请打开已有事项添加来源。", 409);
    const matter: H5Matter = { id: `matter-${randomUUID()}`, title: input.title, goal: input.goal, dueAt: input.dueAt, durationMinutes: input.durationMinutes, participants: input.participants, provenance: "user_entered" };
    await this.save(appendRequest({ ...state, matters: [...state.matters, matter] }, "add-matter", input, "matters", null, null));
    return this.snapshot();
  }

  async reviseRecord(id: string, input: ReviseRecordInput): Promise<H5Snapshot> {
    const state: LocalState = this.store.read();
    if (checkRequest(state, "revise-record", input, id) !== undefined) return this.snapshot();
    const previous: H5Record | undefined = state.records.find((item) => item.id === id && item.state === "active");
    if (previous === undefined) throw new DomainError("RECORD_NOT_FOUND", `来源 ${id} 不存在或已失效。`, 404);
    if (previous.revision !== input.expectedRevision) throw new DomainError("STALE_RECORD", "来源已有更新，请重新打开当前版本再保存。", 409);
    const revised: H5Record = { ...previous, title: input.title, text: input.text, revision: previous.revision + 1, recordedAt: this.options.now() };
    await this.save(appendRequest({ ...state, records: state.records.map((item) => item.id === id ? revised : item), recordHistory: [...state.recordHistory, previous] }, "revise-record", input, id, null, null));
    return this.snapshot();
  }

  async decideSuggestion(id: string, input: SuggestionDecisionInput): Promise<H5Snapshot> {
    const state: LocalState = this.store.read();
    if (checkRequest(state, "decide-suggestion", input, id) !== undefined) return this.snapshot();
    const suggestion = suggestionsFromState(state, this.options.now()).find((item) => item.id === id);
    if (suggestion === undefined) throw new DomainError("SUGGESTION_NOT_FOUND", "建议已不在当前准备时间窗内，请从事情页面选择准备。", 404);
    const decisions: LocalState["decisions"] = state.decisions.filter((item) => item.matterId !== suggestion.matterId);
    const snoozeMinutes: 60 | 180 | 1440 = input.snoozeMinutes ?? 60;
    if (input.decision !== "restore") decisions.push({
      matterId: suggestion.matterId,
      state: input.decision === "dismiss" ? "dismissed" : "snoozed",
      snoozedUntil: input.decision === "snooze" ? new Date(Date.parse(this.options.now()) + snoozeMinutes * 60_000).toISOString() : null,
    });
    await this.save(appendRequest({ ...state, decisions }, "decide-suggestion", input, id, null, null));
    return this.snapshot();
  }

  async prepare(input: PrepareInput): Promise<PreparationResponse> { return this.prepareScoped(input); }

  private async prepareScoped(input: PrepareInput, selectedRecordIds: readonly string[] | undefined = undefined): Promise<PreparationResponse> {
    const state: LocalState = this.store.read();
    const selected = selectedRecordIds === undefined ? undefined : [...new Set(selectedRecordIds)].sort();
    const scope: string = selected === undefined ? input.matterId : `${input.matterId}:selected:${selected.join(",")}`;
    const previous: SavedRequest | undefined = checkRequest(state, "prepare", input, scope);
    if (previous?.artifactId !== undefined && previous.artifactId !== null) return { snapshot: this.snapshot(), artifactId: previous.artifactId };
    const matter = matterFromState(state, input.matterId);
    const requirements: string[] = [...input.requirements];
    const context: ContextBundle = currentContext(state, matter, requirements, this.options.now(), this.options.ownerId, selected);
    const template = await this.options.loadTemplate(input.skillId);
    const artifact: PreparedArtifact = prepareFromTemplate(context, template, matter, this.options.now());
    await this.save(appendRequest({ ...state, contexts: [...state.contexts, context], artifacts: [...state.artifacts, artifact] }, "prepare", input, scope, artifact.id, null));
    return { snapshot: this.snapshot(), artifactId: artifact.id };
  }

  async reviseArtifact(id: string, input: ArtifactRevisionInput): Promise<PreparationResponse> {
    const state: LocalState = this.store.read();
    if (checkRequest(state, "revise-artifact", input, id) !== undefined) return { snapshot: this.snapshot(), artifactId: id };
    const previous: PreparedArtifact = latestArtifact(state, id);
    if (previous.version !== input.expectedVersion) throw new DomainError("STALE_ARTIFACT_VERSION", "成果已有新版本，请重新打开最新版本后保存。", 409);
    const context: ContextBundle = savedContext(state, previous);
    assertFullContextCurrent(state, context, this.options.now());
    if (input.sections.length !== previous.sections.length || new Set(input.sections.map((section) => section.id)).size !== input.sections.length) throw new DomainError("INVALID_EDIT_STRUCTURE", "编辑必须保留原成果的所有章节和条目 ID。", 400);
    const sections: PreparedArtifact["sections"] = previous.sections.map((section) => {
      const edit = input.sections.find((item) => item.id === section.id);
      if (edit === undefined || edit.blocks.length !== section.blocks.length || new Set(edit.blocks.map((block) => block.id)).size !== edit.blocks.length) throw new DomainError("INVALID_EDIT_STRUCTURE", "编辑必须保留原成果的所有章节和条目 ID。", 400);
      return { ...section, blocks: section.blocks.map((block) => {
        const changed = edit.blocks.find((item) => item.id === block.id);
        if (changed === undefined) throw new DomainError("INVALID_EDIT_STRUCTURE", `Missing original block ${block.id}`, 400);
        return changed.text === block.text ? block : { ...block, text: changed.text, basis: "user_authored", memoryIds: [] };
      }) };
    });
    const template = await this.options.loadTemplate(previous.skillId);
    const next: PreparedArtifact = validateArtifactRevision(previous, { ...previous, version: previous.version + 1, previousVersion: previous.version, sections, savedAt: this.options.now() }, context, template);
    await this.save(appendRequest({ ...state, artifacts: [...state.artifacts, next] }, "revise-artifact", input, id, id, null));
    return { snapshot: this.snapshot(), artifactId: id };
  }

  private exportableArtifact(state: LocalState, id: string, version: number): PreparedArtifact {
    const artifact: PreparedArtifact = latestArtifact(state, id);
    if (artifact.version !== version) throw new DomainError("STALE_ARTIFACT_VERSION", "成果已有新版本，请针对最新保存版本重新确认导出。", 409);
    assertFullContextCurrent(state, savedContext(state, artifact), this.options.now());
    return artifact;
  }

  async planExport(input: ExportPlanInput): Promise<ExportPlanResponse> {
    const state: LocalState = this.store.read();
    const artifact: PreparedArtifact = this.exportableArtifact(state, input.artifactId, input.artifactVersion);
    const existing: ExportPlan | undefined = state.plans.find((plan) => plan.artifactId === artifact.id && plan.artifactVersion === artifact.version);
    if (existing !== undefined) return { plan: existing, planHash: hashPlan(existing) };
    const plan: ExportPlan = createExportPlan(`plan-${randomUUID()}`, 1, artifact, `${artifact.skillId}-${artifact.id}-v${artifact.version}.docx`);
    await this.save({ ...state, plans: [...state.plans, plan] });
    return { plan, planHash: hashPlan(plan) };
  }

  async export(input: ConfirmExportInput): Promise<ExportResponse> {
    const state: LocalState = this.store.read();
    checkRequest(state, "export", input, input.plan.id);
    const plan: ExportPlan | undefined = state.plans.find((item) => item.id === input.plan.id);
    if (plan === undefined || hashPlan(plan) !== input.planHash || hashPlan(input.plan) !== input.planHash) throw new DomainError("STALE_CONFIRMATION", "导出确认与已保存方案不一致，请重新生成并确认导出方案。", 409);
    const artifact: PreparedArtifact = this.exportableArtifact(state, plan.artifactId, plan.artifactVersion);
    const template = await this.options.loadTemplate(artifact.skillId);
    const request: ExportRequest = { actorId: this.options.ownerId, plan, artifact, confirmation: { ownerId: this.options.ownerId, planId: plan.id, planHash: input.planHash, confirmedAt: this.options.now(), decision: input.decision }, template: template };
    const pending: ToolRun = beginToolRun(this.options.ownerId, plan, artifact, request.confirmation, null);
    if (checkRequest(state, "export", input, input.plan.id) === undefined) await this.save(appendRequest(state, "export", input, input.plan.id, artifact.id, pending.operationId));
    const existing: ToolRun | undefined = state.runs.find((run) => run.operationId === pending.operationId);
    const readEvidence = async (): Promise<CurrentEvidence> => {
      await this.store.refresh();
      const current: LocalState = this.store.read();
      const currentArtifact = this.exportableArtifact(current, plan.artifactId, plan.artifactVersion);
      return evidenceForContext(current, savedContext(current, currentArtifact));
    };
    const run: ToolRun = existing !== undefined && existing.state !== "completed"
      ? await reconcileConfirmedExport(request, this, this.storage, readEvidence, this.options.now())
      : await executeConfirmedExport(request, this, this.storage, readEvidence, this.options.now());
    const updated: LocalState = this.store.read();
    if (checkRequest(updated, "export", input, input.plan.id) === undefined) await this.save(appendRequest(updated, "export", input, input.plan.id, artifact.id, run.operationId));
    const snapshot: H5Snapshot = this.snapshot();
    const receipt: H5ExportReceipt | undefined = snapshot.exports.find((item) => item.operationId === run.operationId);
    if (receipt === undefined) throw new DomainError("RECEIPT_NOT_SAVED", "DOCX result lacks its saved receipt; inspect the export operation", 500);
    return { snapshot, receipt };
  }

  private assistantContextId(state: LocalState, requested: string | null): string {
    const contextId: string | undefined = requested ?? state.matters[0]?.id;
    if (contextId === undefined) throw new DomainError("ASSISTANT_CONTEXT_REQUIRED", "请先创建一件事项，助手才能确定要使用的记录范围。", 409);
    matterFromState(state, contextId);
    return contextId;
  }

  private assistantResult(sessionId: string | null, taskId: string | null, confirmation: AssistantConfirmation | null): AssistantOperationResponse {
    return { snapshot: this.snapshot(), sessionId, taskId, confirmation };
  }

  private buildAssistantTask(state: LocalState, sessionId: string, contextId: string, goal: string, now: string): { assistant: AssistantState; task: AssistantTask } {
    const matter: H5Matter = matterFromState(state, contextId);
    const taskId: string = `assistant-task-${randomUUID()}`;
    const task: AssistantTask = {
      id: taskId,
      sessionId,
      ownerId: this.options.ownerId,
      contextId,
      goal: goal.length > 0 ? goal : `准备${matter.title}`,
      requirements: [],
      deliveryMode: null,
      status: "draft",
      progress: 0,
      currentStep: 0,
      executor: "local-preparation-service",
      etaSeconds: null,
      planVersion: 1,
      runVersion: 1,
      nextRunAt: null,
      artifactId: null,
      artifactVersion: null,
      exportOperationId: null,
      errorCode: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    const steps: AssistantTaskStep[] = [
      ["查找相关内容", "核对关联记录与可用背景"],
      ["核对有效信息", "区分当前信息与需要你确认的事项"],
      ["确认交付格式", "选择需要生成的可交付内容"],
      ["生成最终版本", "保存结果并提供可下载文件"],
    ].map(([title, detail]) => ({
      id: `assistant-step-${randomUUID()}`,
      taskId,
      title: title ?? "待执行步骤",
      detail: detail ?? "等待执行",
      status: "pending",
      startedAt: null,
      finishedAt: null,
      error: null,
    }));
    const evidence = state.records
      .filter((record) => record.state === "active" && record.contextId === contextId)
      .map((record) => ({
        id: `assistant-evidence-${randomUUID()}`,
        taskId,
        sourceType: "record" as const,
        sourceRef: record.id,
        sourceRevision: record.revision,
        summary: record.text.slice(0, 180),
        included: true,
        excludedAt: null,
      }));
    const event = { id: `assistant-event-${randomUUID()}`, taskId, kind: "task-created" as const, summary: `已创建“${task.goal}”任务草稿。`, createdAt: now };
    return {
      task,
      assistant: {
        ...state.assistant,
        tasks: [...state.assistant.tasks, task],
        steps: [...state.assistant.steps, ...steps],
        evidence: [...state.assistant.evidence, ...evidence],
        events: [...state.assistant.events, event].slice(-500),
      },
    };
  }

  async createAssistantSession(input: AssistantCreateSessionInput): Promise<AssistantOperationResponse> {
    const state: LocalState = this.store.read();
    const previous: SavedRequest | undefined = checkRequest(state, "assistant-create-session", input, "assistant-sessions");
    if (previous !== undefined) return this.assistantResult(previous.sessionId, previous.taskId, null);
    if (input.contextId !== null) matterFromState(state, input.contextId);
    const mode: AssistantMode = input.mode === "auto" ? (isTaskIntent(input.content) ? "task" : "chat") : input.mode;
    const now: string = this.options.now();
    const contextRefs: string[] = input.contextId === null ? [] : state.records.filter((record) => record.state === "active" && record.contextId === input.contextId).map((record) => record.id);
    const sessionId: string = `assistant-session-${randomUUID()}`;
    const session = {
      id: sessionId,
      ownerId: this.options.ownerId,
      mode,
      title: input.content.slice(0, 48),
      contextId: input.contextId,
      contextRefs,
      createdAt: now,
      updatedAt: now,
    };
    const userMessage = { id: `assistant-message-${randomUUID()}`, sessionId, role: "user" as const, content: input.content, createdAt: now };
    let assistant: AssistantState = { ...state.assistant, sessions: [...state.assistant.sessions, session], messages: [...state.assistant.messages, userMessage] };
    let taskId: string | null = null;
    if (mode === "task") {
      const contextId: string = this.assistantContextId(state, input.contextId);
      const interim: LocalState = { ...state, assistant };
      const created = this.buildAssistantTask(interim, sessionId, contextId, input.content, now);
      taskId = created.task.id;
      assistant = {
        ...created.assistant,
        messages: [...created.assistant.messages, {
          id: `assistant-message-${randomUUID()}`,
          sessionId,
          role: "assistant" as const,
          content: `这件事需要生成可交付内容，我已将对话升级为任务。会先核对“${matterFromState(state, contextId).title}”的记录，再由你确认关键选择。`,
          createdAt: now,
        }],
      };
    } else {
      const scope = input.contextId === null ? "当前可用记录" : `“${matterFromState(state, input.contextId).title}”的关联记录`;
      assistant = {
        ...assistant,
        messages: [...assistant.messages, {
          id: `assistant-message-${randomUUID()}`,
          sessionId,
          role: "assistant" as const,
          content: `当前为本地整理模式，尚未连接在线模型。我会基于${scope}帮你归纳；若需要文件、外部操作或持续执行，可以升级为任务。`,
          createdAt: now,
        }],
      };
    }
    await this.save(appendRequest({ ...state, assistant }, "assistant-create-session", input, "assistant-sessions", null, null, sessionId, taskId));
    return this.assistantResult(sessionId, taskId, null);
  }

  async upgradeAssistantSession(sessionId: string, input: AssistantUpgradeInput): Promise<AssistantOperationResponse> {
    const state: LocalState = this.store.read();
    const previous: SavedRequest | undefined = checkRequest(state, "assistant-upgrade", input, sessionId);
    if (previous !== undefined) return this.assistantResult(previous.sessionId ?? sessionId, previous.taskId, null);
    const session = assistantSessionFromState(state, sessionId);
    const existing: AssistantTask | undefined = state.assistant.tasks.find((task) => task.sessionId === sessionId && task.status !== "cancelled");
    if (existing !== undefined) return this.assistantResult(sessionId, existing.id, null);
    const now: string = this.options.now();
    const contextId: string = this.assistantContextId(state, input.contextId ?? session.contextId);
    const contextRefs: string[] = state.records.filter((record) => record.state === "active" && record.contextId === contextId).map((record) => record.id);
    const updatedSession = { ...session, mode: "task" as const, contextId, contextRefs, updatedAt: now };
    const baseAssistant: AssistantState = {
      ...state.assistant,
      sessions: state.assistant.sessions.map((item) => item.id === sessionId ? updatedSession : item),
      messages: [...state.assistant.messages, {
        id: `assistant-message-${randomUUID()}`,
        sessionId,
        role: "assistant" as const,
        content: "这一步会生成可交付内容，因此需要进入任务模式。我会保留前面的对话与已选范围。",
        createdAt: now,
      }],
    };
    const created = this.buildAssistantTask({ ...state, assistant: baseAssistant }, sessionId, contextId, session.title, now);
    await this.save(appendRequest({ ...state, assistant: created.assistant }, "assistant-upgrade", input, sessionId, null, null, sessionId, created.task.id));
    return this.assistantResult(sessionId, created.task.id, null);
  }

  async startAssistantTask(taskId: string, input: AssistantStartTaskInput): Promise<AssistantOperationResponse> {
    const state: LocalState = this.store.read();
    if (checkRequest(state, "assistant-start", input, taskId) !== undefined) return this.assistantResult(assistantTaskFromState(state, taskId).sessionId, taskId, null);
    const task: AssistantTask = assistantTaskFromState(state, taskId);
    if (task.status !== "draft" && task.status !== "ready") throw new DomainError("ASSISTANT_TASK_NOT_READY", "这个任务当前不能开始。请先处理等待的问题或重新打开任务。", 409);
    const first: AssistantTaskStep | undefined = taskStepsFromState(state, taskId)[0];
    if (first === undefined) throw new DomainError("ASSISTANT_TASK_PLAN_MISSING", "任务计划不完整，无法开始执行。", 409);
    const now: string = this.options.now();
    const nextTask: AssistantTask = { ...task, status: "running", progress: 5, currentStep: 0, etaSeconds: null, nextRunAt: new Date(Date.parse(now) + 550).toISOString(), updatedAt: now, errorCode: null };
    const nextStep: AssistantTaskStep = { ...first, status: "running", startedAt: now };
    let assistant: AssistantState = updateAssistantTask(state.assistant, nextTask);
    assistant = updateAssistantStep(assistant, nextStep);
    assistant = appendAssistantEvent(assistant, taskId, "task-started", "任务已开始处理。", now);
    await this.save(appendRequest({ ...state, assistant }, "assistant-start", input, taskId, null, null, task.sessionId, taskId));
    return this.assistantResult(task.sessionId, taskId, null);
  }

  async updateAssistantPlan(taskId: string, input: AssistantPlanInput): Promise<AssistantOperationResponse> {
    const state: LocalState = this.store.read();
    if (checkRequest(state, "assistant-plan", input, taskId) !== undefined) return this.assistantResult(assistantTaskFromState(state, taskId).sessionId, taskId, null);
    const task: AssistantTask = assistantTaskFromState(state, taskId);
    if (task.status !== "draft" && task.status !== "ready") throw new DomainError("ASSISTANT_PLAN_LOCKED", "任务开始后不能直接更改交付格式；请先暂停并通过任务要求更新结果。", 409);
    if (task.deliveryMode === input.deliveryMode) return this.assistantResult(task.sessionId, taskId, null);
    const now: string = this.options.now();
    let assistant: AssistantState = updateAssistantTask(state.assistant, { ...task, deliveryMode: input.deliveryMode, planVersion: task.planVersion + 1, updatedAt: now });
    assistant = appendAssistantEvent(assistant, taskId, "plan-updated", `已将交付格式设为${input.deliveryMode === "docx" ? "Word 文档" : "仅保留可编辑内容"}。`, now);
    await this.save(appendRequest({ ...state, assistant }, "assistant-plan", input, taskId, null, null, task.sessionId, taskId));
    return this.assistantResult(task.sessionId, taskId, null);
  }

  async tickAssistantTasks(): Promise<void> {
    const state: LocalState = this.store.read();
    const now: string = this.options.now();
    const task: AssistantTask | undefined = state.assistant.tasks.find((item) => item.status === "running" && item.nextRunAt !== null && Date.parse(item.nextRunAt) <= Date.parse(now));
    if (task === undefined) return;
    const steps: AssistantTaskStep[] = taskStepsFromState(state, task.id);
    const current: AssistantTaskStep | undefined = steps[task.currentStep];
    if (current === undefined) {
      const failed: AssistantTask = { ...task, status: "failed", nextRunAt: null, etaSeconds: null, errorCode: "TASK_PLAN_MISSING", updatedAt: now };
      await this.save({ ...state, assistant: updateAssistantTask(state.assistant, failed) });
      return;
    }
    if (task.currentStep === 0) {
      const next: AssistantTaskStep | undefined = steps[1];
      if (next === undefined) throw new DomainError("ASSISTANT_TASK_PLAN_MISSING", "任务计划不完整，无法继续执行。", 409);
      let assistant: AssistantState = updateAssistantStep(state.assistant, { ...current, status: "completed", finishedAt: now });
      assistant = updateAssistantStep(assistant, { ...next, status: "running", startedAt: now });
      assistant = updateAssistantTask(assistant, { ...task, currentStep: 1, progress: 30, etaSeconds: null, nextRunAt: new Date(Date.parse(now) + 650).toISOString(), updatedAt: now });
      assistant = appendAssistantEvent(assistant, task.id, "step-completed", "已完成相关内容查找。", now);
      await this.save({ ...state, assistant });
      return;
    }
    if (task.currentStep === 1) {
      const formatStep: AssistantTaskStep | undefined = steps[2];
      if (formatStep === undefined) throw new DomainError("ASSISTANT_TASK_PLAN_MISSING", "任务计划不完整，无法请求交付格式。", 409);
      if (task.deliveryMode !== null) {
        const deliveryStep: AssistantTaskStep | undefined = steps[3];
        if (deliveryStep === undefined) throw new DomainError("ASSISTANT_TASK_PLAN_MISSING", "任务计划不完整，无法继续生成。", 409);
        let assistant: AssistantState = updateAssistantStep(state.assistant, { ...current, status: "completed", finishedAt: now });
        assistant = updateAssistantStep(assistant, { ...formatStep, status: "completed", finishedAt: now });
        assistant = updateAssistantStep(assistant, { ...deliveryStep, status: "running", startedAt: now });
        assistant = updateAssistantTask(assistant, { ...task, status: "running", currentStep: 3, progress: 65, etaSeconds: null, nextRunAt: new Date(Date.parse(now) + 650).toISOString(), updatedAt: now });
        await this.save({ ...state, assistant });
        return;
      }
      const inputRequest = {
        id: `assistant-input-${randomUUID()}`,
        taskId: task.id,
        question: "汇报文件用哪种形式？",
        detail: "用于确认最终交付格式。当前本地体验只会生成已经接入的格式。",
        options: [
          { id: "format-docx", label: "Word 文档", detail: "生成可下载的 .docx 文件", recommended: true },
          { id: "format-content", label: "仅保留可编辑内容", detail: "不生成文件，之后仍可从结果页导出 Word", recommended: false },
        ],
        selectedOptionId: null,
        status: "open" as const,
        createdAt: now,
        answeredAt: null,
      };
      let assistant: AssistantState = updateAssistantStep(state.assistant, { ...current, status: "completed", finishedAt: now });
      assistant = updateAssistantStep(assistant, { ...formatStep, status: "waiting" });
      assistant = updateAssistantTask(assistant, { ...task, status: "waiting_input", currentStep: 2, progress: 50, etaSeconds: null, nextRunAt: null, updatedAt: now });
      assistant = { ...assistant, inputRequests: [...assistant.inputRequests, inputRequest] };
      assistant = appendAssistantEvent(assistant, task.id, "input-requested", "需要你确认交付格式。", now);
      await this.save({ ...state, assistant });
      return;
    }
    if (task.currentStep === 3) await this.prepareAssistantArtifact(task, current, now);
  }

  private async prepareAssistantArtifact(task: AssistantTask, deliveryStep: AssistantTaskStep, now: string): Promise<void> {
    try {
      if (task.contextId === null) throw new DomainError("ASSISTANT_CONTEXT_REQUIRED", "当前任务没有可用事项范围，无法生成交付内容。", 409);
      const stateBefore: LocalState = this.store.read();
      const answer = stateBefore.assistant.inputRequests.find((item) => item.taskId === task.id && item.status === "answered");
      const deliveryMode = task.deliveryMode ?? (answer?.selectedOptionId === "format-content" ? "content" : answer?.selectedOptionId === "format-docx" ? "docx" : null);
      if (deliveryMode === null) throw new DomainError("ASSISTANT_INPUT_REQUIRED", "请先确认交付格式，再继续生成内容。", 409);
      const selectedRecordIds: string[] = stateBefore.assistant.evidence.filter((item) => item.taskId === task.id && item.included).map((item) => item.sourceRef);
      const result = task.artifactId === null
        ? await this.prepareScoped({ requestId: `assistant-prepare-${task.id}-v${task.planVersion}`, matterId: task.contextId, skillId: "report-outline", requirements: [task.goal, ...task.requirements, "整理为可核对的团队同步汇报结构"] }, selectedRecordIds)
        : { snapshot: this.snapshot(), artifactId: task.artifactId };
      const state: LocalState = this.store.read();
      const currentTask: AssistantTask = assistantTaskFromState(state, task.id);
      const artifact = state.artifacts.filter((item) => item.id === result.artifactId).sort((left, right) => right.version - left.version)[0];
      if (artifact === undefined) throw new DomainError("ASSISTANT_ARTIFACT_MISSING", "任务已生成内容，但没有找到可交付成果。", 500);
      const contentOnly: boolean = deliveryMode === "content";
      let nextTask: AssistantTask = { ...currentTask, artifactId: artifact.id, artifactVersion: artifact.version, etaSeconds: null, nextRunAt: null, updatedAt: now };
      let assistant: AssistantState = updateAssistantStep(state.assistant, { ...deliveryStep, status: contentOnly ? "completed" : "waiting", finishedAt: contentOnly ? now : null });
      let confirmation: AssistantConfirmation | null = null;
      if (contentOnly) {
        nextTask = { ...nextTask, status: "completed", progress: 100, completedAt: now };
        assistant = appendAssistantEvent(assistant, task.id, "task-completed", "可编辑汇报内容已准备完成。", now);
      } else {
        confirmation = {
          id: `assistant-confirmation-${randomUUID()}`,
          taskId: task.id,
          actionType: "artifact.export-docx",
          title: "生成 Word 文件",
          detail: `将为“${artifact.title}”生成一个仅供你下载的 .docx 文件，不会发送给其他人。`,
          riskLevel: "low",
          artifactId: artifact.id,
          artifactVersion: artifact.version,
          planVersion: nextTask.planVersion,
          status: "pending",
          createdAt: now,
          decidedAt: null,
        };
        nextTask = { ...nextTask, status: "waiting_confirmation", progress: 80 };
        assistant = { ...assistant, confirmations: [...assistant.confirmations, confirmation] };
        assistant = appendAssistantEvent(assistant, task.id, "confirmation-requested", "内容已准备好，等待确认生成 Word 文件。", now);
      }
      assistant = updateAssistantTask(assistant, nextTask);
      await this.save({ ...state, assistant });
    } catch (error) {
      const state: LocalState = this.store.read();
      const currentTask: AssistantTask = assistantTaskFromState(state, task.id);
      const reason: string = error instanceof DomainError ? error.code : "ASSISTANT_PREPARATION_FAILED";
      let assistant: AssistantState = updateAssistantTask(state.assistant, { ...currentTask, status: "failed", etaSeconds: null, nextRunAt: null, errorCode: reason, updatedAt: now });
      assistant = updateAssistantStep(assistant, { ...deliveryStep, status: "failed", finishedAt: now, error: "准备最终内容时未能完成。" });
      assistant = appendAssistantEvent(assistant, task.id, "task-failed", "生成内容时出现问题，已保留可恢复检查点。", now);
      await this.save({ ...state, assistant });
    }
  }

  async answerAssistantTask(taskId: string, input: AssistantAnswerInput): Promise<AssistantOperationResponse> {
    const state: LocalState = this.store.read();
    if (checkRequest(state, "assistant-answer", input, taskId) !== undefined) return this.assistantResult(assistantTaskFromState(state, taskId).sessionId, taskId, null);
    const task: AssistantTask = assistantTaskFromState(state, taskId);
    if (task.status !== "waiting_input") throw new DomainError("ASSISTANT_INPUT_NOT_OPEN", "这个任务当前没有等待回答的问题。", 409);
    const request = state.assistant.inputRequests.find((item) => item.id === input.inputRequestId && item.taskId === taskId && item.status === "open");
    if (request === undefined || !request.options.some((option) => option.id === input.optionId)) throw new DomainError("ASSISTANT_INPUT_NOT_FOUND", "这个选择已失效，请重新打开任务后选择。", 409);
    const steps: AssistantTaskStep[] = taskStepsFromState(state, taskId);
    const formatStep: AssistantTaskStep | undefined = steps[2];
    const deliveryStep: AssistantTaskStep | undefined = steps[3];
    if (formatStep === undefined || deliveryStep === undefined) throw new DomainError("ASSISTANT_TASK_PLAN_MISSING", "任务计划不完整，无法继续执行。", 409);
    const now: string = this.options.now();
    let assistant: AssistantState = {
      ...state.assistant,
      inputRequests: state.assistant.inputRequests.map((item) => item.id === request.id ? { ...item, selectedOptionId: input.optionId, status: "answered" as const, answeredAt: now } : item),
    };
    assistant = updateAssistantStep(assistant, { ...formatStep, status: "completed", finishedAt: now });
    assistant = updateAssistantStep(assistant, { ...deliveryStep, status: "running", startedAt: now });
    assistant = updateAssistantTask(assistant, { ...task, deliveryMode: input.optionId === "format-content" ? "content" : "docx", status: "running", currentStep: 3, progress: 65, etaSeconds: null, nextRunAt: new Date(Date.parse(now) + 650).toISOString(), updatedAt: now });
    await this.save(appendRequest({ ...state, assistant }, "assistant-answer", input, taskId, null, null, task.sessionId, taskId));
    return this.assistantResult(task.sessionId, taskId, null);
  }

  async confirmAssistantTask(taskId: string, input: AssistantConfirmInput): Promise<AssistantOperationResponse> {
    const state: LocalState = this.store.read();
    if (checkRequest(state, "assistant-confirm", input, taskId) !== undefined) return this.assistantResult(assistantTaskFromState(state, taskId).sessionId, taskId, null);
    const task: AssistantTask = assistantTaskFromState(state, taskId);
    const confirmation = state.assistant.confirmations.find((item) => item.id === input.confirmationId && item.taskId === taskId && item.status === "pending");
    if (confirmation === undefined || task.status !== "waiting_confirmation") throw new DomainError("ASSISTANT_CONFIRMATION_NOT_OPEN", "这项确认已失效，请返回任务详情查看最新状态。", 409);
    const now: string = this.options.now();
    if (input.decision === "rejected") {
      let assistant: AssistantState = {
        ...state.assistant,
        confirmations: state.assistant.confirmations.map((item) => item.id === confirmation.id ? { ...item, status: "rejected" as const, decidedAt: now } : item),
      };
      assistant = updateAssistantTask(assistant, { ...task, status: "paused", etaSeconds: null, nextRunAt: null, updatedAt: now });
      await this.save(appendRequest({ ...state, assistant }, "assistant-confirm", input, taskId, null, null, task.sessionId, taskId));
      return this.assistantResult(task.sessionId, taskId, { ...confirmation, status: "rejected", decidedAt: now });
    }
    if (confirmation.artifactId === null || confirmation.artifactVersion === null) throw new DomainError("ASSISTANT_CONFIRMATION_INVALID", "确认内容缺少成果版本，请重新生成任务结果。", 409);
    try {
      const plan = await this.planExport({ artifactId: confirmation.artifactId, artifactVersion: confirmation.artifactVersion });
      const exported = await this.export({ requestId: `assistant-export-${task.id}`, plan: plan.plan, planHash: plan.planHash, decision: "approved" });
      const latest: LocalState = this.store.read();
      const currentTask: AssistantTask = assistantTaskFromState(latest, taskId);
      const currentSteps: AssistantTaskStep[] = taskStepsFromState(latest, taskId);
      const deliveryStep: AssistantTaskStep | undefined = currentSteps[3];
      if (deliveryStep === undefined) throw new DomainError("ASSISTANT_TASK_PLAN_MISSING", "任务计划不完整，无法保存交付结果。", 409);
      let assistant: AssistantState = {
        ...latest.assistant,
        confirmations: latest.assistant.confirmations.map((item) => item.id === confirmation.id ? { ...item, status: "approved" as const, decidedAt: now } : item),
      };
      assistant = updateAssistantStep(assistant, { ...deliveryStep, status: "completed", finishedAt: now });
      assistant = updateAssistantTask(assistant, { ...currentTask, status: "completed", progress: 100, etaSeconds: null, nextRunAt: null, exportOperationId: exported.receipt.operationId, updatedAt: now, completedAt: now });
      assistant = appendAssistantEvent(assistant, taskId, "task-completed", "Word 文件已生成并完成核对。", now);
      await this.save(appendRequest({ ...latest, assistant }, "assistant-confirm", input, taskId, confirmation.artifactId, exported.receipt.operationId, task.sessionId, taskId));
      return this.assistantResult(task.sessionId, taskId, { ...confirmation, status: "approved", decidedAt: now });
    } catch (error) {
      const latest: LocalState = this.store.read();
      const currentTask: AssistantTask = assistantTaskFromState(latest, taskId);
      const reason: string = error instanceof DomainError ? error.code : "ASSISTANT_EXPORT_FAILED";
      const assistant: AssistantState = updateAssistantTask(latest.assistant, { ...currentTask, status: "failed", etaSeconds: null, nextRunAt: null, errorCode: reason, updatedAt: now });
      await this.save({ ...latest, assistant });
      throw error;
    }
  }

  async actOnAssistantTask(taskId: string, input: AssistantTaskActionInput): Promise<AssistantOperationResponse> {
    const state: LocalState = this.store.read();
    if (checkRequest(state, "assistant-task-action", input, taskId) !== undefined) return this.assistantResult(assistantTaskFromState(state, taskId).sessionId, taskId, null);
    const task: AssistantTask = assistantTaskFromState(state, taskId);
    const now: string = this.options.now();
    let next: AssistantTask;
    let eventKind: "task-paused" | "task-resumed" | "task-cancelled";
    let summary: string;
    if (input.action === "pause" && ["running", "waiting_input", "waiting_confirmation"].includes(task.status)) {
      next = { ...task, status: "paused", etaSeconds: null, nextRunAt: null, updatedAt: now };
      eventKind = "task-paused";
      summary = task.status === "waiting_input" ? "任务已暂停，等待的信息会保留。" : task.status === "waiting_confirmation" ? "任务已暂停，待确认的操作会保留。" : "任务将在当前安全检查点暂停。";
    } else if (input.action === "resume" && task.status === "paused") {
      const hasOpenInput: boolean = state.assistant.inputRequests.some((item) => item.taskId === taskId && item.status === "open");
      const hasPendingConfirmation: boolean = state.assistant.confirmations.some((item) => item.taskId === taskId && item.status === "pending");
      next = hasOpenInput
        ? { ...task, status: "waiting_input", etaSeconds: null, nextRunAt: null, updatedAt: now }
        : hasPendingConfirmation
          ? { ...task, status: "waiting_confirmation", etaSeconds: null, nextRunAt: null, updatedAt: now }
          : { ...task, status: "running", etaSeconds: null, nextRunAt: new Date(Date.parse(now) + 550).toISOString(), updatedAt: now };
      eventKind = "task-resumed";
      summary = hasOpenInput ? "任务已恢复，仍等待你补充关键信息。" : hasPendingConfirmation ? "任务已恢复，仍等待你确认关键操作。" : "任务已恢复处理。";
    } else if (input.action === "cancel" && !["completed", "cancelled"].includes(task.status)) {
      next = { ...task, status: "cancelled", etaSeconds: null, nextRunAt: null, updatedAt: now, completedAt: now };
      eventKind = "task-cancelled";
      summary = "任务已取消；已经生成的内容和文件不会被删除。";
    } else if (input.action === "retry" && task.status === "failed") {
      next = { ...task, status: "running", etaSeconds: null, nextRunAt: new Date(Date.parse(now) + 550).toISOString(), updatedAt: now, errorCode: null };
      eventKind = "task-resumed";
      summary = "正在从可恢复检查点继续。";
    } else throw new DomainError("ASSISTANT_ACTION_UNAVAILABLE", "这个操作不适用于任务当前状态。", 409);
    let assistant: AssistantState = updateAssistantTask(state.assistant, next);
    assistant = appendAssistantEvent(assistant, taskId, eventKind, summary, now);
    await this.save(appendRequest({ ...state, assistant }, "assistant-task-action", input, taskId, null, null, task.sessionId, taskId));
    return this.assistantResult(task.sessionId, taskId, null);
  }

  async addAssistantRequirement(taskId: string, input: AssistantRequirementInput): Promise<AssistantOperationResponse> {
    const state: LocalState = this.store.read();
    if (checkRequest(state, "assistant-requirement", input, taskId) !== undefined) return this.assistantResult(assistantTaskFromState(state, taskId).sessionId, taskId, null);
    const task: AssistantTask = assistantTaskFromState(state, taskId);
    if (task.status === "completed" || task.status === "cancelled") {
      throw new DomainError("ASSISTANT_REQUIREMENT_LOCKED", "任务已经结束。请创建后续任务，避免改写已经交付的结果。", 409);
    }
    const content: string = input.content.trim();
    if (task.requirements.some((item) => item === content)) return this.assistantResult(task.sessionId, taskId, null);
    const now: string = this.options.now();
    let assistant: AssistantState = state.assistant;
    const rebuildArtifact: boolean = task.artifactId !== null || task.status === "waiting_confirmation";
    if (rebuildArtifact) {
      const deliveryStep: AssistantTaskStep | undefined = taskStepsFromState(state, task.id)[3];
      if (deliveryStep !== undefined) assistant = updateAssistantStep(assistant, { ...deliveryStep, status: "pending", startedAt: null, finishedAt: null, error: null });
      assistant = {
        ...assistant,
        confirmations: assistant.confirmations.map((item) => item.taskId === task.id && item.status === "pending" ? { ...item, status: "expired" as const, decidedAt: now } : item),
      };
    }
    const nextStatus = task.status === "draft" || task.status === "ready" || task.status === "waiting_input"
      ? task.status
      : "paused" as const;
    const nextTask: AssistantTask = {
      ...task,
      requirements: [...task.requirements, content],
      status: nextStatus,
      currentStep: rebuildArtifact ? 3 : task.currentStep,
      progress: rebuildArtifact ? Math.min(task.progress, 65) : task.progress,
      planVersion: task.planVersion + 1,
      nextRunAt: null,
      etaSeconds: null,
      artifactId: rebuildArtifact ? null : task.artifactId,
      artifactVersion: rebuildArtifact ? null : task.artifactVersion,
      exportOperationId: rebuildArtifact ? null : task.exportOperationId,
      updatedAt: now,
    };
    assistant = updateAssistantTask(assistant, nextTask);
    const summary = rebuildArtifact
      ? "已纳入新的任务要求；旧的待确认结果已失效，恢复任务后会重新生成。"
      : "已纳入新的任务要求，后续步骤会按新要求处理。";
    assistant = appendAssistantEvent(assistant, task.id, "requirement-added", summary, now);
    await this.save(appendRequest({ ...state, assistant }, "assistant-requirement", input, taskId, null, null, task.sessionId, taskId));
    return this.assistantResult(task.sessionId, taskId, null);
  }

  async updateAssistantEvidence(evidenceId: string, input: AssistantEvidenceInput): Promise<AssistantOperationResponse> {
    const state: LocalState = this.store.read();
    const evidence = state.assistant.evidence.find((item) => item.id === evidenceId);
    if (evidence === undefined) throw new DomainError("ASSISTANT_EVIDENCE_NOT_FOUND", "该依据已不存在，请重新打开任务详情。", 404);
    if (checkRequest(state, "assistant-evidence", input, evidenceId) !== undefined) return this.assistantResult(assistantTaskFromState(state, evidence.taskId).sessionId, evidence.taskId, null);
    const now: string = this.options.now();
    const task: AssistantTask = assistantTaskFromState(state, evidence.taskId);
    if (task.status === "completed" || task.status === "cancelled") {
      throw new DomainError("ASSISTANT_EVIDENCE_LOCKED", "任务已经结束，成果保留了当时的依据快照。若要调整依据，请创建新的任务版本。", 409);
    }
    let assistant: AssistantState = {
      ...state.assistant,
      evidence: state.assistant.evidence.map((item) => item.id === evidenceId ? { ...item, included: input.included, excludedAt: input.included ? null : now } : item),
    };
    const rebuildArtifact: boolean = task.artifactId !== null || task.status === "waiting_confirmation";
    if (rebuildArtifact) {
      const deliveryStep: AssistantTaskStep | undefined = taskStepsFromState(state, task.id)[3];
      if (deliveryStep !== undefined) assistant = updateAssistantStep(assistant, { ...deliveryStep, status: "pending", startedAt: null, finishedAt: null, error: null });
      assistant = {
        ...assistant,
        confirmations: assistant.confirmations.map((item) => item.taskId === task.id && item.status === "pending" ? { ...item, status: "expired" as const, decidedAt: now } : item),
      };
    }
    const nextStatus = task.status === "draft" || task.status === "ready" || task.status === "waiting_input"
      ? task.status
      : "paused" as const;
    const nextTask: AssistantTask = {
      ...task,
      status: nextStatus,
      currentStep: rebuildArtifact ? 3 : task.currentStep,
      progress: rebuildArtifact ? Math.min(task.progress, 65) : task.progress,
      planVersion: task.planVersion + 1,
      nextRunAt: null,
      etaSeconds: null,
      artifactId: rebuildArtifact ? null : task.artifactId,
      artifactVersion: rebuildArtifact ? null : task.artifactVersion,
      exportOperationId: rebuildArtifact ? null : task.exportOperationId,
      updatedAt: now,
    };
    assistant = updateAssistantTask(assistant, nextTask);
    const summary = rebuildArtifact
      ? "已更新执行依据；原准备稿保留为历史版本，请恢复任务后生成新的结果。"
      : input.included ? "已重新纳入一条执行依据，后续步骤会按新范围核对。" : "已排除一条执行依据，后续步骤会按新范围核对。";
    assistant = appendAssistantEvent(assistant, task.id, "evidence-updated", summary, now);
    await this.save(appendRequest({ ...state, assistant }, "assistant-evidence", input, evidenceId, null, null, task.sessionId, task.id));
    return this.assistantResult(task.sessionId, task.id, null);
  }

  async download(operationId: string): Promise<DownloadResult> {
    const state: LocalState = this.store.read();
    const run: ToolRun | undefined = state.runs.find((item) => item.operationId === operationId && item.state === "completed");
    const plan: ExportPlan | undefined = state.plans.find((item) => item.id === run?.planId);
    if (run === undefined || plan === undefined || run.storageKey === null) throw new DomainError("DOWNLOAD_NOT_FOUND", "尚无核对完成的下载文件，请先确认导出。", 404);
    this.exportableArtifact(state, plan.artifactId, plan.artifactVersion);
    const bytes: Buffer = await this.storage.read(run.storageKey);
    if (bytes.length !== run.byteLength || hashBytes(bytes) !== run.fileHash) throw new DomainError("FILE_VERIFICATION_FAILED", "下载文件与已保存的导出回执不一致，请核对本地文件，不要重复生成覆盖。", 409);
    await this.store.refresh();
    this.exportableArtifact(this.store.read(), plan.artifactId, plan.artifactVersion);
    return { bytes, filename: plan.filename };
  }

  async getArtifact(ownerId: string, id: string, version: number): Promise<PreparedArtifact | null> { return this.store.read().artifacts.find((item) => item.ownerId === ownerId && item.id === id && item.version === version) ?? null; }
  async getContext(ownerId: string, id: string): Promise<ContextBundle | null> { return this.store.read().contexts.find((item) => item.ownerId === ownerId && item.id === id) ?? null; }
  async getRun(ownerId: string, operationId: string): Promise<ToolRun | null> { return this.store.read().runs.find((item) => item.ownerId === ownerId && item.operationId === operationId) ?? null; }
  async claimRun(run: ToolRun): Promise<{ created: boolean; run: ToolRun }> {
    const state: LocalState = this.store.read();
    const existing: ToolRun | undefined = state.runs.find((item) => item.operationId === run.operationId);
    if (existing !== undefined) return { created: false, run: existing };
    await this.save({ ...state, runs: [...state.runs, run] });
    return { created: true, run };
  }
  async saveRunResult(run: ToolRun): Promise<void> {
    const state: LocalState = this.store.read();
    if (!state.runs.some((item) => item.operationId === run.operationId)) throw new DomainError("RUN_NOT_CLAIMED", "Export result has no durable claim", 409);
    const plan: ExportPlan | undefined = state.plans.find((item) => item.id === run.planId);
    if (plan === undefined) throw new DomainError("PLAN_NOT_FOUND", "Export plan is unavailable for final verification", 409);
    this.exportableArtifact(state, plan.artifactId, plan.artifactVersion);
    await this.save({ ...state, runs: state.runs.map((item) => item.operationId === run.operationId ? run : item) });
  }
}
