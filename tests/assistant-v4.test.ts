import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DomainError } from "../src/errors.ts";
import { createH5Service } from "../src/h5-local-service.ts";
import { assistantView, initialAssistantUiState } from "../web/assistant.ts";
import { snapshot as decodeSnapshot } from "../web/api.ts";

function required<T>(value: T | null | undefined, label: string): T {
  if (value === undefined || value === null) throw new Error(`Missing ${label}`);
  return value;
}

test("assistant task persists selected evidence through a regenerated DOCX export", async (t) => {
  const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));
  const dataRoot = await mkdtemp(path.join(workspaceRoot, "work", "assistant-v4-test-"));
  t.after(async () => { await rm(dataRoot, { recursive: true, force: true }); });
  let clock = Date.parse("2026-09-22T18:00:00.000Z");
  const service = await createH5Service({ workspaceRoot, dataRoot, now: () => new Date(clock).toISOString() });
  const suggested = required(service.snapshot().suggestions.find((item) => item.state === "available"), "initial suggestion");
  const snoozed = await service.decideSuggestion(suggested.id, { requestId: "assistant-v4-snooze-tomorrow", decision: "snooze", snoozeMinutes: 1440 });
  const scheduled = required(snoozed.suggestions.find((item) => item.id === suggested.id), "scheduled suggestion");
  assert.equal(scheduled.state, "snoozed");
  assert.equal(scheduled.snoozedUntil, new Date(clock + 1_440 * 60_000).toISOString(), "the selected snooze duration must be persisted from the server clock");
  await service.decideSuggestion(suggested.id, { requestId: "assistant-v4-restore-suggestion", decision: "restore" });
  const dismissed = await service.decideSuggestion(suggested.id, { requestId: "assistant-v4-dismiss-suggestion", decision: "dismiss" });
  assert.equal(required(dismissed.suggestions.find((item) => item.id === suggested.id), "dismissed suggestion").state, "dismissed");
  const restored = await service.decideSuggestion(suggested.id, { requestId: "assistant-v4-undo-dismiss-suggestion", decision: "restore" });
  assert.equal(required(restored.suggestions.find((item) => item.id === suggested.id), "restored suggestion").state, "available");
  const createInput = { requestId: "assistant-v4-create", mode: "task" as const, content: "准备团队方案同步的汇报结构", contextId: "mx-product" };

  const created = await service.createAssistantSession(createInput);
  const taskId = required(created.taskId, "task ID");
  const duplicate = await service.createAssistantSession(createInput);
  assert.equal(duplicate.taskId, taskId, "a retried request must return the original task");
  assert.equal(duplicate.snapshot.assistant.tasks.length, 1, "a retried request must not create another task");

  const expandedHome = initialAssistantUiState();
  expandedHome.composerExpanded = true;
  expandedHome.addContentSheetOpen = true;
  expandedHome.dismissedSuggestionId = suggested.id;
  const homeMarkup = assistantView(created.snapshot, expandedHome);
  assert.match(homeMarkup, /<textarea[^>]*data-assistant-field="composer"/, "the expanded input uses a native multi-line field");
  assert.match(homeMarkup, /添加内容/, "the add-content sheet is rendered from state");
  assert.match(homeMarkup, /assistant-undo-dismiss/, "a dismissed suggestion has an undo action");
  const planUi = initialAssistantUiState();
  planUi.screen = "plan-edit";
  planUi.taskId = taskId;
  const planMarkup = assistantView(created.snapshot, planUi);
  assert.match(planMarkup, /修改任务计划/);
  assert.match(planMarkup, /保存并开始执行/);

  const budgetEvidence = required(created.snapshot.assistant.evidence.find((item) => item.taskId === taskId && item.sourceRef === "sample-budget"), "budget evidence");
  await service.updateAssistantEvidence(budgetEvidence.id, { requestId: "assistant-v4-exclude-budget", included: false });
  await service.startAssistantTask(taskId, { requestId: "assistant-v4-start" });
  clock += 600;
  await service.tickAssistantTasks();
  clock += 700;
  await service.tickAssistantTasks();

  let snapshot = service.snapshot();
  const input = required(snapshot.assistant.inputRequests.find((item) => item.taskId === taskId && item.status === "open"), "format request");
  const pausedForInput = await service.actOnAssistantTask(taskId, { requestId: "assistant-v4-pause-for-input", action: "pause" });
  assert.equal(required(pausedForInput.snapshot.assistant.tasks.find((item) => item.id === taskId), "paused task").status, "paused", "a missing-information task can be deferred");
  const resumedForInput = await service.actOnAssistantTask(taskId, { requestId: "assistant-v4-resume-for-input", action: "resume" });
  assert.equal(required(resumedForInput.snapshot.assistant.tasks.find((item) => item.id === taskId), "resumed task").status, "waiting_input", "resuming a deferred input request must not skip the user question");
  await service.answerAssistantTask(taskId, { requestId: "assistant-v4-answer", inputRequestId: input.id, optionId: "format-docx" });
  clock += 700;
  await service.tickAssistantTasks();

  snapshot = service.snapshot();
  let task = required(snapshot.assistant.tasks.find((item) => item.id === taskId), "task after preparation");
  assert.equal(task.status, "waiting_confirmation");
  const firstArtifact = required(snapshot.artifacts.find((item) => item.id === task.artifactId && item.version === task.artifactVersion), "first artifact");
  const firstContext = required(snapshot.contexts.find((item) => item.id === firstArtifact.contextBundleId), "first context");
  assert.deepEqual(firstContext.evidenceScope, { mode: "selected_record_ids", recordIds: ["sample-deadline", "sample-focus", "sample-scope"] });
  assert.equal(JSON.stringify(firstArtifact.sections).includes("18000"), false, "excluded evidence must not enter the artifact");
  const previewUi = initialAssistantUiState();
  previewUi.screen = "preview";
  previewUi.taskId = taskId;
  const previewMarkup = assistantView(snapshot, previewUi);
  assert.match(previewMarkup, /文件预览/, "a completed artifact has a lightweight local preview");
  assert.match(previewMarkup, /本地可编辑内容/, "the preview states that it is local content rather than a cloud copy");

  const requirement = await service.addAssistantRequirement(taskId, { requestId: "assistant-v4-add-requirement", content: "精简技术细节，突出待确认项" });
  snapshot = requirement.snapshot;
  task = required(snapshot.assistant.tasks.find((item) => item.id === taskId), "task after requirement");
  assert.equal(task.status, "paused", "adding a requirement after a pending artifact pauses the task");
  assert.equal(task.artifactId, null, "the outdated artifact cannot remain the task result");
  assert.deepEqual(task.requirements, ["精简技术细节，突出待确认项"]);
  assert.equal(required(snapshot.assistant.confirmations.find((item) => item.taskId === taskId), "expired confirmation after requirement").status, "expired");
  const decodedRequirement = decodeSnapshot(JSON.parse(JSON.stringify(snapshot)));
  assert.ok(decodedRequirement.assistant.events.some((item) => item.taskId === taskId && item.kind === "requirement-added"), "the browser decoder must accept requirement-added events");

  const deadlineEvidence = required(snapshot.assistant.evidence.find((item) => item.taskId === taskId && item.sourceRef === "sample-deadline"), "deadline evidence");
  await service.updateAssistantEvidence(deadlineEvidence.id, { requestId: "assistant-v4-exclude-deadline", included: false });
  snapshot = service.snapshot();
  task = required(snapshot.assistant.tasks.find((item) => item.id === taskId), "task after evidence change");
  assert.equal(task.status, "paused", "changing a pending artifact's evidence pauses the task");
  assert.equal(task.artifactId, null, "the outdated artifact cannot remain the task result");
  assert.equal(required(snapshot.assistant.confirmations.find((item) => item.taskId === taskId), "expired confirmation").status, "expired");

  await service.actOnAssistantTask(taskId, { requestId: "assistant-v4-resume", action: "resume" });
  clock += 600;
  await service.tickAssistantTasks();
  snapshot = service.snapshot();
  task = required(snapshot.assistant.tasks.find((item) => item.id === taskId), "task after regeneration");
  assert.equal(task.status, "waiting_confirmation");
  const artifact = required(snapshot.artifacts.find((item) => item.id === task.artifactId && item.version === task.artifactVersion), "regenerated artifact");
  const context = required(snapshot.contexts.find((item) => item.id === artifact.contextBundleId), "regenerated context");
  assert.deepEqual(context.evidenceScope, { mode: "selected_record_ids", recordIds: ["sample-focus", "sample-scope"] });
  assert.equal(JSON.stringify(artifact.sections).includes("18000"), false);
  assert.equal(JSON.stringify(artifact.sections).includes("周四完成"), false);
  assert.ok(artifact.userRequirements.includes("精简技术细节，突出待确认项"), "the regenerated artifact must include the added task requirement");

  const confirmation = required(snapshot.assistant.confirmations.find((item) => item.taskId === taskId && item.status === "pending"), "current confirmation");
  const completed = await service.confirmAssistantTask(taskId, { requestId: "assistant-v4-confirm", confirmationId: confirmation.id, decision: "approved" });
  const completedTask = required(completed.snapshot.assistant.tasks.find((item) => item.id === taskId), "completed task");
  assert.equal(completedTask.status, "completed");
  const receipt = required(completed.snapshot.exports.find((item) => item.operationId === completedTask.exportOperationId), "export receipt");
  const downloaded = await service.download(receipt.operationId);
  assert.ok(downloaded.bytes.length > 0, "the confirmed export must be downloadable");

  await assert.rejects(
    service.updateAssistantEvidence(deadlineEvidence.id, { requestId: "assistant-v4-after-complete", included: true }),
    (error: unknown) => error instanceof DomainError && error.code === "ASSISTANT_EVIDENCE_LOCKED",
  );
  await assert.rejects(
    service.addAssistantRequirement(taskId, { requestId: "assistant-v4-after-complete-requirement", content: "不要再改写" }),
    (error: unknown) => error instanceof DomainError && error.code === "ASSISTANT_REQUIREMENT_LOCKED",
  );

  const cancellable = await service.createAssistantSession({ requestId: "assistant-v4-cancellable", mode: "task", content: "准备另一份汇报结构", contextId: "mx-product" });
  const cancellableTaskId = required(cancellable.taskId, "cancellable task ID");
  const cancelled = await service.actOnAssistantTask(cancellableTaskId, { requestId: "assistant-v4-cancel", action: "cancel" });
  assert.equal(required(cancelled.snapshot.assistant.tasks.find((item) => item.id === cancellableTaskId), "cancelled task").status, "cancelled");
  const decoded = decodeSnapshot(JSON.parse(JSON.stringify(cancelled.snapshot)));
  assert.ok(decoded.assistant.events.some((item) => item.taskId === cancellableTaskId && item.kind === "task-cancelled"), "the browser decoder must accept a cancelled-task event");
});
