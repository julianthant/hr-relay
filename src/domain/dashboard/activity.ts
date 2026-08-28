/**
 * The Activity report wire (ref frontend-backend-integration §5 "Activity", §3.6
 * `GET /api/v1/reports/activity?from=&to=`, D180).
 *
 * **It is a rendering of the ONE run/queue projection over a date range, not a
 * second counting path.** D81 is the whole reason this wire exists in this
 * shape: ref frontend-backend-integration §8 guard #4 names Activity aggregates explicitly, so every
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
 *
 * **A warning count nobody derived is UNKNOWN, never zero.** The same rule one
 * axis over: a `done` run's warning set lives on its evidence receipt, and a
 * run with no derived receipt has a warning set this projection cannot read.
 * `ActivityCompletion` therefore has THREE arms, not two — `warningsUnknown`
 * is the `unmeasuredRuns` of the completion axis, and folding it into
 * `readBack` would report an unread run as a clean one on the artifact that
 * leaves the operator's screen.
 *
 * **One block on this wire is NOT the projection's, and says so (D236).** The
 * write `ledger` is a second authority reported BESIDE the totals, never
 * derived from them — see `ActivityLedgerBlockSchema` for the whole carve-out
 * and ref dashboard-surfaces §10.1 for its ratification.
 */
import { z } from "zod";
import {
  BrowserSystemIdSchema,
  ErrorCodeSchema,
  IsoInstantSchema,
  RunIdSchema,
  WorkflowIdSchema,
} from "../ids.js";
import { WorkflowCodeSchema } from "../workflow/presentation.js";
import { DashboardWireVersionSchema } from "./primitives.js";
import { QueueStatusSchema, TERMINAL_QUEUE_STATUSES } from "./projection.js";
import { displayStatusProseLabelOf } from "./status-vocabulary.js";

/**
 * How many exemplar run ids an aggregate row may carry.
 *
 * One bound for every sample on this wire: the failure breakdown's `sample`
 * and the outstanding buckets' `sample` are the same affordance — "show me a
 * few of the runs behind this number" — and two different caps would be two
 * different promises the surface would have to explain separately.
 */
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

/**
 * A run whose workflow is no longer registered still happened, and its runs
 * still count. The report says the label and category are unavailable and why,
 * rather than inventing a title from the id — the same posture the queue
 * pipeline already takes for an unregistered descriptor.
 */
export const ActivityWorkflowRegistrationSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("registered"),
    label: z.string().min(1),
    /**
     * The workflow's SHORT CODE (ref workflow-model §1.1.1, D242) — the table's leading
     * token, so the name column can carry a name instead of a full label at
     * every row. It sits INSIDE the registered arm, not beside it, because the
     * code is resolved by the same registry lookup as the label and an
     * unregistered workflow has neither.
     */
    code: WorkflowCodeSchema,
    categoryId: CategoryIdSchema,
  }),
  z.strictObject({ state: z.literal("unregistered"), reason: z.string().min(1) }),
]);

/**
 * The `done` runs, split by what their evidence receipt says (D22/D126).
 *
 * The demo's per-workflow table separates `Read back` from `Warnings`, and in
 * the demo those are two STATUSES. Here they are not: this projection's outcome
 * map settles a clean run and a warned run alike as the one `done` status, and
 * the warning set lives on the run's derived receipt — the same source the
 * queue row's `△ N` chip reads, so the table and the chip cannot disagree.
 *
 * Three arms, because the receipt read has three answers and only two of them
 * are counts of anything:
 *
 * - `readBack` — a receipt exists and records no warning. Genuinely clean.
 * - `warnings` — a receipt exists and records at least one warning.
 * - `warningsUnknown` — NO receipt has been derived for this run, so its
 *   warning set is unread. It is reported in its own column rather than being
 *   added to `readBack`, which would state "this run came back clean" about a
 *   run nobody checked.
 */
export const ActivityCompletionSchema = z.strictObject({
  readBack: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
  warningsUnknown: z.number().int().nonnegative(),
});
export type ActivityCompletion = z.infer<typeof ActivityCompletionSchema>;

/**
 * How many distinct people the range's runs touched, when authority can prove
 * the axis without exporting an identifier.
 *
 * `present` carries only a COUNT. The projection deduplicates exact durable
 * receipt facts whose declared redaction is `direct-identifier/digest`; the
 * digest itself never crosses this wire. `evidenceRows` says how many
 * person-bearing run/member rows supplied one of those facts, which matters
 * because an operation counts once as a run while each of its members may be
 * a different person.
 *
 * `absent` is deliberately not `present { distinct: 0 }`. A run whose receipt
 * is missing, whose workflow has no declared selector, or whose only identity
 * is a last-four suffix leaves the count UNKNOWN. `unavailableRows` makes that
 * missing coverage visible without publishing a run id or any person value.
 */
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
    unavailableRows: z.number().int().positive(),
    reason: z.string().min(1),
  }),
]);
export type ActivityPeopleTotal = z.infer<typeof ActivityPeopleTotalSchema>;

