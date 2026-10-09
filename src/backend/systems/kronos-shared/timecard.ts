/**
 * Semantic timecard-check helper shared by both Kronos stores.
 *
 * PORTED (copy with provenance, D93 cross-repo rules) from the legacy repo:
 *   commit 793abe1f8265f3213ffe8a80d6cfd9860a32a1dc
 *   path   src/services/timecard/index.ts  (`TimecardDriver`, `runTimecardCheck`)
 *   blob   91c5b930a77dcc40c4185475ab59d720edcc90b7
 *
 * Four boundary changes were made in the port; each removes a silent fallback or
 * a banned primitive rather than reshaping the control flow:
 *
 * 1. **No raw `Page`.** The legacy driver took `(page, …)` on every method, so a
 *    caller could reach past the registry. Here the operations are page-free and
 *    the concrete Kronos drivers own their own Playwright internals (ref operator-trust §1.4).
 * 2. **No `waitForTimeout`.** The legacy orchestration slept 3s after navigation
 *    and after a period switch. Settling is a semantic page-state wait owned by
 *    the driver operation itself; this helper never sleeps.
 * 3. **Navigation failure throws.** `goToTimecard(): Promise<boolean>` returning
 *    `false` made "could not open the timecard" indistinguishable from "no punch
 *    entries exist" — both surfaced as `null`. The operation now returns `void`
 *    and fails loud.
 * 4. **The driver cannot assert its own switch.** `switchPeriod(): Promise<boolean>`
 *    is replaced by a typed outcome carrying the before/after period labels; THIS
 *    helper compares them (ref operator-trust §1.4 — normalization/comparison belong to the
 *    kernel side of the boundary). "There is no previous period" must be declared
 *    explicitly by the driver, never inferred from a bare `false`.
 *
 * The Old Kronos adapter closes its capability at migration order 2 and the New
 * Kronos adapter at order 8; this helper is the shared seam both bind to.
 */
import type { Clock } from "../../../rules/time/clock.js";
import {
  VisibleTimecardMonthDaysSchema,
  assertPeriodLabelSwitched,
  resolveCurrentVisibleTimecardRange,
  resolvePreviousVisibleTimecardRange,
} from "../../../rules/time/timecard-period.js";
import type { TimecardDateRange, VisibleTimecardMonthDays } from "../../../rules/time/timecard-period.js";

/**
 * Result of asking a Kronos view to move to the previous pay period. The
 * `no-previous-period` arm is a declared, named outcome — the driver states that
 * the control is genuinely absent, and never uses it to mask a failed click.
 */
export type TimecardPeriodSwitch =
  | Readonly<{ kind: "switched"; beforeLabel: string; afterLabel: string }>
  | Readonly<{ kind: "no-previous-period"; reason: string }>;

/**
 * The semantic operations a Kronos store must provide for the shared check.
 * Every method is page-free; the implementing driver owns locators, page-state
 * waits, and iframe scoping behind this boundary.
 */
export interface SemanticTimecardDriver {
  /** Open the timecard view, settled and ready to read. Fails loud; never returns a status flag. */
  goToTimecard(): Promise<void>;
  /** Move to the previous pay period, reporting the labels observed before and after. */
  switchToPreviousPeriod(): Promise<TimecardPeriodSwitch>;
  /** Read the first/last month-day pairs actually rendered in the grid. */
  readVisibleMonthDays(): Promise<VisibleTimecardMonthDays>;
  /**
   * Read the last date carrying In/Out entries in the current view, or `null`
   * when the period genuinely has none. `range` is the inclusive window the
   * displayed period must fall inside — resolve grid month/day pairs against it
   * with `formatTimecardDate(month, day, range)`.
   */
  readLastDate(range: TimecardDateRange): Promise<string | null>;
}

/**
 * Navigate to the timecard, read the last punched date in the current pay
 * period, and — only when the current period is genuinely empty — switch to the
 * previous period and read again.
 *
 * Returns `"MM/DD/YYYY"`, or `null` when neither period has entries. Every other
 * outcome (navigation failure, an unverifiable period switch, an impossible or
 * ambiguous grid date) throws.
 *
 * `currentLabelPattern` lets a store name the literal "Current Pay Period" label
 * its view keeps rendering after the dropdown closes, so a non-switch cannot be
 * read as a switch.
 */
export async function runTimecardCheck(
  driver: SemanticTimecardDriver,
  clock: Clock,
  currentLabelPattern?: RegExp,
): Promise<string | null> {
  await driver.goToTimecard();

  // The grid read is the untrusted boundary — parse it here, so the domain
  // resolvers only ever see a shape-valid pair and a malformed driver return
  // fails with a schema error instead of a misleading bounds message.
  const readGrid = async (): Promise<VisibleTimecardMonthDays> =>
    VisibleTimecardMonthDaysSchema.parse(await driver.readVisibleMonthDays());

  // Resolve the exact current range from the visible first/last rows BEFORE
  // parsing any yearless punch dates.
  const currentRange = resolveCurrentVisibleTimecardRange(await readGrid(), clock);
  const currentLastDate = await driver.readLastDate(currentRange);
  if (currentLastDate !== null) return currentLastDate;

  const outcome = await driver.switchToPreviousPeriod();
  if (outcome.kind === "no-previous-period") return null;
  assertPeriodLabelSwitched(outcome.beforeLabel, outcome.afterLabel, currentLabelPattern);

  const previousRange = resolvePreviousVisibleTimecardRange(await readGrid(), currentRange);
  return driver.readLastDate(previousRange);
}
