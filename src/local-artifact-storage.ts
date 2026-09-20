import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { DomainError } from "./errors.ts";
import type { ArtifactStorage } from "./docx-export.ts";

/** Workspace-only adapter used for local integration; never overwrites an existing object. */
export class LocalArtifactStorage implements ArtifactStorage {
  readonly root: string;
  readonly workspaceRoot: string;

  constructor(workspaceRoot: string, storageRoot: string) {
    const relative: string = path.relative(path.resolve(workspaceRoot), path.resolve(storageRoot));
    if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
      throw new DomainError("STORAGE_PATH_ESCAPE", "Local artifact storage must stay inside the project workspace", 400);
    }
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.root = path.resolve(storageRoot);
  }

  private async resolveKey(storageKey: string): Promise<string> {
    if (!/^export-[a-f0-9]{64}\.docx$/.test(storageKey)) {
      throw new DomainError("INVALID_STORAGE_KEY", "Storage key must be the confirmed operation identifier followed by .docx", 400);
    }
    const canonicalWorkspace: string = await realpath(this.workspaceRoot);
    // Check existing parents before creation to avoid writing through a junction.
    let existingParent: string = this.root;
    while (true) {
      try { existingParent = await realpath(existingParent); break; }
      catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
        const parent: string = path.dirname(existingParent);
        if (parent === existingParent) throw error;
        existingParent = parent;
      }
    }
    const parentRelative: string = path.relative(canonicalWorkspace, existingParent);
    if (path.isAbsolute(parentRelative) || parentRelative === ".." || parentRelative.startsWith(`..${path.sep}`)) {
      throw new DomainError("STORAGE_PATH_ESCAPE", "Storage parent resolves outside the project workspace", 400);
    }
    await mkdir(this.root, { recursive: true });
    const canonicalRoot: string = await realpath(this.root);
    const relative: string = path.relative(canonicalWorkspace, canonicalRoot);
    if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
      throw new DomainError("STORAGE_PATH_ESCAPE", "Storage directory resolves outside the project workspace", 400);
    }
    return path.join(canonicalRoot, storageKey);
  }

  async writeNew(storageKey: string, bytes: Buffer): Promise<void> {
    const destination: string = await this.resolveKey(storageKey);
    await writeFile(destination, bytes, { flag: "wx" });
  }

  async read(storageKey: string): Promise<Buffer> {
    const destination: string = await this.resolveKey(storageKey);
    const actual: string = await realpath(destination);
    if (path.relative(path.dirname(destination), actual) !== storageKey) {
      throw new DomainError("STORAGE_PATH_ESCAPE", "Stored object resolves outside its assigned filename", 400);
    }
    return readFile(actual);
  }
}
