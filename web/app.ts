/** Stable automation: tab-today, tab-memory, tab-assistant, tab-profile, add-record,
 * record-title, record-text, record-module, record-matter, save-record, memory-search,
 * prepare-requirements, skill-report-outline, skill-requirements-checklist, prepare,
 * artifact-editor, save-revision, version-select, export-review, export-confirm,
 * source-dialog, source-edit, source-save, modal-close, error-message,
 * timeline-toggle, assistant-start, assistant-stage-back. */
import type { ContextBundle, PreparedArtifact, SkillId } from "../src/contracts.ts";
import type { ExportPlanResponse, H5ExportReceipt, H5Matter, H5Record, H5Snapshot, H5Suggestion, RecordModule } from "../src/h5-types.ts";
import { assistantView as assistantV4View, initialAssistantUiState } from "./assistant.js";
import type { AssistantUiState } from "./assistant.js";
import { ApiError, array, assistantOperation, exportPlan, exportResult, object, preparation, request, snapshot, string } from "./api.js";
import type { JsonValue } from "./api.js";

type Tab = "today" | "memory" | "assistant" | "profile";
type AssistantStage = "overview" | "prepare" | "artifact";
interface AssistantLocation { stage: AssistantStage; scrollY: number; }
type MemoryGroup = "matter" | "person" | "date";
type ModuleFilter = RecordModule | "all";
interface ArtifactDraft { artifactId: string; version: number; blocks: Record<string, string>; }
interface RecordDraft { title: string; text: string; module: RecordModule; contextId: string; }
interface MatterDraft { title: string; goal: string; dueAt: string; duration: string; participants: string; }
type Modal = { kind: "source"; recordId: string; editing: boolean; revision: number; title: string; text: string } | { kind: "add" } | { kind: "new-matter" } | { kind: "calendar" } | { kind: "export"; response: ExportPlanResponse } | null;
interface ViewState {
  snapshot: H5Snapshot | null;
  tab: Tab;
  assistantStage: AssistantStage;
  assistantUi: AssistantUiState;
  timelineExpanded: boolean;
  backgroundExpanded: boolean;
  filter: ModuleFilter;
  search: string;
  group: MemoryGroup;
  matterId: string;
  skillId: SkillId;
  requirements: string;
  requirementsByMatter: Record<string, string>;
  artifactId: string;
  artifactVersion: number | null;
  drafts: ArtifactDraft[];
  recordDraft: RecordDraft;
  matterDraft: MatterDraft;
  modal: Modal;
  busy: string | null;
  error: string;
  notice: string;
}

const state: ViewState = { snapshot: null, tab: "today", assistantStage: "overview", assistantUi: initialAssistantUiState(), timelineExpanded: false, backgroundExpanded: false, filter: "all", search: "", group: "matter", matterId: "", skillId: "report-outline", requirements: "", requirementsByMatter: {}, artifactId: "", artifactVersion: null, drafts: [], recordDraft: { title: "", text: "", module: "work", contextId: "" }, matterDraft: { title: "", goal: "", dueAt: "", duration: "30", participants: "" }, modal: null, busy: null, error: "", notice: "" };
const tabScroll: Record<Tab, number> = { today: 0, memory: 0, assistant: 0, profile: 0 };
const assistantHistory: AssistantLocation[] = [];
const requestIds: Map<string, string> = new Map();
const storageKey: string = "mx-h5-editing-v1";
let modalTrigger: HTMLElement | null = null;
let modalScrollY: number = 0;
let dismissUndoTimer: number | null = null;
const modules: { id: RecordModule; label: string; icon: string }[] = [{ id: "work", label: "工作", icon: "briefcase" }, { id: "life", label: "生活", icon: "coffee" }, { id: "social", label: "社交", icon: "users" }, { id: "inspiration", label: "灵感", icon: "lightbulb" }];
const tabs: { id: Tab; label: string; icon: string }[] = [{ id: "today", label: "今天", icon: "sun" }, { id: "memory", label: "记忆", icon: "layers" }, { id: "assistant", label: "助手", icon: "sparkles" }, { id: "profile", label: "我的", icon: "user" }];

