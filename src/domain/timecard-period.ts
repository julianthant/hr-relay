/**
 * Kronos timecard pay-period range resolution — pure, Clock-injected domain logic.
 *
 * PORTED (copy with provenance, D93 cross-repo rules) from the legacy repo:
 *   commit 793abe1f8265f3213ffe8a80d6cfd9860a32a1dc
 *   path   src/services/timecard/index.ts
 *   blob   91c5b930a77dcc40c4185475ab59d720edcc90b7
 *
 * Kronos grids render punch dates without a year ("Mon 12/30"), so every parsed
 * month/day must be resolved against a window the view is actually showing. The
 * legacy module carried `now: Date = new Date()` defaults; those defaults are
 * exactly what reintroduced the Dec→Jan year-stamp bug whenever a caller omitted
 * the argument. Here every reference time is an explicit `Clock` read, so there
 * is no default to omit and `clock-single-source` covers it.
 *
 * Browser orchestration is NOT here — see `src/stores/common/timecard.ts`.
 */
import { z } from "zod";
import type { Clock } from "./clock.js";

/**
 * Inclusive date window a grid-parsed month/day pair must fall inside.
 * Compared at DAY granularity — the time-of-day on `start`/`end` is ignored.
 */
export const TimecardDateRangeSchema = z.strictObject({
  start: z.date(),
  end: z.date(),
});

/**
 * Month/day pair read directly from a visible Kronos grid row. The grid renders
 * no year, so this is the untrusted half of every timecard date and its bounds
 * are enforced here rather than at each call site.
 */
export const TimecardMonthDaySchema = z.strictObject({
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
});

/** First and last dates actually rendered in the selected timecard period. */
export const VisibleTimecardMonthDaysSchema = z.strictObject({
  first: TimecardMonthDaySchema,
  last: TimecardMonthDaySchema,
});

export type TimecardDateRange = z.infer<typeof TimecardDateRangeSchema>;
export type TimecardMonthDay = z.infer<typeof TimecardMonthDaySchema>;
export type VisibleTimecardMonthDays = z.infer<typeof VisibleTimecardMonthDaysSchema>;

const DAY_MS = 24 * 60 * 60 * 1000;
/** A Kronos pay period is at most a month; 62 days bounds a two-month straddle. */
const MAX_PERIOD_SPAN_DAYS = 62;

/** Local-midnight timestamp for `at` (day-granularity comparisons). */
function startOfDay(at: Date): number {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
}

/**
 * Whole calendar days from `from` to `to`. A DST transition makes the raw
 * millisecond difference 23h or 25h, so the quotient is rounded — every caller
 * here compares day counts, never sub-day precision.
 */
function calendarDaysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);
}

/** "MM/DD/YYYY" for error messages. */
function describeDate(at: Date): string {
  return `${String(at.getMonth() + 1).padStart(2, "0")}/${String(at.getDate()).padStart(2, "0")}/${at.getFullYear()}`;
}

/** "MM/DD/YYYY - MM/DD/YYYY" for error messages. */
function describeRange(range: TimecardDateRange): string {
  return `${describeDate(range.start)} - ${describeDate(range.end)}`;
}

function describeMonthDays(visible: VisibleTimecardMonthDays): string {
  return `${visible.first.month}/${visible.first.day}-${visible.last.month}/${visible.last.day}`;
}

function assertValidDate(at: Date, label: string): void {
  if (!Number.isFinite(at.getTime())) throw new Error(`[timecard] ${label} is not a valid Date`);
}

/**
 * Bounds-check a grid pair through its own schema, but keep the legible
 * `[timecard] impossible <label> grid date M/D` message that names the offending
 * value — a raw Zod issue path would not say which of the two visible rows failed.
 */
function assertValidMonthDayBounds(value: TimecardMonthDay, label: string): void {
  if (TimecardMonthDaySchema.safeParse(value).success) return;
  throw new Error(`[timecard] impossible ${label} grid date ${value.month}/${value.day}`);
}

/**
 * Compose a real calendar date, or `null` when JavaScript would silently roll
 * the day into the next month (2/30 → Mar 1, a non-leap 2/29 → Mar 1).
 */
