/** Deterministic source grouping, not model extraction or a claim of understanding. */
import { randomUUID } from "node:crypto";
import { validatePreparedArtifact } from "./artifacts.ts";
import type { ArtifactTemplate, ContextBundle, Memory, PreparedArtifact } from "./contracts.ts";
import { DomainError } from "./errors.ts";
import { evidenceFromRecords, LOCAL_OWNER } from "./h5-state.ts";
import type { LocalState } from "./h5-state.ts";
import type { H5Matter, H5Suggestion } from "./h5-types.ts";
import { assertContextCurrent, buildContextBundle } from "./memory.ts";

type Block = PreparedArtifact["sections"][number]["blocks"][number];

export function matterFromState(state: LocalState, id: string): H5Matter {
  const matter: H5Matter | undefined = state.matters.find((item) => item.id === id);
  if (matter === undefined) throw new DomainError("MATTER_NOT_FOUND", `Unknown matter ${id}; select an existing matter`, 404);
  return matter;
}

function selectedRecordIds(recordIds: readonly string[] | undefined): string[] | undefined {
  return recordIds === undefined ? undefined : [...new Set(recordIds)].sort();
}

function scopedEvidence(state: LocalState, ownerId: string, recordIds: readonly string[] | undefined) {
  const selected: string[] | undefined = selectedRecordIds(recordIds);
  const permitted: Set<string> | undefined = selected === undefined ? undefined : new Set(selected);
  const records = permitted === undefined ? state.records : state.records.filter((record) => permitted.has(record.id));
  const history = permitted === undefined ? state.recordHistory : state.recordHistory.filter((record) => permitted.has(record.id));
  return evidenceFromRecords(records, history, ownerId);
}

export function evidenceForContext(state: LocalState, context: ContextBundle) {
  const selected = context.evidenceScope.mode === "selected_record_ids" ? context.evidenceScope.recordIds : undefined;
  return scopedEvidence(state, context.ownerId, selected);
}

export function currentContext(state: LocalState, matter: H5Matter, requirements: string[], now: string, ownerId: string = LOCAL_OWNER, recordIds: readonly string[] | undefined = undefined): ContextBundle {
  const selected: string[] | undefined = selectedRecordIds(recordIds);
  const evidence = scopedEvidence(state, ownerId, selected);
  return buildContextBundle({
    id: `context-${randomUUID()}`, ownerId, contextId: matter.id, goal: matter.goal,
    userRequirements: requirements,
    gaps: ["规则只整理已输入的文字，不核实实际进度、人员身份或事项承诺；未明确给出的信息仍待确认。"],
    evidenceScope: selected === undefined
      ? { mode: "all_active_context_records", recordIds: [] }
      : { mode: "selected_record_ids", recordIds: selected },
  }, evidence.sources, evidence.memories, now);
}

export function assertFullContextCurrent(state: LocalState, context: ContextBundle, now: string): void {
  const evidence = evidenceForContext(state, context);
  assertContextCurrent(context, evidence.sources, evidence.memories, now);
  const selected = context.evidenceScope.mode === "selected_record_ids" ? context.evidenceScope.recordIds : undefined;
  const current: ContextBundle = currentContext(state, matterFromState(state, context.contextId), context.userRequirements, now, context.ownerId, selected);
  if (JSON.stringify(current.memories) !== JSON.stringify(context.memories)) {
    throw new DomainError("STALE_CONTEXT", "相关来源已增加、修订或失效；请重新准备后再编辑或导出，原稿仍作为历史版本保留。", 409);
  }
}

export function artifactIsCurrent(state: LocalState, artifact: PreparedArtifact, now: string): boolean {
  const context: ContextBundle | undefined = state.contexts.find((item) => item.id === artifact.contextBundleId);
  if (context === undefined) return false;
  try { assertFullContextCurrent(state, context, now); return true; }
  catch (error) {
    if (error instanceof DomainError && error.code === "STALE_CONTEXT") return false;
    throw error;
  }
}