function element(id: string): HTMLElement {
  const result: HTMLElement | null = document.getElementById(id);
  if (result === null) throw new Error(`Missing application element: ${id}`);
  return result;
}
function escape(value: string | number): string { return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character); }
function icon(name: string, extraClass: string): string { return `<img class="icon ${extraClass}" src="/assets/icons/${name}.svg" alt="" aria-hidden="true" width="22" height="22">`; }
function dateText(value: string, mode: "day" | "time" | "full"): string {
  const options: Intl.DateTimeFormatOptions = mode === "time" ? { hour: "2-digit", minute: "2-digit", hour12: false } : mode === "day" ? { month: "long", day: "numeric", weekday: "long" } : { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false };
  return new Intl.DateTimeFormat("zh-CN", options).format(new Date(value));
}
function isSameDay(left: string, right: string): boolean { return new Date(left).toDateString() === new Date(right).toDateString(); }
function activeRecords(): H5Record[] { return state.snapshot?.records.filter((record) => record.state === "active") ?? []; }
function currentMatter(): H5Matter | undefined { return state.snapshot?.matters.find((matter) => matter.id === state.matterId) ?? state.snapshot?.matters[0]; }
function matterRecords(matterId: string): H5Record[] { return activeRecords().filter((record) => record.contextId === matterId); }
function latestArtifacts(): PreparedArtifact[] {
  const versions: Map<string, PreparedArtifact> = new Map();
  for (const artifact of state.snapshot?.artifacts ?? []) if ((versions.get(artifact.id)?.version ?? 0) < artifact.version) versions.set(artifact.id, artifact);
  return [...versions.values()].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
}
function currentArtifact(): PreparedArtifact | undefined {
  const versions: PreparedArtifact[] = (state.snapshot?.artifacts ?? []).filter((artifact) => artifact.id === state.artifactId && artifact.contextId === state.matterId);
  return state.artifactVersion === null ? versions.sort((a, b) => b.version - a.version)[0] : versions.find((artifact) => artifact.version === state.artifactVersion);
}
function currentDraft(artifact: PreparedArtifact): ArtifactDraft | undefined { return state.drafts.find((draft) => draft.artifactId === artifact.id && draft.version === artifact.version); }
function draftDirty(artifact: PreparedArtifact): boolean {
  const draft: ArtifactDraft | undefined = currentDraft(artifact);
  return draft !== undefined && artifact.sections.some((section) => section.blocks.some((block) => (draft.blocks[block.id] ?? block.text) !== block.text));
}
function hasDirty(): boolean { return (state.snapshot?.artifacts ?? []).some(draftDirty) || state.recordDraft.title.length > 0 || state.recordDraft.text.length > 0 || state.matterDraft.title.length > 0 || state.matterDraft.goal.length > 0 || state.matterDraft.dueAt.length > 0 || state.matterDraft.participants.length > 0 || state.matterDraft.duration !== "30" || sourceDirty(); }
function sourceDirty(): boolean {
  if (state.modal?.kind !== "source" || !state.modal.editing) return false;
  const record: H5Record | undefined = activeRecords().find((candidate) => candidate.id === (state.modal?.kind === "source" ? state.modal.recordId : ""));
  return record !== undefined && (record.title !== state.modal.title || record.text !== state.modal.text);
}
function stale(artifact: PreparedArtifact): boolean {
  const context: ContextBundle | undefined = state.snapshot?.contexts.find((candidate) => candidate.id === artifact.contextBundleId);
  if (context === undefined) return true;
  const references = context.memories.flatMap((memory) => memory.sources);
  const scopedRecords = context.evidenceScope.mode === "selected_record_ids"
    ? matterRecords(artifact.contextId).filter((record) => context.evidenceScope.recordIds.includes(record.id))
    : matterRecords(artifact.contextId);
  return references.some((ref) => !activeRecords().some((record) => record.id === ref.sourceId && record.revision === ref.revision)) || scopedRecords.some((record) => !references.some((ref) => ref.sourceId === record.id));
}
function persistDrafts(): void {
  if (state.matterId !== "") state.requirementsByMatter[state.matterId] = state.requirements;
  try { sessionStorage.setItem(storageKey, JSON.stringify({ requirements: state.requirements, requirementsByMatter: state.requirementsByMatter, matterId: state.matterId, skillId: state.skillId, artifactId: state.artifactId, drafts: state.drafts, recordDraft: state.recordDraft, matterDraft: state.matterDraft })); }
  catch (error) {
    if (error instanceof DOMException) { state.error = "浏览器无法暂存未保存文字。请先保存当前版本，关闭页面可能丢失修改。"; renderMessages(); return; }
    throw error;
  }
}
function restoreDrafts(): void {
  const saved: string | null = sessionStorage.getItem(storageKey);
  if (saved === null) return;
  const raw: JsonValue = JSON.parse(saved);
  const v = object(raw, "browser draft");
  state.requirements = string(v.requirements, "draft.requirements");
  if (v.requirementsByMatter !== undefined) for (const [key, value] of Object.entries(object(v.requirementsByMatter, "draft.requirementsByMatter"))) state.requirementsByMatter[key] = string(value, `draft.requirementsByMatter.${key}`);
  state.matterId = string(v.matterId, "draft.matterId");
  state.artifactId = string(v.artifactId, "draft.artifactId");
  const skill: string = string(v.skillId, "draft.skillId");
  if (skill !== "report-outline" && skill !== "requirements-checklist") throw new Error("浏览器保存的准备类型不受支持，请保留文字后清理本站会话存储。");
  state.skillId = skill;
  state.drafts = array(v.drafts, "drafts").map((item) => {
    const draft = object(item, "draft");
    const version: JsonValue | undefined = draft.version;
    if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) throw new Error("浏览器草稿版本无效，请保留文字后清理本站会话存储。");
    const blocks: Record<string, string> = {};
    for (const [key, value] of Object.entries(object(draft.blocks, "draft.blocks"))) blocks[key] = string(value, `draft.blocks.${key}`);
    return { artifactId: string(draft.artifactId, "draft.artifactId"), version, blocks };
  });
  const record = object(v.recordDraft, "recordDraft");
  const module: string = string(record.module, "recordDraft.module");
  if (!isModule(module)) throw new Error("浏览器保存的记录分类无效。");
  state.recordDraft = { title: string(record.title, "recordDraft.title"), text: string(record.text, "recordDraft.text"), contextId: string(record.contextId, "recordDraft.contextId"), module };
  if (v.matterDraft !== undefined) {
    const matter = object(v.matterDraft, "matterDraft");
    state.matterDraft = { title: string(matter.title, "matterDraft.title"), goal: string(matter.goal, "matterDraft.goal"), dueAt: string(matter.dueAt, "matterDraft.dueAt"), duration: string(matter.duration, "matterDraft.duration"), participants: string(matter.participants, "matterDraft.participants") };
  }
}
function isModule(value: string): value is RecordModule { return value === "work" || value === "life" || value === "social" || value === "inspiration"; }
function requestId(key: string): string {
  const existing: string | undefined = requestIds.get(key);
  if (existing !== undefined) return existing;
  const created: string = crypto.randomUUID();
  requestIds.set(key, created);
  return created;
}
function announce(message: string): void { element("announcement").textContent = message; }
function setSnapshot(value: H5Snapshot): void {
  state.snapshot = value;
  if (!value.matters.some((matter) => matter.id === state.matterId)) switchMatter(value.matters[0]?.id ?? "");
  else if (state.artifactId === "") state.artifactId = latestArtifacts().find((artifact) => artifact.contextId === state.matterId)?.id ?? "";
  if (state.recordDraft.contextId === "") state.recordDraft.contextId = state.matterId;
}
function switchMatter(matterId: string): void {
  if (state.matterId !== matterId) {
    state.assistantStage = "overview";
    state.backgroundExpanded = false;
    assistantHistory.length = 0;
    tabScroll.assistant = 0;
  }
  if (state.matterId !== "") state.requirementsByMatter[state.matterId] = state.requirements;
  const latest: PreparedArtifact | undefined = latestArtifacts().find((artifact) => artifact.contextId === matterId);
  state.matterId = matterId;
  state.requirements = state.requirementsByMatter[matterId] ?? latest?.userRequirements.join("\n") ?? "";
  state.artifactId = latest?.id ?? "";
  state.artifactVersion = null;
  if (state.recordDraft.title === "" && state.recordDraft.text === "") state.recordDraft.contextId = matterId;
}
function button(label: string, action: string, className: string, attributes: string): string { return `<button type="button" class="${className}" data-action="${action}" ${attributes}>${label}</button>`; }
function sourceButton(record: H5Record, label: string): string { return button(`${escape(label)}${icon("chevron-right", "small")}`, "source", "text-button source-link", `data-id="${escape(record.id)}" data-testid="source-${escape(record.id)}"`); }
function receiptDownload(receipt: H5ExportReceipt, className: string, testId: string, label: string): string {
  const artifact: PreparedArtifact | undefined = state.snapshot?.artifacts.find((item) => item.id === receipt.artifactId && item.version === receipt.artifactVersion);
  const latest: PreparedArtifact | undefined = latestArtifacts().find((item) => item.id === receipt.artifactId);
  const unavailable: string | null = artifact !== undefined && stale(artifact) ? "背景已变化，请重新准备" : artifact === undefined || latest?.version !== receipt.artifactVersion ? "请使用最新版本" : null;
  if (unavailable !== null) return `<button type="button" class="${className}" data-testid="${escape(testId)}" disabled aria-disabled="true">${unavailable}</button>`;
  return `<a class="${className}" data-testid="${escape(testId)}" href="${escape(receipt.downloadUrl)}" download="${escape(receipt.filename)}">${label}${icon("download", "small")}</a>`;
}
function moduleLabel(module: RecordModule): string { return modules.find((candidate) => candidate.id === module)?.label ?? module; }
function pageHeader(title: string, subtitle: string): string { return `<header class="page-header"><div class="page-heading"><h1>${title}</h1><span>${escape(subtitle)}</span></div><div class="header-actions">${button(icon("calendar", ""), "calendar", "icon-button", 'aria-label="查看近期事项" data-testid="calendar"')}${button(`${icon("plus", "")}<span>添加记录</span>`, "add", "add-button", 'data-testid="add-record" aria-label="添加文字记录"')}</div></header>`; }
function navigation(): string {
  return `<aside class="sidebar"><nav class="main-nav" aria-label="主导航">${tabs.map((tab) => `<button type="button" data-action="tab" data-tab="${tab.id}" data-testid="tab-${tab.id}" class="nav-item ${state.tab === tab.id ? "active" : ""}" ${state.tab === tab.id ? 'aria-current="page"' : ""}>${icon(tab.icon, "")}<span>${tab.label}</span></button>`).join("")}</nav></aside>`;
}
function compactSuggestionCard(suggestion: H5Suggestion): string {
  const recordCount: number = suggestion.sourceIds.filter((id) => activeRecords().some((record) => record.id === id)).length;
  const ready: boolean = suggestion.state === "prepared";
  const title: string = state.snapshot?.matters.find((matter) => matter.id === suggestion.matterId)?.title ?? suggestion.title;
  return `<section class="preparation-card compact-preparation">${button(`<span class="spark-circle">${icon("sparkles", "")}</span><span><strong>${escape(title)}</strong><small>${recordCount} 条相关记录 · ${ready ? "接着完善" : "提前准备"}</small></span>${icon("chevron-right", "small")}`, "suggestion-open", "compact-preparation-open", `data-id="${escape(suggestion.id)}" data-testid="suggestion-open"`)}<details class="suggestion-why"><summary>为什么提醒我</summary><p class="prep-reason">${escape(suggestion.reason)}</p><p class="quiet-note">事项时间：${dateText(suggestion.dueAt, "full")}</p>${ready ? "" : `<div class="suggestion-options">${button(`${icon("clock", "small")}稍后提醒`, "snooze", "text-button", `data-id="${escape(suggestion.id)}" data-testid="suggestion-snooze"`)}${button("这次不需要", "dismiss", "text-button subdued", `data-id="${escape(suggestion.id)}" data-testid="suggestion-dismiss"`)}</div>`}</details></section>`;
}
function timelineRecord(record: H5Record): string {
  const cover: string = record.cover === "run" ? "mountains" : record.cover;
  return `<article class="timeline-item"><div class="timeline-time"><span class="time-dot"></span><time datetime="${escape(record.recordedAt)}">${dateText(record.recordedAt, "time")}</time></div><button class="record-content" type="button" data-action="source" data-id="${escape(record.id)}" data-testid="record-${escape(record.id)}"><div class="record-media ${cover === "none" ? "text-cover" : ""}">${cover === "none" ? icon("file-text", "") : `<img src="/assets/${cover}.png" alt="" loading="lazy"><span>场景示意</span>`}</div><div class="record-copy"><span class="category ${record.module}">${moduleLabel(record.module)}</span><h3>${escape(record.title)}</h3><p>${escape(record.text)}</p><span class="record-origin">${icon("file-text", "tiny")}${record.provenance === "synthetic" ? "示例记录" : "你的文字记录"}${icon("chevron-right", "tiny")}</span></div></button></article>`;
}
function todayView(): string {
  const snapshotValue: H5Snapshot | null = state.snapshot;
  if (snapshotValue === null) return "";
  const todayRecords: H5Record[] = activeRecords().filter((record) => isSameDay(record.recordedAt, snapshotValue.now));
  const records: H5Record[] = todayRecords.filter((record) => state.filter === "all" || record.module === state.filter).sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  const visibleRecords: H5Record[] = state.timelineExpanded ? records : records.slice(0, 3);
  const suggestion: H5Suggestion | undefined = snapshotValue.suggestions.find((candidate) => candidate.state === "available" || candidate.state === "prepared");
  const paused: H5Suggestion[] = snapshotValue.suggestions.filter((candidate) => candidate.state === "snoozed" || candidate.state === "dismissed");
  const userRecordCount: number = todayRecords.filter((record) => record.provenance === "user_text").length;
  const moduleCount: number = new Set(todayRecords.map((record) => record.module)).size;
  return `${pageHeader("今天", dateText(snapshotValue.now, "day"))}<div class="page-note">${icon("book-open", "small")}<span>示例记录 · 可添加你的内容</span></div><div class="today-layout"><section class="day-section"><div class="section-heading"><h2>${state.filter === "all" ? "今天的生活线" : `今天的${moduleLabel(state.filter)}片段`}</h2><span>${records.length} 个片段</span></div><div class="timeline" id="today-timeline">${visibleRecords.length > 0 ? visibleRecords.map(timelineRecord).join("") : `<div class="empty-state compact">${icon("book-open", "")}<h3>这里还没有片段</h3><p>写下一个想法，或试试其他分类。</p>${button("添加文字记录", "add", "secondary-button", "")}</div>`}</div>${records.length > 3 ? button(state.timelineExpanded ? "收起记录" : `查看全部 ${records.length} 条记录`, "timeline-toggle", "text-button timeline-toggle", `data-testid="timeline-toggle" aria-expanded="${state.timelineExpanded}" aria-controls="today-timeline"`) : ""}</section><section class="daily-reflection"><h2>${todayRecords.length === 0 ? "今天，还可以留下一个片段。" : `今天，留下了 ${todayRecords.length} 个片段。`}</h2><p>${todayRecords.length === 0 ? "一个想法、一段讨论，都可以从文字开始。" : `覆盖 ${moduleCount} 类日常 · ${userRecordCount} 条由你添加`}</p></section><div class="category-filters app-categories" aria-label="记录分类">${modules.map((module) => button(`${icon(module.icon, "")}<strong>${module.label}</strong><small>${todayRecords.filter((record) => record.module === module.id).length} 条记录</small>`, "filter", `filter-chip ${module.id} ${state.filter === module.id ? "selected" : ""}`, `data-filter="${module.id}" data-testid="filter-${module.id}" aria-pressed="${state.filter === module.id}" aria-label="${module.label}分类，再次点击显示全部"`)).join("")}</div><aside class="preparation-column">${suggestion === undefined ? `<section class="preparation-card compact-preparation quiet-card"><h2>给下一步，留一点准备。</h2>${button(`打开助手${icon("arrow-right", "small")}`, "tab", "secondary-button", 'data-tab="assistant"')}</section>` : compactSuggestionCard(suggestion)}${paused.map((item) => `<div class="paused-suggestion"><span>${item.state === "snoozed" ? `${icon("clock", "small")} 已稍后${item.snoozedUntil === null ? "" : ` · ${dateText(item.snoozedUntil, "full")}`}` : "已忽略本次提醒"}</span>${button("恢复", "restore", "text-button", `data-id="${escape(item.id)}" data-testid="suggestion-restore"`)}</div>`).join("")}</aside></div>`;
}
function memoryResults(): string {
  const query: string = state.search.toLocaleLowerCase().trim();
  const records: H5Record[] = activeRecords().filter((record) => {
    const matter: H5Matter | undefined = state.snapshot?.matters.find((candidate) => candidate.id === record.contextId);
    return `${record.title} ${record.text} ${matter?.title ?? ""} ${matter?.participants.join(" ") ?? ""}`.toLocaleLowerCase().includes(query);
  });
  const groups: Map<string, H5Record[]> = new Map();
  for (const record of records) {
    const matter: H5Matter | undefined = state.snapshot?.matters.find((candidate) => candidate.id === record.contextId);
    const keys: string[] = state.group === "date" ? [dateText(record.recordedAt, "day")] : state.group === "person" ? (matter?.participants.length ? matter.participants.map((person) => `${person} · 事项关联`) : ["尚未关联人物"]) : [matter?.title ?? "生活片段"];
    for (const key of keys) groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return groups.size === 0 ? `<div class="empty-state">${icon("search", "")}<h3>没有找到相关记录</h3><p>试试更短的关键词，或添加一条新记录。</p></div>` : [...groups.entries()].map(([label, group]) => `<section class="memory-group"><div class="section-heading"><h2>${escape(label)}</h2><span>${group.length} 条记录</span></div>${group.map((record) => `<article class="memory-card"><span class="tinted-icon ${record.module}">${icon(modules.find((module) => module.id === record.module)?.icon ?? "file-text", "")}</span><div><h3>${escape(record.title)}</h3><p>${escape(record.text)}</p><div class="memory-meta"><span>${dateText(record.recordedAt, "full")} · ${record.provenance === "synthetic" ? "示例记录" : "你的文字记录"}</span>${sourceButton(record, "查看来源")}</div></div></article>`).join("")}</section>`).join("");
}
function memoryView(): string {
  return `${pageHeader("记忆", "从片段，找到联系")}<div class="memory-toolbar"><label class="search-field">${icon("search", "")}<input type="search" data-field="search" data-testid="memory-search" aria-label="搜索人物、事情或记录内容" placeholder="搜索人物、事情或过去的内容" value="${escape(state.search)}"></label><div class="segmented" aria-label="记忆分组">${([{ id: "matter", text: "事情" }, { id: "person", text: "人物" }, { id: "date", text: "日期" }] satisfies { id: MemoryGroup; text: string }[]).map((group) => button(group.text, "memory-group", state.group === group.id ? "active" : "", `data-group="${group.id}" data-testid="group-${group.id}" aria-pressed="${state.group === group.id}"`)).join("")}</div></div><section class="weekly-landscape"><img src="/assets/mountains.png" alt="太阳与层叠山峦的回顾插画"><div><span>回看这些日子</span><h2>生活的线索，<br>藏在每一个片段里。</h2><p>${activeRecords().length} 条记录 · ${state.snapshot?.matters.length ?? 0} 件关联事项</p></div><span class="image-note">场景插画</span></section>${state.group === "person" ? `<p class="quiet-note">人物来自事项的参与人设置；这里只显示该事项关联的记录，不代表识别了每条记录的说话人。</p>` : ""}<div id="memory-results">${memoryResults()}</div>`;
}
function backgroundNodes(matter: H5Matter): string {
  const records: H5Record[] = matterRecords(matter.id);
  return `<div class="background-nodes"><article class="background-node"><span class="tinted-icon blue">${icon("calendar", "")}</span><div><h3>${escape(matter.title)}</h3><p>${dateText(matter.dueAt, "full")} · ${matter.durationMinutes} 分钟</p><span class="subtle-tag">${matter.provenance === "synthetic" ? "示例事项设定" : "你设置的事项"}</span></div></article><article class="background-node"><span class="tinted-icon green">${icon("users", "")}</span><div><h3>${matter.participants.length === 0 ? "参与人待补充" : escape(matter.participants.join("、"))}</h3><p>事项的参与人设置，仍需你自行核对</p></div></article><article class="background-node"><span class="tinted-icon orange">${icon("sparkles", "")}</span><div><h3>从已有记录开始准备</h3><p>${escape(matter.goal)}</p><span class="subtle-tag">准备建议</span></div></article></div><details class="background-sources" data-testid="background-sources" ${state.backgroundExpanded ? "open" : ""}><summary>${records.length} 条可核对的背景记录 ${icon("chevron-right", "small")}</summary>${records.map((record) => `<div class="background-source"><span>${escape(record.title)}<small>${record.provenance === "synthetic" ? "示例记录" : "你的文字记录"} · 修订 ${record.revision}</small></span>${sourceButton(record, "来源")}</div>`).join("")}</details>`;
}
function preparationForm(matter: H5Matter): string {
  return `<section class="prepare-form"><div class="section-heading"><h2>这次，想准备什么？</h2></div><div class="skill-options">${([{ id: "report-outline", title: "汇报提纲", detail: "把进展、决定与下一步讲清楚", icon: "file-text" }, { id: "requirements-checklist", title: "需求清单", detail: "整理要求、约束与待核对的问题", icon: "check-circle-2" }] satisfies { id: SkillId; title: string; detail: string; icon: string }[]).map((skill) => button(`${icon(skill.icon, "")}<span><strong>${skill.title}</strong><small>${skill.detail}</small></span><span class="radio-dot"></span>`, "skill", `skill-option ${state.skillId === skill.id ? "selected" : ""}`, `data-skill="${skill.id}" data-testid="skill-${skill.id}" aria-pressed="${state.skillId === skill.id}"`)).join("")}</div><label class="field-label" for="prepare-requirements">还有什么需要特别注意？</label><textarea id="prepare-requirements" data-field="requirements" data-testid="prepare-requirements" rows="3" maxlength="10000" placeholder="例如：控制在 3 分钟内；先说产品方向，再说待确认的问题。每行一条。">${escape(state.requirements)}</textarea><p class="field-hint">重新准备会新建稿件，原稿保留。当前要求会随新稿保存；清空某条要求即可不再采用它。</p>${button(`${icon("sparkles", "")}开始准备${icon("arrow-right", "")}`, "prepare", "primary-button full-width", `data-testid="prepare" data-busy-label="正在整理背景…" ${matterRecords(matter.id).length === 0 ? 'disabled aria-describedby="no-source-note"' : ""}`)}${matterRecords(matter.id).length === 0 ? '<p id="no-source-note" class="quiet-note">先为这个事项添加一条文字记录，再开始准备。</p>' : ""}</section>`;
}
function artifactSourceIds(artifact: PreparedArtifact, memoryIds: string[]): string[] {
  const context: ContextBundle | undefined = state.snapshot?.contexts.find((item) => item.id === artifact.contextBundleId);
  return [...new Set((context?.memories.filter((memory) => memoryIds.includes(memory.id)).flatMap((memory) => memory.sources.map((source) => source.sourceId))) ?? [])];
}
function artifactView(artifact: PreparedArtifact): string {
  const versions: PreparedArtifact[] = (state.snapshot?.artifacts ?? []).filter((item) => item.id === artifact.id).sort((a, b) => b.version - a.version);
  const historical: boolean = artifact.version !== versions[0]?.version;
  const dirty: boolean = draftDirty(artifact);
  const draft: ArtifactDraft | undefined = currentDraft(artifact);
  const isStale: boolean = stale(artifact);
  const receipts = state.snapshot?.exports.filter((receipt) => receipt.artifactId === artifact.id && receipt.artifactVersion === artifact.version) ?? [];
  return `<section class="artifact-panel" data-testid="artifact-editor"><div class="artifact-topline"><span class="prepared-badge">${icon("check", "small")}已保存准备稿</span><label class="version-picker"><span class="sr-only">查看版本</span><select data-field="version" data-testid="version-select">${versions.map((version) => `<option value="${version.version}" ${version.version === artifact.version ? "selected" : ""}>版本 ${version.version}${version.version === versions[0]?.version ? " · 最新" : " · 历史"}</option>`).join("")}</select></label></div><h2>${escape(artifact.title)}</h2><p class="artifact-meta">${dateText(artifact.savedAt, "full")} 保存 · ${historical ? "历史版本，只读查看" : "正文可直接修改"}</p>${isStale ? `<div class="inline-warning" data-testid="stale-context">${icon("alert-circle", "small")}<p>背景记录已有变化。这个版本会保留，请用最新记录重新准备，再核对后导出。</p></div>` : ""}${artifact.userRequirements.length > 0 ? `<details class="requirements-summary"><summary>这份准备稿的要求</summary><ul>${artifact.userRequirements.map((requirement) => `<li>${escape(requirement)}</li>`).join("")}</ul></details>` : ""}<div class="artifact-sections">${artifact.sections.map((section) => `<section class="artifact-section"><h3>${escape(section.title)}</h3>${section.blocks.map((block) => {
    const sources: H5Record[] = artifactSourceIds(artifact, block.memoryIds).flatMap((id) => activeRecords().filter((record) => record.id === id));
    return `<div class="artifact-block"><label class="sr-only" for="block-${escape(block.id)}">${escape(section.title)}正文</label><textarea id="block-${escape(block.id)}" data-field="artifact-block" data-block-id="${escape(block.id)}" data-testid="artifact-block-${escape(block.id)}" rows="${Math.max(2, Math.min(8, Math.ceil((draft?.blocks[block.id] ?? block.text).length / 36)))}" maxlength="20000" ${historical ? "readonly" : ""}>${escape(draft?.blocks[block.id] ?? block.text)}</textarea><div class="block-evidence"><span>${block.basis === "sourced" ? "依据记录整理" : block.basis === "user_authored" ? "补充内容" : block.basis === "gap" ? "待补充信息" : "准备建议，需核对"}</span>${sources.map((record) => sourceButton(record, record.title)).join("")}</div></div>`;
  }).join("")}</section>`).join("")}</div><div class="artifact-actions"><span id="draft-status" role="status">${dirty ? "有未保存的修改" : historical ? "正在查看历史版本" : "修改后可保存为新版本"}</span><div>${historical ? button("返回最新版本", "latest-version", "secondary-button", 'data-testid="latest-version"') : button(`${icon("check", "small")}保存新版本`, "save-revision", "secondary-button", `data-testid="save-revision" ${dirty ? "" : "disabled"} data-busy-label="正在保存…"`)}${button(`${icon("download", "small")}导出 Word`, "export-review", "primary-button", `data-testid="export-review" ${dirty || isStale || historical ? "disabled" : ""} data-busy-label="正在核对版本…"`)}</div></div>${receipts.length > 0 ? `<div class="export-receipts">${receipts.map((receipt) => `<div class="receipt">${icon("check-circle-2", "small")}<span>版本 ${receipt.artifactVersion} 已生成 Word<small>${dateText(receipt.verifiedAt, "full")} · ${receipt.byteLength.toLocaleString()} 字节</small></span>${receiptDownload(receipt, "text-button", "download-file", "下载文件")}</div>`).join("")}</div>` : ""}</section>`;
}
function assistantStageHeader(title: string, matter: H5Matter): string {
  return `<header class="app-detail-header">${button(`${icon("chevron-left", "")}<span>返回</span>`, "assistant-stage-back", "text-button", 'data-testid="assistant-stage-back" aria-label="返回上一页"')}<div><h1>${title}</h1><p>${escape(matter.title)}</p></div></header>`;
}
function legacyAssistantView(): string {
  const matter: H5Matter | undefined = currentMatter();
  const artifact: PreparedArtifact | undefined = currentArtifact();
  if (matter === undefined) return `${pageHeader("助手", "让下一步，更有准备")}<div class="empty-state"><h2>还没有可准备的事项</h2><p>先添加一件事，再留下一条相关记录。</p>${button("新建准备事项", "new-matter", "secondary-button", 'data-testid="new-matter"')}</div>`;
  if (state.assistantStage === "prepare") return `<div data-assistant-stage="prepare">${assistantStageHeader("准备要求", matter)}${preparationForm(matter)}</div>`;
  if (state.assistantStage === "artifact" && artifact !== undefined) return `<div data-assistant-stage="artifact">${assistantStageHeader("我的准备稿", matter)}${artifactView(artifact)}</div>`;
  const history: PreparedArtifact[] = latestArtifacts().filter((item) => item.contextId === state.matterId);
  const recordCount: number = matterRecords(matter.id).length;
  return `${pageHeader("助手", "让下一步，更有准备")}<div class="assistant-layout" data-assistant-stage="overview"><div class="assistant-context"><h2 class="assistant-headline">${escape(matter.title)}，<br>${recordCount > 0 ? "已经有了准备的起点。" : "可以从一条记录开始。"}</h2><p class="assistant-lead">先看一看相关背景，再决定这次需要什么。</p>${backgroundNodes(matter)}<section class="assistant-invite"><h3>${recordCount > 0 ? "我可以帮你整理一版准备稿。" : "为这件事，留下第一条记录。"}</h3><p>${recordCount > 0 ? `从 ${recordCount} 条记录出发，准备汇报提纲或需求清单。` : "记下已知信息与待确认的问题，准备时就有据可查。"}</p>${recordCount > 0 ? button(`和我一起准备${icon("arrow-right", "")}`, "assistant-start", "primary-button full-width", 'data-testid="assistant-start"') : button(`${icon("plus", "small")}添加文字记录`, "add", "primary-button full-width", 'data-testid="assistant-add-record"')}</section><div class="assistant-context-controls"><label class="matter-picker"><span>正在准备的事情</span><select data-field="matter" data-testid="matter-select">${(state.snapshot?.matters ?? []).map((item) => `<option value="${escape(item.id)}" ${item.id === matter.id ? "selected" : ""}>${escape(item.title)}</option>`).join("")}</select></label>${button(`${icon("plus", "small")}新建准备事项`, "new-matter", "text-button new-matter-button", 'data-testid="new-matter"')}</div></div>${history.length > 0 ? `<section class="saved-artifacts"><div class="section-heading"><h2>保存的准备稿</h2><span>${history.length} 份</span></div>${history.map((item) => button(`${icon("file-text", "")}<span><strong>${escape(item.title)}</strong><small>${dateText(item.savedAt, "full")} · 版本 ${item.version}${draftDirty(item) ? " · 有未保存修改" : ""}</small></span>${icon("chevron-right", "small")}`, "select-artifact", `saved-artifact ${item.id === state.artifactId ? "active" : ""}`, `data-id="${escape(item.id)}" data-testid="saved-${escape(item.id)}"`)).join("")}</section>` : ""}</div>`;
}

function assistantView(): string {
  if (state.snapshot === null) return "";
  // The original editable artifact flow remains available after opening an existing result.
  if (state.assistantStage !== "overview") return legacyAssistantView();
  return assistantV4View(state.snapshot, state.assistantUi);
}
function profileView(): string {
  const snapshotValue: H5Snapshot | null = state.snapshot;
  if (snapshotValue === null) return "";
  return `${pageHeader("我的", "属于你的记录空间")}<div class="profile-layout"><section class="profile-card"><span class="profile-avatar">${icon("user", "")}</span><h2>${snapshotValue.mode === "hosted-private" ? "我的记录空间" : "我的本地空间"}</h2><p>慢慢记录，随时回来。</p><div class="profile-counts"><div><strong>${activeRecords().length}</strong><span>条记录</span></div><div><strong>${latestArtifacts().length}</strong><span>份准备稿</span></div><div><strong>${snapshotValue.exports.length}</strong><span>次导出</span></div></div></section><section class="mode-details"><h2>这个体验空间如何工作</h2><p>你添加的文字记录、保存的版本和导出回执保存在${snapshotValue.mode === "hosted-private" ? "此站点的云端空间" : "本地服务"}中。未保存的编辑暂存在当前浏览器会话，刷新前会提醒你。</p><ul><li>标注“示例记录”的内容用于体验流程，场景插画不是现场照片。</li><li>示例事项的时间与参与人是预设背景，请自行核对。</li><li>准备稿由规则整理已有文字，可编辑并查看来源。当前未接入在线模型、录音转写或外部日历。</li><li>导出仅生成供你下载的 Word 文件；不会发送给其他人。</li></ul><div class="local-status"><span></span>${snapshotValue.mode === "hosted-private" ? "个人云端体验" : "本地体验模式"}${button("重新读取", "refresh", "text-button", 'data-testid="refresh-state"')}</div></section></div><section class="receipt-section"><div class="section-heading"><h2>导出记录</h2><span>${snapshotValue.exports.length} 次</span></div>${snapshotValue.exports.length === 0 ? `<div class="empty-state compact">${icon("download", "")}<h3>还没有导出记录</h3><p>在助手中准备并核对一份稿件后，即可确认导出。</p></div>` : snapshotValue.exports.map((receipt) => `<article class="receipt">${icon("check-circle-2", "")}<span><strong>${escape(receipt.filename)}</strong><small>版本 ${receipt.artifactVersion} · ${dateText(receipt.verifiedAt, "full")} · ${receipt.byteLength.toLocaleString()} 字节</small></span>${receiptDownload(receipt, "secondary-button", `receipt-download-${receipt.operationId}`, "下载")}</article>`).join("")}</section>`;
}

function renderMessages(): void {
  const host: HTMLElement | null = document.getElementById("message-host");
  if (host !== null) host.innerHTML = `${state.error ? `<div class="message error" role="alert" data-testid="error-message">${icon("alert-circle", "")}<div><strong>这一步没有完成</strong><p>${escape(state.error)}</p></div>${button(icon("x", "small"), "dismiss-error", "icon-button", 'aria-label="关闭错误提示"')}</div>` : ""}${state.notice ? `<div class="message success" role="status">${icon("check-circle-2", "small")}<span>${escape(state.notice)}</span></div>` : ""}`;
  const modalError: HTMLElement | null = document.getElementById("modal-error");
  if (modalError !== null) modalError.textContent = state.error;
}
function render(): void {
  const view: string = state.snapshot === null ? `<section class="initial-state"><h1>记录暂时没有读进来</h1><p>请检查服务状态，再重新读取。</p>${button("重新读取", "refresh", "primary-button", 'data-testid="retry-load"')}</section>` : state.tab === "today" ? todayView() : state.tab === "memory" ? memoryView() : state.tab === "assistant" ? assistantView() : profileView();
  element("app").innerHTML = `${navigation()}<main id="main-content" class="main-content" tabindex="-1"><div id="message-host"></div>${view}<footer class="app-footer"><span>Mixture X</span><span>记录留在这里，下一步由你决定。</span></footer></main>`;
  document.title = `Mixture X · ${tabs.find((tab) => tab.id === state.tab)?.label ?? "今天"}`;
  renderMessages();
  updateBusy();
}
function updateBusy(): void {
  document.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((target) => {
    if (state.busy !== null && !["close-modal", "dismiss-error", "tab"].includes(target.dataset.action ?? "")) {
      if (!target.disabled) target.dataset.busyDisabled = "true";
      target.disabled = true;
    } else if (target.dataset.busyDisabled === "true") {
      target.disabled = false;
      delete target.dataset.busyDisabled;
    }
    target.setAttribute("aria-busy", String(state.busy === target.dataset.action));
  });
  document.querySelectorAll<HTMLButtonElement>('button[type="submit"]').forEach((target) => { target.disabled = state.busy !== null; });
}
function openModal(modal: NonNullable<Modal>): void {
  if (state.modal === null) {
    modalTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modalScrollY = window.scrollY;
  }
  state.modal = modal;
  state.error = "";
  renderModal();
}
function closeModal(): void {
  if (state.busy !== null) { announce("请等待当前保存或导出完成。"); return; }
  if (sourceDirty() && !window.confirm("来源有未保存的修改。关闭会放弃这些修改，确定关闭吗？")) return;
  state.modal = null;
  element("overlay-root").innerHTML = "";
  element("app").inert = false;
  document.body.classList.remove("modal-open");
  if (modalTrigger?.isConnected) modalTrigger.focus({ preventScroll: true }); else element("main-content").focus({ preventScroll: true });
  window.scrollTo({ top: modalScrollY, behavior: "instant" });
}
function renderModal(): void {
  const modal: Modal = state.modal;
  if (modal === null) { element("overlay-root").innerHTML = ""; element("app").inert = false; document.body.classList.remove("modal-open"); return; }
  let title: string = "";
  let content: string = "";
  if (modal.kind === "add") {
    title = "留下一个片段";
    content = `<p class="modal-lead">把值得留住的话，先放在这里。</p><form data-form="add" id="record-form"><label class="field-label" for="record-title">记录标题</label><input id="record-title" data-field="record-title" data-testid="record-title" name="title" required maxlength="200" placeholder="例如：今天产品讨论的决定" value="${escape(state.recordDraft.title)}"><label class="field-label" for="record-text">记录内容</label><textarea id="record-text" data-field="record-text" data-testid="record-text" name="text" required maxlength="20000" rows="6" placeholder="记下原话、想法或待确认的问题…">${escape(state.recordDraft.text)}</textarea><div class="form-row"><label class="field-label">分类<select name="module" data-field="record-module" data-testid="record-module">${modules.map((module) => `<option value="${module.id}" ${module.id === state.recordDraft.module ? "selected" : ""}>${module.label}</option>`).join("")}</select></label><label class="field-label">关联事项<select name="contextId" data-field="record-matter" data-testid="record-matter">${(state.snapshot?.matters ?? []).map((matter) => `<option value="${escape(matter.id)}" ${matter.id === state.recordDraft.contextId ? "selected" : ""}>${escape(matter.title)}</option>`).join("")}</select></label></div><p class="field-hint">保存后标注为“你的文字记录”，不会变成示例内容。</p><div id="modal-error" class="modal-error" role="alert"></div><button class="primary-button full-width" type="submit" data-testid="save-record">${icon("plus", "small")}保存记录</button></form>`;
  } else if (modal.kind === "new-matter") {
    title = "新建准备事项";
    content = `<p class="modal-lead">先说明这件事，再添加相关记录。助手会从这些背景开始准备。</p><form data-form="new-matter"><label class="field-label" for="matter-title">事项名称</label><input id="matter-title" name="title" data-field="new-matter-title" data-testid="matter-title" required maxlength="200" placeholder="例如：下周的产品评审" value="${escape(state.matterDraft.title)}"><label class="field-label" for="matter-goal">希望达成什么</label><textarea id="matter-goal" name="goal" data-field="new-matter-goal" data-testid="matter-goal" required maxlength="10000" rows="3" placeholder="例如：讲清产品方向，列出需要团队决定的问题">${escape(state.matterDraft.goal)}</textarea><div class="form-row equal"><label class="field-label">计划时间<input name="dueAt" data-field="new-matter-due" data-testid="matter-due" type="datetime-local" value="${escape(state.matterDraft.dueAt)}" required></label><label class="field-label">预计时长（分钟）<input name="duration" data-field="new-matter-duration" data-testid="matter-duration" type="number" min="1" max="1440" value="${escape(state.matterDraft.duration)}" required></label></div><label class="field-label" for="matter-participants">参与人（选填，用逗号分隔）</label><input id="matter-participants" name="participants" data-field="new-matter-participants" data-testid="matter-participants" maxlength="1000" placeholder="例如：Alex、产品团队" value="${escape(state.matterDraft.participants)}"><p class="field-hint">尚未保存的内容会暂存在此浏览器，关闭窗口后仍可接着填写；刷新前会提醒你。</p><div id="modal-error" class="modal-error" role="alert"></div><button type="submit" class="primary-button full-width modal-form-actions" data-testid="save-matter">保存事项</button></form>`;
  } else if (modal.kind === "source") {
    const record: H5Record | undefined = activeRecords().find((candidate) => candidate.id === modal.recordId);
    title = modal.editing ? "修订来源记录" : "回到原始记录";
    content = record === undefined ? "<p>这条来源已不可用，请重新读取最新记录。</p>" : `<div class="source-labels"><span class="subtle-tag">${record.provenance === "synthetic" ? "示例记录" : "你的文字记录"}</span><span>修订 ${record.revision}</span><span>${dateText(record.recordedAt, "full")}</span></div>${modal.editing ? `<form data-form="source"><label class="field-label" for="source-title">标题</label><input id="source-title" data-field="source-title" name="title" required maxlength="200" value="${escape(modal.title)}"><label class="field-label" for="source-text">原始文字</label><textarea id="source-text" data-field="source-text" data-testid="source-text" name="text" required maxlength="20000" rows="9">${escape(modal.text)}</textarea><p class="field-hint">保存会新增来源修订。已有准备稿保留，导出前需要用最新记录重新准备。</p><div id="modal-error" class="modal-error" role="alert"></div><button class="primary-button full-width" type="submit" data-testid="source-save">保存来源修订</button></form>` : `<h3 class="source-title">${escape(record.title)}</h3><blockquote class="original-text">${escape(record.text)}</blockquote><p class="quiet-note">${record.provenance === "synthetic" ? "此文字是体验用的示例来源；配图为场景插画，不是记录现场。" : "这段文字由你添加，保留原文用于核对准备稿。"}</p><div id="modal-error" class="modal-error" role="alert"></div>${button(`${icon("edit-3", "small")}修订这条记录`, "source-edit", "secondary-button", 'data-testid="source-edit"')}`}`;
  } else if (modal.kind === "calendar") {
    title = "近期的事情";
    content = `<p class="modal-lead">这里包含示例和你自己设置的事项，尚未连接外部日历。</p>${button(`${icon("plus", "small")}新建准备事项`, "new-matter", "secondary-button", 'data-testid="calendar-new-matter"')}${(state.snapshot?.matters ?? []).map((matter) => `<article class="calendar-matter"><span class="tinted-icon blue">${icon("calendar", "")}</span><div><h3>${escape(matter.title)}</h3><p>${dateText(matter.dueAt, "full")} · ${matter.durationMinutes} 分钟</p><span>${matter.provenance === "synthetic" ? "示例事项" : "你设置的事项"} · ${escape(matter.participants.join("、"))}</span>${button(`为这件事准备${icon("arrow-right", "small")}`, "matter-open", "text-button", `data-id="${escape(matter.id)}"`)}</div></article>`).join("")}`;
  } else {
    title = "核对后，再导出";
    const plan = modal.response.plan;
    const artifact: PreparedArtifact | undefined = state.snapshot?.artifacts.find((candidate) => candidate.id === plan.artifactId && candidate.version === plan.artifactVersion);
    content = `<div class="export-file-icon">${icon("file-text", "")}</div><h3 class="export-title">${escape(artifact?.title ?? "准备稿")}</h3><dl class="export-details"><div><dt>导出版本</dt><dd>版本 ${plan.artifactVersion}</dd></div><div><dt>文件格式</dt><dd>Word 文档（.docx）</dd></div><div><dt>文件名</dt><dd>${escape(plan.filename)}</dd></div><div><dt>去向</dt><dd>生成文件，仅供你下载</dd></div></dl><p class="confirmation-note">确认后会生成这一个版本的文件，不会发送给其他人。之后的文字修改不会改变这份文件。</p><div id="modal-error" class="modal-error" role="alert"></div>${button(`${icon("download", "small")}确认生成 Word 文件`, "export-confirm", "primary-button full-width", 'data-testid="export-confirm"')}<p class="quiet-note centered">关闭此窗口即可取消，不会生成文件。</p>`;
  }
  element("overlay-root").innerHTML = `<div class="modal-backdrop" data-action="backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" data-testid="${modal.kind === "source" ? "source-dialog" : `${modal.kind}-dialog`}" tabindex="-1"><header class="modal-header"><h2 id="modal-title">${title}</h2>${button(icon("x", ""), "close-modal", "icon-button", 'aria-label="关闭窗口" data-testid="modal-close"')}</header>${content}</section></div>`;
  element("app").inert = true;
  document.body.classList.add("modal-open");
  renderMessages();
  updateBusy();
  const focusTarget: HTMLElement | null = element("overlay-root").querySelector<HTMLElement>("input, textarea, .modal");
  focusTarget?.focus();
}

async function perform(name: string, operation: () => Promise<void>): Promise<void> {
  if (state.busy !== null) return;
  state.busy = name;
  state.error = "";
  state.notice = "";
  updateBusy();
  renderMessages();
  announce(name === "refresh" ? "正在读取记录。" : name === "prepare" ? "正在整理记录，准备可编辑的稿件。" : name === "export-review" ? "正在核对导出版本。" : name === "export-confirm" ? "正在生成 Word 文件。" : "正在保存，请稍候。");
  try { await operation(); }
  catch (error) {
    state.error = error instanceof ApiError ? `${error.code}：${error.message}` : error instanceof Error ? error.message : "发生非预期错误；请保留当前文字并检查浏览器控制台。";
    announce(state.error);
    renderMessages();
  } finally { state.busy = null; updateBusy(); }
}
async function refreshState(): Promise<void> {
  await perform("refresh", async () => { setSnapshot(snapshot(await request("/api/state", "GET", null))); render(); state.notice = "已读取最新记录，未保存的文字仍保留。"; renderMessages(); announce(state.notice); });
}
function switchTab(tab: Tab): void {
  if (state.tab === tab) return;
  tabScroll[state.tab] = window.scrollY;
  state.tab = tab;
  state.error = "";
  state.notice = "";
  render();
  window.scrollTo({ top: tabScroll[tab], behavior: "instant" });
}
function showAssistantStage(stage: AssistantStage): void {
  assistantHistory.push({ stage: state.assistantStage, scrollY: state.tab === "assistant" ? window.scrollY : tabScroll.assistant });
  state.assistantStage = stage;
  tabScroll.assistant = 0;
  if (state.tab !== "assistant") { renderMessages(); return; }
  render();
  window.scrollTo({ top: 0, behavior: "instant" });
}
function backAssistantStage(): void {
  const previous: AssistantLocation | undefined = assistantHistory.pop();
  state.assistantStage = previous?.stage ?? "overview";
  tabScroll.assistant = previous?.scrollY ?? 0;
  state.error = "";
  state.notice = "";
  render();
  window.scrollTo({ top: tabScroll.assistant, behavior: "instant" });
}
function openAssistantMatter(matterId: string, artifactId: string | null): void {
  tabScroll[state.tab] = window.scrollY;
  switchMatter(matterId);
  assistantHistory.length = 0;
  state.assistantStage = "overview";
  if (artifactId !== null) {
    state.artifactId = artifactId;
    state.artifactVersion = null;
    if (currentArtifact() !== undefined) {
      assistantHistory.push({ stage: "overview", scrollY: 0 });
      state.assistantStage = "artifact";
    }
  }
  state.tab = "assistant";
  tabScroll.assistant = 0;
  state.error = "";
  state.notice = "";
  persistDrafts();
  render();
  window.scrollTo({ top: 0, behavior: "instant" });
}
function updateDraftState(): void {
  const artifact: PreparedArtifact | undefined = currentArtifact();
  if (artifact === undefined) return;
  const dirty: boolean = draftDirty(artifact);
  const status: HTMLElement | null = document.getElementById("draft-status");
  if (status !== null) status.textContent = dirty ? "有未保存的修改 · 已在此浏览器暂存" : "修改后可保存为新版本";
  const save: HTMLButtonElement | null = document.querySelector('[data-testid="save-revision"]');
  if (save !== null) save.disabled = !dirty || state.busy !== null;
  const exportButton: HTMLButtonElement | null = document.querySelector('[data-testid="export-review"]');
  if (exportButton !== null) exportButton.disabled = dirty || stale(artifact) || state.busy !== null;
}
async function prepareArtifact(): Promise<void> {
  const matter: H5Matter | undefined = currentMatter();
  if (matter === undefined) return;
  await perform("prepare", async () => {
    const requirements: string[] = state.requirements.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
    const payload = { matterId: matter.id, skillId: state.skillId, requirements };
    const result = preparation(await request("/api/prepare", "POST", JSON.stringify({ ...payload, requestId: requestId(JSON.stringify({ action: "prepare", revision: state.snapshot?.revision, ...payload })) })));
    setSnapshot(result.snapshot);
    state.artifactId = result.artifactId;
    state.artifactVersion = null;
    persistDrafts();
    state.notice = "准备稿已保存。可以直接修改正文，核对来源后再导出。";
    showAssistantStage("artifact");
    announce(state.notice);
  });
}
async function saveRevision(): Promise<void> {
  const artifact: PreparedArtifact | undefined = currentArtifact();
  if (artifact === undefined || !draftDirty(artifact)) return;
  const draft: ArtifactDraft | undefined = currentDraft(artifact);
  if (draft === undefined) return;
  await perform("save-revision", async () => {
    const sections = artifact.sections.map((section) => ({ id: section.id, blocks: section.blocks.map((block) => ({ id: block.id, text: draft.blocks[block.id] ?? block.text })) }));
    if (sections.some((section) => section.blocks.some((block) => block.text.trim().length === 0))) throw new Error("正文中有空白段落。请补充内容，或写明“待补充”后再保存版本。");
    const payload = { expectedVersion: artifact.version, sections };
    const result = preparation(await request(`/api/artifacts/${encodeURIComponent(artifact.id)}/revisions`, "POST", JSON.stringify({ ...payload, requestId: requestId(JSON.stringify({ action: "revision", id: artifact.id, ...payload })) })));
    setSnapshot(result.snapshot);
    state.artifactVersion = null;
    state.drafts = state.drafts.filter((item) => item.artifactId !== artifact.id || item.version !== artifact.version);
    persistDrafts();
    state.notice = "新版本已保存，之前的版本仍可查看。";
    render();
    announce(state.notice);
  });
}
async function suggestionDecision(id: string, decision: "snooze" | "dismiss" | "restore", snoozeMinutes?: 60 | 180 | 1440): Promise<void> {
  await perform(decision, async () => {
    const payload = { requestId: requestId(`${decision}:${id}:${snoozeMinutes ?? "default"}:${state.snapshot?.revision}`), decision, ...(snoozeMinutes === undefined ? {} : { snoozeMinutes }) };
    setSnapshot(snapshot(await request(`/api/suggestions/${encodeURIComponent(id)}/decision`, "POST", JSON.stringify(payload))));
    if (dismissUndoTimer !== null) { window.clearTimeout(dismissUndoTimer); dismissUndoTimer = null; }
    state.assistantUi.dismissedSuggestionId = decision === "dismiss" ? id : null;
    if (decision === "dismiss") {
      dismissUndoTimer = window.setTimeout(() => {
        if (state.assistantUi.dismissedSuggestionId !== id) return;
        state.assistantUi.dismissedSuggestionId = null;
        render();
      }, 8_000);
    }
    state.notice = decision === "snooze" ? `已延后提醒${snoozeMinutes === 1440 ? "到明天" : snoozeMinutes === 180 ? "到今天稍后" : " 1 小时"}，记录仍保留。` : decision === "dismiss" ? "已忽略这次提醒，你仍可在助手中准备。" : "准备提醒已恢复。";
    render();
    announce(state.notice);
  });
}
function assistantContextId(value: string | undefined): string | null {
  if (value !== undefined && value.length > 0) return value;
  return currentMatter()?.id ?? null;
}
function applyAssistantOperation(value: ReturnType<typeof assistantOperation>): void {
  setSnapshot(value.snapshot);
  if (value.sessionId !== null) state.assistantUi.sessionId = value.sessionId;
  if (value.taskId !== null) state.assistantUi.taskId = value.taskId;
}
function openAssistantTask(taskId: string, screen: "task" | "plan-edit" | "details" | "evidence" | "result" | "preview" | "failure" = "task"): void {
  const task = state.snapshot?.assistant.tasks.find((item) => item.id === taskId);
  if (task === undefined) { state.error = "该任务已不在当前列表中，请重新读取。"; renderMessages(); return; }
  state.assistantStage = "overview";
  state.assistantUi.taskId = task.id;
  state.assistantUi.sessionId = task.sessionId;
  state.assistantUi.selectedOptionId = null;
  state.assistantUi.confirmationRead = false;
  state.assistantUi.screen = screen;
  state.assistantUi.modeSheetOpen = false;
  state.assistantUi.snoozeSuggestionId = null;
  state.assistantUi.composerExpanded = false;
  state.assistantUi.addContentSheetOpen = false;
  state.assistantUi.planStepSheetOpen = false;
  state.assistantUi.messageDetailId = null;
  render();
  window.scrollTo({ top: 0, behavior: "instant" });
}
async function sendAssistantMessage(content: string, forcedMode: "task" | null, contextId: string | null): Promise<void> {
  const text: string = content.trim();
  if (text.length === 0) { state.error = "先告诉助手你希望完成什么。"; renderMessages(); return; }
  await perform("assistant-send", async () => {
    const mode = forcedMode ?? state.assistantUi.selectedMode;
    const result = assistantOperation(await request("/api/assistant/sessions", "POST", JSON.stringify({ requestId: requestId(JSON.stringify({ action: "assistant-session", mode, text, contextId })), mode, content: text, contextId })));
    applyAssistantOperation(result);
    state.assistantUi.composer = "";
    state.assistantUi.composerExpanded = false;
    state.assistantUi.addContentSheetOpen = false;
    state.assistantUi.selectedOptionId = null;
    state.assistantUi.confirmationRead = false;
    state.assistantUi.messageDetailId = null;
    state.assistantUi.screen = result.taskId === null ? "chat" : "task";
    state.notice = result.taskId === null ? "已保存为一段本地整理对话。" : "已创建任务草稿。请先核对计划，再开始执行。";
    render();
    announce(state.notice);
  });
}
async function upgradeAssistantSession(sessionId: string, contextId: string | null): Promise<void> {
  await perform("assistant-upgrade", async () => {
    const result = assistantOperation(await request(`/api/assistant/sessions/${encodeURIComponent(sessionId)}/upgrade`, "POST", JSON.stringify({ requestId: requestId(`assistant-upgrade:${sessionId}:${contextId ?? "none"}`), contextId })));
    applyAssistantOperation(result);
    if (result.taskId === null) throw new Error("任务草稿未返回，请重新打开对话后再试。");
    state.assistantUi.screen = "task";
    state.notice = "已保留对话和依据，任务草稿已经创建。";
    render();
    announce(state.notice);
  });
}
async function startAssistantTask(taskId: string): Promise<void> {
  await perform("assistant-start", async () => {
    const result = assistantOperation(await request(`/api/assistant/tasks/${encodeURIComponent(taskId)}/start`, "POST", JSON.stringify({ requestId: requestId(`assistant-start:${taskId}`) })));
    applyAssistantOperation(result);
    state.assistantUi.screen = "task";
    state.notice = "任务已开始。本地服务运行期间会持续推进，遇到关键选择会暂停等待你。";
    render();
    announce(state.notice);
  });
}
async function updateAssistantDeliveryMode(taskId: string, deliveryMode: "docx" | "content"): Promise<void> {
  await perform("assistant-plan", async () => {
    const taskValue = state.snapshot?.assistant.tasks.find((item) => item.id === taskId);
    const planVersion = taskValue?.planVersion ?? 1;
    const result = assistantOperation(await request(`/api/assistant/tasks/${encodeURIComponent(taskId)}/plan`, "PATCH", JSON.stringify({ requestId: requestId(`assistant-plan:${taskId}:${planVersion}:${deliveryMode}`), deliveryMode })));
    applyAssistantOperation(result);
    state.assistantUi.planFormatSheetOpen = false;
    state.notice = deliveryMode === "docx" ? "交付格式已更新为 Word；生成文件前仍会请你确认。" : "交付格式已更新为可编辑内容；不会创建或导出文件。";
    render();
    announce(state.notice);
  });
}
async function answerAssistantTask(taskId: string, inputRequestId: string, optionId: string): Promise<void> {
  await perform("assistant-answer", async () => {
    const result = assistantOperation(await request(`/api/assistant/tasks/${encodeURIComponent(taskId)}/answer`, "POST", JSON.stringify({ requestId: requestId(`assistant-answer:${taskId}:${inputRequestId}:${optionId}`), inputRequestId, optionId })));
    applyAssistantOperation(result);
    state.assistantUi.selectedOptionId = null;
    state.assistantUi.screen = "task";
    state.notice = "已纳入你的选择，正在准备下一步。";
    render();
    announce(state.notice);
  });
}
async function confirmAssistantTask(taskId: string, confirmationId: string, decision: "approved" | "rejected"): Promise<void> {
  await perform("assistant-confirm", async () => {
    const result = assistantOperation(await request(`/api/assistant/tasks/${encodeURIComponent(taskId)}/confirm`, "POST", JSON.stringify({ requestId: requestId(`assistant-confirm:${taskId}:${confirmationId}:${decision}`), confirmationId, decision })));
    applyAssistantOperation(result);
    state.assistantUi.screen = decision === "approved" ? "result" : "task";
    state.assistantUi.confirmationRead = false;
    state.notice = decision === "approved" ? "文件已生成并完成核对。" : "已取消本次文件生成，任务保留在暂停状态。";
    render();
    announce(state.notice);
  });
}
async function actOnAssistantTask(taskId: string, taskAction: "pause" | "resume" | "cancel" | "retry"): Promise<void> {
  await perform("assistant-task-action", async () => {
    const result = assistantOperation(await request(`/api/assistant/tasks/${encodeURIComponent(taskId)}/action`, "POST", JSON.stringify({ requestId: requestId(`assistant-task-action:${taskId}:${taskAction}`), action: taskAction })));
    applyAssistantOperation(result);
    const task = result.snapshot.assistant.tasks.find((item) => item.id === taskId);
    state.assistantUi.screen = taskAction === "retry" ? "task" : state.assistantUi.screen;
    state.notice = taskAction === "pause" ? "任务已在当前检查点暂停。" : taskAction === "resume" ? task?.status === "waiting_input" ? "任务已恢复，仍等待你补充信息。" : task?.status === "waiting_confirmation" ? "任务已恢复，仍等待你确认操作。" : "任务已恢复处理。" : taskAction === "cancel" ? "任务已取消，已完成结果仍然保留。" : "正在从可恢复检查点继续。";
    render();
    announce(state.notice);
  });
}
async function toggleAssistantEvidence(evidenceId: string, included: boolean): Promise<void> {
  await perform("assistant-evidence", async () => {
    const result = assistantOperation(await request(`/api/assistant/evidence/${encodeURIComponent(evidenceId)}`, "PATCH", JSON.stringify({ requestId: requestId(`assistant-evidence:${evidenceId}:${included}`), included })));
    applyAssistantOperation(result);
    state.notice = included ? "这条依据已重新纳入。" : "这条依据已排除；尚未完成的任务会重新核对。";
    render();
    announce(state.notice);
  });
}
async function addAssistantRequirement(taskId: string, content: string): Promise<void> {
  const requirement = content.trim();
  if (requirement.length === 0) { state.error = "先补充要纳入任务的要求。"; renderMessages(); return; }
  const returnToPlanEdit: boolean = state.assistantUi.screen === "plan-edit";
  await perform("assistant-requirement", async () => {
    const result = assistantOperation(await request(`/api/assistant/tasks/${encodeURIComponent(taskId)}/requirements`, "POST", JSON.stringify({ requestId: requestId(`assistant-requirement:${taskId}:${requirement}`), content: requirement })));
    applyAssistantOperation(result);
    const task = result.snapshot.assistant.tasks.find((item) => item.id === taskId);
    state.assistantUi.composer = "";
    state.assistantUi.composerExpanded = false;
    state.assistantUi.addContentSheetOpen = false;
    state.assistantUi.planStepSheetOpen = false;
    state.assistantUi.planStepTitleDraft = "";
    state.assistantUi.planStepDetailDraft = "";
    state.assistantUi.screen = returnToPlanEdit ? "plan-edit" : "task";
    state.notice = returnToPlanEdit
      ? "补充步骤已纳入本地内容准备要求；不会因此触发外部操作。"
      : task?.status === "paused"
      ? "已纳入新要求；任务已停在安全检查点，请继续处理后生成新结果。"
      : "已纳入新要求，后续步骤会按这个要求处理。";
    render();
    announce(state.notice);
  });
}
async function submitAssistantPlanStep(): Promise<void> {
  const taskId: string | null = state.assistantUi.taskId;
  const title: string = state.assistantUi.planStepTitleDraft.trim();
  const detail: string = state.assistantUi.planStepDetailDraft.trim();
  if (taskId === null) return;
  if (title.length === 0 || detail.length === 0) {
    state.error = "步骤名称和执行说明都需要填写。";
    renderMessages();
    return;
  }
  await addAssistantRequirement(taskId, `补充执行步骤：${title}\n${detail}`);
}
function openAssistantArtifact(artifactId: string): void {
  const artifact = state.snapshot?.artifacts.filter((item) => item.id === artifactId).sort((left, right) => right.version - left.version)[0];
  if (artifact === undefined) { state.error = "当前还没有可打开的任务成果。"; renderMessages(); return; }
  state.artifactId = artifact.id;
  state.artifactVersion = artifact.version;
  state.assistantStage = "artifact";
  assistantHistory.push({ stage: "overview", scrollY: 0 });
  render();
  window.scrollTo({ top: 0, behavior: "instant" });
}
async function reviewExport(): Promise<void> {
  const artifact: PreparedArtifact | undefined = currentArtifact();
  if (artifact === undefined || draftDirty(artifact)) return;
  const trigger: HTMLButtonElement | null = document.querySelector('[data-testid="export-review"]');
  await perform("export-review", async () => {
    const response: ExportPlanResponse = exportPlan(await request("/api/export-plans", "POST", JSON.stringify({ artifactId: artifact.id, artifactVersion: artifact.version })));
    openModal({ kind: "export", response });
    modalTrigger = trigger;
  });
}
async function confirmExport(): Promise<void> {
  if (state.modal?.kind !== "export") return;
  const response: ExportPlanResponse = state.modal.response;
  await perform("export-confirm", async () => {
    const result = exportResult(await request("/api/exports", "POST", JSON.stringify({ requestId: requestId(`export:${response.planHash}`), plan: response.plan, planHash: response.planHash, decision: "approved" })));
    setSnapshot(result.snapshot);
    state.modal = null;
    renderModal();
    state.notice = `版本 ${result.receipt.artifactVersion} 的 Word 文件已生成，可在准备稿下方下载。`;
    render();
    announce(state.notice);
    document.querySelector<HTMLElement>('[data-testid="download-file"]')?.focus();
  });
}
async function submitRecord(form: HTMLFormElement): Promise<void> {
  const values: FormData = new FormData(form);
  const title: string = String(values.get("title") ?? "").trim();
  const text: string = String(values.get("text") ?? "").trim();
  await perform("save-record", async () => {
    if (title.length === 0 || text.length === 0) throw new Error("标题和记录内容不能只有空格，请补充具体文字。");
    const sourceModal = state.modal;
    if (form.dataset.form === "source" && sourceModal?.kind === "source") {
      const payload = { expectedRevision: sourceModal.revision, title, text };
      setSnapshot(snapshot(await request(`/api/records/${encodeURIComponent(sourceModal.recordId)}`, "PATCH", JSON.stringify({ ...payload, requestId: requestId(JSON.stringify({ action: "source", id: sourceModal.recordId, ...payload })) }))));
      state.notice = "来源修订已保存；旧准备稿仍保留，请用最新背景重新准备。";
    } else {
      const module: string = String(values.get("module") ?? "");
      if (!isModule(module)) throw new Error("请从现有分类中选择记录类型。");
      const payload = { title, text, module, contextId: String(values.get("contextId") ?? "") };
      setSnapshot(snapshot(await request("/api/records", "POST", JSON.stringify({ ...payload, requestId: requestId(JSON.stringify({ action: "add", ...payload })) }))));
      state.recordDraft = { title: "", text: "", module: "work", contextId: state.matterId };
      state.notice = "文字记录已保存，可以在今天与记忆里查看。";
    }
    persistDrafts();
    state.modal = null;
    renderModal();
    render();
    announce(state.notice);
    element("main-content").focus({ preventScroll: true });
    window.scrollTo({ top: modalScrollY, behavior: "instant" });
  });
}
async function submitMatter(form: HTMLFormElement): Promise<void> {
  const values: FormData = new FormData(form);
  await perform("save-matter", async () => {
    const title: string = String(values.get("title") ?? "").trim();
    const goal: string = String(values.get("goal") ?? "").trim();
    const rawDate: string = String(values.get("dueAt") ?? "");
    const durationMinutes: number = Number(values.get("duration"));
    if (title.length === 0 || goal.length === 0 || !Number.isFinite(Date.parse(rawDate))) throw new Error("请填写事项名称、准备目标与有效的计划时间。");
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) throw new Error("预计时长需要填写 1 至 1440 之间的整数分钟。");
    const participants: string[] = String(values.get("participants") ?? "").split(/[,，、\n]/).map((item) => item.trim()).filter((item) => item.length > 0);
    const payload = { title, goal, dueAt: new Date(rawDate).toISOString(), durationMinutes, participants };
    const previousIds: Set<string> = new Set(state.snapshot?.matters.map((matter) => matter.id));
    setSnapshot(snapshot(await request("/api/matters", "POST", JSON.stringify({ ...payload, requestId: requestId(JSON.stringify({ action: "matter", ...payload })) }))));
    const created: H5Matter | undefined = state.snapshot?.matters.find((matter) => !previousIds.has(matter.id));
    if (created !== undefined) switchMatter(created.id);
    state.matterDraft = { title: "", goal: "", dueAt: "", duration: "30", participants: "" };
    state.modal = null;
    tabScroll[state.tab] = modalScrollY;
    state.tab = "assistant";
    state.notice = "事项已保存。添加一条相关记录，就可以开始准备。";
    persistDrafts();
    renderModal();
    render();
    announce(state.notice);
    element("main-content").focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  });
}

