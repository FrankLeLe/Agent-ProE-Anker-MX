/** Loopback-only H5 transport with a narrow static allowlist and serialized local operations. */
import { readFile, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import path from "node:path";
import { z } from "zod";
import { DomainError } from "./errors.ts";
import { addMatterSchema, addRecordSchema, artifactRevisionSchema, assistantAnswerSchema, assistantConfirmSchema, assistantCreateSessionSchema, assistantEvidenceSchema, assistantPlanSchema, assistantRequirementSchema, assistantStartTaskSchema, assistantTaskActionSchema, assistantUpgradeSchema, confirmExportSchema, exportPlanInputSchema, prepareSchema, reviseRecordSchema, suggestionDecisionSchema } from "./h5-service.ts";
import { createH5Service } from "./h5-local-service.ts";
import type { H5Service, H5ServiceOptions } from "./h5-service.ts";
import type { H5ErrorResponse } from "./h5-types.ts";

const MAX_BODY_BYTES: number = 256 * 1024;
type JsonBody = z.infer<typeof jsonValueSchema>;
const jsonValueSchema = z.json();

export function validateLocalHost(host: string): string {
  if (host !== "127.0.0.1" && host !== "localhost") throw new DomainError("NONLOCAL_HOST", "Local H5 only supports --host 127.0.0.1 or localhost", 400);
  return host;
}

function assertLocalRequest(request: IncomingMessage): void {
  const host: string = request.headers.host ?? "";
  if (!/^(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(host)) throw new DomainError("HOST_FORBIDDEN", "Local preview requires a localhost or 127.0.0.1 Host header", 403);
  const origin: string | undefined = request.headers.origin;
  if (origin !== undefined) {
    let parsed: URL;
    try { parsed = new URL(origin); }
    catch (error) { if (!(error instanceof TypeError)) throw error; throw new DomainError("ORIGIN_FORBIDDEN", "Origin must be this local preview address", 403); }
    if (parsed.protocol !== "http:" || parsed.host !== host || parsed.username !== "" || parsed.password !== "" || parsed.origin !== origin) throw new DomainError("ORIGIN_FORBIDDEN", "Origin must match this exact local preview host and port", 403);
  }
  if (request.headers["sec-fetch-site"] === "cross-site") throw new DomainError("ORIGIN_FORBIDDEN", "Cross-site requests cannot access the local preview", 403);
}

async function bodyJson(request: IncomingMessage): Promise<JsonBody> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers["content-type"] ?? "")) throw new DomainError("CONTENT_TYPE_REQUIRED", "Request body must use application/json with UTF-8 encoding", 415);
  const length: string | undefined = request.headers["content-length"];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new DomainError("BODY_TOO_LARGE", `JSON request exceeds ${MAX_BODY_BYTES} bytes`, 413);
  const chunks: Buffer[] = [];
  let size: number = 0;
  for await (const rawChunk of request) {
    const chunk: Buffer = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(String(rawChunk));
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new DomainError("BODY_TOO_LARGE", `JSON request exceeds ${MAX_BODY_BYTES} bytes`, 413);
    chunks.push(chunk);
  }
  try { return jsonValueSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
  catch (error) {
    if (error instanceof SyntaxError) throw new DomainError("INVALID_JSON", "Request body is not valid JSON; correct the JSON and resend", 400);
    throw error;
  }
}

function sendJson(response: ServerResponse, status: number, value: object): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

function assertMethod(request: IncomingMessage, method: string): void {
  if (request.method !== method) throw new DomainError("METHOD_NOT_ALLOWED", `This endpoint requires ${method}; received ${request.method ?? "missing method"}`, 405);
}

function requestPath(request: IncomingMessage): string {
  const rawPath: string = (request.url ?? "/").split("?")[0] ?? "/";
  let decoded: string;
  try { decoded = decodeURIComponent(rawPath); }
  catch (error) { if (!(error instanceof URIError)) throw error; throw new DomainError("INVALID_PATH", "URL path contains malformed encoding", 400); }
  if (!decoded.startsWith("/") || decoded.includes("\\") || decoded.includes("\0") || decoded.split("/").some((part) => part === ".." || part === ".") || decoded.includes("%")) throw new DomainError("INVALID_PATH", "Path traversal or double-encoded paths are not allowed", 400);
  return decoded;
}

