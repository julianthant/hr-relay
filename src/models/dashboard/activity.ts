/** The Activity report wire: a rendering of the ONE run/queue projection over a date range, not a second counting path. */
import { z } from "zod";
import {
  BrowserSystemIdSchema,
  ErrorCodeSchema,
  IsoInstantSchema,
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

/** The durable terminal outcomes ref workflow-model §4 closes over. */
export const ActivityOutcomeSchema = z.enum([
  "done", "failed", "cancelled", "partial", "superseded", "discarded", "interrupted",
]);

export const ActivityDayTotalSchema = z.strictObject({
  day: z.iso.date(),
  runs: z.number().int().nonnegative(),
});

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

/** One workflow's row of the report — a CROSS-TAB of the workflow axis with the status axis, counted in the one pass beside `statuses[]`. */
export const ActivityWorkflowTotalSchema = z.strictObject({
  workflowId: WorkflowIdSchema,
  registration: ActivityWorkflowRegistrationSchema,
  runs: z.number().int().nonnegative(),
  completion: ActivityCompletionSchema,
  failed: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  partial: z.number().int().nonnegative(),
  /** every non-terminal status — what this workflow still has open in range */
  open: z.number().int().nonnegative(),
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

/** A failure breakdown by the failure record's own closed `code`, with the exact runs behind it; `transient` rides along because "17 failures" reads differently once 14 are visible as retried. */
export const ActivityFailureTotalSchema = z.strictObject({
  code: ErrorCodeSchema,
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
