/** The separation timecard — pure, browser-safe folds over a New Kronos (UKG / WFD) timecard grid that has already been read off the page. */
import { formatTimecardDate, resolveTimecardDate } from "../time/timecard-period.js";
import type { TimecardDateRange } from "../time/timecard-period.js";
import { z } from "zod";

/** One rendered grid row, exactly as the page carried it; every cell is the raw trimmed string, and nothing is parsed at the boundary. */
export const TimecardGridRowSchema = z.strictObject({
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  /** The pinned date cell verbatim, e.g. `"Mon 6/01"`; `""` on a carried row. */
  rawDateCell: z.string(),
  schedule: z.string(),
  punchIn: z.string(),
  punchOut: z.string(),
  transfer: z.string(),
  payCode: z.string(),
  amount: z.string(),
  shift: z.string(),
  daily: z.string(),
  period: z.string(),
  absence: z.string(),
});
export type TimecardGridRow = z.infer<typeof TimecardGridRowSchema>;

/** `MM/DD/YYYY`, the one date spelling every Kronos-derived value uses. */
export const TimecardDateSchema = z.string().regex(
  /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/,
  "timecard date must be MM/DD/YYYY",
);

/** A pay-code row projected to its resolved date, kept verbatim beside it. */
export const TimecardPayCodeDaySchema = z.strictObject({
  date: TimecardDateSchema,
  /** The Pay code cell exactly as rendered, e.g. `"Holiday - Hourly"`. */
  payCode: z.string().min(1),
  /** The Amount cell exactly as rendered, e.g. `"4.00"`; `""` when blank. */
  amount: z.string(),
});
export type TimecardPayCodeDay = z.infer<typeof TimecardPayCodeDaySchema>;

export const SeparationTimecardFoldSchema = z.strictObject({
    /* Latest day carrying an In/Out punch, or `null` when the window genuinely has none — a card that opened and holds no punches, only ever produced from a grid that yielded rows. */
  lastPunchDate: TimecardDateSchema.nullable(),
  /** Every day carrying an In/Out punch, chronological, de-duplicated. */
  punchDates: z.array(TimecardDateSchema),
  /** Days whose pay code matches `/sick/i`, chronological, de-duplicated. */
  sickDates: z.array(TimecardDateSchema),
  /** Days whose pay code matches `/holiday/i`, chronological, de-duplicated. */
  holidayDates: z.array(TimecardDateSchema),
  /** Every pay-code row in the window, verbatim — the full surface. */
  payCodeDays: z.array(TimecardPayCodeDaySchema),
    /* Pay codes present in the window that matched neither rule, reported rather than dropped, because a holiday the classifier does not know about would move a separation date. */
  unclassifiedPayCodes: z.array(z.string().min(1)),
});
export type SeparationTimecardFold = z.infer<typeof SeparationTimecardFoldSchema>;

/** The column set the fold needs, resolved from the grid's own header row rather than from fixed indices. */
export const TimecardDataColumnSchema = z.enum([
  "Schedule",
  "In",
  "Out",
  "Transfer",
  "Pay code",
  "Amount",
  "Shift",
  "Daily",
  "Period",
  "Absence",
]);
export type TimecardDataColumn = z.infer<typeof TimecardDataColumnSchema>;
export const TIMECARD_DATA_COLUMNS: readonly TimecardDataColumn[] = Object.freeze(
  TimecardDataColumnSchema.options,
);

/** Header text carries a sort-order suffix (`"In 1"`); strip it before matching. */
function normalizeHeader(raw: string): string {
  return raw.replace(/\s+\d+$/u, "").replace(/\s+/gu, " ").trim().toLowerCase();
}

