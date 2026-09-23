import type { H5Matter, H5Record, H5Snapshot, RecordModule } from "../src/h5-types.ts";

export type TodayModulePage = "home" | "recordings" | "recording" | "summary" | "work" | "life" | "social" | "inspiration";
export type MemoryModulePage = "home" | "search" | "day" | "matter" | "person" | "review" | "detail" | "pending";

export interface ModuleOptions {
  todayPage: TodayModulePage;
  memoryPage: MemoryModulePage;
  recordId: string;
  query: string;
  filter: string;
  group: "date" | "things" | "person";
  pendingFilter: "all" | "identity" | "assignment" | "conflict";
  selectedPending: string[];
  confirmedPending: string[];
  playingRecord: string;
  selectedDay: string;
  selectedMatter: string;
  selectedPerson: string;
  recordSelectionMode: boolean;
  selectedRecordIds: string[];
  ignoredIdeas: string[];
  memoryItemStates: Record<string, string>;
}

const moduleInfo: Record<RecordModule, { title: string; icon: string; tint: string; action: string }> = {
  work: { title: "工作", icon: "briefcase", tint: "blue", action: "today-work" },
  life: { title: "生活", icon: "coffee", tint: "green", action: "today-life" },
  social: { title: "社交", icon: "users", tint: "amber", action: "today-social" },
  inspiration: { title: "灵感", icon: "lightbulb", tint: "purple", action: "today-inspiration" },
};
const esc = (value: string | number): string => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
const ico = (name: string, cls = ""): string => `<img class="icon ${cls}" src="/assets/icons/${name}.svg" alt="" aria-hidden="true" width="22" height="22">`;
const action = (label: string, name: string, attrs = "", cls = "module-button"): string => `<button type="button" class="${cls}" data-action="${name}" ${attrs}>${label}</button>`;
const timeLabel = (value: string): string => new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
const fullDate = (value: string): string => new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date(value));
const dayKey = (value: string): string => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const liveRecords = (snapshot: H5Snapshot): H5Record[] => snapshot.records.filter((record) => record.state === "active").sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
const matterOf = (snapshot: H5Snapshot, record: H5Record): H5Matter | undefined => snapshot.matters.find((item) => item.id === record.contextId);
const recordButton = (record: H5Record, label?: string): string => action(`${ico("file-text", "small")}${esc(label ?? record.title)}${ico("chevron-right", "small")}`, "module-record", `data-id="${esc(record.id)}"`, "mx-source-link");
const section = (title: string, meta: string, body: string, cls = ""): string => `<section class="mx-section ${cls}"><header class="mx-section-head"><h2>${title}</h2>${meta ? `<span>${meta}</span>` : ""}</header>${body}</section>`;
const card = (title: string, text: string, meta = "", icon = "file-text", tint = "blue", footer = ""): string => `<article class="mx-card"><span class="mx-icon ${tint}">${ico(icon)}</span><div class="mx-card-body"><h3>${title}</h3>${text ? `<p>${text}</p>` : ""}${meta ? `<small>${meta}</small>` : ""}${footer}</div></article>`;
function header(title: string, sub = "", testId = "module-back"): string {
  return `<header class="mx-page-head">${action(`${ico("chevron-left")}<span>返回</span>`, testId, "", "mx-back")}<div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ""}</div><span class="mx-head-spacer"></span></header>`;
}
function sourceMeta(record: H5Record): string {
  return `${fullDate(record.recordedAt)} · ${record.provenance === "synthetic" ? "示例来源" : "你的记录"} · 修订 ${record.revision}`;
}
function sourceRows(records: H5Record[]): string {
  return records.length ? records.map((record) => `<div class="mx-source-row"><span><b>${esc(record.title)}</b><small>${sourceMeta(record)}</small></span>${recordButton(record, "查看来源")}</div>`).join("") : `<div class="mx-empty">还没有关联记录。${action("添加一条文字记录", "add", "", "mx-inline-action")}</div>`;
}
function modulePill(kind: RecordModule, count: number): string {
  const item = moduleInfo[kind];
  return action(`${ico(item.icon)}<strong>${item.title}</strong><small>${count} 条</small>`, item.action, "", `mx-module-pill ${item.tint}`);
}
function todayHome(snapshot: H5Snapshot): string {
  const records = liveRecords(snapshot);
  const today = records.filter((record) => dayKey(record.recordedAt) === dayKey(snapshot.now));
  const counts = Object.fromEntries((Object.keys(moduleInfo) as RecordModule[]).map((key) => [key, today.filter((record) => record.module === key).length])) as Record<RecordModule, number>;
  const preview = today.slice(0, 3).map((record) => `<button class="mx-record-row" type="button" data-action="module-record" data-id="${esc(record.id)}"><time>${timeLabel(record.recordedAt)}</time><span class="mx-record-line"><b>${esc(record.title)}</b><small>${esc(record.text)}</small></span>${ico("chevron-right", "small")}</button>`).join("");
  return `<div class="mx-today-home"><div class="mx-topline"><div><span class="mx-eyebrow">${fullDate(snapshot.now)}</span><h1>今天</h1></div><span class="mx-day-count">${today.length} 个片段</span></div><section class="mx-today-hero"><div><span class="mx-eyebrow light">DAILY SUMMARY · 示例归纳</span><h2>${today.length ? "把今天的线索，放在一起看。" : "给今天，留下一点记录。"}</h2><p>内容按来源汇总；重要结论仍由你核对。</p>${action("查看今日总结" + ico("arrow-right", "small"), "today-summary", "", "mx-hero-action")}</div><img src="/assets/lake-sunset.png" alt="湖畔日落场景示意"></section><div class="mx-quick-actions">${action(`${ico("layers")}<span>全部录音<small>${today.length} 条记录</small></span>${ico("chevron-right", "small")}`, "today-recordings", "", "mx-link-card")}${action(`${ico("calendar")}<span>历史日期<small>按天查看记录</small></span>${ico("chevron-right", "small")}`, "memory-day", `data-day="${dayKey(snapshot.now)}"`, "mx-link-card")}</div>${section("今天的内容", `${today.length} 条`, `${preview || `<div class="mx-empty">今天还没有记录。可从文字开始，之后再补充其他内容。</div>`}${action("查看全部记录", "today-recordings", "", "mx-text-link")}`)}<div class="mx-module-grid">${modulePill("work", counts.work)}${modulePill("life", counts.life)}${modulePill("social", counts.social)}${modulePill("inspiration", counts.inspiration)}</div><p class="mx-disclaimer">演示数据与真实记录会明确区分；不会自动创建任务或对外执行操作。</p></div>`;
}
function todayRecordings(snapshot: H5Snapshot, options: ModuleOptions): string {
  const query = options.query.trim().toLocaleLowerCase();
  const records = liveRecords(snapshot).filter((record) => (!options.filter || options.filter === "all" || record.module === options.filter) && `${record.title} ${record.text}`.toLocaleLowerCase().includes(query));
  const days = new Map<string, H5Record[]>();
  records.slice().reverse().forEach((record) => days.set(dayKey(record.recordedAt), [...(days.get(dayKey(record.recordedAt)) ?? []), record]));
  const list = [...days.entries()].reverse().map(([day, items]) => `<section class="mx-day-group"><div class="mx-day-label"><b>${fullDate(day + "T12:00:00")}</b><span>${items.length} 条</span></div>${items.map((record) => `<article class="mx-record-card"><div class="mx-record-clock"><i></i><time>${timeLabel(record.recordedAt)}</time></div><button class="mx-record-content" type="button" data-action="module-record" data-id="${esc(record.id)}"><span class="mx-thumb ${record.cover === "none" ? "no-photo" : ""}">${record.cover === "none" ? ico("file-text") : `<img src="/assets/${record.cover === "run" ? "mountains" : record.cover}.png" alt="场景示意" loading="lazy">`}</span><span class="mx-record-copy"><em class="mx-tag ${record.module}">${moduleInfo[record.module].title}</em><b>${esc(record.title)}</b><small>${esc(record.text)}</small><span class="mx-record-meta">${record.durationSeconds ? `${Math.floor(record.durationSeconds / 60)}:${String(record.durationSeconds % 60).padStart(2, "0")}` : "文字记录"} · ${record.provenance === "synthetic" ? "示例来源" : "你的记录"}</span></span></button>${action(`${options.playingRecord === record.id ? "Ⅱ 暂停播放" : "▶ 播放"}`, "module-play", `data-id="${esc(record.id)}"`, "mx-play-button")}${options.recordSelectionMode ? `<label class="mx-record-selection"><input type="checkbox" data-field="record-selection" data-id="${esc(record.id)}" ${options.selectedRecordIds.includes(record.id) ? "checked" : ""}><span>选</span></label>` : ""}</article>`).join("")}</section>`).join("");
  return `${header("今天的录音", "按日期回看，点击片段查看原文。")}<label class="mx-search-box">${ico("search")}<input data-field="module-query" data-testid="today-record-search" type="search" placeholder="搜索记录内容" value="${esc(options.query)}" aria-label="搜索记录内容"></label>${action(options.recordSelectionMode ? "完成选择" : "选择记录", "record-selection-mode", "", "mx-text-link") }<div class="mx-filter-row">${(["all", "work", "life", "social", "inspiration"] as const).map((filter) => action(filter === "all" ? "全部" : moduleInfo[filter].title, "module-filter", `data-filter="${filter}"`, `mx-filter-chip ${options.filter === filter ? "active" : ""}`)).join("")}</div><p class="mx-note">示例内容和你添加的内容会分别标注。批量操作仅在演示界面展示，不会改动原始来源。</p>${list || `<div class="mx-empty">没有找到匹配的记录。试试更短的关键词或其他分类。</div>`}${options.recordSelectionMode ? `<div class="mx-bulk-bar">已选 ${options.selectedRecordIds.length} 条${action("排除", "module-bulk-action", `data-operation="exclude"`, "mx-secondary-action")}${action("转分类", "module-bulk-action", `data-operation="classify"`, "mx-secondary-action")}${action("删除", "module-bulk-action", `data-operation="delete"`, "mx-primary-action")}</div>` : ""}`;
}
function recordingDetail(snapshot: H5Snapshot, options: ModuleOptions): string {
  const record = liveRecords(snapshot).find((item) => item.id === options.recordId) ?? liveRecords(snapshot)[0];
  if (!record) return `${header("记录详情")}<div class="mx-empty">这条记录暂不可用。</div>`;
  const matter = matterOf(snapshot, record);
  const playing = options.playingRecord === record.id;
  const waveform = Array.from({ length: 42 }, (_, i) => `<i class="wave-${8 + ((i * 17 + 9) % 31)}"></i>`).join("");
  return `${header("记录详情", `${timeLabel(record.recordedAt)} · ${moduleInfo[record.module].title}`)}<section class="mx-player"><div class="mx-player-cover">${record.cover === "none" ? ico("file-text") : `<img src="/assets/${record.cover === "run" ? "mountains" : record.cover}.png" alt="场景示意">`}</div><div class="mx-waveform" aria-label="音频波形示意">${waveform}</div><div class="mx-player-controls">${action(playing ? "Ⅱ" : "▶", "module-play", `data-id="${esc(record.id)}"`, "mx-round-play")}<span>${playing ? "正在播放演示" : "录音回放尚未连接音频文件"}</span><small>${record.durationSeconds ? `${Math.floor(record.durationSeconds / 60)}:${String(record.durationSeconds % 60).padStart(2, "0")}` : "—"}</small></div></section>${section("原始记录", "来源可追溯", `<article class="mx-quote"><p>${esc(record.text)}</p><small>${sourceMeta(record)}</small></article>`)}${section("整理线索", "需你核对", `${card(esc(record.title), "此处展示与来源直接关联的记录摘要。未提供的转写、置信度和说话人识别不会被推断补齐。", "来源：原始文字记录", "sparkles", moduleInfo[record.module].tint)}`)}${section("关联事项", matter ? esc(matter.title) : "暂未关联", matter ? `<article class="mx-card"><span class="mx-icon blue">${ico("calendar")}</span><div class="mx-card-body"><h3>${esc(matter.title)}</h3><p>${esc(matter.goal)}</p>${action("查看事项记忆" + ico("chevron-right", "small"), "memory-matter", `data-id="${esc(matter.id)}"`, "mx-text-link")}</div></article>` : `<p class="mx-note">这条记录尚未关联事项。</p>`)}<div class="mx-actions">${action("编辑来源文字", "source-edit-open", `data-id="${esc(record.id)}"`, "mx-secondary-action")}${action("从来源处核对", "source", `data-id="${esc(record.id)}"`, "mx-primary-action")}</div>`;
}
function todaySummary(snapshot: H5Snapshot): string {
  const records = liveRecords(snapshot).filter((record) => dayKey(record.recordedAt) === dayKey(snapshot.now));
  const modules = (Object.keys(moduleInfo) as RecordModule[]).map((key) => ({ key, records: records.filter((record) => record.module === key) }));
  const moduleCards = modules.map(({ key, records: list }) => `<button class="mx-summary-module ${moduleInfo[key].tint}" type="button" data-action="today-module" data-module="${key}"><span>${ico(moduleInfo[key].icon)}${moduleInfo[key].title}</span><b>${list.length}</b><small>${esc(list[0]?.title ?? "暂无相关记录")}</small></button>`).join("");
  return `${header("今日总结", fullDate(snapshot.now))}<section class="mx-summary-hero"><img src="/assets/lake-sunset.png" alt="湖畔日落场景示意"><div><span class="mx-eyebrow">LIVE DAILY SUMMARY · 示例归纳</span><h2>${records.length ? "今天有了可以回看的线索。" : "今天的总结还在等待记录。"}</h2><p>更新时间 ${timeLabel(snapshot.now)} · 基于 ${records.length} 条来源</p></div></section>${section("今天的主线", "保持事实与推测分开", card(records[0] ? esc(records[0].title) : "暂无可核对内容", records[0] ? esc(records[0].text) : "添加记录后，这里将展示可追溯的总结。", records[0] ? sourceMeta(records[0]) : "尚无来源", "sparkles", "orange", records[0] ? recordButton(records[0], "查看依据") : ""))}${section("重要变化", `${records.length} 条来源`, records.slice(0, 3).map((record, index) => `<div class="mx-timeline-change"><span>${index + 1}</span><div><b>${esc(record.title)}</b><p>${esc(record.text)}</p>${recordButton(record, "查看来源")}</div></div>`).join("") || `<p class="mx-note">暂无变化记录。</p>`)}${section("四个模块", "同一日期下汇总", `<div class="mx-summary-grid">${moduleCards}</div>`)}${section("来源覆盖", "点击来源可回到原始内容", sourceRows(records))}<div class="mx-actions">${action("重新整理（演示）", "module-notice", `data-notice="总结由现有示例记录展示；自动处理服务尚未接入。"`, "mx-secondary-action")}${action("查看全部录音" + ico("arrow-right", "small"), "today-recordings", "", "mx-primary-action")}</div>`;
}
function todayModule(snapshot: H5Snapshot, module: RecordModule, options: ModuleOptions): string {
  const allRecords = liveRecords(snapshot).filter((record) => record.module === module);
  const records = module === "inspiration" ? allRecords.filter((record) => !options.ignoredIdeas.includes(record.id)) : allRecords;
  const info = moduleInfo[module];
  const facts = records.slice(0, 3).map((record) => `<article class="mx-fact"><div class="mx-fact-dot ${info.tint}"></div><div><b>${esc(record.title)}</b><p>${esc(record.text)}</p><small>${timeLabel(record.recordedAt)} · ${record.provenance === "synthetic" ? "示例来源" : "你的记录"}</small>${recordButton(record, "查看证据")}${module === "inspiration" ? action("忽略这条整理（原文保留）", "today-ignore-idea", `data-id="${esc(record.id)}"`, "mx-text-link") : ""}</div></article>`).join("");
  const content: Record<RecordModule, { title: string; lead: string; sections: string[] }> = {
    work: { title: "今天的工作", lead: "事项、决定与未解决问题都应能回到来源。", sections: ["进行中的事项", "会议与沟通", "尚未解决的问题", "今天的变化", "相关人物"] },
    life: { title: "今天的生活", lead: "记录真实活动与安排，不从记录推断健康诊断。", sections: ["个人安排", "活动片段", "近期变化", "相关记录", "隐私边界"] },
    social: { title: "今天的社交", lead: "人名、承诺和关系信息都需要你确认。", sections: ["今天提到的人", "沟通记录", "待确认的承诺", "说话人身份", "相关来源"] },
    inspiration: { title: "今天的灵感", lead: "保留你的原话；系统整理内容与原文分开呈现。", sections: ["原始想法", "其他灵感", "相似想法", "相关录音", "补充想法"] },
  };
  const copy = content[module];
  const heroPhoto = module === "life" ? `<img class="mx-hero-photo" src="/assets/lakeside-run.png" alt="湖畔慢跑场景示意">` : "";
  const actions = module === "life" ? action("核对后保存为记忆", "today-save-memory", "", "mx-secondary-action") : module === "social" ? action("核对人物身份", "today-confirm-identity", "", "mx-secondary-action") : module === "inspiration" ? `${action("补充一条想法", "today-add-idea", "", "mx-secondary-action")}${action("核对相似想法", "today-merge-ideas", "", "mx-secondary-action")}` : "";
  return `${header(copy.title, fullDate(snapshot.now))}<section class="mx-module-hero ${info.tint} ${module === "life" ? "photo" : ""}">${heroPhoto}<span class="mx-icon">${ico(info.icon)}</span><div><span class="mx-eyebrow">${info.title.toUpperCase()} · TODAY</span><h2>${copy.lead}</h2><small>${records.length} 条相关记录</small></div></section>${copy.sections.map((title, i) => section(title, i === 0 ? `${records.length} 条` : "示例关联", i === 0 ? (facts || `<p class="mx-note">暂时没有相关记录。可以从文字记录开始。</p>`) : i === copy.sections.length - 1 ? sourceRows(allRecords) : `<article class="mx-insight-card"><b>${i === 1 ? esc(records[1]?.title ?? "等待更多来源") : i === 2 ? "需要人工核对" : i === 3 ? "来源可追溯" : "不自动确认身份"}</b><p>${i === 1 ? esc(records[1]?.text ?? "有新记录后，这里会显示相应内容。") : i === 2 ? "此处只整理来源中明确表达的内容，不创建提醒或承诺。" : i === 3 ? "跨模块只引用同一条来源记录，不重复创建主要数据。" : "未授权照片时使用名字首字母；不自动合并人物。"}</p>${records[i % Math.max(records.length, 1)] ? recordButton(records[i % records.length]!, "查看来源") : ""}</article>`)).join("")}${actions}${action("交给助手继续处理", "module-assistant", "", "mx-primary-action full")}`;
}

