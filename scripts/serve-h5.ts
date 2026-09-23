/** Start the existing local preview; no provider, database, or remote binding. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { DomainError } from "../src/errors.ts";
import { createH5Server, validateLocalHost } from "../src/h5-server.ts";

const optionsSchema = z.object({ host: z.string(), port: z.coerce.number().int().min(1).max(65535), dataRoot: z.string().min(1) });
const values: { host: string; port: string; dataRoot: string } = { host: "127.0.0.1", port: "4173", dataRoot: "work/h5-data" };
const args: string[] = process.argv.slice(2);
for (let index: number = 0; index < args.length; index += 2) {
  const name: string | undefined = args[index];
  const value: string | undefined = args[index + 1];
  if ((name !== "--host" && name !== "--port" && name !== "--data-root") || value === undefined) throw new DomainError("INVALID_ARGUMENT", "Usage: node scripts/serve-h5.ts [--host 127.0.0.1|localhost] [--port 4173] [--data-root work/h5-data]", 400);
  if (name === "--host") values.host = value;
  else if (name === "--port") values.port = value;
  else values.dataRoot = value;
}
const options = optionsSchema.parse(values);
const host: string = validateLocalHost(options.host);
const workspaceRoot: string = fileURLToPath(new URL("../", import.meta.url));
const dataRoot: string = path.resolve(workspaceRoot, options.dataRoot);
const server = await createH5Server({ workspaceRoot, dataRoot, now: (): string => new Date().toISOString() });
server.on("error", (error: Error): void => {
  process.stderr.write(`${JSON.stringify({ event: "h5_server_error", errorType: error.name, code: "code" in error ? error.code : "LISTEN_FAILED", host, port: options.port })}\n`);
  process.exitCode = 1;
});
server.listen(options.port, host, (): void => { process.stdout.write(`${JSON.stringify({ event: "h5_listening", url: `http://${host}:${options.port}`, mode: "local-preview", dataDirectory: path.relative(workspaceRoot, dataRoot), providersConnected: false })}\n`); });
