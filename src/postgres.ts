/** Owner-scoped PostgreSQL snapshots, immutable artifact versions, and execution records.
 * File fields on non-completed runs describe expected output, not a verified receipt.
 * Callers supply an authenticated owner and a configured Pool; schema setup is explicit.
 * Source freshness and action confirmation remain required service-layer checks.
 */
import { DatabaseError } from "pg";
import type { Pool, PoolClient, QueryResult } from "pg";
import { z } from "zod";
import { artifactSchema, contextBundleSchema, identifierSchema, toolRunSchema } from "./contracts.ts";
import type { ContextBundle, PreparedArtifact, ToolRun } from "./contracts.ts";
import { DomainError } from "./errors.ts";

interface PayloadRow { payload: string; }
type SqlValue = string | number | null;
export interface ClaimedRun { created: boolean; run: ToolRun; }

async function query(connection: Pool | PoolClient, text: string, values: SqlValue[], operation: string): Promise<QueryResult<PayloadRow>> {
  try {
    return await connection.query<PayloadRow, SqlValue[]>(text, values);
  } catch (error) {
    if (!(error instanceof DatabaseError)) throw error;
    const conflict: boolean = error.code === "23505" || error.code === "23503" || error.code === "23514";
    const failure: DomainError = new DomainError(
      conflict ? "POSTGRES_CONTRACT_CONFLICT" : "POSTGRES_QUERY_FAILED",
      `${operation} failed with PostgreSQL SQLSTATE ${error.code ?? "unavailable"}; inspect the schema, referenced version, and server diagnostic for constraint ${error.constraint ?? "unspecified"}`,
      conflict ? 409 : 503,
    );
    failure.cause = error;
    throw failure;
  }
}

function parseStored<T>(row: PayloadRow, schema: z.ZodType<T>, location: string): T {
  const result: z.ZodSafeParseResult<T> = schema.safeParse(JSON.parse(row.payload));
  if (!result.success) {
    throw new DomainError("STORED_CONTRACT_INVALID", `${location} does not match the current data contract; inspect its stored contract version before continuing`, 500);
  }
  return result.data;
}

function validateContext(context: ContextBundle): ContextBundle {
  if (context.memories.some((memory) => memory.ownerId !== context.ownerId || memory.contextId !== context.contextId)) {
    throw new DomainError("CONTEXT_MEMORY_MISMATCH", `Background ${context.id} contains memory belonging to another owner or matter`, 403);
  }
  return context;
}

function readArtifact(row: PayloadRow, ownerId: string, id: string): PreparedArtifact {
  const artifact: PreparedArtifact = parseStored(row, artifactSchema, `Artifact ${id}`);
  if (artifact.ownerId !== ownerId || artifact.id !== id) {
    throw new DomainError("STORED_IDENTITY_MISMATCH", `Stored artifact identity does not match the requested artifact ${id}`, 500);
  }
  return artifact;
}

async function artifactTransaction(pool: Pool, work: (client: PoolClient) => Promise<void>): Promise<void> {
  const client: PoolClient = await pool.connect();
  let discard: boolean = false;
  try {
    await query(client, "BEGIN ISOLATION LEVEL READ COMMITTED", [], "Begin artifact transaction");
    await work(client);
    await query(client, "COMMIT", [], "Commit artifact transaction");
  } catch (error) {
    try {
      await query(client, "ROLLBACK", [], "Roll back artifact transaction");
    } catch (rollbackError) {
      discard = true;
      throw new AggregateError([error, rollbackError], "Artifact transaction and rollback failed; the connection was discarded. Query the intended version before another write");
    }
    throw error;
  } finally {
    client.release(discard);
  }
}

export class PostgresStore {
  readonly #pool: Pool;

