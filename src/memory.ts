/** Build task-scoped evidence snapshots without treating similarity as authorization. */
import { contextBundleSchema, memorySchema, sourceSchema } from "./contracts.ts";
import type { ContextBundle, ContextEvidenceScope, Memory, Source } from "./contracts.ts";
import { DomainError } from "./errors.ts";

export interface ContextRequest {
  id: string;
  ownerId: string;
  contextId: string;
  goal: string;
  userRequirements: readonly string[];
  gaps: readonly string[];
  evidenceScope?: ContextEvidenceScope;
}

function activeMemories(ownerId: string, contextId: string, sources: readonly Source[], memories: readonly Memory[], now: string): Memory[] {
  const timestamp: number = Date.parse(now);
  if (!Number.isFinite(timestamp)) throw new DomainError("INVALID_TIME", "Context time must be an ISO datetime", 400);
  const sourceIndex: Map<string, Source> = new Map();
  for (const rawSource of sources) {
    const source: Source = sourceSchema.parse(rawSource);
    if (source.ownerId === ownerId && source.contextId === contextId) {
      if (sourceIndex.has(source.id)) throw new DomainError("DUPLICATE_SOURCE", `Duplicate current source: ${source.id}`, 400);
      sourceIndex.set(source.id, source);
    }
  }
  const identifiers: Set<string> = new Set();
  const superseded: Set<string> = new Set();
  const candidates: Memory[] = [];
  for (const rawMemory of memories) {
    const memory: Memory = memorySchema.parse(rawMemory);
    if (memory.ownerId !== ownerId || memory.contextId !== contextId) continue;
    if (identifiers.has(memory.id)) throw new DomainError("DUPLICATE_MEMORY", `Duplicate current memory: ${memory.id}`, 400);
    identifiers.add(memory.id);
    // Supersession is historical: an expired or removed replacement does not
    // silently make the earlier condition current again.
    if (memory.supersedesId !== null && Date.parse(memory.validFrom) <= timestamp) superseded.add(memory.supersedesId);
    if (Date.parse(memory.validFrom) > timestamp || (memory.validUntil !== null && Date.parse(memory.validUntil) <= timestamp)) continue;
    const evidenceCurrent: boolean = memory.sources.every((reference) => {
      const source: Source | undefined = sourceIndex.get(reference.sourceId);
      return source !== undefined && source.state === "active" && source.revision === reference.revision && reference.endMs <= source.durationMs;
    });
    if (evidenceCurrent) candidates.push(memory);
  }
  return candidates.filter((memory) => !superseded.has(memory.id));
}

export function buildContextBundle(request: ContextRequest, sources: readonly Source[], memories: readonly Memory[], now: string): ContextBundle {
  return contextBundleSchema.parse({
    contract: "context-bundle.v1", id: request.id, ownerId: request.ownerId, contextId: request.contextId,
    createdAt: now, goal: request.goal, userRequirements: [...request.userRequirements],
    memories: activeMemories(request.ownerId, request.contextId, sources, memories, now), gaps: [...request.gaps],
    evidenceScope: request.evidenceScope ?? { mode: "all_active_context_records", recordIds: [] },
  });
}

export function assertContextCurrent(bundleInput: ContextBundle, sources: readonly Source[], memories: readonly Memory[], now: string): void {
  const bundle: ContextBundle = contextBundleSchema.parse(bundleInput);
  const current: Map<string, Memory> = new Map(activeMemories(bundle.ownerId, bundle.contextId, sources, memories, now).map((memory) => [memory.id, memory]));
  for (const memory of bundle.memories) {
    const authoritative: Memory | undefined = current.get(memory.id);
    if (memory.ownerId !== bundle.ownerId || memory.contextId !== bundle.contextId || !authoritative || JSON.stringify(authoritative) !== JSON.stringify(memory)) {
      throw new DomainError("STALE_CONTEXT", `Background memory is no longer current or accessible: ${memory.id}; rebuild the background before preparing or exporting`, 409);
    }
  }
}