/**
 * One workflow's row of the report — a CROSS-TAB of the workflow axis with the
 * status axis, not a second count of either.
 *
 * The aggregate wire fixes its axes at build time, so a cross-tab that was not
 * built cannot be recovered by a client; these counts therefore come out of the
 * one summation pass beside `statuses[]`, and the report's own `superRefine`
 * refuses a payload whose rows and whose whole-report totals disagree.
 *
 * The bucket set is TOTAL over the closed `QueueStatus` vocabulary — every
 * status lands in exactly one of `completion` (`done`), `failed`, `cancelled`,
 * `partial`, or `open` (every non-terminal status). `partial` is here even
 * though this projection's run-outcome map cannot currently produce it: a
 * bucket set that enumerated only the statuses seen today would silently
 * absorb a new one into the wrong column instead of failing the partition.
 *
 * NOT here, deliberately: the demo's `Est. min saved` column, whose only input
 * is an operator-entered minutes-per-workflow constant with no durable home
 * (`docs/findings/activity.md`, decide-first). The workflow `code` that was
 * also deferred here has landed — it is a registry fact, not a total, so it
 * rides on `registration` beside the label rather than on this row (D242).
 */
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

/**
 * One status bucket, with the exemplar runs behind an OPEN one.
 *
 * "Who is waiting on me" is the question the outstanding table exists to
 * answer, and a count answers half of it. `sample` is the failure breakdown's
 * own precedent applied one axis over: a bounded list of run ids, which the
 * surface resolves against the queue projection it already holds.
 *
 * It carries run IDS and no display names on purpose. A name is subject data
 * and this report is explicitly built to be exported, so the redaction posture
 * for names on it is unsettled (`docs/findings/activity.md`); a run id the
 * client resolves locally puts no new subject data on the wire at all.
 *
 * A TERMINAL status carries an empty sample, refused otherwise below: the
 * sample exists for open work, and a "who" list for finished runs would be a
 * second, unbounded thing for a supervisor to read the wrong way.
 */
