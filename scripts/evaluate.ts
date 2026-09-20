/** Usage: node scripts/evaluate.ts <project-input.json> <new-project-report.json>. */
import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateEvidence, evaluationInputSchema } from "../src/evaluation.ts";
import type { EvaluationInput, EvaluationReport } from "../src/evaluation.ts";
import { DomainError } from "../src/errors.ts";

function assertInsideProject(projectRoot: string, candidate: string): void {
  const relative: string = path.relative(projectRoot, candidate);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new DomainError("EVALUATION_PATH_OUTSIDE_PROJECT", `Evaluation input and output must be files inside the current project: ${candidate}`, 400);
  }
}

async function main(arguments_: readonly string[]): Promise<void> {
  const inputArgument: string | undefined = arguments_[0];
  const outputArgument: string | undefined = arguments_[1];
  if (arguments_.length !== 2 || !inputArgument || !outputArgument) {
    throw new DomainError("EVALUATION_ARGUMENTS_REQUIRED", "Usage: node scripts/evaluate.ts <project-input.json> <new-project-report.json>; both paths are required", 400);
  }
  const projectRoot: string = await realpath(fileURLToPath(new URL("../", import.meta.url)));
  const inputCandidate: string = path.resolve(projectRoot, inputArgument);
  const outputCandidate: string = path.resolve(projectRoot, outputArgument);
  assertInsideProject(projectRoot, inputCandidate);
  assertInsideProject(projectRoot, outputCandidate);
  const inputPath: string = await realpath(inputCandidate);
  assertInsideProject(projectRoot, inputPath);
  const outputParent: string = await realpath(path.dirname(outputCandidate));
  const outputPath: string = path.join(outputParent, path.basename(outputCandidate));
  assertInsideProject(projectRoot, outputPath);
  const content: string = await readFile(inputPath, "utf8");
  let input: EvaluationInput;
  try {
    input = evaluationInputSchema.parse(JSON.parse(content));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new DomainError("EVALUATION_INVALID_JSON", `Cannot parse evaluation input ${inputPath}: ${error.message}`, 400);
    }
    throw error;
  }
  const report: EvaluationReport = evaluateEvidence(input);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${JSON.stringify({ outputPath, status: report.status, datasetMeetsMinimums: report.datasetMeetsMinimums })}\n`);
}

await main(process.argv.slice(2));
