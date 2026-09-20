/** Export orchestration requires a durable claim before a single external write. */
import { beginToolRun } from "./actions.ts";
import { validatePreparedArtifact } from "./artifacts.ts";
import { assertContextCurrent } from "./memory.ts";
import { hashBytes, renderArtifactDocx, verifyExportResult } from "./docx-export.ts";
import type { ArtifactStorage } from "./docx-export.ts";
import type { ArtifactTemplate, Confirmation, ContextBundle, ExportPlan, Memory, PreparedArtifact, Source, ToolRun } from "./contracts.ts";
import { DomainError } from "./errors.ts";

export interface RunStore {
  getArtifact(ownerId: string, id: string, version: number): Promise<PreparedArtifact | null>;
  getContext(ownerId: string, id: string): Promise<ContextBundle | null>;
  claimRun(run: ToolRun): Promise<{ created: boolean; run: ToolRun }>;
  getRun(ownerId: string, operationId: string): Promise<ToolRun | null>;
  saveRunResult(run: ToolRun): Promise<void>;
}

export interface ExportRequest {
  actorId: string;
  plan: ExportPlan;
  artifact: PreparedArtifact;
  confirmation: Confirmation;
  template: ArtifactTemplate;
}

export interface CurrentEvidence {
  sources: readonly Source[];
  memories: readonly Memory[];
}

export type EvidenceReader = () => Promise<CurrentEvidence>;

interface SavedExport { artifact: PreparedArtifact; context: ContextBundle; }

async function readSavedExport(request: ExportRequest, store: RunStore): Promise<SavedExport> {
  // Validate actor/confirmation before looking up any saved private content.
  beginToolRun(request.actorId, request.plan, request.artifact, request.confirmation, null);
  const artifact: PreparedArtifact | null = await store.getArtifact(request.actorId, request.plan.artifactId, request.plan.artifactVersion);
  if (artifact === null) throw new DomainError("ARTIFACT_NOT_SAVED", "Export requires the exact saved artifact version; save it before confirming export", 409);
  beginToolRun(request.actorId, request.plan, artifact, request.confirmation, null);
  const context: ContextBundle | null = await store.getContext(request.actorId, artifact.contextBundleId);
  if (context === null) throw new DomainError("CONTEXT_NOT_SAVED", "Saved artifact background is unavailable; rebuild and save a new version before export", 409);
  validatePreparedArtifact(artifact, context, request.template);
  return { artifact, context };
}

async function verifyCurrentResult(request: ExportRequest, context: ContextBundle, run: ToolRun, storage: ArtifactStorage, readEvidence: EvidenceReader, now: string): Promise<ToolRun> {
  const result: ToolRun = await verifyExportResult(request.actorId, run, storage, now);
  const evidence: CurrentEvidence = await readEvidence();
  assertContextCurrent(context, evidence.sources, evidence.memories, now);
  return result;
}

export async function executeConfirmedExport(request: ExportRequest, store: RunStore, storage: ArtifactStorage, readEvidence: EvidenceReader, now: string): Promise<ToolRun> {
  const saved: SavedExport = await readSavedExport(request, store);
  const current: CurrentEvidence = await readEvidence();
  assertContextCurrent(saved.context, current.sources, current.memories, now);
  const planned: ToolRun = beginToolRun(request.actorId, request.plan, saved.artifact, request.confirmation, null);
  const existing: ToolRun | null = await store.getRun(request.actorId, planned.operationId);
  if (existing !== null) {
    const completed: ToolRun = beginToolRun(request.actorId, request.plan, saved.artifact, request.confirmation, existing);
    return verifyCurrentResult(request, saved.context, completed, storage, readEvidence, now);
  }
  const bytes: Buffer = await renderArtifactDocx(saved.artifact, saved.context, request.template);
  const storageKey: string = `${planned.operationId}.docx`;
  const intent: ToolRun = { ...planned, storageKey, fileHash: hashBytes(bytes), byteLength: bytes.length };
  const claim: { created: boolean; run: ToolRun } = await store.claimRun(intent);
  if (!claim.created) {
    const completed: ToolRun = beginToolRun(request.actorId, request.plan, saved.artifact, request.confirmation, claim.run);
    return verifyCurrentResult(request, saved.context, completed, storage, readEvidence, now);
  }
  const latest: CurrentEvidence = await readEvidence();
  assertContextCurrent(saved.context, latest.sources, latest.memories, now);
  // A write/read/DB exception leaves a durable non-completed claim. Reconcile it;
  // never create another operation or overwrite the object on an uncertain result.
  await storage.writeNew(storageKey, bytes);
  const result: ToolRun = await verifyCurrentResult(request, saved.context, intent, storage, readEvidence, now);
  await store.saveRunResult(result);
  return result;
}

export async function reconcileConfirmedExport(request: ExportRequest, store: RunStore, storage: ArtifactStorage, readEvidence: EvidenceReader, now: string): Promise<ToolRun> {
  const saved: SavedExport = await readSavedExport(request, store);
  const operation: ToolRun = beginToolRun(request.actorId, request.plan, saved.artifact, request.confirmation, null);
  const current: CurrentEvidence = await readEvidence();
  assertContextCurrent(saved.context, current.sources, current.memories, now);
  const existing: ToolRun | null = await store.getRun(request.actorId, operation.operationId);
  if (existing === null) throw new DomainError("OPERATION_NOT_FOUND", "No durable operation exists to reconcile", 404);
  if (existing.operationId !== operation.operationId || existing.planHash !== operation.planHash || existing.planId !== operation.planId) {
    throw new DomainError("OPERATION_CONFLICT", "Stored operation does not match the exact confirmed plan", 409);
  }
  const result: ToolRun = await verifyCurrentResult(request, saved.context, existing, storage, readEvidence, now);
  if (existing.state !== "completed") await store.saveRunResult(result);
  return result;
}
