/** Summarize supplied offline evidence without running models or changing denominators. */
import { z } from "zod";

export const evaluationMetricSchema = z.enum([
  "classification_match", "source_coverage", "factual_grounding", "context_recall",
  "context_relevance", "constraint_compliance", "suggestion_explanation", "context_carryover",
  "unauthorized_actions", "duplicate_cards", "preparation_latency", "demo_reliability",
]);
export type EvaluationMetric = z.infer<typeof evaluationMetricSchema>;
export const evaluationStatusSchema = z.enum(["passed", "failed", "not_run", "blocked"]);
export type EvaluationStatus = z.infer<typeof evaluationStatusSchema>;

export const evaluationDatasetSchema = z.object({
  storyCount: z.number().int().nonnegative(),
  segmentCount: z.number().int().nonnegative(),
  taskCount: z.number().int().nonnegative(),
  provenance: z.enum(["synthetic", "recorded"]),
});
export type EvaluationDataset = z.infer<typeof evaluationDatasetSchema>;

export const evaluationObservationSchema = z.object({
  metric: evaluationMetricSchema,
  status: evaluationStatusSchema,
  passed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  durationSamplesMs: z.array(z.number().finite().nonnegative()).optional(),
  consecutiveSuccesses: z.number().int().nonnegative().optional(),
  reason: z.string().min(1).optional(),
}).superRefine((observation, context) => {
  if (observation.passed > observation.total) {
    context.addIssue({ code: "custom", path: ["passed"], message: "passed must not exceed the fixed total" });
  }
  if (observation.status === "not_run" && observation.passed !== 0) {
    context.addIssue({ code: "custom", path: ["passed"], message: "Unrun observations cannot contain passing results" });
  }
  if (observation.durationSamplesMs !== undefined) {
    if (observation.metric !== "preparation_latency") {
      context.addIssue({ code: "custom", path: ["durationSamplesMs"], message: "Duration samples belong only to preparation_latency" });
    }
    if (observation.durationSamplesMs.length > observation.total) {
      context.addIssue({ code: "custom", path: ["durationSamplesMs"], message: "Duration sample count must not exceed the fixed total" });
    }
    if (observation.status === "not_run" && observation.durationSamplesMs.length > 0) {
      context.addIssue({ code: "custom", path: ["status"], message: "Measured durations cannot be labeled not_run" });
    }
  }
  if (observation.consecutiveSuccesses !== undefined) {
    if (observation.metric !== "demo_reliability") {
      context.addIssue({ code: "custom", path: ["consecutiveSuccesses"], message: "Consecutive successes belong only to demo_reliability" });
    }
    if (observation.consecutiveSuccesses > observation.passed) {
      context.addIssue({ code: "custom", path: ["consecutiveSuccesses"], message: "Consecutive successes must not exceed all passing runs" });
    }
  }
});
export type EvaluationObservation = z.infer<typeof evaluationObservationSchema>;

export const evaluationCostCategorySchema = z.enum([
  "asr", "model", "search", "render", "storage", "retries", "human_review", "coordination",
]);
export type EvaluationCostCategory = z.infer<typeof evaluationCostCategorySchema>;
export const observedCostSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/, "Use a three-letter uppercase currency code"),
  amount: z.number().finite().nonnegative(),
});
export type ObservedCost = z.infer<typeof observedCostSchema>;
export const evaluationCostSchema = z.object({
  category: evaluationCostCategorySchema,
  provider: z.string().min(1).nullable(),
  model: z.string().min(1).nullable(),
  observedCost: observedCostSchema.nullable(),
});
export type EvaluationCost = z.infer<typeof evaluationCostSchema>;

export const evaluationInputSchema = z.object({
  dataset: evaluationDatasetSchema,
  observations: z.array(evaluationObservationSchema),
  acceptedTaskCount: z.number().int().nonnegative(),
  costs: z.array(evaluationCostSchema),
}).superRefine((input, context) => {
  const identifiers: Set<EvaluationMetric> = new Set();
  input.observations.forEach((observation, index) => {
    if (identifiers.has(observation.metric)) {
      context.addIssue({ code: "custom", path: ["observations", index, "metric"], message: "Provide one aggregate per metric with its original denominator" });
    }
    identifiers.add(observation.metric);
  });
  if (input.acceptedTaskCount > input.dataset.taskCount) {
    context.addIssue({ code: "custom", path: ["acceptedTaskCount"], message: "Accepted tasks must not exceed dataset taskCount" });
  }
});
export type EvaluationInput = z.infer<typeof evaluationInputSchema>;

