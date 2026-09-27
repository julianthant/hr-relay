/**
 * The activity report's range vocabulary — the one shape the URL carries.
 *
 * It lives beside `activity.tsx` rather than inside it because a module that
 * exports a component may export nothing else if React Fast Refresh is to treat
 * it as a refresh boundary: one non-component export makes every edit to the
 * surface invalidate upward into `dashboard-app.tsx` and remount the app
 * instead of hot-swapping the component.
 */
import type {
  ActivityPeopleTotal,
  ActivityReportWire,
} from "../../domain/dashboard/activity.js";
import {
  ACTIVITY_VOLUME_MAX_YEAR_BUCKETS,
  ACTIVITY_VOLUME_WEEK_STARTS_ON,
  chooseActivityVolumeGranularity,
} from "../../domain/dashboard/activity-volume.js";
import { dayLabel, plural } from "./format.js";

/** What the Activity Who column needs off a queue row, and nothing else. */
export interface QueueRowIdentity {
  runId: string;
  workflowId: string;
  traceId: string;
  title: string;
  displayName: { state: "present"; value: string } | { state: "absent"; reason: string };
}

/** A sampled open run resolved only against Queue rows the shell already holds. */
export interface ResolvedActivityWho {
  runId: string;
  /** the subject or the operator's rename — the Queue row's own choice */
  name: { state: "present"; value: string } | { state: "absent"; reason: string };
  workflowLabel: string | undefined;
  traceId: string | undefined;
}

/**
 * Resolve one served Activity sample without fetching or inventing identity.
 * A range routinely names a run outside the one Queue day held by the shell;
 * that run stays identified by its served id.
 */
export function resolveActivityWho(
  runId: string,
  rows: readonly QueueRowIdentity[],
  report: ActivityReportWire,
): ResolvedActivityWho {
  const row = rows.find((candidate) => candidate.runId === runId);
  if (row === undefined) {
    return {
      runId,
      name: {
        state: "absent",
        reason: "this run is not among the queue rows loaded for the day on screen, so its name is not known here",
      },
      workflowLabel: undefined,
      traceId: undefined,
    };
  }
  const registration = report.workflows.find((entry) => entry.workflowId === row.workflowId)?.registration;
  return {
    runId,
    name: { state: "present", value: row.displayName.state === "present" ? row.displayName.value : row.title },
    workflowLabel: registration?.state === "registered" ? registration.label : row.workflowId,
    traceId: row.traceId,
  };
}

/** The compact people-axis phrase shared by the panel header and its tiles. */
export function activityPeopleMeta(people: ActivityPeopleTotal): string {
  return people.state === "present"
    ? plural(people.distinct, "distinct person", "distinct people")
    : "distinct people unavailable";
}

/** A tile note whose absent arm can never be mistaken for a measured zero. */
export function activityPeopleNote(people: ActivityPeopleTotal): string {
  return people.state === "present"
    ? `${plural(people.distinct, "distinct person", "distinct people")} touched`
    : "Distinct people unavailable";
}

/** The Runs tile's explanation of the server-internal people count. */
export function activityPeopleEvidenceItems(people: ActivityPeopleTotal): readonly string[] {
  return people.state === "present"
    ? [
      `${plural(people.evidenceRows, "current Separations run/member row")} supplied validated canonical identity.`,
      "The server deduplicates those identities inside this selected range; only the count reaches this page or its export.",
      "Full identifiers, last-four suffixes, item ids, row titles and receipt digests are never counted instead.",
    ]
    : [
      people.reason,
      "Unavailable is not zero. The report refuses the whole axis when range coverage is missing or incompatible.",
    ];
}

/** `from..to`, the one shape the URL carries. */
export function parseActivityRange(value: string, today: string): { from: string; to: string; refusal?: string } {
  // Only a navigation entry with no selection gets the month-to-date default.
  if (value === "") {
    if (!isActivityCalendarDate(today)) return { from: "", to: "", refusal: ACTIVITY_RANGE_REFUSAL };
    return { from: `${today.slice(0, 7)}-01`, to: today };
  }
  const parts = value.split("..");
  const from = parts[0] ?? "";
  const to = parts[1] ?? "";
  if (parts.length === 2 && isActivityCalendarDate(from) && isActivityCalendarDate(to) && from <= to) return { from, to };
  return { from, to, refusal: ACTIVITY_RANGE_REFUSAL };
}

export function activityRangeValue(range: { from: string; to: string }): string {
  return `${range.from}..${range.to}`;
}

