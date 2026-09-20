/** Emit erasable browser TypeScript with Node; npm run check performs separate type validation. */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";

const workspaceRoot: string = process.cwd();
const sourceRoot: string = path.join(workspaceRoot, "web");
const outputRoot: string = path.join(workspaceRoot, "work", "h5-build");

async function compileDirectory(directory: string): Promise<number> {
  let compiled: number = 0;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "assets") continue;
    const sourcePath: string = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      compiled += await compileDirectory(sourcePath);
      continue;
    }
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) continue;
    const source: string = await readFile(sourcePath, "utf8");
    const output: string = stripTypeScriptTypes(source, { mode: "strip" });
    const destination: string = path.join(outputRoot, path.relative(sourceRoot, sourcePath).replace(/\.ts$/, ".js"));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, output, "utf8");
    compiled += 1;
  }
  return compiled;
}

const compiledFiles: number = await compileDirectory(sourceRoot);
if (compiledFiles === 0) throw new Error("H5 build contains no TypeScript browser modules; add web/app.ts before building.");
console.log(JSON.stringify({ event: "h5_build_completed", compiledFiles, outputRoot }));
