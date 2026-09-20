/** Single-owner commands over a request-scoped store with optimistic persistence. */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { beginToolRun, createExportPlan, hashPlan } from "./actions.ts";
import { validateArtifactRevision } from "./artifacts.ts";
import { exportPlanSchema, identifierSchema, skillIdSchema } from "./contracts.ts";
import type { ArtifactTemplate, ContextBundle, ExportPlan, PreparedArtifact, SkillId, ToolRun } from "./contracts.ts";
import type { ArtifactStorage } from "./docx-export.ts";
import { hashBytes } from "./docx-export.ts";
import { DomainError } from "./errors.ts";
import { executeConfirmedExport, reconcileConfirmedExport } from "./export-service.ts";
import type { CurrentEvidence, ExportRequest, RunStore } from "./export-service.ts";
import { evidenceFromRecords, fingerprint, LOCAL_OWNER } from "./h5-state.ts";
import type { H5StateStore, LocalState, SavedRequest } from "./h5-state.ts";
import { assertFullContextCurrent, currentContext, matterFromState, prepareFromTemplate, suggestionsFromState } from "./h5-preparation.ts";
import type { AddMatterInput, AddRecordInput, ArtifactRevisionInput, ConfirmExportInput, ExportPlanInput, ExportPlanResponse, ExportResponse, H5ExportReceipt, H5Matter, H5Record, H5Snapshot, PreparationResponse, PrepareInput, ReviseRecordInput, SuggestionDecisionInput } from "./h5-types.ts";

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
export const suggestionDecisionSchema: z.ZodType<SuggestionDecisionInput> = z.object({ requestId: identifierSchema, decision: z.enum(["snooze", "dismiss", "restore"]) });
export const prepareSchema: z.ZodType<PrepareInput> = z.object({ requestId: identifierSchema, matterId: identifierSchema, skillId: skillIdSchema, requirements: z.array(z.string().trim().min(1).max(10000)).max(30) });
export const artifactRevisionSchema: z.ZodType<ArtifactRevisionInput> = z.object({
  requestId: identifierSchema, expectedVersion: z.number().int().positive(),
  sections: z.array(z.object({ id: identifierSchema, blocks: z.array(z.object({ id: identifierSchema, text: z.string().trim().min(1).max(20000) })).min(1).max(200) })).min(1).max(20),
});
export const exportPlanInputSchema: z.ZodType<ExportPlanInput> = z.object({ artifactId: identifierSchema, artifactVersion: z.number().int().positive() });
export const confirmExportSchema: z.ZodType<ConfirmExportInput> = z.object({ requestId: identifierSchema, plan: exportPlanSchema, planHash: z.string().regex(/^[a-f0-9]{64}$/), decision: z.literal("approved") });

export interface H5ServiceOptions { workspaceRoot: string; dataRoot: string; now: () => string; }
export interface H5Runtime { now: () => string; mode: H5Snapshot["mode"]; loadTemplate: (id: SkillId) => Promise<ArtifactTemplate>; storage: ArtifactStorage; }
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

function appendRequest(state: LocalState, kind: string, input: { requestId: string }, scope: string, artifactId: string | null, operationId: string | null): LocalState {
  return { ...state, requests: [...state.requests, { requestId: input.requestId, fingerprint: fingerprint({ scope, input }), kind, artifactId, operationId }] };
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
    return { revision: state.revision, mode: this.options.mode, now, records: state.records, matters: state.matters, suggestions: suggestionsFromState(state, now), artifacts: state.artifacts, contexts: state.contexts, exports: this.receipts(state) };
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
    if (input.decision !== "restore") decisions.push({ matterId: suggestion.matterId, state: input.decision === "dismiss" ? "dismissed" : "snoozed", snoozedUntil: input.decision === "snooze" ? new Date(Date.parse(this.options.now()) + 3600000).toISOString() : null });
    await this.save(appendRequest({ ...state, decisions }, "decide-suggestion", input, id, null, null));
    return this.snapshot();
  }

  async prepare(input: PrepareInput): Promise<PreparationResponse> {
    const state: LocalState = this.store.read();
    const previous: SavedRequest | undefined = checkRequest(state, "prepare", input, input.matterId);
    if (previous?.artifactId !== undefined && previous.artifactId !== null) return { snapshot: this.snapshot(), artifactId: previous.artifactId };
    const matter = matterFromState(state, input.matterId);
    const requirements: string[] = [...input.requirements];
    const context: ContextBundle = currentContext(state, matter, requirements, this.options.now());
    const template = await this.options.loadTemplate(input.skillId);
    const artifact: PreparedArtifact = prepareFromTemplate(context, template, matter, this.options.now());
    await this.save(appendRequest({ ...state, contexts: [...state.contexts, context], artifacts: [...state.artifacts, artifact] }, "prepare", input, input.matterId, artifact.id, null));
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
    const request: ExportRequest = { actorId: LOCAL_OWNER, plan, artifact, confirmation: { ownerId: LOCAL_OWNER, planId: plan.id, planHash: input.planHash, confirmedAt: this.options.now(), decision: input.decision }, template: template };
    const pending: ToolRun = beginToolRun(LOCAL_OWNER, plan, artifact, request.confirmation, null);
    if (checkRequest(state, "export", input, input.plan.id) === undefined) await this.save(appendRequest(state, "export", input, input.plan.id, artifact.id, pending.operationId));
    const existing: ToolRun | undefined = state.runs.find((run) => run.operationId === pending.operationId);
    const readEvidence = async (): Promise<CurrentEvidence> => {
      await this.store.refresh();
      const current: LocalState = this.store.read();
      this.exportableArtifact(current, plan.artifactId, plan.artifactVersion);
      return evidenceFromRecords(current.records, current.recordHistory);
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