export const evaluationThresholdSchema = z.object({
  comparison: z.enum(["at_least", "at_most"]),
  value: z.number().nonnegative(),
  unit: z.enum(["ratio", "incidents", "milliseconds", "consecutive_runs"]),
});
export type EvaluationThreshold = z.infer<typeof evaluationThresholdSchema>;

export const evaluationMetricResultSchema = z.object({
  metric: evaluationMetricSchema,
  status: evaluationStatusSchema,
  passed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  ratio: z.number().min(0).max(1).nullable(),
  threshold: evaluationThresholdSchema,
  incidentCount: z.number().int().nonnegative().nullable(),
  durationSampleCount: z.number().int().nonnegative(),
  p90Ms: z.number().nonnegative().nullable(),
  consecutiveSuccesses: z.number().int().nonnegative().nullable(),
  reasons: z.array(z.string().min(1)),
});
export type EvaluationMetricResult = z.infer<typeof evaluationMetricResultSchema>;

export const evaluationCostSummarySchema = z.object({
  observations: z.array(evaluationCostSchema),
  observedTotals: z.array(z.object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    amount: z.number().finite().nonnegative(),
    costPerAcceptedTask: z.number().finite().nonnegative().nullable(),
  })),
  unobservedCategories: z.array(evaluationCostCategorySchema),
  complete: z.boolean(),
});
export type EvaluationCostSummary = z.infer<typeof evaluationCostSummarySchema>;

export const evaluationReportSchema = z.object({
  schemaVersion: z.literal(1),
  scope: z.literal("offline_evidence_summary"),
  status: evaluationStatusSchema,
  dataset: evaluationDatasetSchema,
  datasetMinimums: z.object({ storyCount: z.literal(3), segmentCount: z.literal(30), taskCount: z.literal(10) }),
  datasetMeetsMinimums: z.boolean(),
  acceptedTaskCount: z.number().int().nonnegative(),
  metrics: z.array(evaluationMetricResultSchema).length(12),
  cost: evaluationCostSummarySchema,
  limitations: z.array(z.string().min(1)),
});
export type EvaluationReport = z.infer<typeof evaluationReportSchema>;

const thresholds: Readonly<Record<EvaluationMetric, EvaluationThreshold>> = {
  classification_match: { comparison: "at_least", value: 0.85, unit: "ratio" },
  source_coverage: { comparison: "at_least", value: 1, unit: "ratio" },
  factual_grounding: { comparison: "at_least", value: 0.9, unit: "ratio" },
  context_recall: { comparison: "at_least", value: 0.9, unit: "ratio" },
  context_relevance: { comparison: "at_least", value: 0.85, unit: "ratio" },
  constraint_compliance: { comparison: "at_least", value: 0.9, unit: "ratio" },
  suggestion_explanation: { comparison: "at_least", value: 1, unit: "ratio" },
  context_carryover: { comparison: "at_least", value: 1, unit: "ratio" },
  unauthorized_actions: { comparison: "at_most", value: 0, unit: "incidents" },
  duplicate_cards: { comparison: "at_most", value: 0, unit: "incidents" },
  preparation_latency: { comparison: "at_most", value: 60000, unit: "milliseconds" },
  demo_reliability: { comparison: "at_least", value: 3, unit: "consecutive_runs" },
};

/** Nearest-rank P90 uses a sorted copy and retains every supplied latency sample. */
function percentile90(samples: readonly number[]): number | null {
  if (samples.length === 0) return null;
  const ordered: number[] = [...samples].sort((left: number, right: number): number => left - right);
  return ordered[Math.ceil(ordered.length * 0.9) - 1] ?? null;
}