async function staticFile(workspaceRoot: string, pathname: string): Promise<{ bytes: Buffer; type: string }> {
  let directory: string;
  let relative: string;
  let type: string;
  if (pathname === "/" || pathname === "/index.html") { directory = "web"; relative = "index.html"; type = "text/html; charset=utf-8"; }
  else if (pathname === "/_preview/iphone") { directory = "web"; relative = "iphone-preview.html"; type = "text/html; charset=utf-8"; }
  else if (pathname === "/_preview/iphone.css") { directory = "web"; relative = "iphone-preview.css"; type = "text/css; charset=utf-8"; }
  else if (pathname === "/_preview/iphone.js") { directory = "web"; relative = "iphone-preview.js"; type = "text/javascript; charset=utf-8"; }
  else if (pathname === "/_preview/iphone/Bezel.png") { directory = "scripts/assets/iphone"; relative = "Bezel.png"; type = "image/png"; }
  else if (pathname === "/_preview/iphone/status-icons.svg") { directory = "scripts/assets/iphone"; relative = "ios-status-icons.svg"; type = "image/svg+xml"; }
  else if (pathname === "/styles.css") { directory = "web"; relative = "styles.css"; type = "text/css; charset=utf-8"; }
  else if (/^\/[a-zA-Z0-9_-]+\.js$/.test(pathname)) { directory = "work/h5-build"; relative = pathname.slice(1); type = "text/javascript; charset=utf-8"; }
  else if (/^\/assets\/[a-zA-Z0-9_./-]+\.(png|jpg|jpeg|webp|svg|avif)$/.test(pathname)) {
    directory = "web/assets"; relative = pathname.slice("/assets/".length);
    const extension: string = path.extname(relative).slice(1);
    const types: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml", avif: "image/avif" };
    type = types[extension] ?? "application/octet-stream";
  } else throw new DomainError("NOT_FOUND", "This local preview does not serve the requested path", 404);
  const root: string = await realpath(path.join(workspaceRoot, directory));
  const actual: string = await realpath(path.join(root, relative));
  const containment: string = path.relative(root, actual);
  if (containment === ".." || containment.startsWith(`..${path.sep}`) || path.isAbsolute(containment)) throw new DomainError("STATIC_PATH_ESCAPE", "Static asset resolves outside its assigned directory", 403);
  return { bytes: await readFile(actual), type };
}

