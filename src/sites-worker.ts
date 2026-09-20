/** Private Sites transport. Dispatcher identity scopes every state row and exported object. */
import { createHash } from "node:crypto";
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { z } from "zod";
import { DomainError } from "./errors.ts";
import { addMatterSchema, addRecordSchema, artifactRevisionSchema, confirmExportSchema, exportPlanInputSchema, H5Service, prepareSchema, reviseRecordSchema, suggestionDecisionSchema } from "./h5-service.ts";
import { openSitesState, R2ArtifactStorage } from "./sites-storage.ts";
import { loadSitesTemplate } from "./sites-templates.ts";

export interface SitesEnvironment {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const MAX_BODY_BYTES: number = 256 * 1024;
const jsonSchema = z.json();
type JsonBody = z.infer<typeof jsonSchema>;

function json(value: object, status: number): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function method(request: Request, expected: string): void {
  if (request.method !== expected) throw new DomainError("METHOD_NOT_ALLOWED", `This endpoint requires ${expected}; received ${request.method}`, 405);
}

async function body(request: Request): Promise<JsonBody> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) throw new DomainError("CONTENT_TYPE_REQUIRED", "Request body must use application/json", 415);
  if (request.body === null) throw new DomainError("INVALID_JSON", "A JSON request body is required", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length: number = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > MAX_BODY_BYTES) { await reader.cancel(); throw new DomainError("BODY_TOO_LARGE", "JSON request exceeds 256 KiB", 413); }
    chunks.push(part.value);
  }
  try { return jsonSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
  catch (error) {
    if (error instanceof SyntaxError) throw new DomainError("INVALID_JSON", "Request body is not valid JSON", 400);
    throw error;
  }
}

function identity(request: Request): string {
  const userId: string = request.headers.get("oai-authenticated-user-id")?.trim() ?? "";
  if (userId.length === 0 || userId.length > 512) throw new DomainError("SIGN_IN_REQUIRED", "请使用站点所有者的 ChatGPT 账号登录后打开此页面。", 401);
  return createHash("sha256").update(userId).digest("hex");
}

function pathname(request: Request): string {
  const url: URL = new URL(request.url);
  const origin: string | null = request.headers.get("origin");
  if ((origin !== null && origin !== url.origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new DomainError("ORIGIN_FORBIDDEN", "Requests must originate from this exact Site", 403);
  let decoded: string;
  try { decoded = decodeURIComponent(url.pathname); }
  catch (error) { if (!(error instanceof URIError)) throw error; throw new DomainError("INVALID_PATH", "Path encoding is invalid", 400); }
  if (decoded.includes("\\") || decoded.includes("\0") || decoded.includes("%") || decoded.split("/").some((item) => item === ".." || item === ".")) throw new DomainError("INVALID_PATH", "Path traversal and double encoding are not supported", 400);
  return decoded;
}

async function route(request: Request, env: SitesEnvironment): Promise<Response> {
  const routePath: string = pathname(request);
  const ownerKey: string = identity(request);
  if (!routePath.startsWith("/api/")) {
    method(request, "GET");
    return env.ASSETS.fetch(request);
  }
  const store = await openSitesState(env.DB, ownerKey, new Date().toISOString());
  const service: H5Service = new H5Service(store, {
    now: () => new Date().toISOString(), mode: "hosted-private", loadTemplate: loadSitesTemplate,
    storage: new R2ArtifactStorage(env.BUCKET, ownerKey),
  });
  if (routePath === "/api/state") { method(request, "GET"); return json(service.snapshot(), 200); }
  if (routePath === "/api/matters") { method(request, "POST"); return json(await service.addMatter(addMatterSchema.parse(await body(request))), 200); }
  if (routePath === "/api/records") { method(request, "POST"); return json(await service.addRecord(addRecordSchema.parse(await body(request))), 200); }
  const record: RegExpExecArray | null = /^\/api\/records\/([a-zA-Z0-9._:-]+)$/.exec(routePath);
  if (record?.[1] !== undefined) { method(request, "PATCH"); return json(await service.reviseRecord(record[1], reviseRecordSchema.parse(await body(request))), 200); }
  const suggestion: RegExpExecArray | null = /^\/api\/suggestions\/([a-zA-Z0-9._:-]+)\/decision$/.exec(routePath);
  if (suggestion?.[1] !== undefined) { method(request, "POST"); return json(await service.decideSuggestion(suggestion[1], suggestionDecisionSchema.parse(await body(request))), 200); }
  if (routePath === "/api/prepare") { method(request, "POST"); return json(await service.prepare(prepareSchema.parse(await body(request))), 200); }
  const artifact: RegExpExecArray | null = /^\/api\/artifacts\/([a-zA-Z0-9._:-]+)\/revisions$/.exec(routePath);
  if (artifact?.[1] !== undefined) { method(request, "POST"); return json(await service.reviseArtifact(artifact[1], artifactRevisionSchema.parse(await body(request))), 200); }
  if (routePath === "/api/export-plans") { method(request, "POST"); return json(await service.planExport(exportPlanInputSchema.parse(await body(request))), 200); }
  if (routePath === "/api/exports") { method(request, "POST"); return json(await service.export(confirmExportSchema.parse(await body(request))), 200); }
  const download: RegExpExecArray | null = /^\/api\/downloads\/(export-[a-f0-9]{64})$/.exec(routePath);
  if (download?.[1] !== undefined) {
    method(request, "GET");
    const result = await service.download(download[1]);
    return new Response(new Uint8Array(result.bytes), { headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${result.filename}"`, "cache-control": "no-store",
    } });
  }
  throw new DomainError("NOT_FOUND", "No API endpoint matches this path", 404);
}

export default {
  async fetch(request: Request, env: SitesEnvironment): Promise<Response> {
    let response: Response;
    try { response = await route(request, env); }
    catch (error) {
      if (error instanceof DomainError) response = json({ error: { code: error.code, message: error.message } }, error.status);
      else if (error instanceof z.ZodError) response = json({ error: { code: "INVALID_INPUT", message: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") } }, 400);
      else {
        console.error(JSON.stringify({ event: "sites_request_unverified", method: request.method, errorType: error instanceof Error ? error.name : "NonError" }));
        response = json({ error: { code: "PERSISTENCE_UNVERIFIED", message: "云端读写未能核对。请重新读取已保存版本；导出请核对原操作，勿创建重复请求。未保存输入仍保留。" } }, 503);
      }
    }
    const secure: Response = new Response(response.body, response);
    secure.headers.set("x-content-type-options", "nosniff");
    secure.headers.set("referrer-policy", "no-referrer");
    secure.headers.set("content-security-policy", "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    return secure;
  },
};
