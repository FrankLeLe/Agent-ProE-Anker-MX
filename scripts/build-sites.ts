/** Build only the public app, trusted templates and Worker; local data never enters dist. */
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { z } from "zod";
import { loadSkill } from "../src/skills.ts";

const root: string = process.cwd();
const dist: string = path.join(root, "dist");
const manifestSchema = z.object({ project_id: z.string().min(1), d1: z.literal("DB"), r2: z.literal("BUCKET") });
const manifest = manifestSchema.parse(JSON.parse(await readFile(path.join(root, ".openai/hosting.json"), "utf8")));
await Promise.all([loadSkill(path.join(root, "product/skills"), "report-outline"), loadSkill(path.join(root, "product/skills"), "requirements-checklist")]);
await mkdir(path.join(dist, "server"), { recursive: true });
await mkdir(path.join(dist, "client"), { recursive: true });
await mkdir(path.join(dist, ".openai"), { recursive: true });
const server = await build({ entryPoints: ["src/sites-worker.ts"], outfile: "dist/server/index.js", bundle: true, format: "esm", platform: "browser", target: "es2022", external: ["node:*"], minify: true, metafile: true });
const forbiddenInputs: string[] = Object.keys(server.metafile.inputs).filter((input) => /h5-data\.ts|h5-local-service|local-artifact-storage|postgres\.ts|work\//.test(input));
if (forbiddenInputs.length > 0) throw new Error(`Worker includes local-only modules: ${forbiddenInputs.join(", ")}`);
await build({ entryPoints: ["web/app.ts"], outfile: "dist/client/app.js", bundle: true, format: "esm", platform: "browser", target: "es2022", minify: true });
await cp(path.join(root, "web/assets"), path.join(dist, "client/assets"), { recursive: true });
await cp(path.join(root, "web/index.html"), path.join(dist, "client/index.html"));
await cp(path.join(root, "web/styles.css"), path.join(dist, "client/styles.css"));
await writeFile(path.join(dist, ".openai/hosting.json"), JSON.stringify(manifest, null, 2), "utf8");
await cp(path.join(root, "drizzle"), path.join(dist, ".openai/drizzle"), { recursive: true });
await mkdir(path.join(root, "work/sites-deployment"), { recursive: true });
await writeFile(path.join(root, "work/sites-deployment/bundle-inputs.json"), JSON.stringify(Object.keys(server.metafile.inputs), null, 2), "utf8");
console.log(JSON.stringify({ event: "sites_build_completed", workerBytes: (await readFile(path.join(dist, "server/index.js"))).length, clientFiles: await readdir(path.join(dist, "client")), localDataIncluded: false }));
