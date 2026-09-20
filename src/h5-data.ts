/** Append-only filesystem adapter for the loopback preview. */
import { mkdir, open, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { DomainError } from "./errors.ts";
import { initialState, stateSchema } from "./h5-state.ts";
import type { H5StateStore, LocalState } from "./h5-state.ts";
export { evidenceFromRecords, fingerprint, LOCAL_OWNER, recordSchema, stateSchema } from "./h5-state.ts";
export type { LocalState, SavedRequest } from "./h5-state.ts";

export async function containedDirectory(workspaceRoot: string, directory: string): Promise<string> {
  const root: string = await realpath(workspaceRoot);
  const relative: string = path.relative(root, path.resolve(directory));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new DomainError("DATA_PATH_ESCAPE", "H5 data must stay inside this project workspace", 400);
  }
  let ancestor: string = path.resolve(directory);
  while (true) {
    try { ancestor = await realpath(ancestor); break; }
    catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      const parent: string = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  const ancestorRelative: string = path.relative(root, ancestor);
  if (ancestorRelative === ".." || ancestorRelative.startsWith(`..${path.sep}`) || path.isAbsolute(ancestorRelative)) {
    throw new DomainError("DATA_PATH_ESCAPE", "H5 data parent resolves outside this project workspace", 400);
  }
  await mkdir(directory, { recursive: true });
  const resolved: string = await realpath(directory);
  const resolvedRelative: string = path.relative(root, resolved);
  if (resolvedRelative === ".." || resolvedRelative.startsWith(`..${path.sep}`) || path.isAbsolute(resolvedRelative)) {
    throw new DomainError("DATA_PATH_ESCAPE", "H5 data resolves outside this project workspace", 400);
  }
  return resolved;
}

/** Files are never replaced; uncertain persistence blocks further writes for investigation. */
export class LocalStateStore implements H5StateStore {
  readonly directory: string;
  private current: LocalState;
  private writeUncertain: boolean;

  constructor(directory: string, state: LocalState) {
    this.directory = directory;
    this.current = state;
    this.writeUncertain = false;
  }

  read(): LocalState { return structuredClone(this.current); }

  async refresh(): Promise<void> { /* The local HTTP server serializes this one store. */ }

  async save(state: LocalState): Promise<void> {
    if (this.writeUncertain) throw new DomainError("STATE_RECONCILIATION_REQUIRED", "A previous local state write is uncertain; inspect the latest snapshot before reopening the preview", 503);
    const parsed: LocalState = stateSchema.parse(state);
    if (parsed.revision !== this.current.revision + 1) throw new DomainError("STATE_REVISION_CONFLICT", "State must append exactly one revision", 409);
    await this.write(parsed);
    this.current = parsed;
  }

  async initialize(): Promise<void> { await this.write(this.current); }

  private async write(state: LocalState): Promise<void> {
    const filename: string = path.join(this.directory, `state-${String(state.revision).padStart(10, "0")}.json`);
    this.writeUncertain = true;
    const file = await open(filename, "wx");
    try { await file.writeFile(JSON.stringify(state), "utf8"); await file.sync(); }
    finally { await file.close(); }
    const readback: LocalState = stateSchema.parse(JSON.parse(await readFile(filename, "utf8")));
    if (JSON.stringify(readback) !== JSON.stringify(state)) throw new DomainError("STATE_READBACK_FAILED", "Saved H5 state differs from the expected revision; inspect the local snapshot", 500);
    this.writeUncertain = false;
  }
}

export async function openLocalState(workspaceRoot: string, dataRoot: string, now: string): Promise<LocalStateStore> {
  const directory: string = await containedDirectory(workspaceRoot, dataRoot);
  const filenames: string[] = (await readdir(directory)).filter((name) => /^state-\d{10}\.json$/.test(name)).sort();
  const latest: string | undefined = filenames.at(-1);
  if (latest !== undefined) {
    const state: LocalState = stateSchema.parse(JSON.parse(await readFile(path.join(directory, latest), "utf8")));
    if (latest !== `state-${String(state.revision).padStart(10, "0")}.json`) throw new DomainError("STATE_REVISION_MISMATCH", "Saved state filename does not match its revision; inspect the snapshot", 500);
    return new LocalStateStore(directory, state);
  }
  const store: LocalStateStore = new LocalStateStore(directory, initialState(now));
  await store.initialize();
  return store;
}
