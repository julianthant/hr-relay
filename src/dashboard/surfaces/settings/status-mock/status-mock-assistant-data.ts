const DAY = 86_400_000;
const LAST_DAY = Date.UTC(2026, 8, 26);
const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const MONTH_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export interface AnalyticsDay { label: string; date: string; time: number }

/** The period a report shows: `count` days ending `endOffset` days before Sep 26, 2026. */
export const ANALYTICS_PERIODS = {
  "7d": { label: "7d", count: 7, endOffset: 0 }, "30d": { label: "30d", count: 30, endOffset: 0 }, "90d": { label: "90d", count: 90, endOffset: 0 },
  "this-month": { label: "This month", count: 26, endOffset: 0 }, "last-month": { label: "Last month", count: 31, endOffset: -26 }, "year": { label: "Year to date", count: 269, endOffset: 0 },
} as const;
export type AnalyticsPeriod = keyof typeof ANALYTICS_PERIODS;

/** The days of a period: a short axis label (weekday and day for a week, month and day beyond), the full date and the UTC day. */
export function analyticsDays(period: AnalyticsPeriod): AnalyticsDay[] {
  const { count, endOffset } = ANALYTICS_PERIODS[period];
  return Array.from({ length: count }, (_, index) => {
    const time = LAST_DAY + endOffset * DAY - (count - 1 - index) * DAY, day = new Date(time);
    return { label: count <= 7 ? `${WEEKDAY.format(day)} ${day.getUTCDate()}` : MONTH_DAY.format(day), date: DATE.format(day), time };
  });
}

/** "Sep 20 – 26, 2026", or "Aug 28 – Sep 26, 2026" across months. */
export function periodLabel(days: readonly AnalyticsDay[]) {
  const first = new Date(days[0]?.time ?? LAST_DAY), last = new Date(days.at(-1)?.time ?? LAST_DAY);
  return `${MONTH_DAY.format(first)} – ${first.getUTCMonth() === last.getUTCMonth() ? last.getUTCDate() : MONTH_DAY.format(last)}, ${last.getUTCFullYear()}`;
}

/** A small repeatable wobble, -1, 0 or 1, for days outside the fixed week. */
export const wobble = (time: number) => Math.round(time / DAY) % 3 - 1;

/** A smooth synthetic count for one day; weekends run quiet. */
const daily = (time: number, base: number, swing: number, phase: number) => {
  const index = time / DAY, weekend = [0, 6].includes(new Date(time).getUTCDay());
  return Math.max(0, Math.round((base + swing * Math.sin(index * 0.9 + phase) + swing * 0.5 * Math.cos(index * 2.3 + phase)) * (weekend ? 0.25 : 1)));
};
const series = (rows: readonly (readonly [string, string, string, number, number, number])[], days: readonly AnalyticsDay[]) =>
  rows.map(([id, label, color, base, swing, phase]) => ({ id, label, color: `var(--chart-${color})`, values: days.map(day => daily(day.time, base, swing, phase)) }));

const ROWS = {
  messages: [["questions", "Questions", "1", 17, 6, 0.4], ["actions", "Actions", "2", 7, 3, 1.7], ["reports", "Reports", "3", 4, 2, 2.9]],
  tools: [["lookup", "Person Lookup", "1", 12, 5, 0.9], ["queue", "Queue search", "2", 8, 3, 2.1], ["logs", "Logs", "3", 6, 2, 3.3], ["start", "Run start", "4", 4, 2, 4.2], ["sheets", "Spreadsheets", "5", 3, 1, 5.1], ["other", "Other", "6", 1, 1, 0.2]],
  actions: [["approved", "Approved", "done", 6, 2, 0.6], ["declined", "Declined", "attention", 1, 1, 1.4], ["failed", "Failed", "failed", 1, 1, 2.6]],
} as const;

/** Synthetic assistant analytics for any period. Backend gap, none of it served today: messages per day by kind, tool calls per tool per day, proposed actions per day by outcome. The model is fixed to GPT-6.1 Sol, so nothing splits by model. */
export const assistantSeries = (kind: keyof typeof ROWS, days: readonly AnalyticsDay[]) => series(ROWS[kind], days);
