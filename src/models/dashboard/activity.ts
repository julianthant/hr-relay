/** The Activity report wire: a rendering of the ONE run/queue projection over a date range, not a second counting path. */
import { z } from "zod";
import {
  BrowserSystemIdSchema,
  ErrorCodeSchema,
  IsoInstantSchema,
  NodeIdSchema,
  RunIdSchema,
  WorkflowIdSchema,
} from "../../rules/identity/ids.js";
import { WorkflowCodeSchema } from "../workflow/presentation.js";
import { DashboardWireVersionSchema } from "./primitives.js";
import { QueueStatusSchema, TERMINAL_QUEUE_STATUSES } from "./projection.js";
import { displayStatusProseLabelOf } from "./status-vocabulary.js";
import { ActivityVolumeSchema, chooseActivityVolumeGranularity } from "./activity-volume.js";

/** How many exemplar run ids an aggregate row may carry; one bound for every sample on this wire, because two caps would be two promises. */
export const ACTIVITY_SAMPLE_LIMIT = 5;

/** The durable terminal outcomes ref workflow-model closes over. */
export const ActivityOutcomeSchema = z.enum([
  "done", "failed", "cancelled", "partial", "superseded", "discarded", "interrupted",
]);

/** Lower median of terminal durations. Absent uses the same sentence as `durations.medianMs`. */
export const ACTIVITY_MEDIAN_ABSENT_REASON = "no terminal run in range carries both a start and an end instant";

export function activityMedian(samples: readonly number[]): {
  measuredRuns: number;
  medianMs: { state: "present"; value: number } | { state: "absent"; reason: string };
} {
  if (samples.length === 0) return { measuredRuns: 0, medianMs: { state: "absent", reason: ACTIVITY_MEDIAN_ABSENT_REASON } };
  const sorted = [...samples].sort((left, right) => left - right);
  const value = sorted[Math.floor((sorted.length - 1) / 2)];
  if (value === undefined || !Number.isInteger(value) || value < 0) throw new Error("activity-median-invalid");
  return { measuredRuns: samples.length, medianMs: { state: "present", value } };
}

/**
 * Analytics outcome for one queue status.
 * `done` and `failed` are those statuses.
 * `attention` is a run waiting on the operator or ended partial or unknown:
 * `awaiting-approval` (parked gate), `partial`, and `blocked` except a still-queued run waiting on a child.
 * A blocked parked write is waiting on the operator. A blocked terminal run is interrupted, which has no done, failed, or cancelled settlement.
 * `queued`, `running`, `cancelling`, and `cancelled` (cancelled, discarded, superseded) stay outside the split.
 */
export function activityOutcomeClass(status: z.infer<typeof QueueStatusSchema>, lifecycleState: string): "done" | "failed" | "attention" | undefined {
  switch (status) {
    case "done": return "done";
    case "failed": return "failed";
    case "awaiting-approval":
    case "partial": return "attention";
    case "blocked": return lifecycleState === "queued" ? undefined : "attention";
    default: return undefined;
  }
}

export const ActivityOutcomeSplitSchema = z.strictObject({
  done: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  attention: z.number().int().nonnegative(),
});
export type ActivityOutcomeSplit = z.infer<typeof ActivityOutcomeSplitSchema>;

export const ActivityMedianDurationSchema = z.strictObject({
  measuredRuns: z.number().int().nonnegative(),
  medianMs: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: z.number().int().nonnegative() }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
}).superRefine((timing, context) => {
  if ((timing.measuredRuns === 0) !== (timing.medianMs.state === "absent")) {
    context.addIssue({ code: "custom", path: ["medianMs"], message: "a median duration requires measured runs" });
  }
});
export type ActivityMedianDuration = z.infer<typeof ActivityMedianDurationSchema>;

/** The step a run failed at. `nodeId` is only the key; `title` is the Logs panel step title. */
export const ActivityFailureStepSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("known"),
    nodeId: NodeIdSchema,
    title: z.string().min(1),
    runs: z.number().int().positive(),
  }).superRefine((step, context) => {
    if (step.title === step.nodeId || ErrorCodeSchema.safeParse(step.title).success) {
      context.addIssue({ code: "custom", path: ["title"], message: "a failure step title is the readable step name, never its node id or an error code" });
    }
  }),
  z.strictObject({
    state: z.literal("unavailable"),
    reason: z.string().min(1),
    runs: z.number().int().positive(),
  }),
]);
export type ActivityFailureStep = z.infer<typeof ActivityFailureStepSchema>;

