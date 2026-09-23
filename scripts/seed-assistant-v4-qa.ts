/** Create a one-time synthetic A00 fixture in an isolated QA data directory. */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assistantStateSchema } from "../src/assistant-types.ts";
import { LocalStateStore, containedDirectory, stateSchema } from "../src/h5-data.ts";
import { initialState } from "../src/h5-state.ts";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const dataRoot = path.join(workspaceRoot, "work", "edge-qa-a00-data");
const taskId = "qa-task-weekend-trip";
const sessionId = "qa-session-weekend-trip";
const nowDate = new Date();
const now = nowDate.toISOString();
const nowMs = nowDate.getTime();
const at = (minutesAgo: number): string => new Date(nowMs - minutesAgo * 60_000).toISOString();

try {
  const existingFiles = (await readdir(dataRoot)).filter((name) => /^state-\d{10}\.json$/.test(name)).sort();
  const latest = existingFiles.at(-1);
  if (latest !== undefined) {
    const existing = stateSchema.parse(JSON.parse(await readFile(path.join(dataRoot, latest), "utf8")));
    if (existing.assistant.tasks.some((task) => task.id === taskId)) {
      process.stdout.write(`${JSON.stringify({ event: "assistant_v4_qa_fixture_exists", dataDirectory: path.relative(workspaceRoot, dataRoot) })}\n`);
      process.exit(0);
    }
    throw new Error(`Refusing to replace existing QA state in ${path.relative(workspaceRoot, dataRoot)}`);
  }
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
}

const base = initialState(now);
const mainMatter = { ...base.matters[0]!, title: "明天下午的团队同步", goal: "准备同步进展、预算变化与待确认事项" };
const ideasMatter = {
  ...base.matters[1]!, id: "today-ideas", title: "整理今天的两个新想法",
  goal: "把今天通勤时记录的两个产品想法整理成后续行动",
};
const tripMatter = {
  ...base.matters[1]!, id: "weekend-trip", title: "周末出行计划",
  goal: "比较周末目的地、路线和出发时间",
};
const ideas = base.records.find((record) => record.id === "sample-life");
if (ideas === undefined) throw new Error("Initial state is missing its synthetic idea record");
const assistant = assistantStateSchema.parse({
  schemaVersion: 1,
  sessions: [{ id: sessionId, ownerId: "local-preview-owner", mode: "task", title: "周末出行计划", contextId: tripMatter.id, contextRefs: ["sample-trip"], createdAt: at(6), updatedAt: now }],
  messages: [
    { id: "qa-message-user", sessionId, role: "user", content: "帮我制定周末出行计划，比对路线和时间。", createdAt: at(6) },
    { id: "qa-message-assistant", sessionId, role: "assistant", content: "正在比对路线和时间。", createdAt: now },
  ],
  tasks: [{
    id: taskId, sessionId, ownerId: "local-preview-owner", contextId: tripMatter.id, goal: "周末出行计划",
    requirements: [], deliveryMode: null, status: "running", progress: 60, currentStep: 2,
    executor: "local-preparation-service", etaSeconds: 60, planVersion: 1, runVersion: 1,
    nextRunAt: null, artifactId: null, artifactVersion: null, exportOperationId: null,
    errorCode: null, createdAt: at(6), updatedAt: now, completedAt: null,
  }],
  steps: [
    { id: "qa-step-destination", taskId, title: "确认目的地偏好", detail: "整理已有的周末出行记录", status: "completed", startedAt: at(5), finishedAt: at(4), error: null },
    { id: "qa-step-options", taskId, title: "筛选适合的路线", detail: "汇总可选路线和时间", status: "completed", startedAt: at(4), finishedAt: at(2), error: null },
    { id: "qa-step-route", taskId, title: "比对路线和时间", detail: "比较通勤时长与出发时间", status: "running", startedAt: at(1), finishedAt: null, error: null },
    { id: "qa-step-plan", taskId, title: "整理行程建议", detail: "整理一版可核对的安排", status: "pending", startedAt: null, finishedAt: null, error: null },
    { id: "qa-step-choice", taskId, title: "等待你的选择", detail: "由你确认后再继续", status: "pending", startedAt: null, finishedAt: null, error: null },
  ],
  evidence: [], inputRequests: [], confirmations: [],
  events: [
    { id: "qa-event-created", taskId, kind: "task-created", summary: "周末出行计划已创建。", createdAt: at(6) },
    { id: "qa-event-started", taskId, kind: "task-started", summary: "正在比对周末路线与时间。", createdAt: now },
  ],
});
const state = stateSchema.parse({
  ...base,
  matters: [mainMatter, ideasMatter, tripMatter],
  decisions: [{ matterId: tripMatter.id, state: "dismissed", snoozedUntil: null }],
  records: [
    ...base.records.filter((record) => record.contextId === mainMatter.id && record.id !== "sample-scope"),
    { ...ideas, id: "sample-idea-one", contextId: ideasMatter.id, title: "示例 · 通勤时想到的产品方向", text: "可以把每天零散记录的想法整理成一个每周回顾。", module: "inspiration", cover: "commute" },
    { ...ideas, id: "sample-idea-two", contextId: ideasMatter.id, title: "示例 · 先验证一个小问题", text: "在做完整方案之前，先找两位用户确认这个想法是否有用。", module: "inspiration", cover: "commute", recordedAt: at(8) },
    { ...ideas, id: "sample-trip", contextId: tripMatter.id, title: "示例 · 周末出行偏好", text: "周末想找一条轻松的路线，出发时间还没有决定。", module: "life", cover: "run", recordedAt: at(12) },
  ],
  assistant,
});
const directory = await containedDirectory(workspaceRoot, dataRoot);
await new LocalStateStore(directory, state).initialize();
process.stdout.write(`${JSON.stringify({ event: "assistant_v4_qa_fixture_created", dataDirectory: path.relative(workspaceRoot, directory), suggestions: 2, activeTask: taskId })}\n`);