const ACTIVITY_RANGE_REFUSAL = "Choose valid From and To dates, with From no later than To. The requested range was not replaced.";
const ACTIVITY_INCOMPLETE_RANGE_REFUSAL = "Choose both From and To dates before applying. The requested range was not replaced.";
const MILLISECONDS_PER_CALENDAR_DAY = 86_400_000;

/**
 * An ISO date here is a report-calendar date, not an instant in the browser's zone.
 * All arithmetic uses UTC only as a stable calendar calculator.
 */
export interface ActivityDateRange {
  from: string;
  to: string;
}

export interface ActivityRangeDraft {
  from: string | null;
  to: string | null;
}

export const ACTIVITY_DATE_PRESETS = [
  { value: "this-week", label: "This week" },
  { value: "today", label: "Today" },
  { value: "last-month", label: "Last month" },
  { value: "last-3-months", label: "Last 3 months" },
  { value: "last-6-months", label: "Last 6 months" },
  { value: "last-year", label: "Last year" },
  { value: "custom", label: "Custom range" },
] as const;

export type ActivityDatePreset = typeof ACTIVITY_DATE_PRESETS[number]["value"];
export type ActivityRangePreset = Exclude<ActivityDatePreset, "custom">;

export const ACTIVITY_WEEK_STARTS_ON = ACTIVITY_VOLUME_WEEK_STARTS_ON;
export const ACTIVITY_MAX_YEAR_BUCKETS = ACTIVITY_VOLUME_MAX_YEAR_BUCKETS;

export type ActivityGranularityPolicy = ReturnType<typeof chooseActivityVolumeGranularity>;

export interface ActivityRangeModel {
  selection: ActivityDateRange;
  /** The exclusive end may use ISO's signed expanded year; selected dates remain strict YYYY-MM-DD. */
  interval: { start: string; endExclusive: string };
  inclusiveDays: number;
  granularity: ActivityGranularityPolicy;
}

export type ActivityRangeModelResult =
  | { state: "ready"; model: ActivityRangeModel }
  | { state: "refused"; refusal: string };

interface ActivityCalendarDate {
  year: number;
  month: number;
  day: number;
  utcMilliseconds: number;
}

function parseActivityCalendarDate(value: string): ActivityCalendarDate | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const utcMilliseconds = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(utcMilliseconds)) return null;
  const date = new Date(utcMilliseconds);
  if (date.toISOString().slice(0, 10) !== value) return null;
  return {
    year: Number(value.slice(0, 4)),
    month: Number(value.slice(5, 7)),
    day: Number(value.slice(8, 10)),
    utcMilliseconds,
  };
}

function isActivityCalendarDate(value: string): boolean {
  return parseActivityCalendarDate(value) !== null;
}

