/** Validate prepared output and immutable revisions; model prose never grants authority. */
import { artifactSchema, contextBundleSchema, templateSchema } from "./contracts.ts";
import type { ArtifactTemplate, ContextBundle, PreparedArtifact } from "./contracts.ts";
import { DomainError } from "./errors.ts";

export function validatePreparedArtifact(input: PreparedArtifact, contextInput: ContextBundle, templateInput: ArtifactTemplate): PreparedArtifact {
  const artifact: PreparedArtifact = artifactSchema.parse(input);
  const context: ContextBundle = contextBundleSchema.parse(contextInput);
  const template: ArtifactTemplate = templateSchema.parse(templateInput);
  if (artifact.ownerId !== context.ownerId || artifact.contextId !== context.contextId || artifact.contextBundleId !== context.id) {
    throw new DomainError("ARTIFACT_CONTEXT_MISMATCH", "Artifact owner, matter, and background snapshot must match the active context", 403);
  }
  if (artifact.skillId !== template.id) throw new DomainError("WRONG_SKILL_TEMPLATE", "Artifact kind does not match the selected skill template", 400);
  if (artifact.userRequirements.length !== context.userRequirements.length || artifact.userRequirements.some((value, index) => value !== context.userRequirements[index])) {
    throw new DomainError("REQUIREMENTS_CHANGED", "Prepared artifact must preserve the exact active user requirements; revise the context explicitly before changing them", 409);
  }
  const allowedSections: Set<string> = new Set(template.sections.map((section) => section.id));
  const sectionIds: Set<string> = new Set();
  const blockIds: Set<string> = new Set();
  const evidenceIds: Set<string> = new Set(context.memories.map((memory) => memory.id));
  for (const section of artifact.sections) {
    if (!allowedSections.has(section.id) || sectionIds.has(section.id)) {
      throw new DomainError("INVALID_SECTION", `Unknown or duplicate template section: ${section.id}`, 400);
    }
    sectionIds.add(section.id);
    for (const block of section.blocks) {
      if (blockIds.has(block.id)) throw new DomainError("DUPLICATE_BLOCK", `Duplicate artifact block: ${block.id}`, 400);
      blockIds.add(block.id);
      if (block.basis === "sourced" && block.memoryIds.length === 0) {
        throw new DomainError("MISSING_EVIDENCE", `Sourced block has no evidence: ${block.id}`, 400);
      }
      if (new Set(block.memoryIds).size !== block.memoryIds.length || block.memoryIds.some((id) => !evidenceIds.has(id))) {
        throw new DomainError("INVALID_CITATION", `Artifact block references missing or duplicate background memories: ${block.id}`, 400);
      }
    }
  }
  for (const section of template.sections) {
    if (section.required && !artifact.sections.some((candidate) => candidate.id === section.id && candidate.blocks.length > 0)) {
      throw new DomainError("MISSING_SECTION", `Required section needs sourced content or an explicit gap: ${section.id}`, 400);
    }
  }
  return artifact;
}

export function validateArtifactRevision(previousInput: PreparedArtifact, nextInput: PreparedArtifact, context: ContextBundle, template: ArtifactTemplate): PreparedArtifact {
  const previous: PreparedArtifact = artifactSchema.parse(previousInput);
  const next: PreparedArtifact = validatePreparedArtifact(nextInput, context, template);
  if (next.id !== previous.id || next.ownerId !== previous.ownerId || next.contextId !== previous.contextId || next.skillId !== previous.skillId || next.previousVersion !== previous.version) {
    throw new DomainError("INVALID_ARTIFACT_REVISION", "Revision must keep artifact identity and append to the exact previous version", 409);
  }
  return next;
}
