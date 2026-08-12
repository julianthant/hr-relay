/**
 * The separation timecard — pure, browser-safe folds over a New Kronos (UKG /
 * WFD) timecard grid that has already been read off the page.
 *
 * PORTED (copy with provenance, D93 cross-repo rules) from the legacy repo:
 *   commit 1bffbd658db34ce84a08e69484db3a40b3658d6e
 *   path   src/systems/new-kronos/navigate.ts
 *          (`resolveSeparationTimecardDates` :817-834, the `page.evaluate`
 *           grid parse inside `getSeparationTimecardData` :852-894)
 *
 * Nothing here touches a browser: the driver hands over RAW rows exactly as the
 * grid rendered them, and every derivation happens here so the Dec→Jan year
 * matrix, the multi-row-per-day carry-forward, and the sick/holiday rules are
 * unit-testable without a page. Year resolution itself is NOT re-implemented —
 * it is `formatTimecardDate` from `../timecard-period.js` (S41), which refuses
 * to stamp a guessed year.
 *
 * Four corrections to the legacy rules, each removing a silent-wrong-value path
 * rather than reshaping the fold. All four were established by the live
 * read-only map on 2026-08-12 (EID 10776990, window 06/01/2026–08/12/2026):
 *
 * 1. **The grid is VIRTUALIZED, so a single DOM read is not the timecard.**
 *    A 73-day window renders only 51 date rows at `scrollTop: 0` (06/01 … 07/20)
 *    — legacy reads once, so any punch after the rendered window is invisible
 *    and the LAST PUNCH silently regresses to an earlier date. The driver now
 *    scrolls and accumulates, and {@link assertTimecardCoversRange} refuses a
 *    read whose day set does not cover the applied window exactly once.
 * 2. **Columns bind BY HEADER NAME, never by index.** Legacy hardcodes
 *    `[1]=In [2]=Out [4]=Pay code`; a column inserted upstream would silently
 *    re-point "Pay code" at "Transfer". {@link resolveTimecardColumns} maps the
 *    live header row and fails loud naming the missing header.
 * 3. **A pay code that classifies as neither sick nor holiday is REPORTED, not
 *    dropped.** The live window carried `Juneteenth Observed` and
 *    `Independence Day Observed` beside `Holiday - Hourly`; only the last
 *    matches legacy's `/holiday/i`. Silently discarding the other two would
 *    hide a day that may belong in the separation date, so they surface as
 *    {@link SeparationTimecardFold.unclassifiedPayCodes} for the operator.
 * 4. **"No punches" and "no rows at all" stay different values.** S34/S38: a
 *    timecard that opened and is genuinely empty is a real outcome; a grid that
 *    produced no rows at all is a failed read. The fold never collapses them.
 */
import { formatTimecardDate } from "../timecard-period.js";
import type { TimecardDateRange } from "../timecard-period.js";
import { z } from "zod";

/**
 * One rendered grid row, exactly as the page carried it. `month`/`day` come
 * from the pinned date column and are carried forward across the extra rows a
 * single calendar day can own (live 2026-08-12: 6/19 owns both
 * `Holiday - Hourly 4.00` and `Juneteenth Observed 0.00`).
 *
 * Every cell is the raw trimmed string. Nothing is parsed at the boundary —
 * D194's "raw cell values beside derived ones" is what lets a later migration
 * answer a question this one never asked.
 */
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
  /**
   * Latest day carrying an In/Out punch, or `null` when the window genuinely
   * has none. `null` here is S38's REAL outcome — a card that opened and holds
   * no punches — and is only ever produced from a grid that yielded rows.
   */
  lastPunchDate: TimecardDateSchema.nullable(),
  /** Every day carrying an In/Out punch, chronological, de-duplicated. */
  punchDates: z.array(TimecardDateSchema),
  /** Days whose pay code matches `/sick/i`, chronological, de-duplicated. */
  sickDates: z.array(TimecardDateSchema),
  /** Days whose pay code matches `/holiday/i`, chronological, de-duplicated. */
  holidayDates: z.array(TimecardDateSchema),
  /** Every pay-code row in the window, verbatim — the D194 full surface. */
  payCodeDays: z.array(TimecardPayCodeDaySchema),
  /**
   * Pay codes present in the window that matched neither rule. Reported rather
   * than dropped: on 2026-08-12 the live window carried two of them, and a
   * holiday the classifier does not know about would move a separation date.
   */
  unclassifiedPayCodes: z.array(z.string().min(1)),
});
export type SeparationTimecardFold = z.infer<typeof SeparationTimecardFoldSchema>;