function composeMonthDay(value: TimecardMonthDay, year: number): Date | null {
  const composed = new Date(year, value.month - 1, value.day);
  if (composed.getFullYear() !== year || composed.getMonth() !== value.month - 1
    || composed.getDate() !== value.day) {
    return null;
  }
  return composed;
}

function visibleRangeCandidate(
  visible: VisibleTimecardMonthDays,
  startYear: number,
): TimecardDateRange | null {
  const firstOrdinal = visible.first.month * 100 + visible.first.day;
  const lastOrdinal = visible.last.month * 100 + visible.last.day;
  const endYear = lastOrdinal < firstOrdinal ? startYear + 1 : startYear;
  const start = composeMonthDay(visible.first, startYear);
  const end = composeMonthDay(visible.last, endYear);
  if (start === null || end === null) return null;
  const spanDays = calendarDaysBetween(start, end);
  if (spanDays < 0 || spanDays > MAX_PERIOD_SPAN_DAYS) return null;
  return { start, end };
}

function requireSingleVisibleRange(
  candidates: readonly TimecardDateRange[],
  detail: string,
): TimecardDateRange {
  const [only] = candidates;
  if (candidates.length !== 1 || only === undefined) {
    throw new Error(
      `[timecard] visible range ${detail} resolved to ${candidates.length} candidate periods - refusing to guess`,
    );
  }
  return only;
}

/** Resolve the exact visible current-period bounds; the period must contain the Clock's today. */
export function resolveCurrentVisibleTimecardRange(
  visible: VisibleTimecardMonthDays,
  clock: Clock,
): TimecardDateRange {
  const now = clock.now();
  assertValidDate(now, "current-period reference");
  assertValidMonthDayBounds(visible.first, "first visible");
  assertValidMonthDayBounds(visible.last, "last visible");
  const anchor = startOfDay(now);
  const candidates: TimecardDateRange[] = [];
  let composable = false;
  for (let year = now.getFullYear() - 1; year <= now.getFullYear() + 1; year++) {
    const candidate = visibleRangeCandidate(visible, year);
    if (candidate === null) continue;
    composable = true;
    if (startOfDay(candidate.start) <= anchor && anchor <= startOfDay(candidate.end)) {
      candidates.push(candidate);
    }
  }
  if (!composable) {
    throw new Error(`[timecard] impossible visible current period ${describeMonthDays(visible)}`);
  }
  if (candidates.length === 0) {
    throw new Error(
      `[timecard] visible current period ${describeMonthDays(visible)} does not contain ${describeDate(now)}`,
    );
  }
  return requireSingleVisibleRange(candidates, "for the current pay period");
}

/** Resolve the exact previous-period bounds relative to an already verified current range. */
export function resolvePreviousVisibleTimecardRange(
  visible: VisibleTimecardMonthDays,
  current: TimecardDateRange,
): TimecardDateRange {
  assertValidDate(current.start, "current range start");
  assertValidDate(current.end, "current range end");
  assertValidMonthDayBounds(visible.first, "first visible");
  assertValidMonthDayBounds(visible.last, "last visible");
  const currentStart = startOfDay(current.start);
  const candidates: TimecardDateRange[] = [];
  let composable = false;
  for (let year = current.start.getFullYear() - 1; year <= current.start.getFullYear(); year++) {
    const candidate = visibleRangeCandidate(visible, year);
    if (candidate === null) continue;
    composable = true;
    const end = startOfDay(candidate.end);
    const gapDays = calendarDaysBetween(candidate.end, current.start);
    if (end < currentStart && gapDays <= MAX_PERIOD_SPAN_DAYS) candidates.push(candidate);
  }
  if (!composable) {
    throw new Error(`[timecard] impossible visible previous period ${describeMonthDays(visible)}`);
  }
  return requireSingleVisibleRange(candidates, "before the verified current pay period");
}

/**
 * Format a grid month/day pair as MM/DD/YYYY, resolving the YEAR against the
 * range the timecard view is actually showing. There is no reference-date
 * default: the year is the unique candidate in
 * `[range.start.getFullYear() .. range.end.getFullYear()]` whose composed date
 * falls inside `[range.start, range.end]` (inclusive, day granularity).
 *
 * Throws — never guesses — on an impossible month/day, zero candidate years
 * (the day cannot belong to the requested window), or two or more candidates
 * (a window wider than a year is ambiguous).
 */
