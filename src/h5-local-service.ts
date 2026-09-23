/** Connect the unchanged local preview to filesystem-backed ports. */
import path from "node:path";
import { openLocalState } from "./h5-data.ts";
import { H5Service } from "./h5-service.ts";
import type { H5ServiceOptions } from "./h5-service.ts";
import { LocalArtifactStorage } from "./local-artifact-storage.ts";
import { LOCAL_OWNER } from "./h5-state.ts";
import { loadSkill } from "./skills.ts";

export async function createH5Service(options: H5ServiceOptions): Promise<H5Service> {
  const store = await openLocalState(options.workspaceRoot, options.dataRoot, options.now());
  return new H5Service(store, {
    now: options.now, mode: "local-preview", ownerId: LOCAL_OWNER,
    loadTemplate: async (id) => (await loadSkill(path.join(options.workspaceRoot, "product", "skills"), id)).template,
    storage: new LocalArtifactStorage(options.workspaceRoot, path.join(options.dataRoot, "exports")),
  });
}