async function action(target: HTMLElement): Promise<void> {
  const name: string = target.dataset.action ?? "";
  const id: string = target.dataset.id ?? "";
  if (name === "tab") { const tab: string = target.dataset.tab ?? ""; if (tab === "today" || tab === "memory" || tab === "assistant" || tab === "profile") switchTab(tab); return; }
  if (name === "close-modal" || name === "backdrop") { closeModal(); return; }
  if (name === "dismiss-error") { state.error = ""; renderMessages(); return; }
  if (name === "assistant-open-mode-sheet") { state.assistantUi.modeSheetOpen = true; state.assistantUi.snoozeSuggestionId = null; state.assistantUi.addContentSheetOpen = false; render(); return; }
  if (name === "assistant-close-mode-sheet") { state.assistantUi.modeSheetOpen = false; render(); return; }
  if (name === "assistant-open-snooze-sheet") { const suggestionId = target.dataset.suggestionId; if (suggestionId !== undefined) { state.assistantUi.snoozeSuggestionId = suggestionId; state.assistantUi.modeSheetOpen = false; render(); } return; }
  if (name === "assistant-close-snooze-sheet") { state.assistantUi.snoozeSuggestionId = null; render(); return; }
  if (name === "assistant-open-add-content-sheet") { state.assistantUi.addContentSheetOpen = true; state.assistantUi.modeSheetOpen = false; render(); return; }
  if (name === "assistant-close-add-content-sheet") { state.assistantUi.addContentSheetOpen = false; render(); return; }
  if (name === "assistant-add-plan-step") {
    const taskId = target.dataset.taskId;
    if (taskId !== undefined) {
      state.assistantUi.taskId = taskId;
      state.assistantUi.planStepTitleDraft = "";
      state.assistantUi.planStepDetailDraft = "";
      state.assistantUi.planStepSheetOpen = true;
      render();
      window.requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-assistant-field="plan-step-title"]')?.focus({ preventScroll: true }));
    }
    return;
  }
  if (name === "assistant-close-plan-step") { state.assistantUi.planStepSheetOpen = false; render(); return; }
  if (name === "assistant-open-plan-format") {
    const taskId = target.dataset.taskId;
    if (taskId !== undefined) { state.assistantUi.taskId = taskId; state.assistantUi.planLocationSheetOpen = false; state.assistantUi.planFormatSheetOpen = true; render(); }
    return;
  }
  if (name === "assistant-close-plan-format") { state.assistantUi.planFormatSheetOpen = false; render(); return; }
  if (name === "assistant-open-plan-location") {
    const taskId = target.dataset.taskId;
    if (taskId !== undefined) { state.assistantUi.taskId = taskId; state.assistantUi.planFormatSheetOpen = false; state.assistantUi.planLocationSheetOpen = true; render(); }
    return;
  }
  if (name === "assistant-close-plan-location") { state.assistantUi.planLocationSheetOpen = false; render(); return; }
  if (name === "assistant-expand-composer") {
    state.assistantUi.composerExpanded = true;
    render();
    window.requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea[data-assistant-field="composer"]')?.focus({ preventScroll: true }));
    return;
  }
  if (name === "assistant-select-mode") {
    const mode = target.dataset.mode;
    if (mode === "auto" || mode === "chat" || mode === "task") { state.assistantUi.selectedMode = mode; render(); }
    return;
  }
  if (name === "assistant-home-tab") {
    const tab = target.dataset.homeTab;
    if (tab === "suggested" || tab === "active" || tab === "completed") { state.assistantUi.homeTab = tab; render(); }
    return;
  }
  if (name === "assistant-task-filter") {
    const filter = target.dataset.taskFilter;
    if (filter === "all" || filter === "waiting" || filter === "running") { state.assistantUi.taskFilter = filter; render(); }
    return;
  }
  if (name === "assistant-back-home") { state.assistantStage = "overview"; state.assistantUi.screen = "home"; state.assistantUi.modeSheetOpen = false; state.assistantUi.snoozeSuggestionId = null; state.assistantUi.composerExpanded = false; state.assistantUi.addContentSheetOpen = false; render(); window.scrollTo({ top: 0, behavior: "instant" }); return; }
  if (name === "assistant-back-task") { state.assistantUi.screen = "task"; state.assistantUi.composerExpanded = false; state.assistantUi.addContentSheetOpen = false; render(); window.scrollTo({ top: 0, behavior: "instant" }); return; }
  if (name === "assistant-back-result") { state.assistantUi.screen = "result"; render(); window.scrollTo({ top: 0, behavior: "instant" }); return; }
  if (name === "assistant-back-chat") { state.assistantStage = "overview"; state.assistantUi.screen = state.assistantUi.sessionId === null ? "home" : "chat"; state.assistantUi.composerExpanded = false; state.assistantUi.addContentSheetOpen = false; render(); window.scrollTo({ top: 0, behavior: "instant" }); return; }
  if (name === "assistant-settings") { state.assistantStage = "overview"; state.assistantUi.screen = "permissions"; state.assistantUi.modeSheetOpen = false; state.assistantUi.composerExpanded = false; state.assistantUi.addContentSheetOpen = false; render(); return; }
  if (name === "assistant-more") { state.assistantStage = "overview"; state.assistantUi.screen = "tasks"; state.assistantUi.composerExpanded = false; state.assistantUi.addContentSheetOpen = false; render(); return; }
  if (name === "assistant-capability-unavailable") { state.assistantUi.addContentSheetOpen = false; state.notice = `${target.dataset.capability ?? "该能力"}尚未接入；本次不会请求授权或打开外部账号。`; render(); announce(state.notice); return; }
  if (name === "assistant-undo-dismiss") { const suggestionId = target.dataset.suggestionId; if (suggestionId !== undefined) await suggestionDecision(suggestionId, "restore"); return; }
  if (state.busy !== null) return;
  if (name === "assistant-create-default-task") {
    const contextId = assistantContextId(target.dataset.contextId);
    const subject = state.snapshot?.matters.find((item) => item.id === contextId);
    await sendAssistantMessage(`准备${subject?.title ?? "这件事"}的汇报结构`, "task", contextId);
    return;
  }
  if (name === "assistant-send") {
    const taskId = target.dataset.taskId;
    if (taskId !== undefined && taskId.length > 0) await addAssistantRequirement(taskId, state.assistantUi.composer);
    else await sendAssistantMessage(state.assistantUi.composer, null, assistantContextId(undefined));
    return;
  }
  if (name === "assistant-use-prompt") { await sendAssistantMessage(target.dataset.prompt ?? "", null, assistantContextId(undefined)); return; }
  if (name === "assistant-composer-search") { state.notice = "当前会在已选事项的记录范围内整理；全局检索尚未接入。"; renderMessages(); return; }
  if (name === "assistant-open-task") {
    const taskId = target.dataset.taskId;
    const requestedScreen = target.dataset.taskScreen;
    const screen = requestedScreen === "plan-edit" || requestedScreen === "details" || requestedScreen === "evidence" || requestedScreen === "result" || requestedScreen === "preview" || requestedScreen === "failure" || requestedScreen === "task" ? requestedScreen : "task";
    if (taskId !== undefined) openAssistantTask(taskId, screen);
    return;
  }
  if (name === "assistant-open-plan-edit") { const taskId = target.dataset.taskId; if (taskId !== undefined) openAssistantTask(taskId, "plan-edit"); return; }
  if (name === "assistant-open-evidence") { const taskId = target.dataset.taskId; if (taskId !== undefined) openAssistantTask(taskId, "evidence"); return; }
  if (name === "assistant-open-result") { const taskId = target.dataset.taskId; if (taskId !== undefined) openAssistantTask(taskId, "result"); return; }
  if (name === "assistant-open-preview") { const taskId = target.dataset.taskId; if (taskId !== undefined) openAssistantTask(taskId, "preview"); return; }
  if (name === "assistant-open-message-detail") { const messageId = target.dataset.messageId; if (messageId !== undefined) { state.assistantUi.messageDetailId = messageId; render(); } return; }
  if (name === "assistant-close-message-detail") { state.assistantUi.messageDetailId = null; render(); return; }
  if (name === "assistant-select-plan-format") {
    const taskId = target.dataset.taskId;
    const deliveryMode = target.dataset.deliveryMode;
    if (taskId !== undefined && (deliveryMode === "docx" || deliveryMode === "content")) await updateAssistantDeliveryMode(taskId, deliveryMode);
    return;
  }
  if (name === "assistant-copy-message") {
    const messageId = target.dataset.messageId;
    const message = state.snapshot?.assistant.messages.find((item) => item.id === messageId && item.role === "assistant");
    if (message !== undefined) {
      try { await navigator.clipboard.writeText(message.content); state.notice = "整理内容已复制。"; }
      catch { state.error = "当前浏览器不允许访问剪贴板；你仍可以在这里查看完整内容。"; }
      renderMessages();
    }
    return;
  }
  if (name === "assistant-save-message-memory") {
    const messageId = target.dataset.messageId;
    const message = state.snapshot?.assistant.messages.find((item) => item.id === messageId && item.role === "assistant");
    const session = state.snapshot?.assistant.sessions.find((item) => item.id === message?.sessionId);
    if (message === undefined || session === undefined) { state.error = "找不到这条整理内容，请刷新后重试。"; renderMessages(); return; }
    if (state.recordDraft.title.trim() !== "" || state.recordDraft.text.trim() !== "") { state.error = "当前有未保存的记录草稿；请先处理草稿，再保存这条整理。"; renderMessages(); return; }
    const contextId = session.contextId ?? currentMatter()?.id ?? state.snapshot?.matters[0]?.id ?? "";
    if (contextId === "") { state.error = "请先创建一个事项，再把整理内容保存到记忆。"; renderMessages(); return; }
    state.recordDraft = { title: `${session.title.slice(0, 180)} · 助手整理`, text: message.content, module: "work", contextId };
    openModal({ kind: "add" });
    window.requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-testid="record-title"]')?.focus({ preventScroll: true }));
    return;
  }
  if (name === "assistant-open-upgrade") { const sessionId = target.dataset.sessionId; if (sessionId !== undefined) { state.assistantUi.sessionId = sessionId; state.assistantUi.screen = "upgrade"; render(); } return; }
  if (name === "assistant-upgrade-confirm") { const sessionId = target.dataset.sessionId; if (sessionId !== undefined) await upgradeAssistantSession(sessionId, assistantContextId(target.dataset.contextId)); return; }
  if (name === "assistant-start-task") { const taskId = target.dataset.taskId; if (taskId !== undefined) await startAssistantTask(taskId); return; }
  if (name === "assistant-select-option") { const optionId = target.dataset.optionId; if (optionId !== undefined) { state.assistantUi.selectedOptionId = optionId; render(); } return; }
  if (name === "assistant-submit-option") { const taskId = target.dataset.taskId; const inputRequestId = target.dataset.inputRequestId; const optionId = state.assistantUi.selectedOptionId; if (taskId !== undefined && inputRequestId !== undefined && optionId !== null) await answerAssistantTask(taskId, inputRequestId, optionId); return; }
  if (name === "assistant-approve-confirmation" || name === "assistant-reject-confirmation") {
    if (name === "assistant-approve-confirmation" && !state.assistantUi.confirmationRead) { state.error = "请先勾选“我已核对内容和文件范围”，再确认生成文件。"; renderMessages(); return; }
    const taskId = target.dataset.taskId;
    const confirmationId = target.dataset.confirmationId;
    if (taskId !== undefined && confirmationId !== undefined) await confirmAssistantTask(taskId, confirmationId, name === "assistant-approve-confirmation" ? "approved" : "rejected");
    return;
  }
  if (name === "assistant-task-action") {
    const taskId = target.dataset.taskId;
    const taskAction = target.dataset.taskAction;
    if (taskId !== undefined && (taskAction === "pause" || taskAction === "resume" || taskAction === "cancel" || taskAction === "retry")) await actOnAssistantTask(taskId, taskAction);
    return;
  }
  if (name === "assistant-toggle-evidence") { const evidenceId = target.dataset.evidenceId; if (evidenceId !== undefined) await toggleAssistantEvidence(evidenceId, target.dataset.included === "true"); return; }
  if (name === "assistant-open-artifact") { const artifactId = target.dataset.artifactId; if (artifactId !== undefined && artifactId.length > 0) openAssistantArtifact(artifactId); return; }
  if (name === "assistant-open-suggestion-evidence") {
    const contextId = target.dataset.contextId;
    const matching = state.snapshot?.assistant.tasks.find((item) => item.contextId === contextId && item.status !== "cancelled");
    if (matching !== undefined) openAssistantTask(matching.id, "evidence");
    else { state.notice = "开始这个任务后，可以查看并调整它实际使用的依据。"; renderMessages(); }
    return;
  }
  if (name === "assistant-set-snooze") {
    const suggestionId = target.dataset.suggestionId;
    const minutes = Number(target.dataset.snoozeMinutes);
    const snoozeMinutes: 60 | 180 | 1440 | null = minutes === 60 || minutes === 180 || minutes === 1440 ? minutes : null;
    if (suggestionId !== undefined && snoozeMinutes !== null) { state.assistantUi.snoozeSuggestionId = null; await suggestionDecision(suggestionId, "snooze", snoozeMinutes); }
    return;
  }
  if (name === "assistant-snooze-suggestion" || name === "assistant-dismiss-suggestion") { const suggestionId = target.dataset.suggestionId; if (suggestionId !== undefined) await suggestionDecision(suggestionId, name === "assistant-snooze-suggestion" ? "snooze" : "dismiss"); return; }
  if (name === "assistant-share-result") {
    const taskId = target.dataset.taskId;
    const task = state.snapshot?.assistant.tasks.find((item) => item.id === taskId);
    const artifact = task?.artifactId === null ? undefined : state.snapshot?.artifacts.find((item) => item.id === task?.artifactId);
    if (task !== undefined && "share" in navigator) {
      try { await navigator.share({ title: artifact?.title ?? "Mixture X 任务结果", text: "这是我在 Mixture X 中完成的一项任务结果。" }); state.notice = "已打开系统分享面板。"; }
      catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) state.error = "无法打开系统分享面板，请先下载文件后使用系统分享。"; }
    } else state.notice = "当前浏览器不支持系统分享，请先下载文件后使用系统分享。";
    renderMessages();
    return;
  }
  if (name === "refresh") await refreshState();
  else if (name === "add") openModal({ kind: "add" });
  else if (name === "calendar") openModal({ kind: "calendar" });
  else if (name === "new-matter") openModal({ kind: "new-matter" });
  else if (name === "source") {
    const record: H5Record | undefined = activeRecords().find((candidate) => candidate.id === id);
    if (record !== undefined) openModal({ kind: "source", recordId: id, editing: false, revision: record.revision, title: record.title, text: record.text });
  } else if (name === "source-edit" && state.modal?.kind === "source") { state.modal.editing = true; renderModal(); }
  else if (name === "filter") { const filter: string = target.dataset.filter ?? ""; if (filter === "all" || isModule(filter)) state.filter = state.filter === filter ? "all" : filter; state.timelineExpanded = false; render(); }
  else if (name === "timeline-toggle") { state.timelineExpanded = !state.timelineExpanded; render(); }
  else if (name === "memory-group") { const group: string = target.dataset.group ?? ""; if (group === "matter" || group === "person" || group === "date") state.group = group; render(); }
  else if (name === "suggestion-open") {
    const suggestion: H5Suggestion | undefined = state.snapshot?.suggestions.find((candidate) => candidate.id === id);
    if (suggestion !== undefined) openAssistantMatter(suggestion.matterId, suggestion.state === "prepared" ? suggestion.artifactId : null);
  } else if (name === "matter-open") { closeModal(); openAssistantMatter(id, null); }
  else if (name === "assistant-start") showAssistantStage("prepare");
  else if (name === "assistant-stage-back") backAssistantStage();
  else if (name === "snooze" || name === "dismiss" || name === "restore") await suggestionDecision(id, name);
  else if (name === "skill") { const skill: string = target.dataset.skill ?? ""; if (skill === "report-outline" || skill === "requirements-checklist") state.skillId = skill; persistDrafts(); render(); }
  else if (name === "prepare") await prepareArtifact();
  else if (name === "save-revision") await saveRevision();
  else if (name === "select-artifact") { state.artifactId = id; state.artifactVersion = null; persistDrafts(); showAssistantStage("artifact"); }
  else if (name === "latest-version") { state.artifactVersion = null; render(); }
  else if (name === "export-review") await reviewExport();
  else if (name === "export-confirm") await confirmExport();
}

