/** Render trusted templates; generation never executes model-supplied scripts. */
import { createHash } from "node:crypto";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { toolRunSchema } from "./contracts.ts";
import type { ArtifactTemplate, ContextBundle, Memory, PreparedArtifact, ToolRun } from "./contracts.ts";
import { validatePreparedArtifact } from "./artifacts.ts";
import { DomainError } from "./errors.ts";

export function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function renderArtifactDocx(artifactInput: PreparedArtifact, context: ContextBundle, template: ArtifactTemplate): Promise<Buffer> {
  const artifact: PreparedArtifact = validatePreparedArtifact(artifactInput, context, template);
  const paragraphs: Paragraph[] = [new Paragraph({ text: artifact.title, heading: HeadingLevel.TITLE })];
  paragraphs.push(new Paragraph({ text: `版本 ${artifact.version} · 背景 ${context.id}`, spacing: { after: 240 } }));
  const labels: Record<"sourced" | "user_authored" | "inference" | "gap", string> = {
    sourced: "依据来源", user_authored: "用户补充", inference: "推测，待确认", gap: "信息缺口",
  };
  for (const section of artifact.sections) {
    paragraphs.push(new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_1 }));
    for (const block of section.blocks) {
      paragraphs.push(new Paragraph({
        children: [
          new TextRun({ text: `[${labels[block.basis]}] `, color: "5C6370" }),
          new TextRun(block.text),
          new TextRun({ text: block.memoryIds.length > 0 ? ` [${block.memoryIds.join(", ")}]` : "", color: "5C6370", size: 18 }),
        ], spacing: { after: 160 },
      }));
    }
  }
  paragraphs.push(new Paragraph({ text: "采用的来源", heading: HeadingLevel.HEADING_1 }));
  const citedIds: Set<string> = new Set(artifact.sections.flatMap((section) => section.blocks.flatMap((block) => block.memoryIds)));
  const provenanceLabels: Record<Memory["provenance"], string> = {
    ai_extracted: "AI 提取", user_confirmed: "用户确认", synthetic: "构造示例", user_entered: "用户输入（未核实）",
  };
  for (const memory of context.memories.filter((item) => citedIds.has(item.id))) {
    paragraphs.push(new Paragraph({ text: `${memory.id} · ${provenanceLabels[memory.provenance]} · ${memory.text}` }));
    for (const source of memory.sources) {
      paragraphs.push(new Paragraph({ text: `${source.sourceId} / v${source.revision} / ${source.startMs}–${source.endMs} ms`, spacing: { after: 160 } }));
    }
  }
  const document: Document = new Document({
    creator: "Mixture X", title: artifact.title, revision: artifact.version,
    description: `Prepared artifact ${artifact.id}; background ${context.id}`,
    styles: { default: { document: { run: { font: "Microsoft YaHei", size: 22 }, paragraph: { spacing: { line: 320 } } } } },
    sections: [{ properties: {}, children: paragraphs }],
  });
  return Packer.toBuffer(document);
}

export interface ArtifactStorage {
  writeNew(storageKey: string, bytes: Buffer): Promise<void>;
  read(storageKey: string): Promise<Buffer>;
}

/** Readback proves byte identity, not visual layout or factual correctness. */
export async function verifyExportResult(actorId: string, input: ToolRun, storage: ArtifactStorage, verifiedAt: string): Promise<ToolRun> {
  const run: ToolRun = toolRunSchema.parse(input);
  if (run.ownerId !== actorId) throw new DomainError("RESULT_FORBIDDEN", "Only the operation owner may verify this result", 403);
  if (run.state === "failed" || run.state === "cancelled") throw new DomainError("TERMINAL_OPERATION", "Failed or cancelled operations require a new explicit action", 409);
  if (run.storageKey === null || run.fileHash === null || run.byteLength === null) {
    throw new DomainError("MISSING_WRITE_INTENT", "Execution lacks expected file metadata; no completed receipt can be issued", 409);
  }
  const bytes: Buffer = await storage.read(run.storageKey);
  if (bytes.length !== run.byteLength || hashBytes(bytes) !== run.fileHash) {
    throw new DomainError("FILE_VERIFICATION_FAILED", `Stored bytes do not match operation ${run.operationId}; retain result_unknown and investigate`, 409);
  }
  return toolRunSchema.parse({ ...run, state: "completed", verifiedAt, errorCode: null });
}
