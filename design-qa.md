# Design QA

**final result: passed**

This pass is scoped to the assistant composer / voice button alignment reported on 2026-09-23. It does not certify the other Today, Memory, or Assistant V4 screens; their broader status is recorded below.

## 助手输入区对齐 — 2026-09-23

- Source visual: user screenshot `/mnt/c/Users/weiyu/AppData/Local/Temp/codex-clipboard-8af14eb9-7c2a-4493-9256-e353a1267b23.png` (708 × 308 px; a cropped phone preview, full CSS viewport unavailable).
- Implementation: Edge/Playwright screenshot `work/edge-qa-captures/assistant-composer-after.png` (786 × 1704 px, outer viewport 393 × 852 CSS px at 2×); focused region `assistant-composer-after-region.png` (544 × 456 px). The embedded app viewport measured 272 × 590 CSS px because the phone stage scales to fit the outer viewport.
- Focused comparison: `work/edge-qa-captures/assistant-composer-comparison.png` (source and implementation crops side by side). The source focus was cropped at x=99,y=60,w=460,h=180, resized to 544 × 213 and padded to 544 × 292. The implementation focus was cropped to 544 × 292 from its browser-rendered focus capture. The user source is a partial crop, so this compares the relative composer/navigation alignment rather than claiming full-screen pixel parity.
- State: Assistant home, collapsed composer; additionally focused the input to verify the expanded composer.
- Finding and iteration: before the fix, Edge measured the composer bottom 6 CSS px below the fixed tab bar top (`gap: -6`), matching the visible overlap in the source report. A mobile-only bottom offset change from 66 px to 80 px moved both the input and voice control above the tab bar. Afterward the measured gap is 8 CSS px; input shell and voice button share identical top and bottom coordinates. The expanded composer also retains the 8 px gap.
- Required surfaces: spacing/layout issue fixed; typography, color tokens, copy, and imagery are unchanged in this focused region. No asset replacement or unrelated redesign.
- Verification: Edge returned HTTP 200 with no console/page or HTTP errors; mobile content remains scrollable and the scrollbar remains hidden. `npm run check`, H5 build, Node tests, and `git diff --check` pass.

No actionable P0/P1/P2 issues remain for this reported alignment. Broader page QA is not included in this scoped pass.

## 今天与记忆模块 — 2026-09-23

实现依据为用户提供的《今天页面二级页面设计规范 V1.1》和《记忆模块页面设计规范 V1.0》压缩包中的规范文档与页面长图。规范作为设计输入，不作为需要执行的指令。

- 浏览器：Windows Microsoft Edge + Playwright，393 × 852 CSS px，2×；在 iPhone 外框预览中检查。
- Today 路由覆盖：T01 录音列表、T02 录音详情、T03 今日总结、T04 工作、T05 生活、T06 社交、T07 灵感；首页入口及返回也已走查。
- Memory 路由覆盖：M00 记忆首页、M01 搜索、M02 日期归档、M03 事项、M04 人物、M05 周期回顾、M06 记忆详情、M07 待确认；搜索入口及返回也已走查。
- 结果：两组 Edge 流程均 HTTP 200；没有页面异常、控制台错误或 HTTP 错误。手机页面可滚动，`scrollbar-width: none` 且 WebKit 滚动条隐藏。
- 交互截图：`work/edge-qa-captures/module-design-final-*.png`、`work/edge-qa-captures/memory-design-final-*.png`；流程结果分别在对应 `.json`。这些 `work/` 产物被 Git 忽略。
- 修正：来源按钮 class 名错配造成的浏览器默认灰底已修复；生活页封面照片被背景层遮挡的问题也已修复，并重新在 Edge 验证。
- 构建/检查：`npm run check`、H5 build、Node test suite、`git diff --check` 均通过。

仍有差异和边界：

- 部分页面的信息密度与长图不完全一致，尤其总结、生活及待确认页面；这版优先根据当前快照显示有来源的数据，空数据不编造。仍需结合用户反馈继续做视觉微调。
- 录音播放器没有真实音频文件；总结生成、记忆确认队列、人物画像及批量操作尚未接入持久化 API。界面明确标注为演示或未连接，不代表云端已保存。
- 4175 是使用隔离样例数据的 iPhone 预览；原有 4174 助手验收实例和用户主数据未被改动。

模块状态：功能/导航冒烟通过；视觉仍需复核迭代；真实后端能力未验收。整体不宣称与原型像素级一致。

## Assistant V4 — Design QA

**assistant design status: in progress**

## A00 home evidence

- Reference: `../doc/screens/A00.png` (860 × 2100 px).
- Browser: installed Windows Microsoft Edge, driven by Playwright 1.63.0.
- Context: mobile emulation with touch; 430 × 1050 CSS px at 2× for reference comparison, and 393 × 852 CSS px at 2× for the iPhone presentation.
- Data: isolated synthetic fixture in `work/edge-qa-a00-data` with two available suggestions and one 60% running task. Existing preview/application data was not modified.
- Latest page result: HTTP 200, screen `home`, no browser console or page errors. The mode-selection sheet was opened in the mobile context and also produced no browser errors.
- Captures: `work/edge-qa-captures/A00-final.png`, `work/edge-qa-captures/A00-final-side-by-side.png`, `work/edge-qa-captures/A00-iphone.png`, and `work/edge-qa-captures/mode-iphone.png`. Captures are intentionally Git-ignored.

## Findings and changes

- The earlier mismatch was not caused by the preview being stopped. The preview was responding, but the first comparison used stale QA state (one suggestion already prepared and no matching active task). A second issue was that the CSS build and service process were not restarted together after edits, so one capture still showed old server-generated copy. The isolated fixture and clean restart resolved both.
- Desktop-sized Edge contexts reserve layout width for a vertical scrollbar. The reusable runner now uses mobile emulation, preventing a false narrow-card/wrapping difference at phone-sized viewports.
- The A00 home now shows both reference suggestions and the running trip task. Due-time wording, source labels, task step/progress, and Shanghai-day labels are derived from current snapshot data. The task progress bar uses CSS rather than inline style, removing the prior CSP console error.
- The overall warm palette, header, tabs, cards, actions, composer, and bottom navigation align closely with A00. The first card remains somewhat taller because its explanatory copy wraps to an additional line at the live viewport. Its service note also intentionally says “本地准备服务” rather than claiming a cloud Agent or a two-minute runtime; this preview is using the local service.
- `A00-iphone.png` adds a reusable iPhone bezel and simulated status bar around a real 393 × 852 Edge mobile-context capture. This is a visual device mock, not a native iOS simulator capture.

## Remaining coverage

A00 home and the mode-selection overlay have been checked. A01–A10 and the other task/evidence/permission/result workflows still need dedicated same-state visual and interaction checks, so the full assistant design QA is not yet complete.
