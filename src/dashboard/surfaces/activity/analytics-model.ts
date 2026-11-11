import type { ActivityDateRange } from "./activity-model.js";

export interface AnalyticsDayRow { date: string; done: number; failed: number; attention: number; seconds: number | null }
export interface AnalyticsWorkflow {
  id: string; label: string; done: number; failed: number; attention: number; typicalSeconds: number | null;
  failedAt: readonly { label: string; runs: number }[]; days: readonly AnalyticsDayRow[];
}
export interface AnalyticsData {
  running: number;
  workflows: readonly AnalyticsWorkflow[];
  reasons: readonly { label: string; workflow: string; runs: number }[];
}

/** `date` is the readable day or week the hover card names. */
export interface AnalyticsBucket { date: string; label: string; done: number; failed: number; attention: number; seconds: Record<string, number> }

const DAY = 86_400_000;
const MAX_DAILY_BARS = 31;
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const FULL_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const MONTH_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const parse = (date: string) => Date.parse(`${date}T00:00:00.000Z`);
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);

export const shiftDate = (date: string, days: number) => iso(parse(date) + days * DAY);
export const rangeDays = (range: ActivityDateRange) => (parse(range.to) - parse(range.from)) / DAY + 1;

/** The range moved one whole period back or forward. */
export function shiftRange(range: ActivityDateRange, direction: -1 | 1): ActivityDateRange {
  const length = rangeDays(range) * direction;
  return { from: shiftDate(range.from, length), to: shiftDate(range.to, length) };
}

export const finished = (counts: { done: number; failed: number; attention: number }) => counts.done + counts.failed + counts.attention;

/** One bar per day, or per week once the period is longer than a month. Time per workflow is the mean of its daily typical times. */
export function analyticsBuckets(range: ActivityDateRange, workflows: readonly AnalyticsWorkflow[]): AnalyticsBucket[] {
  const total = rangeDays(range);
  const step = total > MAX_DAILY_BARS ? 7 : 1;
  const buckets: AnalyticsBucket[] = [];
  for (let offset = 0; offset < total; offset += step) {
    const dates = Array.from({ length: Math.min(step, total - offset) }, (_, index) => shiftDate(range.from, offset + index));
    const start = dates[0] ?? range.from;
    const end = dates.at(-1) ?? start;
    const bucket: AnalyticsBucket = { date: start === end ? FULL_DATE.format(parse(start)) : analyticsPeriodLabel({ from: start, to: end }), label: step === 1 ? total <= 7 ? `${WEEKDAY.format(parse(start))} ${new Date(parse(start)).getUTCDate()}` : MONTH_DAY.format(parse(start)) : MONTH_DAY.format(parse(start)), done: 0, failed: 0, attention: 0, seconds: {} };
    for (const workflow of workflows) {
      const days = workflow.days.filter(day => dates.includes(day.date));
      for (const day of days) { bucket.done += day.done; bucket.failed += day.failed; bucket.attention += day.attention; }
      const timed = days.flatMap(day => day.seconds === null ? [] : [day.seconds]);
      bucket.seconds[workflow.id] = timed.length === 0 ? 0 : timed.reduce((sum, value) => sum + value, 0) / timed.length;
    }
    buckets.push(bucket);
  }
  return buckets;
}

/** "Sep 20 – 26, 2026", or "Aug 28 – Sep 26, 2026" across months. */
export function analyticsPeriodLabel(range: ActivityDateRange): string {
  const first = new Date(parse(range.from)), last = new Date(parse(range.to));
  if (range.from === range.to) return `${MONTH_DAY.format(first)}, ${last.getUTCFullYear()}`;
  const sameMonth = first.getUTCMonth() === last.getUTCMonth() && first.getUTCFullYear() === last.getUTCFullYear();
  return `${MONTH_DAY.format(first)} – ${sameMonth ? last.getUTCDate() : MONTH_DAY.format(last)}, ${last.getUTCFullYear()}`;
}

export const analyticsClock = (seconds: number | null) => seconds === null ? "—" : `${Math.floor(seconds / 60)}m ${String(Math.round(seconds % 60)).padStart(2, "0")}s`;