document.addEventListener("click", (event: MouseEvent) => {
  const original: EventTarget | null = event.target;
  if (!(original instanceof Element)) return;
  const target: HTMLElement | null = original.closest<HTMLElement>("[data-action]");
  const stop: HTMLElement | null = original.closest<HTMLElement>("[data-action-stop]");
  if (stop !== null && target !== null && !stop.contains(target)) return;
  if (target === null || (target.dataset.action === "backdrop" && target !== original)) return;
  event.preventDefault();
  void action(target);
});
document.addEventListener("submit", (event: SubmitEvent) => {
  if (!(event.target instanceof HTMLFormElement) || event.target.dataset.form === undefined) return;
  event.preventDefault();
  if (event.target.dataset.form === "assistant-plan-step") void submitAssistantPlanStep();
  else if (event.target.dataset.form === "new-matter") void submitMatter(event.target);
  else void submitRecord(event.target);
});
document.addEventListener("input", (event: Event) => {
  const target: EventTarget | null = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
  if (target.dataset.assistantField === "composer") { state.assistantUi.composer = target.value; return; }
  if (target.dataset.assistantField === "plan-step-title") { state.assistantUi.planStepTitleDraft = target.value; return; }
  if (target.dataset.assistantField === "plan-step-detail") { state.assistantUi.planStepDetailDraft = target.value; return; }
  if (target instanceof HTMLInputElement && target.dataset.assistantField === "confirmation-read") { state.assistantUi.confirmationRead = target.checked; render(); return; }
  const field: string = target.dataset.field ?? "";
  if (field === "search") { state.search = target.value; element("memory-results").innerHTML = memoryResults(); return; }
  if (field === "requirements") state.requirements = target.value;
  else if (field === "record-title") state.recordDraft.title = target.value;
  else if (field === "record-text") state.recordDraft.text = target.value;
  else if (field === "new-matter-title") state.matterDraft.title = target.value;
  else if (field === "new-matter-goal") state.matterDraft.goal = target.value;
  else if (field === "new-matter-due") state.matterDraft.dueAt = target.value;
  else if (field === "new-matter-duration") state.matterDraft.duration = target.value;
  else if (field === "new-matter-participants") state.matterDraft.participants = target.value;
  else if (field === "source-title" && state.modal?.kind === "source") state.modal.title = target.value;
  else if (field === "source-text" && state.modal?.kind === "source") state.modal.text = target.value;
  else if (field === "artifact-block") {
    const artifact: PreparedArtifact | undefined = currentArtifact();
    const blockId: string | undefined = target.dataset.blockId;
    if (artifact === undefined || blockId === undefined) return;
    let draft: ArtifactDraft | undefined = currentDraft(artifact);
    if (draft === undefined) { draft = { artifactId: artifact.id, version: artifact.version, blocks: {} }; state.drafts.push(draft); }
    draft.blocks[blockId] = target.value;
    updateDraftState();
  }
  persistDrafts();
});
document.addEventListener("focusin", (event: FocusEvent) => {
  const target: EventTarget | null = event.target;
  if (!(target instanceof HTMLInputElement) || target.dataset.assistantField !== "composer" || state.assistantUi.composerExpanded) return;
  state.assistantUi.composerExpanded = true;
  render();
  window.requestAnimationFrame(() => {
    const editor: HTMLTextAreaElement | null = document.querySelector('textarea[data-assistant-field="composer"]');
    editor?.focus({ preventScroll: true });
    editor?.setSelectionRange(editor.value.length, editor.value.length);
  });
});
document.addEventListener("change", (event: Event) => {
  const target: EventTarget | null = event.target;
  if (!(target instanceof HTMLSelectElement)) return;
  if (target.dataset.field === "matter") { switchMatter(target.value); persistDrafts(); render(); }
  else if (target.dataset.field === "version") { state.artifactVersion = Number(target.value); render(); }
  else if (target.dataset.field === "record-module" && isModule(target.value)) { state.recordDraft.module = target.value; persistDrafts(); }
  else if (target.dataset.field === "record-matter") { state.recordDraft.contextId = target.value; persistDrafts(); }
});
document.addEventListener("toggle", (event: Event) => {
  if (event.target instanceof HTMLDetailsElement && event.target.dataset.testid === "background-sources" && event.target.isConnected) state.backgroundExpanded = event.target.open;
}, true);
document.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key === "Escape" && (state.assistantUi.planStepSheetOpen || state.assistantUi.planFormatSheetOpen || state.assistantUi.planLocationSheetOpen || state.assistantUi.messageDetailId !== null)) {
    event.preventDefault();
    state.assistantUi.planStepSheetOpen = false;
    state.assistantUi.planFormatSheetOpen = false;
    state.assistantUi.planLocationSheetOpen = false;
    state.assistantUi.messageDetailId = null;
    render();
    return;
  }
  if (event.key === "Escape" && event.target instanceof HTMLTextAreaElement && event.target.dataset.assistantField === "composer") {
    event.preventDefault();
    state.assistantUi.composerExpanded = false;
    state.assistantUi.addContentSheetOpen = false;
    render();
    return;
  }
  if (event.key === "Enter" && event.target instanceof HTMLInputElement && event.target.dataset.assistantField === "composer") {
    event.preventDefault();
    const taskId = event.target.dataset.taskId;
    if (taskId !== undefined && taskId.length > 0) void addAssistantRequirement(taskId, state.assistantUi.composer);
    else void sendAssistantMessage(state.assistantUi.composer, null, assistantContextId(undefined));
    return;
  }
  if (state.modal === null) return;
  if (event.key === "Escape") { event.preventDefault(); closeModal(); return; }
  if (event.key !== "Tab") return;
  const focusable: HTMLElement[] = [...element("overlay-root").querySelectorAll<HTMLElement>('button:not([disabled]), input, textarea, select, a[href], [tabindex="0"]')];
  const first: HTMLElement | undefined = focusable[0];
  const last: HTMLElement | undefined = focusable[focusable.length - 1];
  if (event.shiftKey && (document.activeElement === first || document.activeElement?.classList.contains("modal"))) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
});
window.addEventListener("beforeunload", (event: BeforeUnloadEvent) => { if (hasDirty()) { event.preventDefault(); event.returnValue = ""; } });

