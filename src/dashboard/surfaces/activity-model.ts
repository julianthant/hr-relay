/**
 * The activity report's range vocabulary — the one shape the URL carries.
 *
 * It lives beside `activity.tsx` rather than inside it because a module that
 * exports a component may export nothing else if React Fast Refresh is to treat
 * it as a refresh boundary: one non-component export makes every edit to the
 * surface invalidate upward into `dashboard-app.tsx` and remount the app
 * instead of hot-swapping the component.
 */
import { dayLabel } from "./format.js";

/** `from..to`, the one shape the URL carries. */
export function parseActivityRange(value: string, today: string): { from: string; to: string } {
  const [from, to] = value.split("..");
  const valid = (candidate: string | undefined): candidate is string =>
    candidate !== undefined && /^\d{4}-\d{2}-\d{2}$/u.test(candidate);
  if (valid(from) && valid(to) && from <= to) return { from, to };
  // The default is the current month to date — a range the operator can widen,
  // never a silently different one than the link said.
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

export function activityRangeValue(range: { from: string; to: string }): string {
  return `${range.from}..${range.to}`;
}

/**
 * The span's own label — the demo's `ReportSpan.label`, derived here from the
 * two bounds the wire requires (D180: both bounds are named, never defaulted).
 * A one-day range reads as the day, exactly as the demo's single-day span does.
 */
export function activityRangeLabel(from: string, to: string): string {
  return from === to ? dayLabel(from) : `${dayLabel(from)} – ${dayLabel(to)}`;
}