/** Map every required data column to its live index, or throw naming the exact headers that are missing and the whole header row that was observed. */
export function resolveTimecardColumns(
  headers: readonly string[],
): Readonly<Record<TimecardDataColumn, number>> {
  const normalized = headers.map(normalizeHeader);
  const resolved = new Map<TimecardDataColumn, number>();
  const missing: string[] = [];
  const ambiguous: string[] = [];
  for (const column of TIMECARD_DATA_COLUMNS) {
    const wanted = column.toLowerCase();
    const hits = normalized.flatMap((header, index) => (header === wanted ? [index] : []));
    const [only] = hits;
    if (hits.length === 0 || only === undefined) missing.push(column);
    else if (hits.length > 1) ambiguous.push(`${column} (${String(hits.length)}x)`);
    else resolved.set(column, only);
  }
  if (missing.length > 0 || ambiguous.length > 0) {
    throw new Error(
      "[new-kronos] timecard grid header row does not resolve the columns the separation read needs"
      + (missing.length > 0 ? ` — missing ${missing.join(", ")}` : "")
      + (ambiguous.length > 0 ? ` — ambiguous ${ambiguous.join(", ")}` : "")
      + ` — observed headers ${JSON.stringify(headers)}`,
    );
  }
  // Explicit keys make a new schema column a compile-time omission.
  const at = (column: TimecardDataColumn): number => {
    const index = resolved.get(column);
    if (index === undefined) throw new Error(`[new-kronos] timecard column ${column} was not resolved`);
    return index;
  };
  return Object.freeze({
    Schedule: at("Schedule"),
    In: at("In"),
    Out: at("Out"),
    Transfer: at("Transfer"),
    "Pay code": at("Pay code"),
    Amount: at("Amount"),
    Shift: at("Shift"),
    Daily: at("Daily"),
    Period: at("Period"),
    Absence: at("Absence"),
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole calendar days from `from` to `to`, DST-safe (rounded). */
function calendarDaysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);
}

function startOfDay(at: Date): number {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
}

function describeDay(at: Date): string {
  return `${String(at.getMonth() + 1).padStart(2, "0")}/${String(at.getDate()).padStart(2, "0")}/${String(at.getFullYear())}`;
}

/** Every calendar day in `[range.start, range.end]` as `MM/DD/YYYY`. */
export function enumerateRangeDays(range: TimecardDateRange): readonly string[] {
  const days: string[] = [];
  const cursor = new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate());
  const end = startOfDay(range.end);
  if (startOfDay(cursor) > end) {
    throw new Error(`[new-kronos] inverted timecard range ${describeDay(range.start)} - ${describeDay(range.end)}`);
  }
  // Bound expanded windows to prevent corrupt ranges from spinning.
  for (let guard = 0; guard <= 400; guard++) {
    days.push(describeDay(cursor));
    if (startOfDay(cursor) >= end) return days;
    cursor.setDate(cursor.getDate() + 1);
  }
  throw new Error(
    `[new-kronos] timecard range ${describeDay(range.start)} - ${describeDay(range.end)} spans more than 400 days`,
  );
}

/** NOT exported: this is the in-process result of a computation, never a durable, wire, or config boundary. */
interface TimecardRangeCoverage {
  /** Every day the applied window demands, `MM/DD/YYYY`. */
  readonly expected: readonly string[];
  /** Every distinct day the rows actually carry, INCLUDING period overhang. */
  readonly observed: ReadonlySet<string>;
  /** The expected days no row carries — empty exactly when the read is whole. */
  readonly missing: readonly string[];
    /* Rows the grid rendered that belong to NO year inside the widened window — `M/D` pairs as the grid spelled them, reported rather than thrown so the refusal can name every one of them. */
  readonly outside: readonly string[];
  readonly complete: boolean;
}

/** How much of the applied window a set of rows actually covers — the ONE coverage computation, so the scroll loop and the refusal cannot disagree. */
export function timecardRangeCoverage(
  rows: readonly Readonly<{ month: number; day: number }>[],
  range: TimecardDateRange,
): TimecardRangeCoverage {
  // Coverage accepts period-aligned days beyond the requested window.
  const resolution = periodAlignedResolutionRange(range);
  const observed = new Set<string>();
  const outside: string[] = [];
  for (const row of rows) {
    const resolved = resolveTimecardDate(row.month, row.day, resolution);
    if (resolved === null) outside.push(`${String(row.month)}/${String(row.day)}`);
    else observed.add(resolved);
  }
  const expected = enumerateRangeDays(range);
  const missing = expected.filter((day) => !observed.has(day));
  return Object.freeze({
    expected,
    observed,
    missing: Object.freeze(missing),
    outside: Object.freeze([...new Set(outside)]),
    // Missing days may need scrolling; out-of-window days prove a different applied window.
    complete: missing.length === 0 && outside.length === 0,
  });
}