/**
 * The column set the fold needs, resolved from the grid's own header row.
 *
 * Live header row 2026-08-12 (`.ui-grid-header-cell`, data viewport):
 * `Schedule · In · Out · Transfer · Pay code · Amount · Shift · Daily · Period · Absence`.
 */
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

/**
 * Map every required data column to its live index, or throw naming the exact
 * headers that are missing and the whole header row that was observed.
 *
 * This replaces legacy's fixed `[1]=In [2]=Out [4]=Pay code` indices. A column
 * inserted by a WFD release would silently re-point "Pay code" at "Transfer"
 * under the old rule; here it is a loud refusal before anything is derived.
 */
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
  // Written out key by key so the record is complete BY CONSTRUCTION — no cast,
  // and a column added to the schema is a compile error here rather than a
  // silently absent index at runtime.
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
  // A separations window is at most ~3 months (legacy computeKronosDateRange:
  // min−1 month … max+1 month); 400 days bounds any legitimate one and stops a
  // corrupted range from spinning.
  for (let guard = 0; guard <= 400; guard++) {
    days.push(describeDay(cursor));
    if (startOfDay(cursor) >= end) return days;
    cursor.setDate(cursor.getDate() + 1);
  }
  throw new Error(
    `[new-kronos] timecard range ${describeDay(range.start)} - ${describeDay(range.end)} spans more than 400 days`,
  );
}

/**
 * Refuse a grid read that does not cover the applied window.
 *
 * This is the guard the virtualized grid demands: WFD renders one row per
 * calendar day, so a complete read holds EVERY day in the applied range. A
 * short read is a truncated scroll, never "those days have nothing on them" —
 * and the difference decides a real termination's last-day-worked.
 */
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
  const observed = new Set(rows.map((row) => formatTimecardDate(row.month, row.day, range)));
  const missing = enumerateRangeDays(range).filter((day) => !observed.has(day));
  if (missing.length === 0) return;
  const shown = missing.slice(0, 8).join(", ");
  throw new Error(
    `[new-kronos] timecard grid read covers ${String(observed.size)} of `
    + `${String(enumerateRangeDays(range).length)} days in `
    + `${describeDay(range.start)} - ${describeDay(range.end)} — missing ${shown}`
    + (missing.length > 8 ? ` and ${String(missing.length - 8)} more` : "")
    + " — the virtualized grid was not scrolled to the end; refusing to derive a last punch from a partial read",
  );
}

/** A row carries a punch when either the In or the Out cell holds a clock time. */
const CLOCK_TIME = /\d+:\d+\s*(?:AM|PM)/iu;
export function rowHasPunch(row: TimecardGridRow): boolean {
  return CLOCK_TIME.test(row.punchIn) || CLOCK_TIME.test(row.punchOut);
}

const SICK_PAY_CODE = /sick/iu;
const HOLIDAY_PAY_CODE = /holiday/iu;

/** How one pay-code cell classifies. Ported verbatim from legacy's two regexes. */
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

/**
 * Fold accumulated grid rows into the separation-relevant dates.
 *
 * `range` is the window the timecard view is PROVED to be showing (the applied
 * range read back off the period label), and every yearless `M/D` resolves
 * against it through `formatTimecardDate` — never against "now" (S41).
 */
export function foldSeparationTimecard(
  rows: readonly TimecardGridRow[],
  range: TimecardDateRange,
): SeparationTimecardFold {
  assertTimecardCoversRange(rows, range);
  const punchDates: string[] = [];
  const sickDates: string[] = [];
  const holidayDates: string[] = [];
  const payCodeDays: TimecardPayCodeDay[] = [];
  const unclassified: string[] = [];
  for (const row of rows) {
    const date = formatTimecardDate(row.month, row.day, range);
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

/**
 * Parse the period label WFD renders after a range is applied — e.g.
 * `"6/01/2026 - 8/12/2026"` — into a real range.
 *
 * This is what turns S40 from "the label changed" into "the label says exactly
 * the window I asked for". WFD pads the two halves inconsistently (live
 * 2026-08-12: `6/01/2026` beside `08/12/2026`), so the parse is
 * padding-tolerant and the COMPARISON is on calendar days, never on strings.
 * A label that is not a range at all (`"Current Pay Period"`) returns `null` —
 * a caller must treat that as "the range did not apply", never as a match.
 */
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
