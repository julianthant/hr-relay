import type { z } from "zod";
import type {
ServerClockWireSchema
} from "../../domain/dashboard/bootstrap.js";
import type { DayCountWireSchema } from "../../domain/dashboard/projection.js";






export type DayCountWire = z.infer<typeof DayCountWireSchema>;


export type ServerClockWire = z.infer<typeof ServerClockWireSchema>;


/**
 * "Today", as the SERVER understands it.
 *
 * The demo read a `DEMO_DAY` constant. Here the live day is a served fact —
 * bootstrap's `serverClock`, in the zone the server states — because the queue
 * is day-partitioned by the backend's local midnight, not the browser's. A
 * browser in another zone must not disagree with the tracker about which day
 * "today" is.
 */
export function serverLocalDay(clock: ServerClockWire): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: clock.zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(clock.now));
  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  const [year, month, day] = [value("year"), value("month"), value("day")];
  if (year === "" || month === "" || day === "") {
    throw new Error(`serverLocalDay: could not resolve a local day from ${clock.now} in ${clock.zone}`);
  }
  return `${year}-${month}-${day}`;
}


/* ── day vocabulary, over the served counts ──────────────────────────────── */

const MS_DAY = 86_400_000;


export const WEEKDAY_HEADS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];


function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}


export function monthOfDay(day: string): string {
  return day.slice(0, 7);
}


/** `2026-08` → `August 2026` */
export function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}


/** `2026-08` shifted by whole months, staying a `YYYY-MM` */
export function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}


/**
 * Arrow-key movement inside the grid, clamped to the 42 cells it holds.
 *
 * Pure, so the keyboard contract is a test rather than something somebody
 * checks by pressing keys — and it is a CLAMP, not a wrap: running off the
 * right edge of the last week stops, it does not teleport to the first.
 */
export function moveCalendarFocus(index: number, key: string): number | null {
  const delta =
    key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : key === "ArrowDown" ? 7 : key === "ArrowUp" ? -7 : null;
  if (delta === null) {
    if (key === "Home") return index - (index % 7);
    if (key === "End") return index - (index % 7) + 6;
    return null;
  }
  const next = index + delta;
  return next < 0 || next > 41 ? index : next;
}


export interface CalendarCell {
  readonly day: string;
  readonly dayOfMonth: number;
  readonly inMonth: boolean;
  readonly count: number;
  /** the projection served a partition for this day */
  readonly available: boolean;
  readonly isToday: boolean;
}


/**
 * Six Sunday-first weeks, always — 42 cells.
 *
 * A grid whose ROW COUNT changes with the month reflows the popover (and the
 * button under the pointer) every time you step a month, which is the one thing
 * a date picker must not do.
 *
 * Availability and count both come from the served `monthCounts`: a day the
 * projection did not serve is DRAWN and DISABLED rather than skipped, because a
 * calendar with holes in it teaches the operator that the month is missing days.
 */
export function buildCalendarMonth(
  month: string,
  counts: readonly DayCountWire[],
  today: string,
): CalendarCell[] {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = Date.UTC(year, monthNumber - 1, 1);
  const start = first - new Date(first).getUTCDay() * MS_DAY;
  const served = new Map(counts.map((entry) => [String(entry.day), entry.count]));
  const cells: CalendarCell[] = [];
  for (let index = 0; index < 42; index += 1) {
    const ms = start + index * MS_DAY;
    const day = ymd(ms);
    const count = served.get(day);
    cells.push({
      day,
      dayOfMonth: new Date(ms).getUTCDate(),
      inMonth: day.slice(0, 7) === month,
      count: count ?? 0,
      available: count !== undefined,
      isToday: day === today,
    });
  }
  return cells;
}


export function servedDays(counts: readonly DayCountWire[]): string[] {
  return counts.map((entry) => String(entry.day)).sort((a, b) => a.localeCompare(b));
}