export function formatTimecardDate(
  month: number,
  day: number,
  range: TimecardDateRange,
): string {
  assertValidDate(range.start, "range start");
  assertValidDate(range.end, "range end");
  assertValidMonthDayBounds({ month, day }, "parsed");
  const low = startOfDay(range.start);
  const high = startOfDay(range.end);
  if (low > high) {
    throw new Error(`[timecard] inverted date range ${describeRange(range)} while resolving ${month}/${day}`);
  }
  let composable = 0;
  const candidates: number[] = [];
  for (let year = range.start.getFullYear(); year <= range.end.getFullYear(); year++) {
    const composed = composeMonthDay({ month, day }, year);
    if (composed === null) continue;
    composable++;
    const at = composed.getTime();
    if (at >= low && at <= high) candidates.push(year);
  }
  if (composable === 0) {
    throw new Error(
      `[timecard] impossible date ${month}/${day} - no candidate year in ${describeRange(range)} has that calendar day`,
    );
  }
  const [resolved] = candidates;
  if (candidates.length === 0 || resolved === undefined) {
    throw new Error(
      `[timecard] ${month}/${day} falls outside the requested range ${describeRange(range)} in every candidate year - refusing to guess the year`,
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      `[timecard] ${month}/${day} is ambiguous within ${describeRange(range)} - candidate years ${candidates.join(", ")}; narrow the range`,
    );
  }
  return `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}/${resolved}`;
}

/**
 * Positive check that a displayed pay-period label actually changed after a
 * "switch to previous period" action.
 *
 * Both Kronos systems close the period dropdown as soon as the click registers;
 * that only proves the dropdown DETACHED, never that the grid switched periods.
 * A blank BEFORE means the baseline was never read, so the switch CANNOT be
 * verified — that is a verification failure, not "assume it switched". When
 * `currentLabelPattern` is supplied, `after` must also no longer match it (New
 * Kronos can close the dropdown while still literally showing "Current Pay
 * Period").
 *
 * Callers must throw on `false`; `assertPeriodLabelSwitched` does that for them.
 */
export function didPeriodLabelSwitch(
  before: string,
  after: string,
  currentLabelPattern?: RegExp,
): boolean {
  const normalizedBefore = before.trim().toLowerCase();
  const normalizedAfter = after.trim().toLowerCase();
  if (normalizedBefore.length === 0 || normalizedAfter.length === 0) return false;
  if (normalizedBefore === normalizedAfter) return false;
  if (currentLabelPattern !== undefined && currentLabelPattern.test(after)) return false;
  return true;
}

/** Fail-loud wrapper: an unverifiable period switch must never be read as a switch. */
export function assertPeriodLabelSwitched(
  before: string,
  after: string,
  currentLabelPattern?: RegExp,
): void {
  if (didPeriodLabelSwitch(before, after, currentLabelPattern)) return;
  throw new Error(
    `[timecard] pay-period switch is unverified - label went from ${JSON.stringify(before)} to ${JSON.stringify(after)}`,
  );
}

/**
 * Conservative year-resolution windows for the two timecard reads, derived from
 * the Clock's now:
 *
 * - current pay period  ≈ [now − 60d, now + 7d]
 * - previous pay period ≈ [now − 120d, now + 7d]
 *
 * Kronos pay periods are at most a month long, so these comfortably contain
 * whatever period is displayed, and each window is well under ~330 days — any
 * month/day pair resolves to exactly ONE candidate year inside it.
 *
 * Offsets are applied in CALENDAR days, not `n * 86_400_000` milliseconds. The
 * legacy version used millisecond arithmetic, which lands an hour off local
 * midnight across a DST transition and can therefore shift a bound by a whole
 * day once `startOfDay` rounds it. Every bound here is local midnight exactly.
 */
export function timecardCheckWindows(
  clock: Clock,
): Readonly<{ current: TimecardDateRange; previous: TimecardDateRange }> {
  const now = clock.now();
  assertValidDate(now, "timecard window reference");
  const shiftDays = (days: number): Date =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  const end = shiftDays(7);
  return {
    current: { start: shiftDays(-60), end },
    previous: { start: shiftDays(-120), end },
  };
}