export const ActivityDayTotalSchema = z.strictObject({
  day: z.iso.date(),
  runs: z.number().int().nonnegative(),
  outcomes: ActivityOutcomeSplitSchema,
  typicalTime: ActivityMedianDurationSchema,
}).superRefine((day, context) => {
  const covered = day.outcomes.done + day.outcomes.failed + day.outcomes.attention;
  if (covered > day.runs) {
    context.addIssue({ code: "custom", path: ["outcomes"], message: `day ${day.day} outcome split covers ${String(covered)} runs but the day counts ${String(day.runs)}` });
  }
});
export type ActivityDayTotal = z.infer<typeof ActivityDayTotalSchema>;

const CategoryIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);

/** A run whose workflow is no longer registered still happened and still counts: the report says the label and category are unavailable, rather than inventing a title. */
export const ActivityWorkflowRegistrationSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("registered"),
    label: z.string().min(1),
        /* The workflow's SHORT CODE — the table's leading token; it sits INSIDE the registered arm because the code is resolved by the same registry lookup as the label. */
    code: WorkflowCodeSchema,
    categoryId: CategoryIdSchema,
  }),
  z.strictObject({ state: z.literal("unregistered"), reason: z.string().min(1) }),
]);

/** The `done` runs, split by what their evidence receipt says, from the same source the queue row's `△ N` chip reads, so the table and the chip cannot disagree. */
export const ActivityCompletionSchema = z.strictObject({
  readBack: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
  warningsUnknown: z.number().int().nonnegative(),
});
export type ActivityCompletion = z.infer<typeof ActivityCompletionSchema>;

/** How many distinct people the range's runs touched, when authority can prove the axis without exporting an identifier; `present` carries only a COUNT. */
export const ActivityPeopleTotalSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("present"),
    distinct: z.number().int().nonnegative(),
    evidenceRows: z.number().int().nonnegative(),
  }).superRefine((people, context) => {
    if (people.distinct > people.evidenceRows) {
      context.addIssue({
        code: "custom",
        path: ["distinct"],
        message: "distinct people cannot exceed the person-bearing rows with identity evidence",
      });
    }
    if ((people.evidenceRows === 0) !== (people.distinct === 0)) {
      context.addIssue({
        code: "custom",
        path: ["evidenceRows"],
        message: "zero identity-evidence rows and zero distinct people must describe the same present state",
      });
    }
  }),
  z.strictObject({
    state: z.literal("absent"),
    evidenceRows: z.number().int().nonnegative(),
    unavailableRows: z.number().int().nonnegative(),
    reason: z.string().min(1),
  }),
]);
export type ActivityPeopleTotal = z.infer<typeof ActivityPeopleTotalSchema>;

/** Arithmetic mean over measured successful root runs, with explicit measurement coverage. */
export const ActivityTypicalTimeSchema = z.strictObject({
  measure: z.literal("successful-root-run-mean"),
  measuredRuns: z.number().int().nonnegative(),
  unmeasuredRuns: z.number().int().nonnegative(),
  meanMs: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: z.number().nonnegative() }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
}).superRefine((timing, context) => {
  if ((timing.measuredRuns === 0) !== (timing.meanMs.state === "absent"))
    context.addIssue({ code: "custom", path: ["meanMs"], message: "a successful-root mean requires measured runs" });
});