export function todayModuleView(snapshot: H5Snapshot, options: ModuleOptions): string {
  if (options.todayPage === "home") return todayHome(snapshot);
  if (options.todayPage === "recordings") return todayRecordings(snapshot, options);
  if (options.todayPage === "recording") return recordingDetail(snapshot, options);
  if (options.todayPage === "summary") return todaySummary(snapshot);
  return todayModule(snapshot, options.todayPage, options);
}

function memoryToolbar(snapshot: H5Snapshot, options: ModuleOptions, search = false): string {
  const count = liveRecords(snapshot).length;
  return `<div class="mx-search-box">${ico("search")}<input type="search" data-field="module-query" data-testid="memory-global-search" value="${esc(options.query)}" placeholder="搜索人物、事情或记录内容" aria-label="搜索人物、事情或记录内容">${action("搜索", "memory-search-go", "", "mx-search-submit")}</div>${search ? `<p class="mx-search-parse">正在查看 ${options.query ? `“${esc(options.query)}”` : "全部来源"} · ${count} 条可检索记录 · 结果均可查看来源</p>` : ""}`;
}
function memoryHome(snapshot: H5Snapshot, options: ModuleOptions): string {
  const records = liveRecords(snapshot);
  const days = [...new Set(records.map((record) => dayKey(record.recordedAt)))].sort().reverse();
  const recentDays = days.slice(0, 7);
  const todayRecords = records.filter((record) => dayKey(record.recordedAt) === dayKey(snapshot.now));
  const important = records.slice(0, 3);
  const people = [...new Set(snapshot.matters.flatMap((matter) => matter.participants))];
  return `<div class="mx-memory-home"><div class="mx-topline"><div><span class="mx-eyebrow">YOUR MEMORY</span><h1>记忆</h1></div>${action(`${ico("check-circle-2")}待确认`, "memory-pending", "", "mx-pending-shortcut")}</div>${memoryToolbar(snapshot, options)}<div class="mx-segmented" role="group" aria-label="记忆浏览方式">${(["date", "things", "person"] as const).map((group) => action(group === "date" ? "按日期" : group === "things" ? "按事情" : "按人物", "memory-group", `data-group="${group}"`, options.group === group ? "active" : "")).join("")}</div><div class="mx-date-rail">${recentDays.map((day) => action(`<b>${new Date(`${day}T12:00:00`).getDate()}</b><small>${new Date(`${day}T12:00:00`).toLocaleDateString("zh-CN", { weekday: "short" })}</small>`, "memory-day", `data-day="${day}"`, day === dayKey(snapshot.now) ? "active" : "")).join("") || `<span class="mx-note">尚无日期</span>`}</div><button class="mx-memory-hero" type="button" data-action="memory-day" data-day="${dayKey(snapshot.now)}"><img src="/assets/lake-sunset.png" alt="湖畔日落场景示意"><span class="mx-memory-hero-shade"></span><span class="mx-memory-hero-copy"><small>今日归档 · ${todayRecords.length} 条来源</small><b>今天发生的事，<br>都可以回到原处。</b><span>打开今日归档 ${ico("arrow-right", "small")}</span></span></button>${section("重要记忆", "最多展示 3 条 · 示例排序", important.map((record) => `<button class="mx-memory-item" type="button" data-action="memory-record" data-id="${esc(record.id)}"><span class="mx-icon ${moduleInfo[record.module].tint}">${ico(moduleInfo[record.module].icon)}</span><span><b>${esc(record.title)}</b><small>${esc(record.text)}</small><em>${fullDate(record.recordedAt)} · ${moduleInfo[record.module].title}</em></span>${ico("chevron-right", "small")}</button>`).join("") || `<p class="mx-note">记下来的内容会出现在这里。</p>`)}<div class="mx-review-row">${action(`<span><small>本周回顾</small><b>回看变化与来源</b></span>${ico("chevron-right", "small")}`, "memory-review", `data-period="week"`, "mx-review-card")}${action(`<span><small>本月回顾</small><b>${records.length} 条来源记录</b></span>${ico("chevron-right", "small")}`, "memory-review", `data-period="month"`, "mx-review-card")}</div>${section("按事情", `${snapshot.matters.length} 件`, snapshot.matters.slice(0, 3).map((matter) => action(`<span class="mx-icon blue">${ico("calendar")}</span><span><b>${esc(matter.title)}</b><small>${esc(matter.goal)}</small></span>${ico("chevron-right", "small")}`, "memory-matter", `data-id="${esc(matter.id)}"`, "mx-link-card")).join("") || `<p class="mx-note">还没有关联事项。</p>`)}${section("按人物", `${people.length} 位 · 事项参与人`, people.slice(0, 3).map((person) => action(`<span class="mx-initial">${esc(person.slice(0, 1))}</span><span><b>${esc(person)}</b><small>事项参与人 · 未验证说话人身份</small></span>${ico("chevron-right", "small")}`, "memory-person", `data-person="${esc(person)}"`, "mx-link-card")).join("") || `<p class="mx-note">没有已填写的人物信息。</p>`)}<p class="mx-disclaimer">当前记忆数据由已有记录与事项生成。人物关系、周期回顾和待确认队列是原型演示，不代表已保存至服务端。</p></div>`;
}
function memorySearch(snapshot: H5Snapshot, options: ModuleOptions): string {
  const query = options.query.trim().toLocaleLowerCase();
  const selectedModule: Record<string, RecordModule | undefined> = { "工作": "work", "生活": "life", "社交": "social", "灵感": "inspiration" };
  const records = liveRecords(snapshot).filter((record) => {
    const matter = matterOf(snapshot, record);
    const status = options.memoryItemStates[record.id] ?? "待确认";
    const statusMatches = options.filter === "已确认" ? status.startsWith("已确认") : options.filter === "待确认" ? !status.startsWith("已确认") : true;
    return statusMatches && (!selectedModule[options.filter] || record.module === selectedModule[options.filter]) && `${record.title} ${record.text} ${matter?.title ?? ""} ${matter?.participants.join(" ") ?? ""}`.toLocaleLowerCase().includes(query);
  });
  const groups = new Map<string, H5Record[]>();
  for (const record of records) {
    const matter = matterOf(snapshot, record);
    const group = options.group === "date" ? fullDate(record.recordedAt) : options.group === "person" ? matter?.participants[0] ?? "未关联人物" : matter?.title ?? "生活片段";
    groups.set(group, [...(groups.get(group) ?? []), record]);
  }
  const filters = ["全部", "工作", "生活", "社交", "灵感", "已确认", "待确认"];
  return `${header("记忆搜索", "先看系统如何理解，再检查来源。")}${memoryToolbar(snapshot, options, true)}<div class="mx-filter-row">${filters.map((item) => action(item, "memory-filter", `data-filter="${item}"`, `mx-filter-chip ${options.filter === item ? "active" : ""}`)).join("")}</div><p class="mx-note">时间范围、模块、人物与事项可组合筛选。原型按已有记录检索；确认状态筛选暂用演示状态。</p>${[...groups.entries()].map(([label, items]) => section(esc(label), `${items.length} 条结果`, items.map((record) => `<button class="mx-memory-result" type="button" data-action="memory-record" data-id="${esc(record.id)}"><span class="mx-icon ${moduleInfo[record.module].tint}">${ico(moduleInfo[record.module].icon)}</span><span><b>${esc(record.title)}</b><small>${esc(record.text)}</small><em>命中：标题 / 原文 · ${sourceMeta(record)}</em></span>${ico("chevron-right", "small")}</button>`).join(""), "mx-search-results")).join("") || `<div class="mx-empty">没有找到匹配内容。可以缩短关键词，或移除一些筛选条件。</div>`}`;
}
function memoryDay(snapshot: H5Snapshot, options: ModuleOptions): string {
  const selected = options.selectedDay || dayKey(snapshot.now);
  const records = liveRecords(snapshot).filter((record) => dayKey(record.recordedAt) === selected);
  const counts = (Object.keys(moduleInfo) as RecordModule[]).map((key) => ({ key, records: records.filter((record) => record.module === key) }));
  const dayTitle = fullDate(`${selected}T12:00:00`);
  return `${header("日期归档", dayTitle)}<section class="mx-day-archive-hero"><span class="mx-eyebrow">${records.length} 条来源 · 示例归档</span><h2>${records.length ? "把当天的记录与变化放在一起。" : "这一天暂时没有记录。"}</h2><p>总结只引用已有内容；没有来源的字段保持为空。</p></section>${section("关键变化", "最多 3 条", records.slice(0, 3).map((record) => card(esc(record.title), esc(record.text), sourceMeta(record), "sparkles", moduleInfo[record.module].tint, recordButton(record, "查看依据"))).join("") || `<p class="mx-note">没有足够来源来归纳变化。</p>`)}${section("模块历史", "同一日历日期", `<div class="mx-summary-grid">${counts.map(({ key, records: list }) => `<button class="mx-summary-module ${moduleInfo[key].tint}" type="button" data-action="today-module" data-module="${key}"><span>${ico(moduleInfo[key].icon)}${moduleInfo[key].title}</span><b>${list.length}</b><small>${list[0] ? esc(list[0].title) : "暂无内容"}</small></button>`).join("")}</div>`)}${section("关联事项", "来源关联", snapshot.matters.filter((matter) => records.some((record) => record.contextId === matter.id)).map((matter) => action(`${ico("calendar")}<span><b>${esc(matter.title)}</b><small>${esc(matter.goal)}</small></span>${ico("chevron-right", "small")}`, "memory-matter", `data-id="${esc(matter.id)}"`, "mx-link-card")).join("") || `<p class="mx-note">没有关联事项。</p>`)}${section("当天记录", `${records.length} 条`, sourceRows(records))}<div class="mx-actions">${action("编辑总结（演示）", "module-notice", `data-notice="此原型不保存编辑后的日期总结。"`, "mx-secondary-action")}${action("重新整理", "module-notice", `data-notice="此原型没有接入总结生成服务。"`, "mx-primary-action")}</div>`;
}
function memoryMatter(snapshot: H5Snapshot, options: ModuleOptions): string {
  const matter = snapshot.matters.find((item) => item.id === options.selectedMatter) ?? snapshot.matters[0];
  if (!matter) return `${header("事项记忆")}<div class="mx-empty">还没有事项。</div>`;
  const records = liveRecords(snapshot).filter((record) => record.contextId === matter.id);
  const people = matter.participants;
  return `${header("事项记忆", "变化按时间排列；点击来源核对原文。")}<section class="mx-matter-cover"><span class="mx-icon blue">${ico("calendar")}</span><div><span class="mx-eyebrow">${matter.provenance === "synthetic" ? "示例事项" : "你创建的事项"}</span><h2>${esc(matter.title)}</h2><p>${esc(matter.goal)}</p></div></section>${section("当前结论", "仅有来源支持时展示", records[0] ? card(esc(records[0].title), esc(records[0].text), sourceMeta(records[0]), "check-circle-2", "green", recordButton(records[0], "查看依据")) : `<p class="mx-note">暂无可核对的结论。</p>`)}${section("变化时间线", `${records.length} 条记录`, records.map((record) => `<article class="mx-fact"><div class="mx-fact-dot ${moduleInfo[record.module].tint}"></div><div><small>${fullDate(record.recordedAt)} · ${timeLabel(record.recordedAt)}</small><b>${esc(record.title)}</b><p>${esc(record.text)}</p>${recordButton(record, "查看来源")}</div></article>`).join("") || `<p class="mx-note">还没有相关来源。</p>`)}${section("相关人物", `${people.length} 位 · 事项参与人`, people.map((person) => action(`<span class="mx-initial">${esc(person.slice(0, 1))}</span><span><b>${esc(person)}</b><small>参与人字段，身份未核验</small></span>${ico("chevron-right", "small")}`, "memory-person", `data-person="${esc(person)}"`, "mx-link-card")).join("") || `<p class="mx-note">暂无人物信息。</p>`)}${section("记录来源", "保持版本可追溯", sourceRows(records))}${action("交给助手继续处理", "module-assistant", "", "mx-primary-action full")}`;
}
function memoryPerson(snapshot: H5Snapshot, options: ModuleOptions): string {
  const name = options.selectedPerson || "未命名人物";
  const matters = snapshot.matters.filter((matter) => matter.participants.includes(name));
  const records = liveRecords(snapshot).filter((record) => matters.some((matter) => matter.id === record.contextId));
  const topics = [...new Set(matters.map((matter) => matter.title))];
  return `${header("人物记忆", "照片未获授权时使用姓名首字，不自动合并身份。")}<section class="mx-person-hero"><span class="mx-person-avatar">${esc(name.slice(0, 1))}</span><div><span class="mx-eyebrow">事项参与人 · 示例关联</span><h2>${esc(name)}</h2><p>说话人身份未核验</p></div></section>${section("最近互动", `${records.length} 条可追溯记录`, records.slice(0, 3).map((record) => card(esc(record.title), esc(record.text), sourceMeta(record), "users", "amber", recordButton(record, "查看记录"))).join("") || `<p class="mx-note">尚无与此人物直接关联的记录。</p>`)}${section("共同事项", `${topics.length} 件`, matters.map((matter) => action(`<span class="mx-icon blue">${ico("calendar")}</span><span><b>${esc(matter.title)}</b><small>${esc(matter.goal)}</small></span>${ico("chevron-right", "small")}`, "memory-matter", `data-id="${esc(matter.id)}"`, "mx-link-card")).join("") || `<p class="mx-note">事项参与人信息为空。</p>`)}${section("记住关于 TA", "待你确认", `<article class="mx-insight-card"><b>关系与偏好暂不自动推断</b><p>只有由你确认的信息才会成为稳定记忆。目前人物画像和承诺管理是原型展示。</p></article>`)}${section("相关历史", `${records.length} 条来源`, sourceRows(records))}${action("交给助手继续处理", "module-assistant", "", "mx-primary-action full")}`;
}
function memoryReview(snapshot: H5Snapshot, options: ModuleOptions): string {
  const records = liveRecords(snapshot);
  const period = options.filter === "month" ? "本月" : "本周";
  const ordered = [...records].reverse();
  const changes = ordered.slice(-3);
  const moduleStats = (Object.keys(moduleInfo) as RecordModule[]).map((key) => ({ key, count: records.filter((record) => record.module === key).length }));
  return `${header(`${period}回顾`, "记录覆盖与关键变化 · 按来源浏览") }<section class="mx-review-hero"><img src="/assets/mountains.png" alt="山峦插画"><div><span class="mx-eyebrow">${period.toUpperCase()} IN REVIEW</span><h2>把近期发生的事，慢慢看清。</h2><p>${records.length} 条来源 · ${snapshot.matters.length} 个关联事项</p></div></section><div class="mx-metric-grid"><article><b>${records.length}</b><small>记录片段</small></article><article><b>${new Set(records.map((record) => dayKey(record.recordedAt))).size}</b><small>覆盖日期</small></article><article><b>${snapshot.matters.length}</b><small>关联事项</small></article></div>${section("三个关键变化", "依照最近的来源排序", changes.map((record) => `<article class="mx-change-card"><span>${timeLabel(record.recordedAt)}</span><div><b>${esc(record.title)}</b><p>${esc(record.text)}</p>${recordButton(record, "查看来源")}</div></article>`).join("") || `<p class="mx-note">积累一些记录后，这里才会形成回顾。</p>`)}${section("持续中的事项", `${snapshot.matters.length} 件`, snapshot.matters.slice(0, 3).map((matter) => action(`<span class="mx-icon blue">${ico("calendar")}</span><span><b>${esc(matter.title)}</b><small>${esc(matter.goal)}</small></span>${ico("chevron-right", "small")}`, "memory-matter", `data-id="${esc(matter.id)}"`, "mx-link-card")).join("") || `<p class="mx-note">暂无事项。</p>`)}${section("模块分布", "按记录数量", `<div class="mx-module-bars">${moduleStats.map(({ key, count }) => `<div><span>${moduleInfo[key].title}</span><i><b class="fill-${records.length ? Math.min(100, Math.max(10, Math.ceil(count / records.length * 10) * 10)) : 0}"></b></i><small>${count}</small></div>`).join("")}</div>`)}${section("来源覆盖", "可回到原始记录", sourceRows(records))}<div class="mx-actions">${action("分享回顾", "module-notice", `data-notice="分享功能未接入；回顾只保留在当前设备原型。"`, "mx-secondary-action")}${action("查看待确认记忆" + ico("arrow-right", "small"), "memory-pending", "", "mx-primary-action")}</div>`;
}
function memoryDetail(snapshot: H5Snapshot, options: ModuleOptions): string {
  const record = liveRecords(snapshot).find((item) => item.id === options.recordId) ?? liveRecords(snapshot)[0];
  if (!record) return `${header("记忆详情")}<div class="mx-empty">没有可查看的记录。</div>`;
  const matter = matterOf(snapshot, record);
  const module = moduleInfo[record.module];
  const sources = liveRecords(snapshot).filter((item) => item.contextId === record.contextId);
  return `${header("记忆详情", "内容、证据和关联信息分开呈现。")}<section class="mx-memory-detail-top"><span class="mx-icon ${module.tint}">${ico(module.icon)}</span><span><small>${module.title} · ${record.provenance === "synthetic" ? "示例记忆" : "你的记录"}</small><h2>${esc(record.title)}</h2><em>${esc(options.memoryItemStates[record.id] ?? `来源修订 ${record.revision} · 未单独确认的记录`)}</em></span></section>${section("当前版本", fullDate(record.recordedAt), `<article class="mx-quote"><p>${esc(record.text)}</p><small>按来源原文呈现，没有把推断写成事实。</small></article>`)}${section("关联事项与模块", "共享同一来源 ID", `${matter ? action(`<span class="mx-icon blue">${ico("calendar")}</span><span><b>${esc(matter.title)}</b><small>${esc(matter.goal)}</small></span>${ico("chevron-right", "small")}`, "memory-matter", `data-id="${esc(matter.id)}"`, "mx-link-card") : ""}<p class="mx-note">归属模块：${module.title} · 原文继续保留在今天的记录列表。</p>`)}${section("证据来源", `${sources.length || 1} 个版本关联`, sourceRows([record]))}${section("版本历史", "来源修订", `<div class="mx-version-row"><span class="mx-version-dot"></span><div><b>修订 ${record.revision} · 当前</b><p>${sourceMeta(record)}</p>${recordButton(record, "查看原始记录")}</div></div>`)}${section("使用范围", "不自动外发", `<p class="mx-note">此来源可在相关事项的上下文中被引用；不会自动分享给其他人。</p>`)}<div class="mx-actions">${action("编辑来源", "source-edit-open", `data-id="${esc(record.id)}"`, "mx-secondary-action")}${action("查看来源记录" + ico("arrow-right", "small"), "module-record", `data-id="${esc(record.id)}"`, "mx-primary-action")}</div><div class="mx-item-manage">${action("确认", "memory-item-state", `data-id="${esc(record.id)}" data-state="confirm"`, "mx-secondary-action")}${action("标记失效", "memory-item-state", `data-id="${esc(record.id)}" data-state="invalidate"`, "mx-secondary-action")}${action("删除记忆", "memory-item-state", `data-id="${esc(record.id)}" data-state="delete"`, "mx-secondary-action")}</div>`;
}
const pendingItems = [
  { id: "p-voice", category: "identity", title: "确认人物与说话人身份", text: "“Alex”来自事项参与人字段，是否与这段录音中的发言人相同？", risk: "身份确认 · 需要逐条核对", icon: "users" },
  { id: "p-matter", category: "assignment", title: "确认这条记录归属的事项", text: "系统建议关联至当前进行中的事项；请检查上下文后决定。", risk: "事项归属 · 来源可查看", icon: "calendar" },
  { id: "p-conflict", category: "conflict", title: "两种并行的偏好表述", text: "“先简要同步”与“详细列出背景”都来自不同日期，不做自动覆盖。", risk: "存在冲突 · 保留两个版本", icon: "alert-circle" },
  { id: "p-reminder", category: "assignment", title: "保存一条长期记忆", text: "此建议只会在你确认后加入记忆；当前是界面演示，不写入服务端。", risk: "低风险候选 · 示例数据", icon: "book-open" },
];
function memoryPending(options: ModuleOptions): string {
  const items = pendingItems.filter((item) => (options.pendingFilter === "all" || item.category === options.pendingFilter) && !options.confirmedPending.includes(item.id));
  const filters: [ModuleOptions["pendingFilter"], string][] = [["all", "全部"], ["identity", "身份"], ["assignment", "归属"], ["conflict", "冲突"]];
  return `${header("待确认记忆", "核对来源后再确认；当前队列为前端演示。")}<div class="mx-pending-banner"><span class="mx-icon amber">${ico("alert-circle")}</span><p><b>${items.length} 条等待核对</b><small>网络或服务端失败不会自动确认任何记忆。</small></p></div><div class="mx-filter-row">${filters.map(([key, label]) => action(label, "memory-pending-filter", `data-filter="${key}"`, `mx-filter-chip ${options.pendingFilter === key ? "active" : ""}`)).join("")}</div>${items.map((item) => `<article class="mx-pending-card"><div class="mx-pending-heading"><span class="mx-icon ${item.category === "conflict" ? "purple" : "amber"}">${ico(item.icon)}</span><span><small>${item.risk}</small><h2>${item.title}</h2></span></div><p>${item.text}</p><div class="mx-pending-source">${action(`${ico("file-text", "small")}查看关联来源`, "module-notice", `data-notice="演示队列没有真实来源记录；不执行身份绑定或数据修改。"`, "mx-text-link")}</div>${item.category !== "identity" ? `<label class="mx-check-row"><input type="checkbox" data-field="pending-select" data-id="${item.id}" ${options.selectedPending.includes(item.id) ? "checked" : ""}> 选择此项（仅演示）</label>` : `<span class="mx-manual-only">身份类内容必须逐条确认，不可批量处理</span>`}<div class="mx-pending-actions">${action("暂不处理", "pending-dismiss", `data-id="${item.id}"`, "mx-secondary-action")}${action("核对并确认", "pending-confirm", `data-id="${item.id}"`, "mx-primary-action")}</div></article>`).join("") || `<div class="mx-empty">当前筛选下没有待确认内容。</div>`}${options.selectedPending.length ? `<div class="mx-bulk-bar">已选 ${options.selectedPending.length} 项 ${action("确认低风险项", "pending-bulk-confirm", "", "mx-primary-action")}</div>` : ""}`;
}
export function memoryModuleView(snapshot: H5Snapshot, options: ModuleOptions): string {
  switch (options.memoryPage) {
    case "home": return memoryHome(snapshot, options);
    case "search": return memorySearch(snapshot, options);
    case "day": return memoryDay(snapshot, options);
    case "matter": return memoryMatter(snapshot, options);
    case "person": return memoryPerson(snapshot, options);
    case "review": return memoryReview(snapshot, options);
    case "detail": return memoryDetail(snapshot, options);
    case "pending": return memoryPending(options);
  }
}
