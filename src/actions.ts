/** Confirmation is bound to exact content; unknown writes must be reconciled. */
import { createHash } from "node:crypto";
import { artifactSchema, confirmationSchema, exportPlanSchema, toolRunSchema } from "./contracts.ts";
import type { Confirmation, ExportPlan, PreparedArtifact, ToolRun } from "./contracts.ts";
import { DomainError } from "./errors.ts";

export function hashArtifact(artifact: PreparedArtifact): string {
  return createHash("sha256").update(JSON.stringify(artifactSchema.parse(artifact))).digest("hex");
}

export function hashPlan(plan: ExportPlan): string {
  return createHash("sha256").update(JSON.stringify(exportPlanSchema.parse(plan))).digest("hex");
}

export function createExportPlan(id: string, version: number, artifactInput: PreparedArtifact, filename: string): ExportPlan {
  const artifact: PreparedArtifact = artifactSchema.parse(artifactInput);
  return exportPlanSchema.parse({
    id, version, ownerId: artifact.ownerId, artifactId: artifact.id, artifactVersion: artifact.version,
    artifactHash: hashArtifact(artifact), contextBundleId: artifact.contextBundleId,
    capability: "artifact.export-docx", target: "private-download", filename,
  });
}

export function validateConfirmation(actorId: string, planInput: ExportPlan, artifact: PreparedArtifact, confirmationInput: Confirmation): void {
  const plan: ExportPlan = exportPlanSchema.parse(planInput);
  const confirmation: Confirmation = confirmationSchema.parse(confirmationInput);
  if (actorId !== plan.ownerId || actorId !== artifact.ownerId || confirmation.ownerId !== actorId) {
    throw new DomainError("ACTION_FORBIDDEN", "Export actor does not own the action, confirmation, and artifact", 403);
  }
  if (plan.artifactId !== artifact.id || plan.artifactVersion !== artifact.version || plan.artifactHash !== hashArtifact(artifact) || plan.contextBundleId !== artifact.contextBundleId) {
    throw new DomainError("STALE_ACTION", "Artifact content or version changed; prepare a new export plan and obtain confirmation", 409);
  }
  if (confirmation.planId !== plan.id || confirmation.planHash !== hashPlan(plan)) {
    throw new DomainError("STALE_CONFIRMATION", "Confirmation does not match this exact export plan", 409);
  }
  if (confirmation.decision !== "approved") throw new DomainError("ACTION_REJECTED", "User rejected this export; no file may be generated", 403);
}

export function beginToolRun(actorId: string, plan: ExportPlan, artifact: PreparedArtifact, confirmation: Confirmation, existing: ToolRun | null): ToolRun {
  validateConfirmation(actorId, plan, artifact, confirmation);
  const planHash: string = hashPlan(plan);
  // Recreating a plan ID cannot bypass an unresolved attempt for the same effect.
  // Confirmation still binds the complete plan; conflicting plans require review.
  const effectHash: string = createHash("sha256").update(JSON.stringify({
    ownerId: plan.ownerId, artifactHash: plan.artifactHash, capability: plan.capability,
    target: plan.target, filename: plan.filename,
  })).digest("hex");
  const operationId: string = `export-${effectHash}`;
  if (existing !== null) {
    const run: ToolRun = toolRunSchema.parse(existing);
    if (run.operationId !== operationId || run.ownerId !== actorId || run.planHash !== planHash || run.planId !== plan.id) {
      throw new DomainError("OPERATION_CONFLICT", "Existing execution belongs to a different action", 409);
    }
    if (run.state === "completed") return run;
    throw new DomainError("RECONCILIATION_REQUIRED", `Operation ${operationId} is ${run.state}; query its result before requesting another write`, 409);
  }
  return toolRunSchema.parse({ operationId, ownerId: actorId, planId: plan.id, planHash, state: "executing", fileHash: null, storageKey: null, byteLength: null, verifiedAt: null, errorCode: null });
}
