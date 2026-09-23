/** Mobile-first V4 assistant surfaces. Business state remains on the H5 service. */
import type { AssistantConfirmation, AssistantEvidence, AssistantInputRequest, AssistantMessage, AssistantMode, AssistantSession, AssistantTask, AssistantTaskStep } from "../src/assistant-types.ts";
import type { H5Matter, H5Snapshot } from "../src/h5-types.ts";

export type AssistantScreen = "home" | "chat" | "upgrade" | "task" | "plan-edit" | "tasks" | "details" | "evidence" | "permissions" | "result" | "preview" | "failure";
export type AssistantHomeTab = "suggested" | "active" | "completed";
export type AssistantTaskFilter = "all" | "waiting" | "running";

export interface AssistantUiState {
  screen: AssistantScreen;
  homeTab: AssistantHomeTab;
  taskFilter: AssistantTaskFilter;
  modeSheetOpen: boolean;
  selectedMode: AssistantMode;
  sessionId: string | null;
  taskId: string | null;
  selectedOptionId: string | null;
  confirmationRead: boolean;
  snoozeSuggestionId: string | null;
  dismissedSuggestionId: string | null;
  composerExpanded: boolean;
  addContentSheetOpen: boolean;
  planStepSheetOpen: boolean;
  planStepTitleDraft: string;
  planStepDetailDraft: string;
  planFormatSheetOpen: boolean;
  planLocationSheetOpen: boolean;
  messageDetailId: string | null;
  composer: string;
}

export function initialAssistantUiState(): AssistantUiState {
  return { screen: "home", homeTab: "suggested", taskFilter: "all", modeSheetOpen: false, selectedMode: "auto", sessionId: null, taskId: null, selectedOptionId: null, confirmationRead: false, snoozeSuggestionId: null, dismissedSuggestionId: null, composerExpanded: false, addContentSheetOpen: false, planStepSheetOpen: false, planStepTitleDraft: "", planStepDetailDraft: "", planFormatSheetOpen: false, planLocationSheetOpen: false, messageDetailId: null, composer: "" };
}