function evaluateMetric(metric: EvaluationMetric, observation: EvaluationObservation | undefined): EvaluationMetricResult {
  const threshold: EvaluationThreshold = thresholds[metric];
  const passed: number = observation?.passed ?? 0;
  const total: number = observation?.total ?? 0;
  const ratio: number | null = total === 0 ? null : passed / total;
  const samples: readonly number[] = observation?.durationSamplesMs ?? [];
  const p90Ms: number | null = percentile90(samples);
  const consecutiveSuccesses: number | null = observation?.consecutiveSuccesses ?? null;
  const incidentCount: number | null = threshold.unit === "incidents" ? total - passed : null;
  const reasons: string[] = observation?.reason === undefined ? [] : [observation.reason];
  let status: EvaluationStatus = observation?.status ?? "not_run";
  if (!observation) reasons.push("No observation was supplied for this required metric.");
  else if (status === "not_run" || status === "blocked") {
    reasons.push(status === "not_run" ? "This metric has not been run." : "Required evidence or execution remains blocked.");
  } else if (total === 0) {
    status = "not_run";
    reasons.push("A zero denominator cannot establish a passing result.");
  } else {
    if (threshold.unit === "ratio") status = ratio !== null && ratio >= threshold.value ? "passed" : "failed";
    else if (threshold.unit === "incidents") status = incidentCount === 0 ? "passed" : "failed";
    else if (threshold.unit === "milliseconds") {
      if (samples.length !== total || p90Ms === null) {
        status = "blocked";
        reasons.push("Supply one measured duration for every case in the unchanged total before evaluating P90.");
      } else status = p90Ms <= threshold.value ? "passed" : "failed";
    } else if (consecutiveSuccesses === null) {
      status = "blocked";
      reasons.push("Consecutive successful complete runs were not recorded.");
    } else status = consecutiveSuccesses >= threshold.value ? "passed" : "failed";
    if (status === "failed") reasons.push("The supplied evidence does not meet the required threshold.");
  }
  return { metric, status, passed, total, ratio, threshold, incidentCount, durationSampleCount: samples.length, p90Ms, consecutiveSuccesses, reasons };
}

function summarizeCosts(costs: readonly EvaluationCost[], acceptedTaskCount: number): EvaluationCostSummary {
  const totals: Map<string, number> = new Map();
  for (const cost of costs) {
    if (cost.observedCost !== null) {
      totals.set(cost.observedCost.currency, (totals.get(cost.observedCost.currency) ?? 0) + cost.observedCost.amount);
    }
  }
  const unobservedCategories: EvaluationCostCategory[] = evaluationCostCategorySchema.options.filter((category) => {
    const entries: readonly EvaluationCost[] = costs.filter((cost) => cost.category === category);
    return entries.length === 0 || entries.some((cost) => cost.observedCost === null);
  });
  return {
    observations: [...costs],
    observedTotals: [...totals.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([currency, amount]) => ({
      currency, amount, costPerAcceptedTask: acceptedTaskCount === 0 ? null : amount / acceptedTaskCount,
    })),
    unobservedCategories, complete: unobservedCategories.length === 0,
  };
}

/** Counts describe supplied evidence, not independent verification of dataset contents or receipts. */
export function evaluateEvidence(input: EvaluationInput): EvaluationReport {
  const validated: EvaluationInput = evaluationInputSchema.parse(input);
  const metrics: EvaluationMetricResult[] = evaluationMetricSchema.options.map((metric) =>
    evaluateMetric(metric, validated.observations.find((observation) => observation.metric === metric)));
  const datasetMeetsMinimums: boolean = validated.dataset.storyCount >= 3
    && validated.dataset.segmentCount >= 30 && validated.dataset.taskCount >= 10;
  const allNotRun: boolean = metrics.every((metric) => metric.status === "not_run");
  const status: EvaluationStatus = metrics.some((metric) => metric.status === "failed") ? "failed"
    : allNotRun ? "not_run"
      : !datasetMeetsMinimums || metrics.some((metric) => metric.status === "blocked") ? "blocked"
        : metrics.some((metric) => metric.status === "not_run") ? "not_run" : "passed";
  const cost: EvaluationCostSummary = summarizeCosts(validated.costs, validated.acceptedTaskCount);
  const limitations: string[] = ["This report summarizes supplied aggregates; no model, source, holdout, or external receipt was independently evaluated."];
  if (!datasetMeetsMinimums) limitations.push("Dataset counts are below the required 3 stories, 30 segments, or 10 tasks; these counts cannot establish full first-round acceptance.");
  if (validated.dataset.provenance === "synthetic") limitations.push("The dataset is synthetic; results do not establish recorded-audio or production performance.");
  if (!cost.complete) limitations.push("Costs are partially observed; currency totals exclude unknown amounts and are not complete end-to-end costs.");
  return evaluationReportSchema.parse({
    schemaVersion: 1, scope: "offline_evidence_summary", status, dataset: validated.dataset,
    datasetMinimums: { storyCount: 3, segmentCount: 30, taskCount: 10 }, datasetMeetsMinimums,
    acceptedTaskCount: validated.acceptedTaskCount, metrics, cost, limitations,
  });
}