export const ActivityStatusTotalSchema = z.strictObject({
  status: QueueStatusSchema,
  runs: z.number().int().nonnegative(),
  sample: z.array(RunIdSchema).max(ACTIVITY_SAMPLE_LIMIT),
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
  sample: z.array(RunIdSchema).max(ACTIVITY_SAMPLE_LIMIT),
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

/**
 * ONE system's row of the write-ledger block — what was actually FILED.
 *
 * `entries` partitions into `prod` + `test` and the refinement refuses any
 * other reading: an entry the wire could not attribute to an instance would
 * make "how many of these touched production" unanswerable on the one artifact
 * a supervisor reads, and a row that quietly dropped it would answer it wrong.
 */
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

/**
 * **The D81 CARVE-OUT (D236).** Every other total on this wire descends from
 * the ONE run/queue projection. This block does not, and it is here anyway.
 *
 * The write ledger is a DIFFERENT authority: ref dashboard-surfaces §10.2 rule 1 has said since
 * Phase 0 that *"the write ledger is never archived — archiving is a display
 * lifecycle; the ledger is an audit one"*, and `src/infra/ledger/` is
 * append-only, never pruned, and partitioned by each entry's own `confirmedAt`.
 * So its entries can OUTLIVE the runs that filed them: a range whose runs have
 * all been archived can still hold ledger lines, and folding those lines out of
 * the run projection would report "nothing was filed" about real HR
 * transactions that were.
 *
 * The carve-out is therefore narrow and it is structural: this block is
 * reported BESIDE the projection's totals and is never reconciled against them.
 * The wire's own refinements deliberately assert NO relationship between
 * `ledger` and `totalRuns`, `terminalRuns` or any status bucket — a cross-check
 * would be a claim that the two corpora cover the same rows, which is the exact
 * claim that is false. What IS checked is each row's internal partition, one
 * level down, where both numbers come from the same authority.
 *
 * The seam is stated ON the surface, not only here: `activityReportCaveats`
 * carries the sentence into the panel's ⓘ and into the CSV export, because a
 * second authority the reader cannot see is a second authority the reader will
 * assume is the first one.
 *
 * An EMPTY `systems` list is an honest fact now that the axis is served —
 * "nothing in this report's reach filed anything into a real HR system" — and
 * was not before, which is why the ported surface omitted the block entirely
 * rather than rendering its empty state over an unserved axis.
 */
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
  /**
   * Top-level runs in range — delegated members are contained in their
   * operation exactly as they are in the Queue Panel, applied once, in the
   * projection, for every surface at the same time.
   */
  totalRuns: z.number().int().nonnegative(),
  terminalRuns: z.number().int().nonnegative(),
  inFlightRuns: z.number().int().nonnegative(),
  people: ActivityPeopleTotalSchema,
  /**
   * The whole-report split of the `done` status — the same three arms every
   * workflow row carries, summed in the same pass. It exists so the headline
   * tile and the per-workflow table read ONE number for "how many came back
   * clean": a tile that folded the rows client-side would be the second count
   * path D81 deletes, and a tile reading a different axis than the table under
   * it is the count/badge divergence this program is replacing.
   */
  completion: ActivityCompletionSchema,
  days: z.array(ActivityDayTotalSchema),
  workflows: z.array(ActivityWorkflowTotalSchema),
  categories: z.array(ActivityCategoryTotalSchema),
  statuses: z.array(ActivityStatusTotalSchema),
  outcomes: z.array(ActivityOutcomeTotalSchema),
  failures: z.array(ActivityFailureTotalSchema),
  durations: ActivityDurationsSchema,
  /**
   * D236 — the one block that is NOT this projection's. See
   * `ActivityLedgerBlockSchema`; nothing below reconciles it against a run
   * total, on purpose.
   */
  ledger: ActivityLedgerBlockSchema,
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

  /**
   * D81, one axis further in: the workflow rows are a CROSS-TAB of two axes
   * this payload also reports on their own, so a row that disagrees with the
   * total it is part of is a report that contradicts itself. Every arm below
   * is refused rather than reconciled — a wire that could be off by one is a
   * wire the surface would have to decide about.
   */
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

  /**
   * The Who sample is an OPEN-work affordance: exactly `min(runs, limit)` ids
   * for a bucket the operator can still act on, and nothing at all for one
   * they cannot. An empty sample beside a positive open count would render a
   * Who column that silently says nobody.
   */
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

/**
 * The error rate, to one decimal, over the TERMINAL denominator the tile and
 * the caveat both name.
 *
 * It lives beside the caveats for the same reason they do: the panel renders it
 * and the CSV export carries it, and two roundings of one ratio is a report
 * whose exported copy disagrees with the screen it was taken from. An empty
 * terminal set is `0` rather than a division — the tile prints the denominator
 * beside the number, so a `0%` over zero terminal runs cannot be misread.
 */
export function activityErrorRatePercent(report: ActivityReportWire): number {
  if (report.terminalRuns === 0) return 0;
  return Math.round((activityStatusRuns(report, "failed") / report.terminalRuns) * 1000) / 10;
}

/**
 * The rules this report was counted by, as sentences, derived from the payload
 * itself.
 *
 * It lives HERE, in the browser-safe contract, because two consumers must read
 * the identical words: the panel's ⓘ popover and the served CSV export (D240).
 * An export carrying the numbers without the rules is precisely the lying
 * artifact this surface is built to prevent — and two copies of the rules, one
 * per consumer, is the same lie with a delay on it, because only one of them
 * would be updated when a rule moves.
 *
 * Every sentence names something the payload actually carries. A caveat about a
 * number that is not on the page is noise, which is why the demo's hours-saved
 * and distinct-people bullets are absent rather than restated (D239, and
 * `docs/findings/activity.md`).
 */
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
    "Every total here is a rendering of the one run/queue projection the Queue Panel reads. Archived "
    + "runs are excluded once, inside it, so this report and the day it summarises cannot disagree.",
    "A finished run's warnings come from its evidence receipt. A run with no derived receipt is "
    + "counted as UNREAD in its own column rather than as read back — the report says how many it "
    + "could not check instead of reporting them as clean.",
    "The Who column samples up to five runs per open state and names them only where the day on "
    + "screen holds the row; every other run in a state is named by its id. The count beside it is "
    + "the whole bucket, never the sample.",
    // D236's seam, stated where the reader is: the ledger block is the one
    // total on this artifact that does not come from the run projection.
    "The write-ledger block is a SECOND authority, reported beside these totals and never derived "
    + "from them. Ledger entries are what was actually filed in a real HR system; they are never "
    + "pruned and never archived, which is why they can outlive the runs that filed them — a system "
    + "can show entries here over a span whose runs have all left the live surfaces.",
  ]);
}
