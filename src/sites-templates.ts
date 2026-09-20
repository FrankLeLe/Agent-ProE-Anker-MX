/** Bundle only the two trusted templates; build validates their catalog and instructions. */
import report from "../product/skills/report-outline/template.json" with { type: "json" };
import requirements from "../product/skills/requirements-checklist/template.json" with { type: "json" };
import { templateSchema } from "./contracts.ts";
import type { ArtifactTemplate, SkillId } from "./contracts.ts";
import { DomainError } from "./errors.ts";

export async function loadSitesTemplate(id: SkillId): Promise<ArtifactTemplate> {
  const templates: Record<SkillId, object> = { "report-outline": report, "requirements-checklist": requirements };
  const template: ArtifactTemplate = templateSchema.parse(templates[id]);
  if (template.id !== id) throw new DomainError("SKILL_TEMPLATE_MISMATCH", "Bundled template identity does not match the requested skill", 500);
  return template;
}
