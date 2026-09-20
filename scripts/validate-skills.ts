/** Verify catalog behavior without implying model quality or client auto-discovery. */
import path from "node:path";
import { listSkills, loadSkill } from "../src/skills.ts";

const root: string = path.resolve("product/skills");
const skills = await listSkills(root);
for (const definition of skills) {
  const skill = await loadSkill(root, definition.id);
  process.stdout.write(`${JSON.stringify({ skill: definition.id, version: definition.version, sections: skill.template.sections.length, catalog: "passed", modelEvaluation: "not_run" })}\n`);
}
