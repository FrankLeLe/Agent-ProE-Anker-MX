/** Request-scoped D1 snapshots and create-only R2 objects for an owner-private Site. */
import type { D1Database, D1DatabaseSession, R2Bucket } from "@cloudflare/workers-types";
import { z } from "zod";
import type { ArtifactStorage } from "./docx-export.ts";
import { DomainError } from "./errors.ts";
import { initialState, stateSchema } from "./h5-state.ts";
import type { H5StateStore, LocalState } from "./h5-state.ts";

const stateRowSchema = z.object({ revision: z.number().int().positive(), payload: z.string() });
type StateRow = z.infer<typeof stateRowSchema>;
const MAX_STATE_BYTES: number = 1_500_000;

export class D1StateStore implements H5StateStore {
  readonly database: D1Database;
  readonly ownerKey: string;
  private session: D1DatabaseSession;
  private current: LocalState;

  constructor(database: D1Database, ownerKey: string, state: LocalState) {
    this.database = database;
    this.session = database.withSession("first-primary");
    this.ownerKey = ownerKey;
    this.current = state;
  }

  read(): LocalState { return structuredClone(this.current); }

  async refresh(): Promise<void> {
    this.session = this.database.withSession("first-primary");
    this.current = await readState(this.session, this.ownerKey);
  }

  async save(input: LocalState): Promise<void> {
    const state: LocalState = stateSchema.parse(input);
    const expectedRevision: number = this.current.revision;
    if (state.revision !== expectedRevision + 1) throw new DomainError("STATE_REVISION_CONFLICT", "State must advance exactly one revision", 409);
    const payload: string = JSON.stringify(state);
    if (Buffer.byteLength(payload) > MAX_STATE_BYTES) throw new DomainError("STATE_CAPACITY_REACHED", "个人体验空间已达到当前容量上限，请联系维护者扩展存储；本次内容尚未保存。", 507);
    const result = await this.session.prepare("UPDATE mx_state SET revision = ?, payload = ? WHERE id = ? AND revision = ?")
      .bind(state.revision, payload, this.ownerKey, expectedRevision).run();
    if (result.meta.changes !== 1) throw new DomainError("STATE_REVISION_CONFLICT", "记录已在其他请求中更新。请重新读取，再用保留的输入提交；导出结果请核对原操作。", 409);
    this.current = state;
  }
}

async function readState(database: D1DatabaseSession, ownerKey: string): Promise<LocalState> {
  const row = stateRowSchema.parse(await database.prepare("SELECT revision, payload FROM mx_state WHERE id = ?").bind(ownerKey).first<StateRow>());
  const state: LocalState = stateSchema.parse(JSON.parse(row.payload));
  if (state.revision !== row.revision) throw new DomainError("STATE_REVISION_MISMATCH", "Stored revision differs from its payload; maintenance is required", 503);
  return state;
}

export async function openSitesState(database: D1Database, ownerKey: string, now: string): Promise<D1StateStore> {
  const session: D1DatabaseSession = database.withSession("first-primary");
  const existing = await session.prepare("SELECT revision, payload FROM mx_state WHERE id = ?").bind(ownerKey).first<StateRow>();
  if (existing === null) {
    const seed: LocalState = initialState(now);
    await session.prepare("INSERT INTO mx_state (id, revision, payload) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING")
      .bind(ownerKey, seed.revision, JSON.stringify(seed)).run();
  }
  return new D1StateStore(database, ownerKey, await readState(session, ownerKey));
}

function objectKey(storageKey: string): string {
  if (!/^export-[a-f0-9]{64}\.docx$/.test(storageKey)) throw new DomainError("INVALID_STORAGE_KEY", "Export object key must identify one confirmed operation", 400);
  return `exports/${storageKey}`;
}

export class R2ArtifactStorage implements ArtifactStorage {
  readonly bucket: R2Bucket;
  readonly ownerKey: string;

  constructor(bucket: R2Bucket, ownerKey: string) { this.bucket = bucket; this.ownerKey = ownerKey; }

  async writeNew(storageKey: string, bytes: Buffer): Promise<void> {
    const result = await this.bucket.put(`${this.ownerKey}/${objectKey(storageKey)}`, new Uint8Array(bytes), {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    });
    if (result === null) throw new DomainError("EXPORT_OBJECT_EXISTS", "该导出文件已存在，请核对原操作结果，不得覆盖。", 409);
  }

  async read(storageKey: string): Promise<Buffer> {
    const result = await this.bucket.get(`${this.ownerKey}/${objectKey(storageKey)}`);
    if (result === null) throw new DomainError("EXPORT_OBJECT_MISSING", "原导出文件尚未找到，操作保持待核对；请联系维护者检查，不要重复创建。", 409);
    return Buffer.from(await result.arrayBuffer());
  }
}