function formatActivityCalendarDate(year: number, month: number, day: number): string {
  const formattedYear = year >= 0 && year <= 9999
    ? String(year).padStart(4, "0")
    : `${year < 0 ? "-" : "+"}${String(Math.abs(year)).padStart(6, "0")}`;
  return `${formattedYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function shiftActivityCalendarMonth(value: string, monthDelta: number): string {
  const date = parseActivityCalendarDate(value);
  if (date === null) throw new RangeError("activityPresetRange: today must be a valid YYYY-MM-DD report-calendar date");
  const absoluteMonth = date.year * 12 + date.month - 1 + monthDelta;
  const year = Math.floor(absoluteMonth / 12);
  if (year < 0 || year > 9999) throw new RangeError("activityPresetRange: shifted date is outside the YYYY-MM-DD calendar");
  const month = absoluteMonth - year * 12 + 1;
  return formatActivityCalendarDate(year, month, Math.min(date.day, daysInMonth(year, month)));
}

function shiftActivityCalendarDay(value: string, dayDelta: number): string {
  const date = parseActivityCalendarDate(value);
  if (date === null) throw new RangeError("activity date arithmetic requires a valid YYYY-MM-DD report-calendar date");
  const shifted = new Date(date.utcMilliseconds);
  shifted.setUTCDate(shifted.getUTCDate() + dayDelta);
  return formatActivityCalendarDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

function rollingRange(today: string, months: number): ActivityDateRange {
  return { from: shiftActivityCalendarDay(shiftActivityCalendarMonth(today, -months), 1), to: today };
}

/** Exact order, labels, and values used by the Activity date selector. */
export function activityPresetRange(preset: ActivityRangePreset, today: string): ActivityDateRange {
  if (!isActivityCalendarDate(today)) {
    throw new RangeError("activityPresetRange: today must be a valid YYYY-MM-DD report-calendar date");
  }
  if (preset === "today") return { from: today, to: today };
  if (preset === "last-month") return rollingRange(today, 1);
  if (preset === "last-3-months") return rollingRange(today, 3);
  if (preset === "last-6-months") return rollingRange(today, 6);
  if (preset === "last-year") return rollingRange(today, 12);
  if (preset !== "this-week") throw new RangeError(`activityPresetRange: unsupported preset ${String(preset)}`);

  const parsed = parseActivityCalendarDate(today);
  if (parsed === null) throw new RangeError("activityPresetRange: today must be a valid YYYY-MM-DD report-calendar date");
  const weekday = new Date(parsed.utcMilliseconds).getUTCDay();
  return { from: shiftActivityCalendarDay(today, -weekday), to: today };
}

/** Return the matching bounded preset, or `custom` when the range is not an exact preset. */
export function activityPresetOf(range: ActivityDateRange, today: string): ActivityDatePreset {
  for (const preset of ACTIVITY_DATE_PRESETS) {
    if (preset.value === "custom") continue;
    const candidate = activityPresetRange(preset.value, today);
    if (candidate.from === range.from && candidate.to === range.to) return preset.value;
  }
  return "custom";
}

/**
 * Validate a selected range and return its inclusive count, clipped calendar interval,
 * and pure bucket policy for A2/A3. No report instant or browser timezone is consulted.
 */
export function buildActivityRangeModel(range: ActivityDateRange): ActivityRangeModelResult {
  const from = parseActivityCalendarDate(range.from);
  const to = parseActivityCalendarDate(range.to);
  if (from === null || to === null || range.from > range.to) return { state: "refused", refusal: ACTIVITY_RANGE_REFUSAL };

  const inclusiveDays = (to.utcMilliseconds - from.utcMilliseconds) / MILLISECONDS_PER_CALENDAR_DAY + 1;
  return {
    state: "ready",
    model: {
      selection: { from: range.from, to: range.to },
      interval: { start: range.from, endExclusive: shiftActivityCalendarDay(range.to, 1) },
      inclusiveDays,
      granularity: chooseActivityVolumeGranularity(range),
    },
  };
}

/** Clone an applied selection before editing; applying stays separate from draft changes. */
export function activityRangeDraft(range: ActivityDateRange): ActivityRangeDraft {
  return { from: range.from, to: range.to };
}

/** Incomplete or invalid drafts are refused and never become report selections. */
export function applyActivityRangeDraft(draft: ActivityRangeDraft): ActivityRangeModelResult {
  if (draft.from === null || draft.to === null) return { state: "refused", refusal: ACTIVITY_INCOMPLETE_RANGE_REFUSAL };
  return buildActivityRangeModel({ from: draft.from, to: draft.to });
}

function compactActivityDate(value: string, includeYear: boolean): string {
  const date = parseActivityCalendarDate(value);
  if (date === null) throw new RangeError("activityCompactRangeLabel: date must be a valid YYYY-MM-DD report-calendar date");
  return new Date(date.utcMilliseconds).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

/** Compact, unambiguous heading label for the exact applied report-calendar dates. */
export function activityCompactRangeLabel(range: ActivityDateRange): string {
  const from = parseActivityCalendarDate(range.from);
  const to = parseActivityCalendarDate(range.to);
  if (from === null || to === null || range.from > range.to) throw new RangeError("activityCompactRangeLabel: range must contain valid ordered dates");
  if (range.from === range.to) return compactActivityDate(range.from, true);
  const sameYear = from.year === to.year;
  return `${compactActivityDate(range.from, !sameYear)} – ${compactActivityDate(range.to, true)}`;
}

export type ActivityPeriod = "today" | "week" | "month" | "custom";

export function activityPeriodRange(period: Exclude<ActivityPeriod, "custom">, today: string): { from: string; to: string } {
  if (period === "today") return { from: today, to: today };
  if (period === "month") return { from: `${today.slice(0, 7)}-01`, to: today };
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return { from: date.toISOString().slice(0, 10), to: today };
}

export function activityPeriodOf(range: { from: string; to: string }, today: string): ActivityPeriod {
  for (const period of ["today", "week", "month"] as const) {
    const candidate = activityPeriodRange(period, today);
    if (candidate.from === range.from && candidate.to === range.to) return period;
  }
  return "custom";
}

/**
 * The span's own label — the demo's `ReportSpan.label`, derived here from the
 * two bounds the wire requires (D180: both bounds are named, never defaulted).
 * A one-day range reads as the day, exactly as the demo's single-day span does.
 */
export function activityRangeLabel(from: string, to: string): string {
  return from === to ? dayLabel(from) : `${dayLabel(from)} – ${dayLabel(to)}`;
}