/** `N of M days, missing a, b, c and K more` — the one phrasing for both callers. */
export function describeTimecardCoverage(
  coverage: TimecardRangeCoverage,
  range: TimecardDateRange,
): string {
  const shown = coverage.missing.slice(0, 8).join(", ");
  return `covers ${String(coverage.observed.size)} of ${String(coverage.expected.length)} days in `
    + `${describeDay(range.start)} - ${describeDay(range.end)} — missing ${shown}`
    + (coverage.missing.length > 8 ? ` and ${String(coverage.missing.length - 8)} more` : "");
}

/** Refuse a grid read that does not cover the applied window: a complete read holds EVERY day, and a short read is a truncated scroll, never "those days have nothing on them". */
export function assertTimecardCoversRange(
  rows: readonly TimecardGridRow[],
  range: TimecardDateRange,
): void {
  if (rows.length === 0) {
    throw new Error(
      `[new-kronos] timecard grid produced ZERO rows for ${describeDay(range.start)} - ${describeDay(range.end)}`
      + " — the grid was not read; this is not an empty timecard",
    );
  }
  const coverage = timecardRangeCoverage(rows, range);
  if (coverage.complete) return;
  if (coverage.outside.length > 0) {
    throw new Error(
      `[new-kronos] timecard grid rows ${coverage.outside.join(", ")} belong to no year inside `
      + `${describeDay(range.start)} - ${describeDay(range.end)} — the grid rendered a DIFFERENT period `
      + "than the one that was applied; refusing to derive a last punch from rows that are not this window's",
    );
  }
  throw new Error(
    `[new-kronos] timecard grid read ${describeTimecardCoverage(coverage, range)}`
    + " — the virtualized grid was not scrolled to the end; refusing to derive a last punch from a partial read",
  );
}

/** A Kronos pay period is at most a month, so a grid whose range bounds fall mid-period renders up to a month of extra days on each side. */
const PERIOD_ALIGNMENT_SLACK_DAYS = 31;
/** Widen the applied window by one pay period on each side, so a period-aligned neighbouring day still resolves to exactly ONE candidate year and the fold never guesses. */
export function periodAlignedResolutionRange(range: TimecardDateRange): TimecardDateRange {
  const widened = {
    start: new Date(
      range.start.getFullYear(), range.start.getMonth(),
      range.start.getDate() - PERIOD_ALIGNMENT_SLACK_DAYS,
    ),
    end: new Date(
      range.end.getFullYear(), range.end.getMonth(),
      range.end.getDate() + PERIOD_ALIGNMENT_SLACK_DAYS,
    ),
  };
  const spanDays = calendarDaysBetween(widened.start, widened.end);
  if (spanDays > 330) {
    throw new Error(
      `[new-kronos] timecard window ${describeDay(range.start)} - ${describeDay(range.end)} is too wide to `
      + `resolve grid years unambiguously once widened for pay-period alignment (${String(spanDays)} days)`,
    );
  }
  return widened;
}

/** A row carries a punch when either the In or the Out cell holds a clock time. */
const CLOCK_TIME = /\d+:\d+\s*(?:AM|PM)/iu;
export function rowHasPunch(row: TimecardGridRow): boolean {
  return CLOCK_TIME.test(row.punchIn) || CLOCK_TIME.test(row.punchOut);
}

const SICK_PAY_CODE = /sick/iu;
const HOLIDAY_PAY_CODE = /holiday/iu;


export function classifyPayCode(payCode: string): "sick" | "holiday" | "unclassified" {
  if (SICK_PAY_CODE.test(payCode)) return "sick";
  if (HOLIDAY_PAY_CODE.test(payCode)) return "holiday";
  return "unclassified";
}

