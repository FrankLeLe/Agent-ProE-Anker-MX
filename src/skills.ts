/** Load only the selected built-in skill; no third-party code or implicit tool execution. */
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { catalogSchema, templateSchema } from "./contracts.ts";
import type { ArtifactTemplate, SkillDefinition, SkillId } from "./contracts.ts";
import { DomainError } from "./errors.ts";

export interface LoadedSkill {
  definition: SkillDefinition;
  instructions: string;
  template: ArtifactTemplate;
}

async function containedFile(root: string, relativePath: string): Promise<string> {
  const canonicalRoot: string = await realpath(root);
  const candidate: string = await realpath(path.resolve(canonicalRoot, relativePath));
  const relative: string = path.relative(canonicalRoot, candidate);
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new DomainError("SKILL_PATH_ESCAPE", `Skill resource is outside the catalog root: ${relativePath}`, 400);
  }
  return candidate;
}

export async function listSkills(root: string): Promise<readonly SkillDefinition[]> {
  const catalog = catalogSchema.parse(JSON.parse(await readFile(path.join(root, "catalog.json"), "utf8")));
  const identifiers: Set<string> = new Set(catalog.skills.map((skill) => skill.id));
  if (identifiers.size !== catalog.skills.length) {
    throw new DomainError("DUPLICATE_SKILL", "Built-in catalog has duplicate skill identifiers", 400);
  }
  return catalog.skills;
}

export async function loadSkill(root: string, id: SkillId): Promise<LoadedSkill> {
  const skills: readonly SkillDefinition[] = await listSkills(root);
  const definition: SkillDefinition | undefined = skills.find((skill) => skill.id === id);
  if (!definition) throw new DomainError("SKILL_NOT_FOUND", `Built-in skill not registered: ${id}`, 404);
  const [instructionPath, templatePath]: [string, string] = await Promise.all([
    containedFile(root, definition.entrypoint), containedFile(root, definition.template),
  ]);
  const instructions: string = await readFile(instructionPath, "utf8");
  const template: ArtifactTemplate = templateSchema.parse(JSON.parse(await readFile(templatePath, "utf8")));
  if (template.id !== id || template.version !== definition.version) {
    throw new DomainError("SKILL_TEMPLATE_MISMATCH", `Template identity or version does not match skill ${id}`, 400);
  }
  if (new Set(template.sections.map((section) => section.id)).size !== template.sections.length) {
    throw new DomainError("DUPLICATE_SECTION", `Template ${id} contains duplicate section identifiers`, 400);
  }
  return { definition, instructions, template };
}