async function start(): Promise<void> {
  try { restoreDrafts(); }
  catch (error) { state.error = error instanceof Error ? `暂存草稿读取失败：${error.message}` : "暂存草稿读取失败，请保留浏览器存储后检查。"; }
  const draftError: string = state.error;
  await refreshState();
  if (state.snapshot === null) render();
  if (draftError.length > 0) { state.error = draftError; renderMessages(); }
  else { state.notice = ""; renderMessages(); }
}
async function refreshInBackground(): Promise<void> {
  if (document.visibilityState !== "visible" || state.busy !== null || state.snapshot === null) return;
  try {
    const updated: H5Snapshot = snapshot(await request("/api/state", "GET", null));
    if (state.busy !== null) return;
    const changed: boolean = updated.revision !== state.snapshot.revision || JSON.stringify(updated.suggestions) !== JSON.stringify(state.snapshot.suggestions);
    setSnapshot(updated);
    if (!changed) return;
    const editingAssistantInput: boolean = document.activeElement instanceof HTMLElement && document.activeElement.dataset.assistantField === "composer";
    if ((state.tab === "today" || state.tab === "profile") && state.modal === null) render();
    else if (state.tab === "assistant" && state.assistantStage === "overview" && state.modal === null && !editingAssistantInput) {
      const scrollY: number = window.scrollY;
      render();
      window.scrollTo({ top: scrollY, behavior: "instant" });
    }
    else {
      state.notice = "记录与提醒有更新。你的编辑仍保留，切换页签后可看到最新内容。";
      renderMessages();
      updateDraftState();
    }
  } catch (error) {
    state.error = error instanceof Error ? `自动读取最新记录未完成：${error.message}。编辑仍保留，可在“我的”中重新读取。` : "自动读取记录发生非预期错误，请检查服务状态。";
    renderMessages();
  }
}
window.setInterval(() => { void refreshInBackground(); }, 60_000);
window.setInterval(() => {
  const running: boolean = state.snapshot?.assistant.tasks.some((task) => task.status === "running") ?? false;
  if (running) void refreshInBackground();
}, 1_000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void refreshInBackground(); });
void start();