function chronological(dates: Iterable<string>): string[] {
  return [...new Set(dates)].sort((left, right) => {
    const [lm = "", ld = "", ly = ""] = left.split("/");
    const [rm = "", rd = "", ry = ""] = right.split("/");
    return `${ly}${lm}${ld}`.localeCompare(`${ry}${rm}${rd}`);
  });
}

/** Fold accumulated grid rows into the separation-relevant dates; every yearless `M/D` resolves against the window the view is PROVED to be showing, never against "now". */
export function foldSeparationTimecard(
  rows: readonly TimecardGridRow[],
  range: TimecardDateRange,
): SeparationTimecardFold {
  assertTimecardCoversRange(rows, range);
  const resolution = periodAlignedResolutionRange(range);
  const insideStart = startOfDay(range.start);
  const insideEnd = startOfDay(range.end);
  const punchDates: string[] = [];
  const sickDates: string[] = [];
  const holidayDates: string[] = [];
  const payCodeDays: TimecardPayCodeDay[] = [];
  const unclassified: string[] = [];
  for (const row of rows) {
    // Resolve years against the period-aligned window, then filter to the requested days.
    const date = formatTimecardDate(row.month, row.day, resolution);
    const at = startOfDay(parseTimecardDate(date, "resolved grid date"));
    if (at < insideStart || at > insideEnd) continue;
    if (rowHasPunch(row)) punchDates.push(date);
    const payCode = row.payCode.trim();
    if (payCode.length === 0) continue;
    payCodeDays.push({ date, payCode, amount: row.amount.trim() });
    const classification = classifyPayCode(payCode);
    if (classification === "sick") sickDates.push(date);
    else if (classification === "holiday") holidayDates.push(date);
    else unclassified.push(payCode);
  }
  const orderedPunches = chronological(punchDates);
  return SeparationTimecardFoldSchema.parse({
    lastPunchDate: orderedPunches.at(-1) ?? null,
    punchDates: orderedPunches,
    sickDates: chronological(sickDates),
    holidayDates: chronological(holidayDates),
    payCodeDays,
    unclassifiedPayCodes: [...new Set(unclassified)].sort(),
  });
}

/** Parse the period label WFD renders after a range is applied into a real range; the parse is padding-tolerant and the COMPARISON is on calendar days, never on strings. */
export function parseAppliedRangeLabel(label: string): TimecardDateRange | null {
  const match = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*[-–]\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/u.exec(label);
  if (match === null) return null;
  const [, sm = "", sd = "", sy = "", em = "", ed = "", ey = ""] = match;
  const start = new Date(Number(sy), Number(sm) - 1, Number(sd));
  const end = new Date(Number(ey), Number(em) - 1, Number(ed));
  if (start.getMonth() !== Number(sm) - 1 || start.getDate() !== Number(sd)) return null;
  if (end.getMonth() !== Number(em) - 1 || end.getDate() !== Number(ed)) return null;
  return { start, end };
}

/** True when two ranges name the same calendar days on both bounds. */
export function rangesAreSameDays(left: TimecardDateRange, right: TimecardDateRange): boolean {
  return startOfDay(left.start) === startOfDay(right.start)
    && startOfDay(left.end) === startOfDay(right.end);
}

/** `MM/DD/YYYY` for a range bound — the spelling every task output uses. */
export function formatRangeBound(at: Date): string {
  return describeDay(at);
}

/** Parse an `MM/DD/YYYY` (or `M/D/YYYY`) task input into a real calendar date. */
export function parseTimecardDate(value: string, label: string): Date {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u.exec(value.trim());
  if (match === null) throw new Error(`[new-kronos] ${label} ${JSON.stringify(value)} is not M/D/YYYY`);
  const [, m = "", d = "", y = ""] = match;
  const parsed = new Date(Number(y), Number(m) - 1, Number(d));
  if (parsed.getFullYear() !== Number(y) || parsed.getMonth() !== Number(m) - 1
    || parsed.getDate() !== Number(d)) {
    throw new Error(`[new-kronos] ${label} ${JSON.stringify(value)} is not a real calendar date`);
  }
  return parsed;
}
