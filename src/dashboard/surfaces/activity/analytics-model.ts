import type { ActivityDateRange } from "./activity-model.js";

export interface AnalyticsDayRow { date: string; done: number; failed: number; attention: number; seconds: number | null }
export interface AnalyticsWorkflow {
  id: string; label: string; done: number; failed: number; attention: number; typicalSeconds: number | null;
  failedAt: readonly { label: string; runs: number }[]; days: readonly AnalyticsDayRow[];
}
export interface AnalyticsData {
  running: number; typicalSeconds: number | null;
  workflows: readonly AnalyticsWorkflow[];
  reasons: readonly { label: string; workflow: string; runs: number }[];
}

/** `date` is the readable day or week the hover card names. */
export interface AnalyticsBucket { date: string; label: string; step: number; done: number; failed: number; attention: number; seconds: Record<string, number | null> }

const DAY = 86_400_000;
const MAX_DAILY_BARS = 31;
const MAX_BARS = 32;
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

/** One bar per day up to a month, then 7-day bars, then wider bars so a period never draws more than 32. Time per workflow is the mean of its daily typical times; a bucket with no timed run is null. */
export function analyticsBuckets(range: ActivityDateRange, workflows: readonly AnalyticsWorkflow[]): AnalyticsBucket[] {
  const total = rangeDays(range);
  const step = total <= MAX_DAILY_BARS ? 1 : Math.max(7, Math.ceil(total / MAX_BARS));
  const buckets: AnalyticsBucket[] = [];
  for (let offset = 0; offset < total; offset += step) {
    const start = shiftDate(range.from, offset);
    const end = shiftDate(range.from, Math.min(offset + step, total) - 1);
    const label = step === 1 && total <= 7 ? `${WEEKDAY.format(parse(start))} ${new Date(parse(start)).getUTCDate()}` : step > 7 ? FULL_DATE.format(parse(start)) : MONTH_DAY.format(parse(start));
    const bucket: AnalyticsBucket = { date: start === end ? FULL_DATE.format(parse(start)) : analyticsPeriodLabel({ from: start, to: end }), label, step, done: 0, failed: 0, attention: 0, seconds: {} };
    for (const workflow of workflows) {
      const days = workflow.days.filter(day => day.date >= start && day.date <= end);
      for (const day of days) { bucket.done += day.done; bucket.failed += day.failed; bucket.attention += day.attention; }
      const timed = days.flatMap(day => day.seconds === null ? [] : [day.seconds]);
      bucket.seconds[workflow.id] = timed.length === 0 ? null : timed.reduce((sum, value) => sum + value, 0) / timed.length;
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