export function suggestionsFromState(state: LocalState, now: string): H5Suggestion[] {
  return state.matters.filter((matter) => Date.parse(matter.dueAt) >= Date.parse(now) && Date.parse(matter.dueAt) - Date.parse(now) <= 48 * 3600000)
    .flatMap((matter): H5Suggestion[] => {
      const records = state.records.filter((record) => record.contextId === matter.id && record.state === "active");
      if (records.length === 0) return [];
      const decision = state.decisions.find((item) => item.matterId === matter.id);
      const prepared: PreparedArtifact | undefined = [...state.artifacts].reverse().find((artifact) => artifact.contextId === matter.id && artifactIsCurrent(state, artifact, now));
      const muted: boolean = decision !== undefined && (decision.state === "dismissed" || (decision.snoozedUntil !== null && Date.parse(decision.snoozedUntil) > Date.parse(now)));
      const changed: number = records.filter((record) => record.revision > 1).length;
      const discussion: boolean = /同步|会议|汇报/.test(`${matter.title} ${matter.goal}`);
      const deliverable: string = discussion ? "汇报结构" : "准备建议";
      const chinaDay = (value: string): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
      const allRecordsToday: boolean = records.length > 0 && records.every((record) => chinaDay(record.recordedAt) === chinaDay(now));
      const iterations: number = Math.max(0, records.length - 1);
      const reason: string = discussion && allRecordsToday
        ? `今天的讨论已持续${iterations}次相关迭代${changed > 0 ? `，并有${changed}条有效修订` : ""}。我可以先帮你整理一版${deliverable}，看看是否符合预期。`
        : `根据${records.length}条相关记录${changed > 0 ? `（含${changed}条修订）` : ""}，我可以先帮你整理一版${deliverable}，看看是否符合预期。`;
      return [{
        id: `suggestion-${matter.id}`, matterId: matter.id, title: `准备${matter.title}`,
        reason,
        dueAt: matter.dueAt, sourceIds: records.map((record) => record.id),
        state: muted && decision !== undefined ? decision.state : prepared !== undefined ? "prepared" : "available",
        snoozedUntil: muted && decision?.state === "snoozed" ? decision.snoozedUntil : null, artifactId: prepared?.id ?? null,
      }];
    });
}

function sourcedBlocks(sectionId: string, memories: readonly Memory[]): Block[] {
  return memories.map((memory, index): Block => ({ id: `${sectionId}-${index + 1}`, text: memory.text, basis: "sourced", memoryIds: [memory.id] }));
}

export function prepareFromTemplate(context: ContextBundle, template: ArtifactTemplate, matter: H5Matter, now: string): PreparedArtifact {
  const uncertain: Memory[] = context.memories.filter((memory) => /待确认|尚未|未确认|还没有|可能|暂定/.test(memory.text));
  const constraints: Memory[] = context.memories.filter((memory) => /不做|不能|预算|上限|必须|限制|不得|不包含|仅|只|先不/.test(memory.text));
  const sections: PreparedArtifact["sections"] = template.sections.map((section) => {
    let blocks: Block[];
    switch (section.id) {
      case "report-objective":
      case "objective-and-scope":
        blocks = [{ id: `${section.id}-goal`, text: `${matter.provenance === "synthetic" ? "【示例事项设定】" : "【用户设置的事项】"}${matter.goal}；${matter.durationMinutes} 分钟。${matter.provenance === "synthetic" ? "事项时间与参与者来自构造场景，未经真实确认。" : "参与者与时间为用户输入，未进行外部核实。"}`, basis: "user_authored", memoryIds: [] }];
        break;
      case "progress-and-changes":
      case "requirements":
        blocks = sourcedBlocks(section.id, context.memories);
        break;
      case "constraints-and-exclusions":
        blocks = sourcedBlocks(section.id, constraints);
        break;
      case "risks-and-impact":
      case "decisions-needed":
        blocks = sourcedBlocks(section.id, uncertain);
        break;
      case "acceptance-notes":
        blocks = [{ id: `${section.id}-proposal`, text: "建议逐项核对上述需求是否保留原始来源、当前条件与不做项；这只是待确认的验收建议，不表示已实现或已通过。", basis: "inference", memoryIds: context.memories.map((memory) => memory.id) }];
        break;
      case "information-gaps":
        blocks = context.gaps.map((gap, index): Block => ({ id: `gap-${index + 1}`, text: gap, basis: "gap", memoryIds: [] }));
        blocks.push(...uncertain.map((memory, index): Block => ({ id: `uncertain-${index + 1}`, text: memory.text, basis: "gap", memoryIds: [memory.id] })));
        if (context.memories.some((memory) => memory.text.startsWith("【构造示例】"))) blocks.push({ id: "synthetic-notice", text: "本稿使用了明确标记的构造示例，请替换或核对后再用于真实工作。", basis: "gap", memoryIds: [] });
        break;
      default: throw new DomainError("UNSUPPORTED_TEMPLATE_SECTION", `Local preparation has no rule for ${section.id}`, 500);
    }
    if (section.id === "report-objective" || section.id === "constraints-and-exclusions") {
      blocks.push(...context.userRequirements.map((requirement, index): Block => ({ id: `user-requirement-${index + 1}`, text: requirement, basis: "user_authored", memoryIds: [] })));
    }
    if (blocks.length === 0) blocks.push({ id: `${section.id}-missing`, text: `当前来源不足以填写「${section.title}」，请补充或确认。`, basis: "gap", memoryIds: [] });
    return { id: section.id, title: section.title, blocks };
  });
  return validatePreparedArtifact({
    contract: "prepared-artifact.v1", id: `artifact-${randomUUID()}`, ownerId: context.ownerId, contextId: context.contextId,
    skillId: template.id, version: 1, previousVersion: null, contextBundleId: context.id,
    title: `${matter.title} · ${template.id === "report-outline" ? "汇报提纲" : "需求清单"}`,
    userRequirements: [...context.userRequirements], sections, savedAt: now,
  }, context, template);
}