/** One workflow's status cross-tab, outcome split, failure steps, and timing. */
export const ActivityWorkflowTotalSchema = z.strictObject({
  workflowId: WorkflowIdSchema,
  registration: ActivityWorkflowRegistrationSchema,
  runs: z.number().int().nonnegative(),
  completion: ActivityCompletionSchema,
  failed: z.number().int().nonnegative(),
  needsAttention: z.number().int().nonnegative(),
  typicalTime: ActivityTypicalTimeSchema,
  /** Median duration of this workflow's measured terminal runs in the selected period. */
  typicalMedian: ActivityMedianDurationSchema,
  outcomes: ActivityOutcomeSplitSchema,
  days: z.array(ActivityDayTotalSchema),
  failedAt: z.array(ActivityFailureStepSchema),
  cancelled: z.number().int().nonnegative(),
  partial: z.number().int().nonnegative(),
  /** every non-terminal status — what this workflow still has open in range */
  open: z.number().int().nonnegative(),
}).superRefine((workflow, context) => {
  if (workflow.needsAttention !== workflow.failed)
    context.addIssue({ code: "custom", path: ["needsAttention"], message: "needs attention must equal failed runs" });
  if (workflow.typicalTime.measuredRuns + workflow.typicalTime.unmeasuredRuns > workflow.completion.readBack + workflow.completion.warnings + workflow.completion.warningsUnknown)
    context.addIssue({ code: "custom", path: ["typicalTime"], message: "successful-root timing cannot exceed completed runs" });
  const covered = workflow.outcomes.done + workflow.outcomes.failed + workflow.outcomes.attention;
  if (covered > workflow.runs) {
    context.addIssue({ code: "custom", path: ["outcomes"], message: `workflow ${workflow.workflowId} outcome split covers ${String(covered)} runs but counts ${String(workflow.runs)}` });
  }
  const failedAt = workflow.failedAt.reduce((total, step) => total + step.runs, 0);
  if (failedAt !== workflow.failed) {
    context.addIssue({ code: "custom", path: ["failedAt"], message: `workflow ${workflow.workflowId} failure steps count ${String(failedAt)} runs but ${String(workflow.failed)} failed` });
  }
  const seen = new Set<string>();
  let dayRuns = 0;
  let dayMeasured = 0;
  const dayOutcomes = { done: 0, failed: 0, attention: 0 };
  for (const day of workflow.days) {
    if (seen.has(day.day)) {
      context.addIssue({ code: "custom", path: ["days"], message: `workflow ${workflow.workflowId} repeats ${day.day}` });
    }
    seen.add(day.day);
    dayRuns += day.runs;
    dayMeasured += day.typicalTime.measuredRuns;
    dayOutcomes.done += day.outcomes.done;
    dayOutcomes.failed += day.outcomes.failed;
    dayOutcomes.attention += day.outcomes.attention;
  }
  if (dayRuns !== workflow.runs) {
    context.addIssue({ code: "custom", path: ["days"], message: `workflow ${workflow.workflowId} days count ${String(dayRuns)} runs but the row counts ${String(workflow.runs)}` });
  }
  if (dayMeasured !== workflow.typicalMedian.measuredRuns) {
    context.addIssue({ code: "custom", path: ["typicalMedian"], message: `workflow ${workflow.workflowId} day medians cover ${String(dayMeasured)} runs but the row median covers ${String(workflow.typicalMedian.measuredRuns)}` });
  }
  if (dayOutcomes.done !== workflow.outcomes.done || dayOutcomes.failed !== workflow.outcomes.failed || dayOutcomes.attention !== workflow.outcomes.attention) {
    context.addIssue({ code: "custom", path: ["days"], message: `workflow ${workflow.workflowId} days do not sum to its outcome split` });
  }
});
export type ActivityWorkflowTotal = z.infer<typeof ActivityWorkflowTotalSchema>;

export const ActivityCategoryTotalSchema = z.strictObject({
  category: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("registered"), categoryId: CategoryIdSchema }),
    z.strictObject({ state: z.literal("unregistered"), reason: z.string().min(1) }),
  ]),
  runs: z.number().int().nonnegative(),
});

/** One status bucket, with the exemplar runs behind an OPEN one; it carries run IDS and no display names on purpose. */
export const ActivityStatusTotalSchema = z.strictObject({
  status: QueueStatusSchema,
  runs: z.number().int().nonnegative(),
  sample: z.array(RunIdSchema).max(ACTIVITY_SAMPLE_LIMIT),
});

export const ActivityOutcomeTotalSchema = z.strictObject({
  outcome: ActivityOutcomeSchema,
  runs: z.number().int().nonnegative(),
});