async function route(request: IncomingMessage, response: ServerResponse, service: H5Service, options: H5ServiceOptions): Promise<void> {
  assertLocalRequest(request);
  const pathname: string = requestPath(request);
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  const previewShell: boolean = pathname === "/_preview/iphone";
  const appDocument: boolean = pathname === "/" || pathname === "/index.html";
  response.setHeader("content-security-policy", `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src ${previewShell ? "'self'" : "'none'"}; base-uri 'none'; form-action 'self'; frame-ancestors ${appDocument ? "'self'" : "'none'"}`);
  if (!["GET", "POST", "PATCH"].includes(request.method ?? "")) throw new DomainError("METHOD_NOT_ALLOWED", "Local H5 supports GET, POST and PATCH on their designated endpoints", 405);
  if (pathname === "/api/state") { assertMethod(request, "GET"); sendJson(response, 200, service.snapshot()); return; }
  if (pathname === "/api/assistant/state") { assertMethod(request, "GET"); sendJson(response, 200, service.snapshot()); return; }
  if (pathname === "/api/assistant/sessions") { assertMethod(request, "POST"); sendJson(response, 200, await service.createAssistantSession(assistantCreateSessionSchema.parse(await bodyJson(request)))); return; }
  const sessionUpgradeMatch: RegExpExecArray | null = /^\/api\/assistant\/sessions\/([a-zA-Z0-9._:-]+)\/upgrade$/.exec(pathname);
  if (sessionUpgradeMatch?.[1] !== undefined) { assertMethod(request, "POST"); sendJson(response, 200, await service.upgradeAssistantSession(sessionUpgradeMatch[1], assistantUpgradeSchema.parse(await bodyJson(request)))); return; }
  const taskStartMatch: RegExpExecArray | null = /^\/api\/assistant\/tasks\/([a-zA-Z0-9._:-]+)\/start$/.exec(pathname);
  if (taskStartMatch?.[1] !== undefined) { assertMethod(request, "POST"); sendJson(response, 200, await service.startAssistantTask(taskStartMatch[1], assistantStartTaskSchema.parse(await bodyJson(request)))); return; }
  const taskAnswerMatch: RegExpExecArray | null = /^\/api\/assistant\/tasks\/([a-zA-Z0-9._:-]+)\/answer$/.exec(pathname);
  if (taskAnswerMatch?.[1] !== undefined) { assertMethod(request, "POST"); sendJson(response, 200, await service.answerAssistantTask(taskAnswerMatch[1], assistantAnswerSchema.parse(await bodyJson(request)))); return; }
  const taskPlanMatch: RegExpExecArray | null = /^\/api\/assistant\/tasks\/([a-zA-Z0-9._:-]+)\/plan$/.exec(pathname);
  if (taskPlanMatch?.[1] !== undefined) { assertMethod(request, "PATCH"); sendJson(response, 200, await service.updateAssistantPlan(taskPlanMatch[1], assistantPlanSchema.parse(await bodyJson(request)))); return; }
  const taskConfirmMatch: RegExpExecArray | null = /^\/api\/assistant\/tasks\/([a-zA-Z0-9._:-]+)\/confirm$/.exec(pathname);
  if (taskConfirmMatch?.[1] !== undefined) { assertMethod(request, "POST"); sendJson(response, 200, await service.confirmAssistantTask(taskConfirmMatch[1], assistantConfirmSchema.parse(await bodyJson(request)))); return; }
  const taskActionMatch: RegExpExecArray | null = /^\/api\/assistant\/tasks\/([a-zA-Z0-9._:-]+)\/action$/.exec(pathname);
  if (taskActionMatch?.[1] !== undefined) { assertMethod(request, "POST"); sendJson(response, 200, await service.actOnAssistantTask(taskActionMatch[1], assistantTaskActionSchema.parse(await bodyJson(request)))); return; }
  const taskRequirementMatch: RegExpExecArray | null = /^\/api\/assistant\/tasks\/([a-zA-Z0-9._:-]+)\/requirements$/.exec(pathname);
  if (taskRequirementMatch?.[1] !== undefined) { assertMethod(request, "POST"); sendJson(response, 200, await service.addAssistantRequirement(taskRequirementMatch[1], assistantRequirementSchema.parse(await bodyJson(request)))); return; }
  const evidenceMatch: RegExpExecArray | null = /^\/api\/assistant\/evidence\/([a-zA-Z0-9._:-]+)$/.exec(pathname);
  if (evidenceMatch?.[1] !== undefined) { assertMethod(request, "PATCH"); sendJson(response, 200, await service.updateAssistantEvidence(evidenceMatch[1], assistantEvidenceSchema.parse(await bodyJson(request)))); return; }
  if (pathname === "/api/matters") { assertMethod(request, "POST"); sendJson(response, 200, await service.addMatter(addMatterSchema.parse(await bodyJson(request)))); return; }
  if (pathname === "/api/records") { assertMethod(request, "POST"); sendJson(response, 200, await service.addRecord(addRecordSchema.parse(await bodyJson(request)))); return; }
  const recordMatch: RegExpExecArray | null = /^\/api\/records\/([a-zA-Z0-9._:-]+)$/.exec(pathname);
  if (recordMatch?.[1] !== undefined) { assertMethod(request, "PATCH"); sendJson(response, 200, await service.reviseRecord(recordMatch[1], reviseRecordSchema.parse(await bodyJson(request)))); return; }
  const suggestionMatch: RegExpExecArray | null = /^\/api\/suggestions\/([a-zA-Z0-9._:-]+)\/decision$/.exec(pathname);
  if (suggestionMatch?.[1] !== undefined) { assertMethod(request, "POST"); sendJson(response, 200, await service.decideSuggestion(suggestionMatch[1], suggestionDecisionSchema.parse(await bodyJson(request)))); return; }
  if (pathname === "/api/prepare") { assertMethod(request, "POST"); sendJson(response, 200, await service.prepare(prepareSchema.parse(await bodyJson(request)))); return; }
  const revisionMatch: RegExpExecArray | null = /^\/api\/artifacts\/([a-zA-Z0-9._:-]+)\/revisions$/.exec(pathname);
  if (revisionMatch?.[1] !== undefined) { assertMethod(request, "POST"); sendJson(response, 200, await service.reviseArtifact(revisionMatch[1], artifactRevisionSchema.parse(await bodyJson(request)))); return; }
  if (pathname === "/api/export-plans") { assertMethod(request, "POST"); sendJson(response, 200, await service.planExport(exportPlanInputSchema.parse(await bodyJson(request)))); return; }
  if (pathname === "/api/exports") { assertMethod(request, "POST"); sendJson(response, 200, await service.export(confirmExportSchema.parse(await bodyJson(request)))); return; }
  const downloadMatch: RegExpExecArray | null = /^\/api\/downloads\/(export-[a-f0-9]{64})$/.exec(pathname);
  if (downloadMatch?.[1] !== undefined) {
    assertMethod(request, "GET");
    const result = await service.download(downloadMatch[1]);
    response.writeHead(200, { "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "content-disposition": `attachment; filename="${result.filename}"`, "content-length": result.bytes.length, "cache-control": "no-store" });
    response.end(result.bytes); return;
  }
  if (pathname.startsWith("/api/")) throw new DomainError("NOT_FOUND", "No API endpoint matches this path", 404);
  assertMethod(request, "GET");
  const file = await staticFile(options.workspaceRoot, pathname);
  response.writeHead(200, { "content-type": file.type, "cache-control": "no-store" });
  response.end(file.bytes);
}

function handleError(error: object, response: ServerResponse): void {
  let failure: DomainError;
  if (error instanceof DomainError) failure = error;
  else if (error instanceof z.ZodError) failure = new DomainError("INVALID_INPUT", error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; "), 400);
  else if (error instanceof Error && "code" in error && error.code === "ENOENT") failure = new DomainError("FILE_NOT_FOUND", "Required local file is missing; build the H5 frontend or inspect the saved export before retrying", 404);
  else {
    const code: string = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "UNEXPECTED_ERROR";
    process.stderr.write(`${JSON.stringify({ event: "h5_request_error", code, errorType: error instanceof Error ? error.name : "NonError" })}\n`);
    failure = new DomainError("LOCAL_OPERATION_FAILED", `Local operation could not be verified (${code}); inspect server logs and persisted state before retrying`, 500);
  }
  if (failure.status >= 500) process.stderr.write(`${JSON.stringify({ event: "h5_operation_blocked", code: failure.code, status: failure.status })}\n`);
  if (!response.headersSent) {
    const body: H5ErrorResponse = { error: { code: failure.code, message: failure.message } };
    sendJson(response, failure.status, body);
  } else response.destroy(failure);
}

export async function createH5Server(options: H5ServiceOptions): Promise<Server> {
  const service: H5Service = await createH5Service(options);
  let pending: Promise<void> = Promise.resolve();
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const task: Promise<T> = pending.then(operation);
    pending = task.then(() => undefined, () => undefined);
    return task;
  };
  const server: Server = createServer((request, response): void => {
    void enqueue(async (): Promise<void> => { await route(request, response, service, options); }).catch((error: unknown): void => { handleError(error instanceof Error ? error : new Error("Unknown local request failure"), response); });
  });
  const taskTimer: NodeJS.Timeout = setInterval((): void => {
    void enqueue(async (): Promise<void> => { await service.tickAssistantTasks(); }).catch((error: unknown): void => {
      const code: string = error instanceof DomainError ? error.code : "ASSISTANT_TICK_FAILED";
      process.stderr.write(`${JSON.stringify({ event: "assistant_task_tick_failed", code })}\n`);
    });
  }, 400);
  server.once("close", (): void => { clearInterval(taskTimer); });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return server;
}