  constructor(pool: Pool) { this.#pool = pool; }

  /** Saving identical content is idempotent; a snapshot ID cannot be repurposed. */
  async saveContext(input: ContextBundle): Promise<void> {
    const context: ContextBundle = validateContext(contextBundleSchema.parse(input));
    const result: QueryResult<PayloadRow> = await query(this.#pool,
      `INSERT INTO mixture_x.context_bundles (owner_id, id, context_id, payload)
       VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (owner_id, id) DO NOTHING
       RETURNING payload::text AS payload`,
      [context.ownerId, context.id, context.contextId, JSON.stringify(context)], `Save background ${context.id}`);
    if (result.rows.length > 0) return;
    const existing: ContextBundle | null = await this.getContext(context.ownerId, context.id);
    if (existing === null || JSON.stringify(existing) !== JSON.stringify(context)) {
      throw new DomainError("CONTEXT_SNAPSHOT_CONFLICT", `Background ${context.id} already exists with different content; create a new snapshot ID`, 409);
    }
  }

  async getContext(ownerId: string, id: string): Promise<ContextBundle | null> {
    identifierSchema.parse(ownerId);
    identifierSchema.parse(id);
    const result: QueryResult<PayloadRow> = await query(this.#pool,
      "SELECT payload::text AS payload FROM mixture_x.context_bundles WHERE owner_id = $1 AND id = $2",
      [ownerId, id], `Read background ${id}`);
    const row: PayloadRow | undefined = result.rows[0];
    if (row === undefined) return null;
    const context: ContextBundle = validateContext(parseStored(row, contextBundleSchema, `Background ${id}`));
    if (context.ownerId !== ownerId || context.id !== id) {
      throw new DomainError("STORED_IDENTITY_MISMATCH", `Stored background identity does not match the requested background ${id}`, 500);
    }
    return context;
  }

  /** Append one revision under a per-owner/artifact transaction lock; never overwrite. */
  async saveArtifact(input: PreparedArtifact): Promise<void> {
    const artifact: PreparedArtifact = artifactSchema.parse(input);
    await artifactTransaction(this.#pool, async (client: PoolClient): Promise<void> => {
      await query(client, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [JSON.stringify(["mixture_x.artifact", artifact.ownerId, artifact.id])], `Lock artifact ${artifact.id}`);
      const latest: QueryResult<PayloadRow> = await query(client,
        "SELECT payload::text AS payload FROM mixture_x.artifact_versions WHERE owner_id = $1 AND id = $2 ORDER BY version DESC LIMIT 1",
        [artifact.ownerId, artifact.id], `Read latest artifact ${artifact.id}`);
      const row: PayloadRow | undefined = latest.rows[0];
      const previous: PreparedArtifact | null = row === undefined ? null : readArtifact(row, artifact.ownerId, artifact.id);
      if (previous === null ? artifact.version !== 1 : artifact.previousVersion !== previous.version || artifact.version !== previous.version + 1) {
        throw new DomainError("ARTIFACT_VERSION_CONFLICT", `Artifact ${artifact.id} must append version ${(previous?.version ?? 0) + 1}; requested version ${artifact.version}`, 409);
      }
      if (previous !== null && (previous.contextId !== artifact.contextId || previous.skillId !== artifact.skillId)) {
        throw new DomainError("ARTIFACT_IDENTITY_CONFLICT", `Artifact ${artifact.id} cannot change its matter or skill across revisions`, 409);
      }
      await query(client,
        `INSERT INTO mixture_x.artifact_versions (owner_id, id, version, previous_version, context_id, skill_id, context_bundle_id, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [artifact.ownerId, artifact.id, artifact.version, artifact.previousVersion, artifact.contextId, artifact.skillId, artifact.contextBundleId, JSON.stringify(artifact)],
        `Append artifact ${artifact.id} version ${artifact.version}`);
    });
  }

  async getArtifact(ownerId: string, id: string, version: number): Promise<PreparedArtifact | null> {
    identifierSchema.parse(ownerId);
    identifierSchema.parse(id);
    z.number().int().positive().parse(version);
    const result: QueryResult<PayloadRow> = await query(this.#pool,
      "SELECT payload::text AS payload FROM mixture_x.artifact_versions WHERE owner_id = $1 AND id = $2 AND version = $3",
      [ownerId, id, version], `Read artifact ${id} version ${version}`);
    const row: PayloadRow | undefined = result.rows[0];
    if (row === undefined) return null;
    const artifact: PreparedArtifact = readArtifact(row, ownerId, id);
    if (artifact.version !== version) throw new DomainError("STORED_VERSION_MISMATCH", `Stored artifact ${id} does not match requested version ${version}`, 500);
    return artifact;
  }

  async getLatestArtifact(ownerId: string, id: string): Promise<PreparedArtifact | null> {
    identifierSchema.parse(ownerId);
    identifierSchema.parse(id);
    const result: QueryResult<PayloadRow> = await query(this.#pool,
      "SELECT payload::text AS payload FROM mixture_x.artifact_versions WHERE owner_id = $1 AND id = $2 ORDER BY version DESC LIMIT 1",
      [ownerId, id], `Read latest artifact ${id}`);
    const row: PayloadRow | undefined = result.rows[0];
    return row === undefined ? null : readArtifact(row, ownerId, id);
  }

  /** Only the caller receiving created=true owns the external write. */
  async claimRun(input: ToolRun): Promise<ClaimedRun> {
    const run: ToolRun = toolRunSchema.parse(input);
    if (run.state !== "executing") throw new DomainError("INVALID_EXECUTION_START", `Operation ${run.operationId} must be claimed in executing state`, 400);
    const result: QueryResult<PayloadRow> = await query(this.#pool,
      `INSERT INTO mixture_x.tool_runs (owner_id, operation_id, plan_id, plan_hash, state, payload)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb) ON CONFLICT DO NOTHING RETURNING payload::text AS payload`,
      [run.ownerId, run.operationId, run.planId, run.planHash, run.state, JSON.stringify(run)], `Claim operation ${run.operationId}`);
    if (result.rows.length > 0) return { created: true, run };
    const existing: ToolRun | null = await this.getRun(run.ownerId, run.operationId);
    if (existing === null || existing.planId !== run.planId || existing.planHash !== run.planHash) {
      throw new DomainError("OPERATION_IDENTITY_CONFLICT", `Operation ${run.operationId} or its plan hash is already claimed under different identity; query the original operation`, 409);
    }
    return { created: false, run: existing };
  }

  async getRun(ownerId: string, operationId: string): Promise<ToolRun | null> {
    identifierSchema.parse(ownerId);
    identifierSchema.parse(operationId);
    const result: QueryResult<PayloadRow> = await query(this.#pool,
      "SELECT payload::text AS payload FROM mixture_x.tool_runs WHERE owner_id = $1 AND operation_id = $2",
      [ownerId, operationId], `Read operation ${operationId}`);
    const row: PayloadRow | undefined = result.rows[0];
    if (row === undefined) return null;
    const run: ToolRun = parseStored(row, toolRunSchema, `Operation ${operationId}`);
    if (run.ownerId !== ownerId || run.operationId !== operationId) {
      throw new DomainError("STORED_IDENTITY_MISMATCH", `Stored operation identity does not match requested operation ${operationId}`, 500);
    }
    return run;
  }

  /** Resolve an active/unknown attempt atomically, preserving its plan and expected file. */
  async saveRunResult(input: ToolRun): Promise<void> {
    const run: ToolRun = toolRunSchema.parse(input);
    if (run.state === "executing") throw new DomainError("INVALID_RUN_TRANSITION", `Operation ${run.operationId} cannot transition back to executing`, 409);
    const result: QueryResult<PayloadRow> = await query(this.#pool,
      `UPDATE mixture_x.tool_runs SET state = $5, payload = $6::jsonb
       WHERE owner_id = $1 AND operation_id = $2 AND plan_id = $3 AND plan_hash = $4
         AND state IN ('executing', 'result_unknown')
         AND (payload->>'fileHash' IS NULL OR payload->>'fileHash' = $7)
         AND (payload->>'storageKey' IS NULL OR payload->>'storageKey' = $8)
         AND (payload->>'byteLength' IS NULL OR (payload->>'byteLength')::bigint = $9)
       RETURNING payload::text AS payload`,
      [run.ownerId, run.operationId, run.planId, run.planHash, run.state, JSON.stringify(run), run.fileHash, run.storageKey, run.byteLength],
      `Resolve operation ${run.operationId} as ${run.state}`);
    if (result.rows.length > 0) return;
    const existing: ToolRun | null = await this.getRun(run.ownerId, run.operationId);
    if (existing === null) throw new DomainError("OPERATION_NOT_FOUND", `Operation ${run.operationId} has not been claimed for this owner`, 404);
    throw new DomainError("RUN_RESULT_CONFLICT", `Operation ${run.operationId} is ${existing.state}; the result must match its original plan and expected file, and completed/failed/cancelled results cannot be replaced`, 409);
  }
}