/** Failures grouped by workflow and recorded code, with the catalog operator sentence. */
export const ActivityFailureTotalSchema = z.strictObject({
  code: ErrorCodeSchema,
  sentence: z.string().min(1),
  workflowId: WorkflowIdSchema,
  registration: ActivityWorkflowRegistrationSchema,
  runs: z.number().int().nonnegative(),
  transient: z.number().int().nonnegative(),
  sample: z.array(RunIdSchema).max(ACTIVITY_SAMPLE_LIMIT),
});

/** Duration statistics over exactly the runs that HAVE a duration; every quantile is present-or-absent with a reason, never a zero that reads as "instant". */
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

/** ONE system's row of the write-ledger block — what was actually FILED; `entries` partitions into `prod` + `test` and the refinement refuses any other reading. */
export const ActivityLedgerSystemTotalSchema = z.strictObject({
  system: BrowserSystemIdSchema,
  entries: z.number().int().positive(),
  prod: z.number().int().nonnegative(),
  test: z.number().int().nonnegative(),
}).superRefine((row, context) => {
  if (row.prod + row.test !== row.entries) {
    context.addIssue({
      code: "custom",
      path: ["entries"],
      message: `ledger system ${row.system} counts ${String(row.entries)} entries but splits into `
        + `${String(row.prod)} production and ${String(row.test)} test`,
    });
  }
});
export type ActivityLedgerSystemTotal = z.infer<typeof ActivityLedgerSystemTotalSchema>;

/** Confirmed operations use retained evidence and may outlive the run/queue projection. */
export const ActivityLedgerBlockSchema = z.strictObject({
  /** highest entry count first; ties by system id, so the order is total */
  systems: z.array(ActivityLedgerSystemTotalSchema),
});
export type ActivityLedgerBlock = z.infer<typeof ActivityLedgerBlockSchema>;

