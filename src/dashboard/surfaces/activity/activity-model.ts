import type {
  ActivityPeopleTotal,
  ActivityReportWire,
} from "../../../models/dashboard/activity.js";
import { plural } from "../shared/status/format.js";

/** The activity report's range vocabulary — the one shape the URL carries. */

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

/** Resolve one served Activity sample without fetching or inventing identity.
 * A range routinely names a run outside the one Queue day held by the shell */
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
  // Only a navigation entry with no selection gets the 7-day default.
  if (value === "") {
    if (!isActivityCalendarDate(today)) return { from: "", to: "", refusal: ACTIVITY_RANGE_REFUSAL };
    return { from: shiftActivityCalendarDay(today, -6), to: today };
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

/** Treat report dates as calendar dates; UTC arithmetic avoids browser-zone shifts. */
export interface ActivityDateRange {
  from: string;
  to: string;
}

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

function shiftActivityCalendarDay(value: string, dayDelta: number): string {
  const date = parseActivityCalendarDate(value);
  if (date === null) throw new RangeError("activity date arithmetic requires a valid YYYY-MM-DD report-calendar date");
  const shifted = new Date(date.utcMilliseconds);
  shifted.setUTCDate(shifted.getUTCDate() + dayDelta);
  return formatActivityCalendarDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}
