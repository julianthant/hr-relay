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
  if (value === "") return { from: `${today.slice(0, 7)}-01`, to: today };
  const parts = value.split("..");
  const from = parts[0] ?? "";
  const to = parts[1] ?? "";
  const valid = (candidate: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(candidate)) return false;
    const date = new Date(`${candidate}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === candidate;
  };
  if (parts.length === 2 && valid(from) && valid(to) && from <= to) return { from, to };
  return { from, to, refusal: "Choose valid From and To dates, with From no later than To. The requested range was not replaced." };
}

export function activityRangeValue(range: { from: string; to: string }): string {
  return `${range.from}..${range.to}`;
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