export const ActivityReportWireSchema = z.strictObject({
  wireVersion: DashboardWireVersionSchema,
  from: z.iso.date(),
  to: z.iso.date(),
  generatedAt: IsoInstantSchema,
    /* Top-level runs in range — delegated members are contained in their operation exactly as they are in the Queue Panel, applied once, in the projection. */
  totalRuns: z.number().int().nonnegative(),
  terminalRuns: z.number().int().nonnegative(),
  inFlightRuns: z.number().int().nonnegative(),
  people: ActivityPeopleTotalSchema,
    /* The whole-report split of the `done` status, summed in the same pass, so the headline tile and the per-workflow table read ONE number. */
  completion: ActivityCompletionSchema,
  /** Done, failed, and attention for the selected period. Cancelled and still-open runs stay outside it. */
  outcomeSplit: ActivityOutcomeSplitSchema,
  /** Median duration of every measured terminal run in the selected period. Same samples as `durations.medianMs`. */
  typicalMedian: ActivityMedianDurationSchema,
  days: z.array(ActivityDayTotalSchema),
  /** New summary-backed report series; absent only on legacy in-memory projection compatibility paths. */
  volume: ActivityVolumeSchema.optional(),
  workflows: z.array(ActivityWorkflowTotalSchema),
  categories: z.array(ActivityCategoryTotalSchema),
  statuses: z.array(ActivityStatusTotalSchema),
  outcomes: z.array(ActivityOutcomeTotalSchema),
  failures: z.array(ActivityFailureTotalSchema),
  durations: ActivityDurationsSchema,
    /* The one block that is NOT this projection's; nothing reconciles it against a run total, on purpose. */
  ledger: ActivityLedgerBlockSchema,
}).superRefine((report, context) => {
  if (report.from > report.to) {
    context.addIssue({ code: "custom", path: ["from"], message: "an activity range starts on or before it ends" });
  }
  if (report.volume !== undefined && report.volume.coveredRuns !== report.totalRuns) {
    context.addIssue({
      code: "custom",
      path: ["volume", "coveredRuns"],
      message: `volume covers ${String(report.volume.coveredRuns)} runs but the report counts ${String(report.totalRuns)}`,
    });
  }
  if (report.volume !== undefined) {
    const expectedGranularity = chooseActivityVolumeGranularity({ from: report.from, to: report.to }).kind;
    if (report.volume.granularity !== expectedGranularity) {
      context.addIssue({
        code: "custom",
        path: ["volume", "granularity"],
        message: `volume uses ${report.volume.granularity} buckets but this range requires ${expectedGranularity}`,
      });
    }
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

    /* The workflow rows are a CROSS-TAB of two axes this payload also reports on their own, so every disagreement below is refused rather than reconciled. */
  const statusRuns = (status: z.infer<typeof QueueStatusSchema>): number =>
    report.statuses.find((entry) => entry.status === status)?.runs ?? 0;
  const openStatusRuns = report.statuses
    .filter((entry) => !TERMINAL_QUEUE_STATUSES.has(entry.status))
    .reduce((total, entry) => total + entry.runs, 0);
  const completed = (completion: ActivityCompletion): number =>
    completion.readBack + completion.warnings + completion.warningsUnknown;

  if (completed(report.completion) !== statusRuns("done")) {
    context.addIssue({
      code: "custom",
      path: ["completion"],
      message: `the completion split covers ${String(completed(report.completion))} runs but ${String(statusRuns("done"))} settled done`,
    });
  }

  const rowTotals = {
    runs: 0, readBack: 0, warnings: 0, warningsUnknown: 0, failed: 0, cancelled: 0, partial: 0, open: 0,
  };
  for (const workflow of report.workflows) {
    const parts = completed(workflow.completion)
      + workflow.failed + workflow.cancelled + workflow.partial + workflow.open;
    if (parts !== workflow.runs) {
      context.addIssue({
        code: "custom",
        path: ["workflows"],
        message: `workflow ${workflow.workflowId} splits into ${String(parts)} runs but counts ${String(workflow.runs)}`,
      });
    }
    rowTotals.runs += workflow.runs;
    rowTotals.readBack += workflow.completion.readBack;
    rowTotals.warnings += workflow.completion.warnings;
    rowTotals.warningsUnknown += workflow.completion.warningsUnknown;
    rowTotals.failed += workflow.failed;
    rowTotals.cancelled += workflow.cancelled;
    rowTotals.partial += workflow.partial;
    rowTotals.open += workflow.open;
  }
  const crossTab: readonly [keyof typeof rowTotals, number, string][] = [
    ["runs", report.totalRuns, "the range's runs"],
    ["readBack", report.completion.readBack, "the report's read-back total"],
    ["warnings", report.completion.warnings, "the report's warned total"],
    ["warningsUnknown", report.completion.warningsUnknown, "the report's unread-warning total"],
    ["failed", statusRuns("failed"), "the failed status total"],
    ["cancelled", statusRuns("cancelled"), "the cancelled status total"],
    ["partial", statusRuns("partial"), "the partial status total"],
    ["open", openStatusRuns, "the non-terminal status totals"],
  ];
  for (const [key, expected, what] of crossTab) {
    if (rowTotals[key] !== expected) {
      context.addIssue({
        code: "custom",
        path: ["workflows"],
        message: `workflow rows sum to ${String(rowTotals[key])} ${key} but ${what} says ${String(expected)}`,
      });
    }
  }

    /* The category axis is the workflow axis grouped by the registry fact on each registered row; every workflow row lands in exactly one registered category or in the one unregistered arm. */
  const categoryTotals = new Map<string, number>();
  for (const entry of report.categories) {
    const key = entry.category.state === "registered" ? entry.category.categoryId : "@unregistered";
    if (categoryTotals.has(key)) {
      context.addIssue({
        code: "custom",
        path: ["categories"],
        message: `${key === "@unregistered" ? "the unregistered category" : `category ${key}`} appears more than once`,
      });
      continue;
    }
    categoryTotals.set(key, entry.runs);
  }
  const categoryRunsFromWorkflows = new Map<string, number>();
  for (const workflow of report.workflows) {
    const key = workflow.registration.state === "registered"
      ? workflow.registration.categoryId
      : "@unregistered";
    categoryRunsFromWorkflows.set(key, (categoryRunsFromWorkflows.get(key) ?? 0) + workflow.runs);
  }
  for (const [key, expected] of categoryRunsFromWorkflows) {
    const actual = categoryTotals.get(key);
    if (actual !== expected) {
      const label = key === "@unregistered" ? "the unregistered category" : `category ${key}`;
      context.addIssue({
        code: "custom",
        path: ["categories"],
        message: actual === undefined
          ? `${label} is absent but its workflow rows count ${String(expected)} runs`
          : `${label} counts ${String(actual)} runs but its workflow rows count ${String(expected)}`,
      });
    }
  }
  for (const [key, actual] of categoryTotals) {
    if (categoryRunsFromWorkflows.has(key) || actual === 0) continue;
    const label = key === "@unregistered" ? "the unregistered category" : `category ${key}`;
    context.addIssue({
      code: "custom",
      path: ["categories"],
      message: `${label} counts ${String(actual)} runs but no workflow row belongs to it`,
    });
  }
  const categoryRuns = report.categories.reduce((total, entry) => total + entry.runs, 0);
  if (categoryRuns !== report.totalRuns) {
    context.addIssue({
      code: "custom",
      path: ["categories"],
      message: `category totals sum to ${String(categoryRuns)} but the report counts ${String(report.totalRuns)} runs`,
    });
  }

    /* The Who sample is an OPEN-work affordance: exactly `min(runs, limit)` ids for a bucket the operator can still act on, and nothing at all for one they cannot. */
  for (const entry of report.statuses) {
    const terminal = TERMINAL_QUEUE_STATUSES.has(entry.status);
    const expected = terminal ? 0 : Math.min(entry.runs, ACTIVITY_SAMPLE_LIMIT);
    if (entry.sample.length !== expected) {
      context.addIssue({
        code: "custom",
        path: ["statuses"],
        message: terminal
          ? `terminal status ${entry.status} carries ${String(entry.sample.length)} sampled runs; the Who sample is for open work only`
          : `open status ${entry.status} counts ${String(entry.runs)} runs but samples ${String(entry.sample.length)}`,
      });
    }
  }
  for (const day of report.days) {
    if (day.day < report.from || day.day > report.to) {
      context.addIssue({ code: "custom", path: ["days"], message: `day ${day.day} falls outside the reported range` });
    }
  }

  const sameMedian = (
    left: ActivityMedianDuration["medianMs"],
    right: ActivityMedianDuration["medianMs"],
  ): boolean => left.state === right.state && (left.state === "absent" ? right.state === "absent" && left.reason === right.reason : right.state === "present" && left.value === right.value);
  if (report.typicalMedian.measuredRuns !== report.durations.measuredRuns || !sameMedian(report.typicalMedian.medianMs, report.durations.medianMs)) {
    context.addIssue({ code: "custom", path: ["typicalMedian"], message: "the period median must describe the same terminal durations as durations.medianMs" });
  }
  const splitOf = (rows: readonly ActivityOutcomeSplit[]) => rows.reduce((total, row) => ({
    done: total.done + row.done, failed: total.failed + row.failed, attention: total.attention + row.attention,
  }), { done: 0, failed: 0, attention: 0 });
  const sameSplit = (left: ActivityOutcomeSplit, right: ActivityOutcomeSplit): boolean =>
    left.done === right.done && left.failed === right.failed && left.attention === right.attention;
  const workflowSplit = splitOf(report.workflows.map(workflow => workflow.outcomes));
  const daySplit = splitOf(report.days.map(day => day.outcomes));
  if (!sameSplit(workflowSplit, report.outcomeSplit) || !sameSplit(daySplit, report.outcomeSplit)) {
    context.addIssue({ code: "custom", path: ["outcomeSplit"], message: "the period outcome split must equal the workflow rows and the days" });
  }
  const dayRuns = report.days.reduce((total, day) => total + day.runs, 0);
  if (dayRuns !== report.totalRuns) {
    context.addIssue({ code: "custom", path: ["days"], message: `days count ${String(dayRuns)} runs but the report counts ${String(report.totalRuns)}` });
  }
  const dayMeasured = report.days.reduce((total, day) => total + day.typicalTime.measuredRuns, 0);
  const workflowMeasured = report.workflows.reduce((total, workflow) => total + workflow.typicalMedian.measuredRuns, 0);
  if (dayMeasured !== report.typicalMedian.measuredRuns || workflowMeasured !== report.typicalMedian.measuredRuns) {
    context.addIssue({ code: "custom", path: ["typicalMedian"], message: "day and workflow medians must cover the period's measured terminal runs" });
  }
  const fromWorkflows = new Map<string, { runs: number; done: number; failed: number; attention: number; measured: number }>();
  for (const workflow of report.workflows) {
    for (const day of workflow.days) {
      const bucket = fromWorkflows.get(day.day) ?? { runs: 0, done: 0, failed: 0, attention: 0, measured: 0 };
      bucket.runs += day.runs;
      bucket.done += day.outcomes.done;
      bucket.failed += day.outcomes.failed;
      bucket.attention += day.outcomes.attention;
      bucket.measured += day.typicalTime.measuredRuns;
      fromWorkflows.set(day.day, bucket);
    }
  }
  for (const day of report.days) {
    const actual = fromWorkflows.get(day.day);
    if (actual === undefined || actual.runs !== day.runs || actual.measured !== day.typicalTime.measuredRuns
      || actual.done !== day.outcomes.done || actual.failed !== day.outcomes.failed || actual.attention !== day.outcomes.attention) {
      context.addIssue({ code: "custom", path: ["days"], message: `day ${day.day} does not match the workflow rows for that day` });
    }
  }
  for (const day of fromWorkflows.keys()) {
    if (!report.days.some(entry => entry.day === day)) {
      context.addIssue({ code: "custom", path: ["workflows"], message: `workflow rows include ${day}, which the report days omit` });
    }
  }
});
export type ActivityReportWire = z.infer<typeof ActivityReportWireSchema>;

/** One status bucket's count off the served payload; an absent bucket is zero. */
export function activityStatusRuns(
  report: ActivityReportWire,
  status: z.infer<typeof QueueStatusSchema>,
): number {
  return report.statuses.find((entry) => entry.status === status)?.runs ?? 0;
}

/** Panel and CSV share one rounded rate over the terminal denominator. */
export function activityErrorRatePercent(report: ActivityReportWire): number {
  if (report.terminalRuns === 0) return 0;
  return Math.round((activityStatusRuns(report, "failed") / report.terminalRuns) * 1000) / 10;
}

/** The rules this report was counted by, as sentences derived from the payload itself, living in the browser-safe contract so the panel's popover and the CSV export read the identical words. */
export function activityReportCaveats(report: ActivityReportWire): readonly string[] {
  const openRuns = report.inFlightRuns;
  const runWord = openRuns === 1 ? "1 run is" : `${String(openRuns)} runs are`;
  return Object.freeze([
    `This report covers runs that started between ${report.from} and ${report.to} inclusive. `
    + "Both bounds were named by whoever asked for it; nothing here defaults a window.",
    "Error rate counts only runs that reached a terminal state. Anything "
    + `${displayStatusProseLabelOf("queued")}, ${displayStatusProseLabelOf("running")}, `
    + `${displayStatusProseLabelOf("awaiting-approval")} or ${displayStatusProseLabelOf("blocked")} is excluded `
    + "and reported separately as still open, so a busy span cannot read "
    + "as a finished one.",
    `${runWord} still open in this span, and that work is represented in no total on this page except its own.`,
    "Run totals use the validated summary snapshot shared by Activity and its exports. Archived "
    + "runs are excluded by that authority.",
    "A finished run's warnings come from its evidence receipt. A run with no derived receipt is "
    + "counted as UNREAD in its own column rather than as read back — the report says how many it "
    + "could not check instead of reporting them as clean.",
    report.people.state === "present"
      ? `Distinct people deduplicates ${String(report.people.evidenceRows)} current Separations run/member rows using `
        + "validated identities from the canonical result schema. Only the aggregate count crosses this wire."
      : `Distinct people is unavailable: ${report.people.reason}. This absence is not zero; a full identifier, `
        + "last-four suffix, item id, row title or receipt digest is never substituted for validated canonical identity.",
    "The Who column samples up to five runs per open state and names them only where the day on "
    + "screen holds the row; every other run in a state is named by its id. The count beside it is "
    + "the whole bucket, never the sample.",
      // The seam, stated where the reader is: the ledger block is the one
    // total on this artifact that does not come from the run projection.
    "The write-ledger block is a SECOND authority, reported beside these totals and never derived "
    + "from them. Confirmed entries survive Archive transfer and remain until explicit owner deletion. "
    + "They can appear here after their runs have left the live surfaces.",
  ]);
}
