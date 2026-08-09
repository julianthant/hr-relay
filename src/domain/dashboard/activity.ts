/**
 * The Activity report wire (doc 13 §5 "Activity", §3.6
 * `GET /api/v1/reports/activity?from=&to=`, D180).
 *
 * **It is a rendering of the ONE run/queue projection over a date range, not a
 * second counting path.** D81 is the whole reason this wire exists in this
 * shape: doc 13 §8 guard #4 names Activity aggregates explicitly, so every
 * total below is built inside `run-queue-projection.ts` from the same in-memory
 * surfaces the Queue Panel renders. A report that summed rows a second way
 * could disagree with the day it summarises, and count/badge divergence is the
 * legacy bug class this program is replacing.
 *
 * **Durations are reported with their misses.** D124's lesson was that a
 * surface must never substitute `now` for a missing terminal instant, and an
 * aggregate has the same duty at scale: a median over the runs whose duration
 * is known, beside an explicit count of the runs whose duration is not, is
 * honest. A single "average duration" computed over a denominator that quietly
 * dropped the unknowns is not.
 */
import { z } from "zod";
import { ErrorCodeSchema, IsoInstantSchema, RunIdSchema, WorkflowIdSchema } from "../ids.js";
import { DashboardWireVersionSchema } from "./primitives.js";
import { QueueStatusSchema } from "./projection.js";

/** The durable terminal outcomes doc 02 §4 closes over. */
export const ActivityOutcomeSchema = z.enum([
  "done", "failed", "cancelled", "partial", "superseded", "discarded", "interrupted",
]);

export const ActivityDayTotalSchema = z.strictObject({
  day: z.iso.date(),
  runs: z.number().int().nonnegative(),
});

const CategoryIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);

/**
 * A run whose workflow is no longer registered still happened, and its runs
 * still count. The report says the label and category are unavailable and why,
 * rather than inventing a title from the id — the same posture the queue
 * pipeline already takes for an unregistered descriptor.
 */
export const ActivityWorkflowRegistrationSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("registered"), label: z.string().min(1), categoryId: CategoryIdSchema }),
  z.strictObject({ state: z.literal("unregistered"), reason: z.string().min(1) }),
]);

export const ActivityWorkflowTotalSchema = z.strictObject({
  workflowId: WorkflowIdSchema,
  registration: ActivityWorkflowRegistrationSchema,
  runs: z.number().int().nonnegative(),
});

export const ActivityCategoryTotalSchema = z.strictObject({
  category: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("registered"), categoryId: CategoryIdSchema }),
    z.strictObject({ state: z.literal("unregistered"), reason: z.string().min(1) }),
  ]),
  runs: z.number().int().nonnegative(),
});

export const ActivityStatusTotalSchema = z.strictObject({
  status: QueueStatusSchema,
  runs: z.number().int().nonnegative(),
});

export const ActivityOutcomeTotalSchema = z.strictObject({
  outcome: ActivityOutcomeSchema,
  runs: z.number().int().nonnegative(),
});

/**
 * A failure breakdown by the failure record's own closed `code`, with the
 * exact runs behind it. `transient` rides along because "17 failures" reads
 * very differently once the operator can see that 14 of them retried clean.
 */
export const ActivityFailureTotalSchema = z.strictObject({
  code: ErrorCodeSchema,
  runs: z.number().int().nonnegative(),
  transient: z.number().int().nonnegative(),
  sample: z.array(RunIdSchema).max(5),
});

/**
 * Duration statistics over exactly the runs that HAVE a duration. Every
 * quantile is present-or-absent with a reason; an empty measured set yields
 * absences, never a zero that reads as "instant".
 */
export const ActivityDurationsSchema = z.strictObject({
  measuredRuns: z.number().int().nonnegative(),
  unmeasuredRuns: z.number().int().nonnegative(),
  medianMs: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: z.number().int().nonnegative() }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
  longestMs: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: z.number().int().nonnegative(), runId: RunIdSchema }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
  totalMs: z.number().int().nonnegative(),
});

export const ActivityReportWireSchema = z.strictObject({
  wireVersion: DashboardWireVersionSchema,
  from: z.iso.date(),
  to: z.iso.date(),
  generatedAt: IsoInstantSchema,
  /**
   * Top-level runs in range — delegated members are contained in their
   * operation exactly as they are in the Queue Panel, applied once, in the
   * projection, for every surface at the same time.
   */
  totalRuns: z.number().int().nonnegative(),
  terminalRuns: z.number().int().nonnegative(),
  inFlightRuns: z.number().int().nonnegative(),
  days: z.array(ActivityDayTotalSchema),
  workflows: z.array(ActivityWorkflowTotalSchema),
  categories: z.array(ActivityCategoryTotalSchema),
  statuses: z.array(ActivityStatusTotalSchema),
  outcomes: z.array(ActivityOutcomeTotalSchema),
  failures: z.array(ActivityFailureTotalSchema),
  durations: ActivityDurationsSchema,
}).superRefine((report, context) => {
  if (report.from > report.to) {
    context.addIssue({ code: "custom", path: ["from"], message: "an activity range starts on or before it ends" });
  }
  const summed = report.statuses.reduce((total, entry) => total + entry.runs, 0);
  if (summed !== report.totalRuns) {
    context.addIssue({
      code: "custom",
      path: ["statuses"],
      message: `status totals sum to ${String(summed)} but the report counts ${String(report.totalRuns)} runs`,
    });
  }
  if (report.terminalRuns + report.inFlightRuns !== report.totalRuns) {
    context.addIssue({
      code: "custom",
      path: ["terminalRuns"],
      message: "terminal and in-flight runs must partition the range's runs",
    });
  }
  if (report.durations.measuredRuns + report.durations.unmeasuredRuns !== report.terminalRuns) {
    context.addIssue({
      code: "custom",
      path: ["durations"],
      message: "measured and unmeasured durations must partition the terminal runs",
    });
  }
  for (const day of report.days) {
    if (day.day < report.from || day.day > report.to) {
      context.addIssue({ code: "custom", path: ["days"], message: `day ${day.day} falls outside the reported range` });
    }
  }
});
export type ActivityReportWire = z.infer<typeof ActivityReportWireSchema>;
