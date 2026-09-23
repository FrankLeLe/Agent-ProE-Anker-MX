/** Validated single-owner state and deterministic source conversion shared by both runtimes. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { assistantStateSchema, emptyAssistantState } from "./assistant-types.ts";
import { artifactSchema, contextBundleSchema, exportPlanSchema, identifierSchema, memorySchema, sourceSchema, toolRunSchema } from "./contracts.ts";
import type { Memory, Source } from "./contracts.ts";
import type { H5Record } from "./h5-types.ts";

export const LOCAL_OWNER: string = "local-preview-owner";
export const recordSchema = z.object({
  id: identifierSchema, contextId: identifierSchema, title: z.string().min(1).max(200), text: z.string().min(1).max(20000),
  module: z.enum(["work", "life", "social", "inspiration"]), recordedAt: z.iso.datetime({ offset: true }),
  durationSeconds: z.number().int().nonnegative().nullable(), provenance: z.enum(["synthetic", "user_text"]),
  revision: z.number().int().positive(), state: z.enum(["active", "deleted"]), cover: z.enum(["commute", "desk", "run", "none"]),
});
const matterSchema = z.object({
  id: identifierSchema, title: z.string().min(1), goal: z.string().min(1), dueAt: z.iso.datetime({ offset: true }),
  participants: z.array(z.string()), durationMinutes: z.number().int().positive(),
  provenance: z.enum(["synthetic", "user_entered"]),
});
const decisionSchema = z.object({
  matterId: identifierSchema, state: z.enum(["snoozed", "dismissed"]), snoozedUntil: z.iso.datetime({ offset: true }).nullable(),
});
const requestSchema = z.object({
  requestId: identifierSchema, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), kind: z.string(),
  artifactId: identifierSchema.nullable(), operationId: identifierSchema.nullable(),
  sessionId: identifierSchema.nullable().default(null), taskId: identifierSchema.nullable().default(null),
});
export const stateSchema = z.object({
  schemaVersion: z.literal(1), revision: z.number().int().positive(), records: z.array(recordSchema),
  recordHistory: z.array(recordSchema), matters: z.array(matterSchema), decisions: z.array(decisionSchema),
  artifacts: z.array(artifactSchema), contexts: z.array(contextBundleSchema), plans: z.array(exportPlanSchema),
  runs: z.array(toolRunSchema), requests: z.array(requestSchema),
  // Existing local snapshots are upgraded on their next append-only write.
  assistant: assistantStateSchema.default(emptyAssistantState()),
});
export type LocalState = z.infer<typeof stateSchema>;
export type SavedRequest = z.infer<typeof requestSchema>;

export function fingerprint(value: object): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function evidenceFromRecords(records: readonly H5Record[], history: readonly H5Record[], ownerId: string = LOCAL_OWNER): { sources: Source[]; memories: Memory[] } {
  const sources: Source[] = records.map((record): Source => sourceSchema.parse({
    id: record.id, ownerId, contextId: record.contextId, revision: record.revision, state: record.state,
    recordedAt: record.recordedAt, timezone: "Asia/Shanghai", durationMs: (record.durationSeconds ?? 0) * 1000, provenance: record.provenance,
  }));
  const memories: Memory[] = [...history, ...records].map((record): Memory => memorySchema.parse({
    id: `memory-${record.id}-v${record.revision}`, ownerId, contextId: record.contextId,
    text: `${record.provenance === "synthetic" ? "【构造示例】" : ""}${record.text}`, kind: "fact", provenance: record.provenance === "synthetic" ? "synthetic" : "user_entered",
    module: record.module, validFrom: record.recordedAt, validUntil: null,
    supersedesId: record.revision > 1 ? `memory-${record.id}-v${record.revision - 1}` : null,
    sources: [{ sourceId: record.id, revision: record.revision, startMs: 0, endMs: 0 }],
  }));
  return { sources, memories };
}

export function initialState(now: string): LocalState {
  const tomorrow: string = new Date(Date.parse(now) + 8 * 3600000 + 86400000).toISOString().slice(0, 10);
  const makeRecord = (id: string, title: string, text: string, minuteOffset: number, module: H5Record["module"], contextId: string, cover: H5Record["cover"]): H5Record => ({
    id, title, text, module, contextId, cover, recordedAt: new Date(Date.parse(now) - minuteOffset * 60000).toISOString(),
    provenance: "synthetic", revision: 1, state: "active", durationSeconds: null,
  });
  const oldBudget: H5Record = makeRecord("sample-budget", "示例 · 预算修订", "早期预算草案为 20000 元，已被后续修订替代。", 40, "work", "mx-product", "desk");
  return stateSchema.parse({
    schemaVersion: 1, revision: 1,
    records: [
      makeRecord("sample-focus", "示例 · 明天的团队同步", "明天与 Alex 做 30 分钟团队方案同步，汇报重点放在当前进展、发生的变化和需要决定的事项。", 30, "work", "mx-product", "commute"),
      makeRecord("sample-deadline", "示例 · 原型时间待确认", "原型希望周四完成，但交付时间尚未确认；汇报中不能把周四写成承诺。", 25, "work", "mx-product", "desk"),
      { ...oldBudget, text: "当前预算上限修订为 18000 元；请按这个金额准备，早期预算已被替代。", revision: 2, recordedAt: new Date(Date.parse(now) - 20 * 60000).toISOString() },
      makeRecord("sample-scope", "示例 · 先跑通核心体验", "这阶段聚焦记录、关联记忆、主动准备；先不做登录和支付系统。", 15, "work", "mx-product", "desk"),
      makeRecord("sample-life", "示例 · 周末慢跑", "周末想沿河慢跑，出发时间还没有决定。", 10, "life", "week-end", "run"),
    ],
    recordHistory: [oldBudget],
    matters: [
      { id: "mx-product", title: "团队方案同步", goal: "准备团队同步要用的进展、变化与待决定事项", dueAt: new Date(`${tomorrow}T14:00:00+08:00`).toISOString(), participants: ["Alex"], durationMinutes: 30, provenance: "synthetic" },
      { id: "week-end", title: "周末生活安排", goal: "整理周末安排与待确认事项", dueAt: new Date(`${tomorrow}T09:00:00+08:00`).toISOString(), participants: [], durationMinutes: 30, provenance: "synthetic" },
    ], decisions: [], artifacts: [], contexts: [], plans: [], runs: [], requests: [], assistant: emptyAssistantState(),
  });
}

export interface H5StateStore {
  read(): LocalState;
  save(state: LocalState): Promise<void>;
  refresh(): Promise<void>;
}
