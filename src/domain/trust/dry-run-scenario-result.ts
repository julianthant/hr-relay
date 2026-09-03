import { z } from "zod";
import {
  FingerprintSchema,
  IsoInstantSchema,
  RunIdSchema,
  ScenarioAssertionIdSchema,
  ScenarioIdSchema,
  TraceIdSchema,
  WorkflowIdSchema,
  slugSchema,
} from "../ids.js";

export const DryRunScenarioResultIdSchema = z.string().uuid().brand<"DryRunScenarioResultId">();
export const DryRunSubjectLabelSchema = slugSchema("dry-run subject label must be kebab-case")
  .brand<"DryRunSubjectLabel">();
export const DryRunScenarioVerdictSchema = z.enum(["met", "blocked", "failed"]);
export const DryRunAssertionReasonSchema = slugSchema("dry-run assertion reason must be kebab-case")
  .brand<"DryRunAssertionReason">();

export const DryRunAssertionOutcomeSchema = z.strictObject({
  assertionId: ScenarioAssertionIdSchema,
  verdict: DryRunScenarioVerdictSchema,
  reason: DryRunAssertionReasonSchema,
});

const DryRunAssertionOutcomesSchema = z.array(DryRunAssertionOutcomeSchema).min(1)
  .superRefine((outcomes, context) => {
    const ids = outcomes.map(({ assertionId }) => assertionId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", message: "dry-run assertion outcome identities must be unique" });
    }
  });

function verdictMismatch(
  verdict: z.infer<typeof DryRunScenarioVerdictSchema>,
  assertions: readonly z.infer<typeof DryRunAssertionOutcomeSchema>[],
): string | undefined {
  if (verdict === "met" && assertions.some((outcome) => outcome.verdict !== "met")) {
    return "a met dry-run result requires every assertion to be met";
  }
  if (verdict === "blocked" && (assertions.every((outcome) => outcome.verdict !== "blocked")
    || assertions.some((outcome) => outcome.verdict === "failed"))) {
    return "a blocked dry-run result requires a blocked assertion and forbids failed assertions";
  }
  if (verdict === "failed" && assertions.every((outcome) => outcome.verdict !== "failed")) {
    return "a failed dry-run result requires a failed assertion";
  }
  return undefined;
}

const DryRunScenarioResultFields = {
  resultId: DryRunScenarioResultIdSchema,
  scenarioId: ScenarioIdSchema,
  workflow: WorkflowIdSchema,
  subjectLabel: DryRunSubjectLabelSchema,
  manifestDigest: FingerprintSchema,
  assertions: DryRunAssertionOutcomesSchema,
  wallTimeMs: z.number().int().nonnegative(),
  recordedAt: IsoInstantSchema,
} as const;

/**
 * D318 — which T1b arm the started execution took. A `dry-run-preview` run is
 * enqueued with `dryRun: true`; a `live-read` run is the ordinary path with
 * `dryRun: false`. Authority binds the persisted result to a run whose
 * envelope agrees. Optional only so rows persisted before D318 — every one of
 * them a preview — remain readable; every new row carries it.
 */
export const DryRunScenarioArmSchema = z.enum(["dry-run-preview", "live-read"]);

const StartedDryRunScenarioResultSchema = z.strictObject({
  ...DryRunScenarioResultFields,
  verdict: DryRunScenarioVerdictSchema,
  execution: z.strictObject({
    state: z.literal("started"),
    arm: DryRunScenarioArmSchema.optional(),
    runId: RunIdSchema,
    traceId: TraceIdSchema,
  }),
}).superRefine((result, context) => {
  const mismatch = verdictMismatch(result.verdict, result.assertions);
  if (mismatch !== undefined) context.addIssue({ code: "custom", path: ["verdict"], message: mismatch });
});

/**
 * A gone or missing subject blocks before a browser starts (§10.5). This arm
 * cannot carry run/trace ids, while every started arm requires both; no caller
 * can make an execution look started by fabricating nullable identities.
 */
const NotStartedDryRunScenarioResultSchema = z.strictObject({
  ...DryRunScenarioResultFields,
  verdict: z.literal("blocked"),
  execution: z.strictObject({
    state: z.literal("not-started"),
    reason: z.literal("subject-unavailable"),
  }),
}).superRefine((result, context) => {
  const mismatch = verdictMismatch(result.verdict, result.assertions);
  if (mismatch !== undefined) context.addIssue({ code: "custom", path: ["verdict"], message: mismatch });
});

export const DryRunScenarioResultSchema = z.union([
  StartedDryRunScenarioResultSchema,
  NotStartedDryRunScenarioResultSchema,
]);

export type DryRunScenarioResult = z.infer<typeof DryRunScenarioResultSchema>;