function escape(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function icon(name: string, extra: string = ""): string {
  return `<img class="v4-icon ${extra}" src="/assets/icons/${name}.svg" alt="" aria-hidden="true" width="22" height="22">`;
}

function button(label: string, action: string, className: string, attributes: string = ""): string {
  return `<button type="button" class="${className}" data-action="${action}" ${attributes}>${label}</button>`;
}

function matter(snapshot: H5Snapshot, contextId: string | null): H5Matter | undefined {
  return snapshot.matters.find((item) => item.id === contextId) ?? snapshot.matters[0];
}

function session(snapshot: H5Snapshot, id: string | null): AssistantSession | undefined {
  return (id === null ? undefined : snapshot.assistant.sessions.find((item) => item.id === id)) ?? snapshot.assistant.sessions.at(-1);
}

function task(snapshot: H5Snapshot, id: string | null): AssistantTask | undefined {
  return (id === null ? undefined : snapshot.assistant.tasks.find((item) => item.id === id)) ?? snapshot.assistant.tasks.at(-1);
}

function taskSteps(snapshot: H5Snapshot, taskId: string): AssistantTaskStep[] {
  return snapshot.assistant.steps.filter((item) => item.taskId === taskId);
}

function taskEvidence(snapshot: H5Snapshot, taskId: string): AssistantEvidence[] {
  return snapshot.assistant.evidence.filter((item) => item.taskId === taskId);
}

function openInput(snapshot: H5Snapshot, taskId: string): AssistantInputRequest | undefined {
  return snapshot.assistant.inputRequests.find((item) => item.taskId === taskId && item.status === "open");
}

function pendingConfirmation(snapshot: H5Snapshot, taskId: string): AssistantConfirmation | undefined {
  return snapshot.assistant.confirmations.find((item) => item.taskId === taskId && item.status === "pending");
}

function taskStatus(taskValue: AssistantTask): string {
  const labels: Record<AssistantTask["status"], string> = {
    draft: "待开始",
    ready: "待开始",
    running: "进行中",
    waiting_input: "等你补充",
    waiting_confirmation: "等你确认",
    paused: "已暂停",
    completed: "已完成",
    failed: "遇到问题",
    cancelled: "已取消",
  };
  return labels[taskValue.status];
}

function taskEtaLabel(taskValue: AssistantTask): string {
  return taskValue.etaSeconds === null ? "暂无法估算剩余时间" : `预计还需约${taskValue.etaSeconds}秒`;
}

function formatDue(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function homeDueLabel(value: string, now: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const parts = (date: Date) => {
    const formatted = formatter.formatToParts(date);
    const valueOf = (type: Intl.DateTimeFormatPartTypes): number => Number(formatted.find((part) => part.type === type)?.value ?? "0");
    return { year: valueOf("year"), month: valueOf("month"), day: valueOf("day"), hour: valueOf("hour") };
  };
  const current = parts(new Date(now));
  const due = parts(new Date(value));
  const currentDay = Date.UTC(current.year, current.month - 1, current.day);
  const dueDay = Date.UTC(due.year, due.month - 1, due.day);
  const dayOffset = Math.round((dueDay - currentDay) / 86_400_000);
  const dayLabel = dayOffset === 0 ? "今天" : dayOffset === 1 ? "明天" : `${due.month}/${due.day}`;
  const period = due.hour < 6 ? "凌晨" : due.hour < 12 ? "上午" : due.hour < 18 ? "下午" : "晚上";
  return `${dayLabel}${period}`;
}

function isTodayInShanghai(value: string, now: string): boolean {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });
  return formatter.format(new Date(value)) === formatter.format(new Date(now));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function isSameDay(left: string, right: string): boolean {
  return new Date(left).toDateString() === new Date(right).toDateString();
}

function activeTasks(snapshot: H5Snapshot): AssistantTask[] {
  const priority: Record<AssistantTask["status"], number> = {
    waiting_input: 0,
    waiting_confirmation: 0,
    failed: 0,
    running: 1,
    draft: 2,
    ready: 2,
    paused: 2,
    completed: 3,
    cancelled: 4,
  };
  return snapshot.assistant.tasks
    .filter((item) => priority[item.status] < 3)
    .sort((left, right) => priority[left.status] - priority[right.status] || Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

function selectedTaskId(ui: AssistantUiState, snapshot: H5Snapshot): string | null {
  return ui.taskId ?? activeTasks(snapshot)[0]?.id ?? snapshot.assistant.tasks.at(-1)?.id ?? null;
}

function composer(ui: AssistantUiState, taskId: string | null | undefined = undefined): string {
  const currentTaskId: string | null = taskId === undefined ? (ui.screen === "task" ? ui.taskId : null) : taskId;
  const taskAttribute = currentTaskId === null ? "" : `data-task-id="${escape(currentTaskId)}"`;
  const placeholder = currentTaskId === null ? "告诉我你想完成什么" : "补充这项任务的要求";
  const hasDraft: boolean = ui.composer.trim().length > 0;
  if (ui.composerExpanded) {
    return `<section class="v4-composer-shell expanded" aria-label="编辑给助手的内容"><div class="v4-composer-expanded"><textarea data-assistant-field="composer" ${taskAttribute} maxlength="2000" placeholder="${placeholder}" aria-label="${placeholder}">${escape(ui.composer)}</textarea><div class="v4-composer-tools">${button("+ 添加", "assistant-open-add-content-sheet", "v4-composer-chip", "aria-haspopup=\"dialog\"")}${button(`${ui.selectedMode === "auto" ? "智能判断" : ui.selectedMode === "chat" ? "仅回答" : "帮我执行"}${icon("chevron-right", "tiny")}`, "assistant-open-mode-sheet", "v4-composer-chip", "aria-haspopup=\"dialog\"")}${button(`${icon("mic", "tiny")}语音`, "assistant-capability-unavailable", "v4-composer-chip", "data-capability=\"语音转写\"")}${button(icon("arrow-right", "small"), "assistant-send", "v4-send-button", `${taskAttribute} aria-label="${currentTaskId === null ? "发送给助手" : "添加任务要求"}" ${hasDraft ? "" : "disabled"}`)}</div></div></section>`;
  }
  const action = hasDraft ? "assistant-send" : "assistant-capability-unavailable";
  const actionAttribute = hasDraft ? taskAttribute : "data-capability=\"语音转写\"";
  return `<section class="v4-composer-shell" aria-label="发送给助手"><div class="v4-composer"><span class="v4-composer-mark">${icon("sparkles", "small")}</span><input data-assistant-field="composer" ${taskAttribute} value="${escape(ui.composer)}" maxlength="2000" placeholder="${placeholder}" aria-label="${placeholder}">${button(icon("search", "small"), "assistant-composer-search", "v4-composer-icon", "aria-label=\"搜索已有内容\"")}</div>${button(icon(hasDraft ? "arrow-right" : "mic", "small"), action, `v4-voice-button ${hasDraft ? "has-draft" : ""}`, `${actionAttribute} aria-label="${hasDraft ? (currentTaskId === null ? "发送给助手" : "添加任务要求") : "语音输入"}"`)}</section>`;
}

function topHeader(title: string, backAction: string | null, utilityAction: string = "assistant-more"): string {
  return `<header class="v4-detail-header">${backAction === null ? `<div class="v4-header-spacer"></div>` : button(icon("chevron-left", ""), backAction, "v4-header-button", "aria-label=\"返回\"")}<h1>${escape(title)}</h1>${button(icon(utilityAction === "assistant-settings" ? "settings" : "more-horizontal", ""), utilityAction, "v4-header-button", `aria-label=\"${utilityAction === "assistant-settings" ? "工具与权限" : "更多操作"}\"`)}</header>`;
}

function homeCard(snapshot: H5Snapshot): string {
  const suggestion = snapshot.suggestions.find((item) => item.state === "available");
  const subject = matter(snapshot, suggestion?.matterId ?? null);
  if (suggestion === undefined || subject === undefined) {
    return `<article class="v4-primary-card v4-primary-card-empty"><span class="v4-round-icon blue">${icon("file-text", "")}</span><div><h2>暂时没有新的准备建议</h2><p>现有任务和已完成结果仍会保留在对应列表中。</p></div></article>`;
  }
  const recordCount = suggestion.sourceIds.length;
  const todayCount = snapshot.records.filter((record) => suggestion.sourceIds.includes(record.id) && isTodayInShanghai(record.recordedAt, snapshot.now)).length;
  const evidenceLabel = todayCount === recordCount ? `来自今天 ${recordCount} 条相关记录` : `来自 ${recordCount} 条相关记录`;
  return `<article class="v4-primary-card"><div class="v4-card-heading"><span class="v4-round-icon blue">${icon("file-text", "")}</span><div><h2>${escape(suggestion.title)}</h2><p>${homeDueLabel(subject.dueAt, snapshot.now)} · ${subject.durationMinutes} 分钟${subject.participants.length > 0 ? ` · ${escape(subject.participants.join("、"))}参加` : ""}</p></div></div><p class="v4-card-copy">${escape(suggestion.reason)}</p><button type="button" class="v4-evidence-link" data-action="assistant-open-suggestion-evidence" data-context-id="${escape(subject.id)}">${icon("book-open", "tiny")}${evidenceLabel} · 查看依据${icon("chevron-right", "tiny")}</button><div class="v4-service-note">${icon("sparkles", "tiny")}任务模式 · 本地准备服务 · 将由你确认交付</div>${button(`和我一起准备 ${icon("arrow-right", "")}`, "assistant-create-default-task", "v4-primary-cta", `data-context-id="${escape(subject.id)}"`)}<div class="v4-card-actions">${button(`${icon("clock", "small")}稍后`, "assistant-open-snooze-sheet", "v4-secondary-cta", `data-suggestion-id="${escape(suggestion.id)}"`)}${button(`${icon("x", "small")}忽略`, "assistant-dismiss-suggestion", "v4-secondary-cta", `data-suggestion-id="${escape(suggestion.id)}"`)}</div></article>`;
}

function compactTaskCard(snapshot: H5Snapshot, taskValue: AssistantTask): string {
  const subject = matter(snapshot, taskValue.contextId);
  const progress = Math.max(0, Math.min(100, taskValue.progress));
  const steps = taskSteps(snapshot, taskValue.id);
  const currentStep = steps[taskValue.currentStep];
  const taskDetail = taskValue.status === "running" && currentStep !== undefined ? `正在${currentStep.title}` : taskStatus(taskValue);
  const progressLabel = taskValue.status === "running" && steps.length > 0 ? `${Math.min(taskValue.currentStep + 1, steps.length)}/${steps.length}` : `${progress}%`;
  return `<button type="button" class="v4-compact-task" data-action="assistant-open-task" data-task-id="${escape(taskValue.id)}" data-task-screen="details"><span class="v4-round-icon ${taskValue.status === "waiting_input" || taskValue.status === "waiting_confirmation" ? "yellow" : taskValue.status === "failed" ? "red" : "green"}">${icon(taskValue.status === "failed" ? "alert-circle" : taskValue.status === "waiting_input" || taskValue.status === "waiting_confirmation" ? "sparkles" : "briefcase", "")}</span><span class="v4-compact-task-copy"><strong>${escape(taskValue.goal || subject?.title || "未命名任务")}</strong><small>${escape(taskDetail)}</small></span><span class="v4-compact-progress"><b>${progressLabel}</b><progress max="100" value="${progress}" aria-label="任务进度">${progress}%</progress></span></button>`;
}

function suggestionOrigin(snapshot: H5Snapshot, sourceIds: readonly string[]): string {
  const records = snapshot.records.filter((record) => sourceIds.includes(record.id));
  const datePrefix = records.length > 0 && records.every((record) => isTodayInShanghai(record.recordedAt, snapshot.now)) ? "今天 " : "";
  return records.length > 0 && records.every((record) => record.cover === "commute") ? `来自${datePrefix}${records.length} 条通勤记录` : `${datePrefix}${records.length} 条相关记录`;
}

function home(snapshot: H5Snapshot, ui: AssistantUiState): string {
  const tasks = activeTasks(snapshot);
  const activeSuggestions = snapshot.suggestions.filter((item) => item.state === "available");
  const secondarySuggestions = activeSuggestions.slice(1, 2);
  const completed = snapshot.assistant.tasks.filter((item) => item.status === "completed");
  const title = ui.homeTab === "suggested" ? activeSuggestions.length === 0 ? "今天没有新的准备建议" : `今天有${activeSuggestions.length}件事值得你处理` : ui.homeTab === "active" ? "正在处理的任务" : "已完成的结果";
  let body: string;
  if (ui.homeTab === "suggested") {
    body = `${homeCard(snapshot)}${secondarySuggestions.map((suggestion) => {
      const subject = matter(snapshot, suggestion.matterId);
      if (subject === undefined) return "";
      return `<article class="v4-small-suggestion"><span class="v4-round-icon yellow">${icon("lightbulb", "")}</span><span><strong>${escape(subject.title)}</strong><small>${escape(suggestionOrigin(snapshot, suggestion.sourceIds))}</small></span>${button(icon("chevron-right", ""), "assistant-create-default-task", "v4-row-arrow", `data-context-id="${escape(subject.id)}" aria-label="开始准备${escape(subject.title)}"`)}</article>`;
    }).join("")}${tasks.length > 0 ? `<section class="v4-home-section"><h2>进行中</h2>${tasks.slice(0, 1).map((item) => compactTaskCard(snapshot, item)).join("")}</section>` : ""}<div class="v4-prompt-grid">${button(`${icon("clock", "tiny")}帮我回顾今天`, "assistant-use-prompt", "v4-prompt-chip", "data-prompt=\"帮我回顾今天\"")}${button(`${icon("file-text", "tiny")}看看明天要准备什么`, "assistant-use-prompt", "v4-prompt-chip", "data-prompt=\"看看明天要准备什么\"")}</div>`;
  } else if (ui.homeTab === "active") {
    body = tasks.length === 0 ? `<div class="v4-empty"><span class="v4-round-icon green">${icon("check", "")}</span><h2>暂时没有进行中的任务</h2><p>从建议卡或输入框开始，任务会在这里持续显示。</p></div>` : `<section class="v4-task-stack">${tasks.map((item) => compactTaskCard(snapshot, item)).join("")}</section>`;
  } else {
    body = completed.length === 0 ? `<div class="v4-empty"><span class="v4-round-icon blue">${icon("file-text", "")}</span><h2>还没有完成的结果</h2><p>完成后的文件和可编辑内容会在这里保存。</p></div>` : `<section class="v4-task-stack">${completed.map((item) => compactTaskCard(snapshot, item)).join("")}</section>`;
  }
  return `<section class="assistant-v4 v4-home" data-assistant-screen="home"><header class="v4-home-header"><h1>助手</h1>${button(icon("settings", "small"), "assistant-settings", "v4-plain-icon", "aria-label=\"工具与权限\"")}</header><div class="v4-home-title"><h2>${escape(title)}</h2><p>我会先说明判断，再由你决定是否开始。</p>${button(`${ui.selectedMode === "auto" ? "智能判断" : ui.selectedMode === "chat" ? "仅问答" : "任务执行"}${icon("chevron-right", "tiny")}`, "assistant-open-mode-sheet", "v4-mode-pill", "aria-haspopup=\"dialog\"")}</div><nav class="v4-home-tabs" aria-label="助手任务状态">${([['suggested','建议处理'],['active','进行中'],['completed','已完成']] as const).map(([id,label]) => button(label, "assistant-home-tab", `v4-home-tab ${ui.homeTab === id ? "active" : ""}`, `data-home-tab="${id}" aria-pressed="${ui.homeTab === id}"`)).join("")}</nav><div class="v4-home-body">${body}</div>${composer(ui)}</section>`;
}

function modeSheet(ui: AssistantUiState): string {
  const choices: { mode: AssistantMode; icon: string; title: string; text: string }[] = [
    { mode: "auto", icon: "sparkles", title: "自动判断", text: "根据任务是否需要交付或持续执行进行判断" },
    { mode: "chat", icon: "arrow-right", title: "仅问答", text: "问答、总结或改写，不调用外部工具" },
    { mode: "task", icon: "briefcase", title: "帮我执行", text: "生成交付物并按步骤持续处理" },
  ];
  return `<div class="v4-sheet-backdrop" data-action="assistant-close-mode-sheet"><section class="v4-mode-sheet" role="dialog" aria-modal="true" aria-label="选择助手工作方式" data-action-stop="true"><span class="v4-sheet-handle"></span><h2>选择助手工作方式</h2><p>你可以手动切换，也可以让助手自动判断。</p><div class="v4-mode-list">${choices.map((choice) => button(`<span class="v4-round-icon ${choice.mode === "task" ? "green" : choice.mode === "chat" ? "blue" : "peach"}">${icon(choice.icon, "")}</span><span><strong>${choice.title}</strong><small>${choice.text}</small></span><span class="v4-radio ${ui.selectedMode === choice.mode ? "selected" : ""}"></span>`, "assistant-select-mode", `v4-mode-option ${ui.selectedMode === choice.mode ? "selected" : ""}`, `data-mode="${choice.mode}" aria-pressed="${ui.selectedMode === choice.mode}"`)).join("")}</div>${button("完成", "assistant-close-mode-sheet", "v4-sheet-done")}</section></div>`;
}

function snoozeSheet(snapshot: H5Snapshot, ui: AssistantUiState): string {
  const suggestion = snapshot.suggestions.find((item) => item.id === ui.snoozeSuggestionId);
  if (suggestion === undefined) return "";
  const choices: { minutes: 60 | 180 | 1440; title: string; detail: string }[] = [
    { minutes: 60, title: "1 小时后", detail: "先把这件事放到稍后" },
    { minutes: 180, title: "今天稍后", detail: "3 小时后再提醒我" },
    { minutes: 1440, title: "明天同一时间", detail: "明天再重新查看这条建议" },
  ];
  return `<div class="v4-sheet-backdrop" data-action="assistant-close-snooze-sheet"><section class="v4-mode-sheet v4-snooze-sheet" role="dialog" aria-modal="true" aria-label="选择提醒时间" data-action-stop="true"><span class="v4-sheet-handle"></span><h2>什么时候再提醒我？</h2><p>建议和关联记录都会保留，你可以随时恢复。</p><div class="v4-mode-list">${choices.map((choice) => button(`<span class="v4-round-icon yellow">${icon("clock", "")}</span><span><strong>${choice.title}</strong><small>${choice.detail} · ${formatDue(new Date(Date.parse(snapshot.now) + choice.minutes * 60_000).toISOString())}</small></span>${icon("chevron-right", "small")}`, "assistant-set-snooze", "v4-mode-option", `data-suggestion-id="${escape(suggestion.id)}" data-snooze-minutes="${choice.minutes}"`)).join("")}</div>${button("取消", "assistant-close-snooze-sheet", "v4-sheet-done v4-sheet-cancel")}</section></div>`;
}

function addContentSheet(): string {
  const choices: { icon: string; color: string; title: string; text: string; capability: string }[] = [
    { icon: "mic", color: "peach", title: "录音", text: "现场录制或选择记录；转写尚未接入", capability: "录音与转写" },
    { icon: "file-text", color: "blue", title: "文件", text: "Word、PDF、表格等；上传尚未接入", capability: "文件上传" },
    { icon: "layers", color: "green", title: "图片", text: "拍照或选择相册；图片输入尚未接入", capability: "图片输入" },
    { icon: "book-open", color: "yellow", title: "从记忆选择", text: "人物、事情或过去内容；选择器尚未接入", capability: "记忆选择器" },
  ];
  return `<div class="v4-sheet-backdrop" data-action="assistant-close-add-content-sheet"><section class="v4-mode-sheet v4-add-content-sheet" role="dialog" aria-modal="true" aria-label="添加内容" data-action-stop="true"><span class="v4-sheet-handle"></span><h2>添加内容</h2><p>附件会随当前对话一起交给助手。以下能力尚未接入，因此不会上传或请求权限。</p><div class="v4-add-content-grid">${choices.map((choice) => button(`<span class="v4-round-icon ${choice.color}">${icon(choice.icon, "")}</span><span><strong>${choice.title}</strong><small>${choice.text}</small></span>`, "assistant-capability-unavailable", "v4-add-content-option", `data-capability="${escape(choice.capability)}"`)).join("")}</div>${button("取消", "assistant-close-add-content-sheet", "v4-sheet-done v4-sheet-cancel")}</section></div>`;
}

function planStepSheet(ui: AssistantUiState): string {
  return `<div class="v4-sheet-backdrop" data-action="assistant-close-plan-step"><section class="v4-mode-sheet v4-plan-step-sheet" role="dialog" aria-modal="true" aria-label="添加计划步骤" data-action-stop="true"><span class="v4-sheet-handle"></span><h2>添加执行步骤</h2><p>补充步骤会作为本地内容准备要求纳入结果，不会自动操作电脑或云盘。</p><form data-form="assistant-plan-step" class="v4-plan-step-form"><label for="assistant-plan-step-title">步骤名称</label><input id="assistant-plan-step-title" data-assistant-field="plan-step-title" maxlength="120" required placeholder="例如：补充风险与待确认项" value="${escape(ui.planStepTitleDraft)}"><label for="assistant-plan-step-detail">执行说明</label><textarea id="assistant-plan-step-detail" data-assistant-field="plan-step-detail" maxlength="1200" rows="3" required placeholder="说明希望在最终内容中补充什么">${escape(ui.planStepDetailDraft)}</textarea><div class="v4-plan-step-actions"><button type="button" class="v4-sheet-done v4-sheet-cancel" data-action="assistant-close-plan-step">取消</button><button type="submit" class="v4-sheet-done">添加到计划</button></div></form></section></div>`;
}

function messageDetailSheet(snapshot: H5Snapshot, ui: AssistantUiState): string {
  const message = ui.messageDetailId === null ? undefined : snapshot.assistant.messages.find((item) => item.id === ui.messageDetailId && item.role === "assistant");
  if (message === undefined) return "";
  return `<div class="v4-sheet-backdrop" data-action="assistant-close-message-detail"><section class="v4-mode-sheet v4-message-detail-sheet" role="dialog" aria-modal="true" aria-label="完整整理内容" data-action-stop="true"><span class="v4-sheet-handle"></span><h2>完整整理</h2><article class="v4-message-detail-copy">${escape(message.content).replace(/\n/g, "<br>")}</article><div class="v4-plan-step-actions">${button("复制内容", "assistant-copy-message", "v4-sheet-done v4-sheet-cancel", `data-message-id="${escape(message.id)}"`)}${button("完成", "assistant-close-message-detail", "v4-sheet-done")}</div></section></div>`;
}

function planFormatSheet(snapshot: H5Snapshot, ui: AssistantUiState): string {
  const taskValue = task(snapshot, ui.taskId);
  if (taskValue === undefined) return "";
  const selected = taskValue.deliveryMode ?? "docx";
  const options = [
    { id: "docx", title: "Word 文档", detail: "生成可下载的 .docx 文件" },
    { id: "content", title: "仅保留可编辑内容", detail: "在助手中预览和继续修改，不生成文件" },
  ] as const;
  return `<div class="v4-sheet-backdrop" data-action="assistant-close-plan-format"><section class="v4-mode-sheet v4-plan-format-sheet" role="dialog" aria-modal="true" aria-label="选择交付格式" data-action-stop="true"><span class="v4-sheet-handle"></span><h2>选择交付格式</h2><p>选择后会更新任务计划；选择 Word 时，生成文件前仍会再次请你确认。</p><div class="v4-mode-list">${options.map((option) => button(`<span class="v4-round-icon ${option.id === "docx" ? "blue" : "green"}">${icon(option.id === "docx" ? "file-text" : "check", "")}</span><span><strong>${option.title}</strong><small>${option.detail}</small></span><span class="v4-radio ${selected === option.id ? "selected" : ""}"></span>`, "assistant-select-plan-format", `v4-mode-option ${selected === option.id ? "selected" : ""}`, `data-task-id="${escape(taskValue.id)}" data-delivery-mode="${option.id}" aria-pressed="${selected === option.id}" ${taskValue.status === "draft" || taskValue.status === "ready" ? "" : "disabled"}`)).join("")}</div>${button("完成", "assistant-close-plan-format", "v4-sheet-done v4-sheet-cancel")}</section></div>`;
}

function planLocationSheet(snapshot: H5Snapshot, ui: AssistantUiState): string {
  const taskValue = task(snapshot, ui.taskId);
  if (taskValue === undefined) return "";
  return `<div class="v4-sheet-backdrop" data-action="assistant-close-plan-location"><section class="v4-mode-sheet v4-plan-location-sheet" role="dialog" aria-modal="true" aria-label="选择交付位置" data-action-stop="true"><span class="v4-sheet-handle"></span><h2>交付位置</h2><p>当前只支持保存在本地体验空间；电脑和云盘尚未连接。</p><article class="v4-location-option current"><span class="v4-round-icon blue">${icon("file-text", "")}</span><span><strong>本地体验空间</strong><small>在此空间保存，可从结果页打开或下载</small></span><b>当前</b></article><article class="v4-location-option unavailable"><span class="v4-round-icon green">${icon("external-link", "")}</span><span><strong>个人电脑或云盘</strong><small>连接能力尚未接入，暂时不可选择</small></span></article>${button("完成", "assistant-close-plan-location", "v4-sheet-done")}</section></div>`;
}

function assistantOverlays(snapshot: H5Snapshot, ui: AssistantUiState): string {
  const content = `${ui.modeSheetOpen ? modeSheet(ui) : ""}${ui.snoozeSuggestionId === null ? "" : snoozeSheet(snapshot, ui)}${ui.addContentSheetOpen ? addContentSheet() : ""}${ui.planStepSheetOpen ? planStepSheet(ui) : ""}${ui.planFormatSheetOpen ? planFormatSheet(snapshot, ui) : ""}${ui.planLocationSheetOpen ? planLocationSheet(snapshot, ui) : ""}${ui.messageDetailId === null ? "" : messageDetailSheet(snapshot, ui)}${ui.dismissedSuggestionId === null ? "" : `<aside class="v4-undo-toast" role="status"><span>已忽略这条建议</span>${button("撤销", "assistant-undo-dismiss", "v4-undo-button", `data-suggestion-id="${escape(ui.dismissedSuggestionId)}"`)}</aside>`}`;
  return content.length === 0 ? "" : `<div class="assistant-v4 v4-overlay-root">${content}</div>`;
}

function chat(snapshot: H5Snapshot, ui: AssistantUiState): string {
  const selected = session(snapshot, ui.sessionId);
  if (selected === undefined) return `<section class="assistant-v4">${topHeader("智能对话", "assistant-back-home")}<div class="v4-empty"><h2>从一句话开始</h2><p>输入你的问题，助手会按已选择的模式判断下一步。</p></div>${composer(ui)}</section>`;
  const messages: AssistantMessage[] = snapshot.assistant.messages.filter((item) => item.sessionId === selected.id);
  const taskValue = snapshot.assistant.tasks.find((item) => item.sessionId === selected.id);
  return `<section class="assistant-v4 v4-chat" data-assistant-screen="chat">${topHeader("智能对话", "assistant-back-home")}<article class="v4-chat-context"><div><strong>${escape(selected.title)}</strong><small>${selected.mode === "task" ? "任务模式 · 会在关键步骤征求确认" : "本地整理模式 · 不调用外部工具"}</small></div><span class="v4-chat-mode">${selected.mode === "task" ? "任务" : "问答"}${icon("chevron-right", "tiny")}</span></article><div class="v4-message-list">${messages.map((message) => `<article class="v4-message ${message.role === "user" ? "user" : "assistant"}">${message.role !== "user" ? `<span class="v4-message-mark">${icon("sparkles", "tiny")}</span>` : ""}<div class="v4-message-bubble">${escape(message.content).replace(/\n/g, "<br>")}${message.role === "assistant" && selected.mode === "chat" ? `<div class="v4-message-actions">${button("查看完整整理", "assistant-open-message-detail", "v4-message-action", `data-message-id="${escape(message.id)}"`)}${button("保存为记忆", "assistant-save-message-memory", "v4-message-action", `data-message-id="${escape(message.id)}"`)}</div>` : ""}</div>${message.role === "user" ? `<span class="v4-me">我</span>` : ""}</article>`).join("")}</div>${taskValue === undefined && selected.mode !== "task" ? `<article class="v4-upgrade-banner"><span class="v4-round-icon peach">${icon("sparkles", "")}</span><div><strong>需要文件或持续处理？</strong><p>升级为任务后，会保留本次对话和已选依据。</p></div>${button("升级", "assistant-open-upgrade", "v4-text-action", `data-session-id="${escape(selected.id)}"`)}</article>` : taskValue === undefined ? "" : `<article class="v4-open-task-banner">${icon("briefcase", "small")}<span>任务已创建，正在等待你开始。</span>${button("查看", "assistant-open-task", "v4-text-action", `data-task-id="${escape(taskValue.id)}"`)}</article>`}${composer(ui)}</section>`;
}

function upgrade(snapshot: H5Snapshot, ui: AssistantUiState): string {
  const selected = session(snapshot, ui.sessionId);
  const selectedTask = task(snapshot, ui.taskId);
  const subject = matter(snapshot, selected?.contextId ?? selectedTask?.contextId ?? null);
  const sessionId = selected?.id ?? "";
  const contextId = subject?.id ?? "";
  const messageCount = selected === undefined ? 0 : snapshot.assistant.messages.filter((message) => message.sessionId === selected.id).length;
  const recordCount = subject === undefined ? 0 : snapshot.records.filter((record) => record.contextId === subject.id && record.state === "active").length;
  return `<section class="assistant-v4 v4-upgrade" data-assistant-screen="upgrade">${topHeader("升级为任务", "assistant-back-chat")}<div class="v4-upgrade-title"><h2>这件事需要进入任务模式</h2><p>我会保留当前对话和背景，不需要你重新说明。</p></div><article class="v4-plan-card"><div class="v4-plan-heading"><span class="v4-round-icon peach">${icon("arrow-right", "")}</span><div><h2>${escape(subject?.title ?? selected?.title ?? "准备一份可交付内容")}</h2><p>我会在关键操作前向你确认。</p></div></div><ol class="v4-plan-list"><li><b>1</b><span><strong>整理当前背景</strong><small>核对已有记录和对话上下文</small></span></li><li><b>2</b><span><strong>生成汇报结构</strong><small>写清进展、变化和待确认项</small></span></li><li><b>3</b><span><strong>确认交付格式</strong><small>当前支持 Word 或仅保留可编辑内容</small></span></li></ol><div class="v4-executor-note">执行方式：本地准备服务 · 不调用外部账号或电脑</div>${selectedTask === undefined ? button(`开始执行 ${icon("arrow-right", "")}`, "assistant-upgrade-confirm", "v4-primary-cta", `data-session-id="${escape(sessionId)}" data-context-id="${escape(contextId)}" ${sessionId === "" ? "disabled" : ""}`) : button(`查看任务 ${icon("arrow-right", "")}`, "assistant-open-task", "v4-primary-cta", `data-task-id="${escape(selectedTask.id)}"`)}</article><section class="v4-upgrade-sources"><h2>将使用的内容</h2><article class="v4-upgrade-source-row"><span class="v4-round-icon blue">${icon("book-open", "")}</span><div><strong>当前对话</strong><small>${messageCount} 条消息会随任务保留</small></div>${icon("chevron-right", "small")}</article><article class="v4-upgrade-source-row"><span class="v4-round-icon yellow">${icon("layers", "")}</span><div><strong>关联记录</strong><small>${recordCount} 条当前事项记录，不跨事项引用</small></div>${icon("chevron-right", "small")}</article></section><p class="v4-under-note">只在这个任务内处理，不会自动发送、提交或同步到外部服务。</p>${composer(ui)}</section>`;
}

function taskPlan(snapshot: H5Snapshot, ui: AssistantUiState, taskValue: AssistantTask): string {
  const subject = matter(snapshot, taskValue.contextId);
  const steps = taskSteps(snapshot, taskValue.id);
  const includedEvidenceCount = taskEvidence(snapshot, taskValue.id).filter((item) => item.included).length;
  const requestedOutcome = taskValue.goal.trim();
  const dialogueRequest = requestedOutcome.length > 56 ? `${requestedOutcome.slice(0, 53)}…` : requestedOutcome;
  const contextTitle = subject?.title ?? "当前任务";
  const deliverableTitle = contextTitle.length > 18 ? "任务汇报结构" : `${contextTitle}汇报结构`;
  const requirementSummary = taskValue.requirements.length === 0 ? "" : `<article class="v4-requirement-note"><h2>已纳入的要求</h2>${taskValue.requirements.map((requirement) => `<p>${icon("check", "tiny")}<span>${escape(requirement)}</span></p>`).join("")}</article>`;
  const startAction = taskValue.status === "paused"
    ? button("继续处理", "assistant-task-action", "v4-primary-cta", `data-task-id="${escape(taskValue.id)}" data-task-action="resume"`)
    : button(`开始准备 ${icon("arrow-right", "")}`, "assistant-start-task", "v4-primary-cta", `data-task-id="${escape(taskValue.id)}"`);
  return `<section class="assistant-v4 v4-task-plan" data-assistant-screen="task">${topHeader("助手", "assistant-back-home", "assistant-settings")}<article class="v4-task-top-card"><div class="v4-card-heading"><span class="v4-round-icon blue">${icon("file-text", "")}</span><div><h2>${escape(subject?.title ?? taskValue.goal)}</h2><p>${escape(taskStatus(taskValue))} · ${escape(taskValue.executor === "local-preparation-service" ? "本地准备服务" : "外部工具尚未接入")}</p></div>${button(icon("x", "tiny"), "assistant-task-action", "v4-card-close", `data-task-id="${escape(taskValue.id)}" data-task-action="cancel" aria-label="取消任务"`)}</div></article><div class="v4-task-dialogue"><article class="v4-system-message"><span class="v4-message-mark">${icon("sparkles", "tiny")}</span><p>我找到了与这件事相关的记录。你希望先整理成什么形式？</p></article><article class="v4-user-message">${escape(dialogueRequest)}<span>我</span></article><article class="v4-system-message"><span class="v4-message-mark">${icon("sparkles", "tiny")}</span><p>明白。我会使用${includedEvidenceCount}条已纳入依据准备结构，并在生成文件前让你确认。</p></article></div>${requirementSummary}<article class="v4-plan-card compact"><div class="v4-plan-heading"><span class="v4-round-icon yellow">${icon("lightbulb", "")}</span><div><h2>即将生成：${escape(deliverableTitle)}</h2><p>使用${includedEvidenceCount}条已纳入依据</p></div>${button("修改", "assistant-open-plan-edit", "v4-text-action", `data-task-id="${escape(taskValue.id)}" aria-label="修改任务计划"`)}</div><ol class="v4-plan-list">${steps.map((step, index) => `<li><b>${index + 1}</b><span><strong>${escape(step.title)}</strong><small>${escape(step.detail)}</small></span></li>`).join("")}</ol>${startAction}</article>${composer(ui, taskValue.id)}</section>`;
}

function planEdit(snapshot: H5Snapshot, taskValue: AssistantTask): string {
  const steps = taskSteps(snapshot, taskValue.id);
  const active = taskValue.status === "draft" || taskValue.status === "ready";
  const customSteps = taskValue.requirements.map((requirement) => {
    const prefix = "补充执行步骤：";
    if (!requirement.startsWith(prefix)) return null;
    const [title, ...detail] = requirement.slice(prefix.length).split("\n");
    return { title: title ?? "补充步骤", detail: detail.join("\n") };
  }).filter((step): step is { title: string; detail: string } => step !== null);
  const otherRequirements = taskValue.requirements.filter((requirement) => !requirement.startsWith("补充执行步骤："));
  const deliveryLabel = taskValue.deliveryMode === "content" ? "仅保留可编辑内容" : "Word";
  const start = taskValue.status === "paused"
    ? button("继续执行", "assistant-task-action", "v4-primary-cta", `data-task-id="${escape(taskValue.id)}" data-task-action="resume"`)
    : button("保存并开始执行", "assistant-start-task", "v4-primary-cta", `data-task-id="${escape(taskValue.id)}" ${active ? "" : "disabled"}`);
  const requirementCards = [
    ...customSteps.map((step) => `<div class="v4-edit-step v4-added-step"><b>+</b><span><strong>${escape(step.title)}</strong><small>${escape(step.detail)}</small></span></div>`),
    ...otherRequirements.map((requirement, index) => `<div class="v4-edit-step v4-added-step"><b>+</b><span><strong>补充要求 ${index + 1}</strong><small>${escape(requirement)}</small></span></div>`),
  ].join("");
  return `<section class="assistant-v4 v4-plan-edit" data-assistant-screen="plan-edit">${topHeader("修改任务计划", "assistant-back-task")}<div class="v4-plan-edit-title"><h2>确认后再开始</h2><p>你可以调整步骤、输出格式和交付位置；尚未连接的电脑或云盘不会被自动操作。</p></div><section class="v4-plan-edit-section"><h2>执行步骤</h2><article class="v4-edit-step-card">${steps.map((step, index) => `<div class="v4-edit-step"><b>${index + 1}</b><span><strong>${escape(step.title)}</strong><small>${escape(step.detail)}</small></span>${icon("more-horizontal", "small")}</div>`).join("")}${requirementCards}${button("+ 添加步骤", "assistant-add-plan-step", "v4-add-step", `data-task-id="${escape(taskValue.id)}" aria-haspopup="dialog"`)}</article></section><section class="v4-plan-edit-section"><h2>输出与交付</h2><article class="v4-edit-delivery"><div><span>格式</span><strong>${escape(deliveryLabel)}</strong>${button("修改", "assistant-open-plan-format", "v4-text-action", `data-task-id="${escape(taskValue.id)}" aria-haspopup="dialog" ${active ? "" : "disabled"}`)}</div><div><span>位置</span><strong>当前本地体验空间</strong>${button("修改", "assistant-open-plan-location", "v4-text-action", `data-task-id="${escape(taskValue.id)}" aria-haspopup="dialog"`)}</div></article></section><article class="v4-plan-edit-note">补充步骤会影响本地整理结果；电脑、日历和云盘等外部操作尚未接入。</article>${start}${button("取消任务", "assistant-task-action", "v4-muted-button v4-plan-cancel", `data-task-id="${escape(taskValue.id)}" data-task-action="cancel"`)}</section>`;
}

function pausedTask(snapshot: H5Snapshot, ui: AssistantUiState, taskValue: AssistantTask): string {
  const subject = matter(snapshot, taskValue.contextId);
  const steps = taskSteps(snapshot, taskValue.id);
  const completed = steps.filter((step) => step.status === "completed").length;
  const evidenceCount = taskEvidence(snapshot, taskValue.id).filter((item) => item.included).length;
  const current = steps[taskValue.currentStep];
  return `<section class="assistant-v4 v4-task-paused" data-assistant-screen="task">${topHeader("任务已暂停", "assistant-back-home")}<div class="v4-paused-symbol">${icon("clock", "")}</div><div class="v4-paused-title"><h2>已暂停${escape(current?.title ?? "当前任务")}</h2><p>已经完成的内容会保留；继续后从当前检查点开始。</p></div><article class="v4-paused-card"><div class="v4-paused-card-head"><strong>${escape(subject?.title ?? taskValue.goal)}</strong><b>已暂停</b></div><div class="v4-progress-line"><i style="width:${taskValue.progress}%"></i></div><dl><div><dt>已完成</dt><dd>${completed} / ${steps.length}</dd></div><div><dt>当前检查点</dt><dd>${escape(current?.title ?? "等待继续")}</dd></div><div><dt>已保留</dt><dd>${evidenceCount} 条依据${taskValue.requirements.length > 0 ? ` · ${taskValue.requirements.length} 条要求` : ""}</dd></div></dl>${button("继续执行", "assistant-task-action", "v4-primary-cta", `data-task-id="${escape(taskValue.id)}" data-task-action="resume"`)}</article><div class="v4-dual-actions">${button("返回沟通", "assistant-back-chat", "v4-muted-button")}${button("取消任务", "assistant-task-action", "v4-outline-button", `data-task-id="${escape(taskValue.id)}" data-task-action="cancel"`)}</div><article class="v4-background-note">关闭页面后，任务会保持暂停；本地服务重新运行后可以从这个检查点继续。</article>${composer(ui, taskValue.id)}</section>`;
}

function runningTask(snapshot: H5Snapshot, ui: AssistantUiState, taskValue: AssistantTask): string {
  const subject = matter(snapshot, taskValue.contextId);
  const steps = taskSteps(snapshot, taskValue.id);
  const activeStep = steps[taskValue.currentStep];
  const requirementCard = taskValue.requirements.length === 0 ? "" : `<article class="v4-incoming-request"><h2>处理中收到的新要求</h2>${taskValue.requirements.map((requirement) => `<p>${icon("check", "tiny")}<span>${escape(requirement)}</span><b>已纳入</b></p>`).join("")}</article>`;
  return `<section class="assistant-v4 v4-task-running" data-assistant-screen="task">${topHeader("任务执行中", "assistant-back-home")}<article class="v4-progress-card"><div><h2>${escape(subject?.title ?? taskValue.goal)}</h2><p>${taskValue.executor === "local-preparation-service" ? "本地内容准备服务" : "未接入的外部工具"}</p></div><span class="v4-status-badge">${escape(taskStatus(taskValue))}</span><div class="v4-progress-words"><strong>${taskValue.currentStep + 1} / ${steps.length}</strong><span>${taskEtaLabel(taskValue)}</span></div><div class="v4-progress-line"><i style="width:${taskValue.progress}%"></i></div></article><ol class="v4-execution-timeline">${steps.map((step, index) => `<li class="${step.status}"><span class="v4-step-dot">${step.status === "completed" ? icon("check", "tiny") : step.status === "running" ? "…" : index + 1}</span><div><h2>${escape(step.title)}</h2><p>${escape(step.status === "running" ? step.detail : step.status === "completed" ? "已完成" : step.detail)}</p></div></li>`).join("")}</ol>${activeStep?.status === "running" ? requirementCard : ""}<div class="v4-dual-actions">${button(`${icon("clock", "small")}暂停处理`, "assistant-task-action", "v4-muted-button", `data-task-id="${escape(taskValue.id)}" data-task-action="pause"`)}${button("返回沟通", "assistant-back-chat", "v4-outline-button")}</div>${composer(ui, taskValue.id)}</section>`;
}

function inputTask(snapshot: H5Snapshot, ui: AssistantUiState, taskValue: AssistantTask): string {
  const request = openInput(snapshot, taskValue.id);
  if (request === undefined) return runningTask(snapshot, ui, taskValue);
  return `<section class="assistant-v4 v4-input-task" data-assistant-screen="input">${topHeader("需要你的信息", "assistant-back-home")}<div class="v4-input-title"><h2>还差一个信息，我才能继续</h2><p>${escape(request.detail)}</p></div><article class="v4-option-card"><h2>${escape(request.question)}</h2>${request.options.map((option) => button(`<span class="v4-option-radio ${ui.selectedOptionId === option.id ? "selected" : ""}"></span><span><strong>${escape(option.label)}${option.recommended ? " <em>推荐</em>" : ""}</strong><small>${escape(option.detail)}</small></span>`, "assistant-select-option", `v4-select-option ${ui.selectedOptionId === option.id ? "selected" : ""}`, `data-option-id="${escape(option.id)}" data-task-id="${escape(taskValue.id)}"`)).join("")}${button("确认并继续", "assistant-submit-option", "v4-primary-cta", `data-task-id="${escape(taskValue.id)}" data-input-request-id="${escape(request.id)}" ${ui.selectedOptionId === null ? "disabled" : ""}`)}</article><p class="v4-under-note">为什么需要确认：交付格式会影响后续步骤；当前未接入的格式不会被伪装成已生成。</p>${button("稍后处理", "assistant-task-action", "v4-text-action v4-later-action", `data-task-id="${escape(taskValue.id)}" data-task-action="pause"`)}${composer(ui, taskValue.id)}</section>`;
}

function confirmTask(snapshot: H5Snapshot, ui: AssistantUiState, taskValue: AssistantTask): string {
  const confirmation = pendingConfirmation(snapshot, taskValue.id);
  if (confirmation === undefined) return runningTask(snapshot, ui, taskValue);
  const artifact = confirmation.artifactId === null ? undefined : snapshot.artifacts.find((item) => item.id === confirmation.artifactId && item.version === confirmation.artifactVersion);
  return `<section class="assistant-v4 v4-confirm-task" data-assistant-screen="confirmation">${topHeader("确认操作", "assistant-back-home")}<div class="v4-confirm-title"><span class="v4-round-icon peach">${icon("check", "")}</span><div><h2>执行前，请确认以下内容</h2><p>确认后将生成文件；不会发送给其他人。</p></div></div><article class="v4-confirm-card"><h2>即将执行</h2><div class="v4-confirm-row"><span class="v4-round-icon blue">${icon("file-text", "")}</span><div><strong>${escape(confirmation.title)}</strong><small>${escape(confirmation.detail)}</small></div>${button("查看", "assistant-open-preview", "v4-text-action", `data-task-id="${escape(taskValue.id)}"`)}</div><div class="v4-confirm-row"><span class="v4-round-icon yellow">${icon("clock", "")}</span><div><strong>文件范围</strong><small>${escape(artifact?.title ?? "当前任务生成的最新内容")} · Word 文档</small></div></div></article><article class="v4-confirm-card v4-confirm-tools"><h2>使用的权限</h2><div><span>${icon("file-text", "tiny")}本地文件生成</span><b>已允许</b></div><div><span>${icon("download", "tiny")}浏览器下载</span><b>由你触发</b></div></article><article class="v4-wont-do"><h2>不会执行</h2><p>不会发送邮件、创建日历、登录外部账号、处理付款或验证码。</p></article><label class="v4-read-confirm"><input type="checkbox" data-assistant-field="confirmation-read" ${ui.confirmationRead ? "checked" : ""}>我已核对内容和文件范围</label><div class="v4-dual-actions">${button("返回修改", "assistant-reject-confirmation", "v4-muted-button", `data-task-id="${escape(taskValue.id)}" data-confirmation-id="${escape(confirmation.id)}"`)}${button("确认并执行", "assistant-approve-confirmation", "v4-primary-cta", `data-task-id="${escape(taskValue.id)}" data-confirmation-id="${escape(confirmation.id)}" ${ui.confirmationRead ? "" : "disabled aria-disabled=\"true\""}`)}</div></section>`;
}

function result(snapshot: H5Snapshot, ui: AssistantUiState, taskValue: AssistantTask): string {
  const artifact = taskValue.artifactId === null ? undefined : snapshot.artifacts.filter((item) => item.id === taskValue.artifactId).sort((left, right) => right.version - left.version)[0];
  const receipt = taskValue.exportOperationId === null ? undefined : snapshot.exports.find((item) => item.operationId === taskValue.exportOperationId);
  const previewAction = artifact === undefined
    ? ""
    : button(icon("chevron-right", ""), "assistant-open-preview", "v4-row-arrow", `data-task-id="${escape(taskValue.id)}" aria-label="查看文件预览"`);
  const primaryAction = artifact === undefined
    ? ""
    : button("查看文件预览", "assistant-open-preview", "v4-primary-cta", `data-task-id="${escape(taskValue.id)}"`);
  const editAction = artifact === undefined
    ? ""
    : button("继续修改", "assistant-open-artifact", "v4-outline-button", `data-artifact-id="${escape(artifact.id)}"`);
  const downloadAction = receipt === undefined
    ? ""
    : `<a class="v4-muted-button v4-link-button" href="${escape(receipt.downloadUrl)}" download="${escape(receipt.filename)}">${icon("download", "small")}下载 Word</a>`;
  return `<section class="assistant-v4 v4-result" data-assistant-screen="result">${topHeader("任务完成", "assistant-back-home")}<div class="v4-result-symbol">${icon("check", "")}</div><div class="v4-result-title"><h2>${escape(artifact?.title ?? "任务结果已准备完成")}</h2><p>${receipt === undefined ? "内容已保存，可继续修改或从结果中导出。" : "文件已生成并完成核对。"}</p></div><article class="v4-result-file"><span class="v4-round-icon green">${icon("file-text", "")}</span><div><strong>${escape(receipt?.filename ?? artifact?.title ?? "可编辑汇报内容")}</strong><small>${receipt === undefined ? "可编辑内容" : `Word · ${receipt.byteLength.toLocaleString()} 字节`}</small></div>${previewAction}</article><dl class="v4-result-meta"><div><dt>保存位置</dt><dd>当前本地体验空间</dd></div><div><dt>同步状态</dt><dd>未连接电脑或云盘</dd></div><div><dt>使用依据</dt><dd>${taskEvidence(snapshot, taskValue.id).filter((item) => item.included).length} 条已纳入记录</dd></div></dl>${primaryAction}<div class="v4-dual-actions">${downloadAction}${button("分享", "assistant-share-result", "v4-muted-button", `data-task-id="${escape(taskValue.id)}"`)}${editAction}</div><section class="v4-result-next"><h2>可以继续</h2>${button(`${icon("sparkles", "tiny")}生成一页汇报摘要${icon("chevron-right", "tiny")}`, "assistant-use-prompt", "v4-next-row", "data-prompt=\"生成一页汇报摘要\"")}${button(`${icon("briefcase", "tiny")}创建后续任务${icon("chevron-right", "tiny")}`, "assistant-use-prompt", "v4-next-row", "data-prompt=\"创建后续任务\"")}</section>${composer(ui)}</section>`;
}

function preview(snapshot: H5Snapshot, taskValue: AssistantTask): string {
  const artifact = taskValue.artifactId === null ? undefined : snapshot.artifacts.filter((item) => item.id === taskValue.artifactId).sort((left, right) => right.version - left.version)[0];
  if (artifact === undefined) return result(snapshot, initialAssistantUiState(), taskValue);
  const receipt = taskValue.exportOperationId === null ? undefined : snapshot.exports.find((item) => item.operationId === taskValue.exportOperationId);
  const documentSections = artifact.sections.map((section) => `<section class="v4-preview-section"><h3>${escape(section.title)}</h3>${section.blocks.map((block) => `<p>${escape(block.text).replace(/\r?\n/g, "<br>")}</p>`).join("")}</section>`).join("");
  const downloadAction = receipt === undefined
    ? ""
    : `<a class="v4-muted-button v4-link-button" href="${escape(receipt.downloadUrl)}" download="${escape(receipt.filename)}">${icon("download", "small")}下载 Word</a>`;
  const backAction = taskValue.status === "waiting_confirmation" ? "assistant-back-task" : "assistant-back-result";
  return `<section class="assistant-v4 v4-preview" data-assistant-screen="preview">${topHeader("文件预览", backAction)}<article class="v4-preview-file-head"><span class="v4-round-icon blue">${icon("file-text", "")}</span><div><h2>${escape(receipt?.filename ?? artifact.title)}</h2><p>本地可编辑内容 · 版本 ${artifact.version}${receipt === undefined ? "" : ` · ${receipt.byteLength.toLocaleString()} 字节`}</p></div></article><article class="v4-preview-sheet" aria-label="${escape(artifact.title)} 内容预览"><header><span>Mixture X</span><small>任务结果</small></header><h1>${escape(artifact.title)}</h1><div class="v4-preview-body">${documentSections}</div></article><p class="v4-under-note">这是当前本地生成内容的轻量预览；不会同步到电脑、云盘或外部账号。</p><div class="v4-dual-actions">${downloadAction}${button("继续修改", "assistant-open-artifact", "v4-outline-button", `data-artifact-id="${escape(artifact.id)}"`)}</div></section>`;
}

function failure(snapshot: H5Snapshot, ui: AssistantUiState, taskValue: AssistantTask): string {
  const steps = taskSteps(snapshot, taskValue.id);
  return `<section class="assistant-v4 v4-failure" data-assistant-screen="failure">${topHeader("任务遇到问题", "assistant-back-home")}<div class="v4-failure-symbol">${icon("alert-circle", "")}</div><div class="v4-result-title"><h2>${escape(taskValue.errorCode === null ? "任务暂时无法继续" : taskValue.errorCode)}</h2><p>已完成的步骤会保留；恢复时不会自动重复它们。</p></div><article class="v4-failure-card"><h2>受影响的步骤</h2>${steps.map((step) => `<div><span class="${step.status === "completed" ? "done" : "failed"}">${icon(step.status === "completed" ? "check" : "alert-circle", "tiny")}</span><strong>${escape(step.title)}</strong><small>${escape(step.status === "completed" ? "已完成" : step.error ?? "等待重新处理")}</small></div>`).join("")}</article><article class="v4-failure-help"><p>你可以从当前检查点重试；若仍失败，请保留诊断编号并查看本地服务日志。</p><small>诊断编号：${escape(taskValue.errorCode ?? "MX-ASSISTANT-UNKNOWN")}</small></article>${button("稍后自动重试", "assistant-task-action", "v4-primary-cta", `data-task-id="${escape(taskValue.id)}" data-task-action="retry"`)}<div class="v4-dual-actions">${button("查看任务", "assistant-open-task", "v4-muted-button", `data-task-id="${escape(taskValue.id)}"`)}${button("查看依据", "assistant-open-evidence", "v4-outline-button", `data-task-id="${escape(taskValue.id)}"`)}</div>${composer(ui, taskValue.id)}</section>`;
}

function taskDetails(snapshot: H5Snapshot, ui: AssistantUiState, taskValue: AssistantTask): string {
  const subject = matter(snapshot, taskValue.contextId);
  const steps = taskSteps(snapshot, taskValue.id);
  const completedSteps = steps.filter((step) => step.status === "completed").length;
  const activeStep = steps.find((step) => step.status === "running" || step.status === "waiting");
  const progress = Math.max(0, Math.min(100, taskValue.progress));
  const evidenceCount = taskEvidence(snapshot, taskValue.id).filter((item) => item.included).length;
  const currentTitle = taskValue.status === "running" ? activeStep?.title ?? "正在处理" : taskStatus(taskValue);
  const currentDetail = taskValue.status === "running"
    ? activeStep?.detail ?? "正在按已选依据处理"
    : taskValue.status === "waiting_input" ? "任务已暂停，等待你补充一个关键信息。"
      : taskValue.status === "waiting_confirmation" ? "内容已准备好，等待你确认文件生成。"
        : taskValue.status === "paused" ? "已停在安全检查点，可继续处理。"
          : taskValue.status === "completed" ? "任务结果已保存，可打开或继续修改。"
            : taskValue.status === "failed" ? "需要从可恢复检查点重新处理。"
              : "计划已创建，开始后会持续显示真实步骤。";
  const nextScreen: AssistantScreen = taskValue.status === "completed" ? "result" : taskValue.status === "failed" ? "failure" : "task";
  const actionLabel = taskValue.status === "completed" ? "查看结果" : taskValue.status === "failed" ? "查看问题" : taskValue.status === "running" ? "返回执行" : "继续处理";
  const taskComposer = taskValue.status === "completed" || taskValue.status === "cancelled" ? composer(ui) : composer(ui, taskValue.id);
  return `<section class="assistant-v4 v4-task-details" data-assistant-screen="details">${topHeader("任务详情", "assistant-back-home")}<article class="v4-task-detail-top"><span class="v4-round-icon blue">${icon("file-text", "")}</span><div><h2>${escape(subject?.title ?? taskValue.goal)}</h2><p>${escape(taskStatus(taskValue))} · ${new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(taskValue.createdAt))} 创建</p></div><b>${progress}%</b></article><section class="v4-detail-section"><h2>当前状态</h2><article class="v4-detail-status"><div><strong>${escape(currentTitle)}</strong><small>${escape(currentDetail)}</small></div>${taskValue.status === "running" ? `<span>${taskEtaLabel(taskValue)}</span>` : ""}<i><em style="width:${progress}%"></em></i></article></section><section class="v4-detail-section"><h2>任务目标</h2><article class="v4-detail-copy">${escape(taskValue.goal)}</article></section><section class="v4-detail-section"><h2>执行信息</h2><article class="v4-detail-info"><dl><div><dt>执行方式</dt><dd>${escape(taskValue.executor === "local-preparation-service" ? "本地准备服务" : "未接入的外部工具")}</dd></div><div><dt>使用依据</dt><dd>${evidenceCount} 条已纳入记录</dd></div><div><dt>补充要求</dt><dd>${taskValue.requirements.length} 条已纳入</dd></div><div><dt>交付位置</dt><dd>当前本地体验空间</dd></div><div><dt>同步状态</dt><dd>未连接电脑或云盘</dd></div></dl></article></section><section class="v4-detail-section"><h2>过程</h2><article class="v4-detail-process"><ol>${steps.map((step, index) => `<li class="${step.status}"><span>${step.status === "completed" ? icon("check", "tiny") : step.status === "running" ? "…" : index + 1}</span><div><strong>${escape(step.title)}</strong><small>${escape(step.status === "completed" ? "已完成" : step.detail)}</small></div></li>`).join("")}</ol><small>${completedSteps} / ${steps.length} 个步骤已完成</small></article></section>${button(actionLabel, "assistant-open-task", "v4-primary-cta", `data-task-id="${escape(taskValue.id)}" data-task-screen="${nextScreen}"`)}<div class="v4-dual-actions">${taskValue.status === "running" ? button("暂停处理", "assistant-task-action", "v4-muted-button", `data-task-id="${escape(taskValue.id)}" data-task-action="pause"`) : button("查看依据", "assistant-open-evidence", "v4-muted-button", `data-task-id="${escape(taskValue.id)}"`)}${button("返回沟通", "assistant-back-chat", "v4-outline-button")}</div>${taskComposer}</section>`;
}

function taskList(snapshot: H5Snapshot, ui: AssistantUiState): string {
  const active = activeTasks(snapshot);
  const waitingStatuses: AssistantTask["status"][] = ["waiting_input", "waiting_confirmation", "failed"];
  const needsAttention = active.filter((item) => waitingStatuses.includes(item.status));
  const executing = active.filter((item) => item.status === "running");
  const waitingToStart = active.filter((item) => item.status === "draft" || item.status === "ready" || item.status === "paused");
  const shown = ui.taskFilter === "all" ? active : ui.taskFilter === "waiting" ? needsAttention : executing;
  const waiting = shown.filter((item) => waitingStatuses.includes(item.status));
  const running = shown.filter((item) => item.status === "running");
  const deferred = ui.taskFilter === "all" ? waitingToStart : [];
  const filters: { id: AssistantTaskFilter; label: string }[] = [
    { id: "all", label: `全部 ${active.length}` },
    { id: "running", label: `执行中 ${executing.length}` },
    { id: "waiting", label: `等待我 ${needsAttention.length}` },
  ];
  return `<section class="assistant-v4 v4-task-list" data-assistant-screen="tasks">${topHeader("进行中的任务", "assistant-back-home") }<nav class="v4-task-filters">${filters.map((filter) => button(filter.label, "assistant-task-filter", `v4-task-filter ${ui.taskFilter === filter.id ? "active" : ""}`, `data-task-filter="${filter.id}" aria-pressed="${ui.taskFilter === filter.id}"`)).join("")}</nav>${waiting.length > 0 ? `<section class="v4-list-section"><h2>需要你处理</h2>${waiting.map((item) => compactTaskCard(snapshot, item)).join("")}</section>` : ""}<section class="v4-list-section"><h2>${running.length > 0 ? "正在执行" : "暂无正在执行的任务"}</h2>${running.length > 0 ? running.map((item) => compactTaskCard(snapshot, item)).join("") : `<p class="v4-list-empty">从首页建议或输入框开始一个新任务。</p>`}</section>${deferred.length > 0 ? `<section class="v4-list-section"><h2>待开始或已暂停</h2>${deferred.map((item) => compactTaskCard(snapshot, item)).join("")}</section>` : ""}<article class="v4-background-note">离开页面后，本地服务在保持运行时会继续处理；需要确认时会暂停等待你。</article>${composer(ui)}</section>`;
}

function evidence(snapshot: H5Snapshot, ui: AssistantUiState, taskValue: AssistantTask): string {
  const subject = matter(snapshot, taskValue.contextId);
  const evidenceRows = taskEvidence(snapshot, taskValue.id);
  const editable = taskValue.status !== "completed" && taskValue.status !== "cancelled";
  const sourceRecord = (item: AssistantEvidence) => snapshot.records.find((entry) => entry.id === item.sourceRef);
  const todayEvidence = evidenceRows.filter((item) => { const record = sourceRecord(item); return record !== undefined && isSameDay(record.recordedAt, snapshot.now); });
  const relatedMemory = evidenceRows.filter((item) => !todayEvidence.some((today) => today.id === item.id));
  const renderRows = (items: AssistantEvidence[], showTime: boolean): string => items.length === 0
    ? `<article class="v4-evidence-empty">${showTime ? "当前没有可纳入的当天讨论。" : "当前没有额外的历史记忆；不会跨事项补充来源。"}</article>`
    : items.map((item) => {
      const record = sourceRecord(item);
      const marker = showTime && record !== undefined
        ? `<time class="v4-evidence-time" datetime="${escape(record.recordedAt)}">${formatTime(record.recordedAt)}</time>`
        : `<span class="v4-evidence-memory-mark">${icon("layers", "tiny")}</span>`;
      return `<article class="v4-evidence-row ${item.included ? "included" : "excluded"}">${marker}<div><strong>${escape(record?.title ?? "来源记录")}</strong><p>${escape(item.summary)}</p><small>修订 ${item.sourceRevision} · ${item.included ? "已纳入" : "已排除"}</small></div>${editable ? button(item.included ? "排除" : "纳入", "assistant-toggle-evidence", "v4-text-action", `data-evidence-id="${escape(item.id)}" data-included="${String(!item.included)}"`) : "<span class=\"v4-evidence-locked\">已固定</span>"}</article>`;
    }).join("");
  const taskComposer = editable ? composer(ui, taskValue.id) : composer(ui);
  return `<section class="assistant-v4 v4-evidence" data-assistant-screen="evidence">${topHeader("执行依据", "assistant-back-home")}<div class="v4-evidence-title"><h2>为什么建议${escape(subject?.title ?? "这个任务")}</h2><p>${editable ? "修改纳入范围会让未完成步骤重新核对。" : "任务已结束，成果保留了当时的依据快照。"}</p></div><article class="v4-judgement-card"><h2>判断摘要</h2><p>${escape(subject?.goal ?? taskValue.goal)}</p></article><section class="v4-evidence-group"><h2>今天的讨论 ${todayEvidence.length} 条</h2>${renderRows(todayEvidence, true)}</section><section class="v4-evidence-group"><h2>相关记忆 ${relatedMemory.length} 条</h2>${renderRows(relatedMemory, false)}</section><p class="v4-under-note">来源数量、同步状态和处理结论均来自当前数据；排除一条依据会重新核对尚未完成的步骤。</p>${taskComposer}</section>`;
}

function permissions(ui: AssistantUiState): string {
  type PermissionState = "available" | "unavailable" | "connect";
  type PermissionRow = { icon: string; color: string; title: string; text: string; state: PermissionState };
  const contentRows: PermissionRow[] = [
    { icon: "calendar", color: "blue", title: "日历", text: "尚未接入，不会读取或修改日程", state: "unavailable" },
    { icon: "clock", color: "yellow", title: "通知", text: "尚未接入，不能创建系统提醒", state: "unavailable" },
    { icon: "file-text", color: "green", title: "云盘", text: "尚未接入，文件不会同步到外部空间", state: "unavailable" },
  ];
  const executionRows: PermissionRow[] = [
    { icon: "briefcase", color: "green", title: "本地准备服务", text: "可生成 Word，导出前仍须逐次确认", state: "available" },
    { icon: "user", color: "peach", title: "电脑远程工具", text: "尚未连接", state: "connect" },
    { icon: "layers", color: "blue", title: "系统自动化", text: "尚未连接", state: "connect" },
  ];
  const control = (row: PermissionRow): string => row.state === "connect"
    ? button("连接", "assistant-capability-unavailable", "v4-connect-capability", `data-capability="${escape(row.title)}"`)
    : `<input class="v4-permission-switch" type="checkbox" role="switch" aria-label="${escape(row.title)}${row.state === "available" ? "已可用" : "未接入"}" ${row.state === "available" ? "checked" : ""} disabled>`;
  const renderRow = (row: PermissionRow): string => `<article class="v4-permission-row"><span class="v4-round-icon ${row.color}">${icon(row.icon, "")}</span><div><strong>${row.title}</strong><small>${row.text}</small></div>${control(row)}</article>`;
  return `<section class="assistant-v4 v4-permissions" data-assistant-screen="permissions">${topHeader("工具与权限", "assistant-back-home")}<section class="v4-permission-group"><h2>内容与账户</h2>${contentRows.map(renderRow).join("")}</section><section class="v4-permission-group"><h2>执行能力</h2>${executionRows.map(renderRow).join("")}</section><section class="v4-permission-group"><h2>确认规则</h2><article class="v4-policy-row"><div><strong>创建和修改文件</strong><small>执行前展示精确文件范围</small></div><input class="v4-permission-switch" type="checkbox" role="switch" aria-label="创建和修改文件每次确认" checked disabled></article><article class="v4-policy-row"><div><strong>发送、提交和预订</strong><small>未接入，不能发起外部动作</small></div><input class="v4-permission-switch" type="checkbox" role="switch" aria-label="发送、提交和预订未接入" disabled></article><article class="v4-policy-row warning"><div><strong>付款和验证码</strong><small>必须由你亲自完成</small></div><b>不可关闭</b></article></section><article class="v4-permission-note">关闭或未接入的能力不会删除已经完成的结果；依赖它的后续步骤会保持暂停。</article>${composer(ui)}</section>`;
}

export function assistantView(snapshot: H5Snapshot, ui: AssistantUiState): string {
  const selectedId = selectedTaskId(ui, snapshot);
  const selectedTask = selectedId === null ? undefined : snapshot.assistant.tasks.find((item) => item.id === selectedId);
  let content: string;
  if (ui.screen === "home") content = home(snapshot, ui);
  else if (ui.screen === "chat") content = chat(snapshot, ui);
  else if (ui.screen === "upgrade") content = upgrade(snapshot, ui);
  else if (ui.screen === "plan-edit" && selectedTask !== undefined) content = planEdit(snapshot, selectedTask);
  else if (ui.screen === "tasks") content = taskList(snapshot, ui);
  else if (ui.screen === "details" && selectedTask !== undefined) content = taskDetails(snapshot, ui, selectedTask);
  else if (ui.screen === "evidence" && selectedTask !== undefined) content = evidence(snapshot, ui, selectedTask);
  else if (ui.screen === "permissions") content = permissions(ui);
  else if (ui.screen === "result" && selectedTask !== undefined) content = result(snapshot, ui, selectedTask);
  else if (ui.screen === "preview" && selectedTask !== undefined) content = preview(snapshot, selectedTask);
  else if (ui.screen === "failure" && selectedTask !== undefined) content = failure(snapshot, ui, selectedTask);
  else if (selectedTask === undefined) content = home(snapshot, ui);
  else if (selectedTask.status === "completed") content = result(snapshot, ui, selectedTask);
  else if (selectedTask.status === "failed") content = failure(snapshot, ui, selectedTask);
  else if (selectedTask.status === "waiting_input") content = inputTask(snapshot, ui, selectedTask);
  else if (selectedTask.status === "waiting_confirmation") content = confirmTask(snapshot, ui, selectedTask);
  else if (selectedTask.status === "running") content = runningTask(snapshot, ui, selectedTask);
  else if (selectedTask.status === "paused") content = pausedTask(snapshot, ui, selectedTask);
  else content = taskPlan(snapshot, ui, selectedTask);
  return `${content}${assistantOverlays(snapshot, ui)}`;
}
