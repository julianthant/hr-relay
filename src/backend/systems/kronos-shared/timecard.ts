
import type { Clock } from "../../../rules/time/clock.js";
import {
  VisibleTimecardMonthDaysSchema,
  assertPeriodLabelSwitched,
  resolveCurrentVisibleTimecardRange,
  resolvePreviousVisibleTimecardRange,
} from "../../../rules/time/timecard-period.js";
import type { TimecardDateRange, VisibleTimecardMonthDays } from "../../../rules/time/timecard-period.js";


export type TimecardPeriodSwitch =
  | Readonly<{ kind: "switched"; beforeLabel: string; afterLabel: string }>
  | Readonly<{ kind: "no-previous-period"; reason: string }>;


export interface SemanticTimecardDriver {
  /** Open the timecard view, settled and ready to read. Fails loud; never returns a status flag. */
  goToTimecard(): Promise<void>;
  /** Move to the previous pay period, reporting the labels observed before and after. */
  switchToPreviousPeriod(): Promise<TimecardPeriodSwitch>;
  /** Read the first/last month-day pairs actually rendered in the grid. */
  readVisibleMonthDays(): Promise<VisibleTimecardMonthDays>;
  // Null means a genuinely punch-free period; resolve month/day pairs inside the inclusive displayed range.
  readLastDate(range: TimecardDateRange): Promise<string | null>;
}

// Return the last punch from the current period; inspect the previous period only when the current one is genuinely empty.
export async function runTimecardCheck(
  driver: SemanticTimecardDriver,
  clock: Clock,
  currentLabelPattern?: RegExp,
): Promise<string | null> {
  await driver.goToTimecard();


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
