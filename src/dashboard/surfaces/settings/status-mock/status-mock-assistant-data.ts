const DAY = 86_400_000;
const LAST_DAY = Date.UTC(2026, 8, 26);
const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const MONTH_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The last `count` days up to Sep 26, 2026: a short axis label (weekday and day for a week, month and day beyond) and the full date. */
export function analyticsDays(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(LAST_DAY - (count - 1 - index) * DAY);
    return { label: count <= 7 ? `${WEEKDAY.format(day)} ${day.getUTCDate()}` : MONTH_DAY.format(day), date: DATE.format(day) };
  });
}

/** A smooth synthetic count for day `index` of 30 (Aug 28 is a Friday); weekends run quiet. */
const daily = (index: number, base: number, swing: number, phase: number) => {
  const weekend = [0, 6].includes((5 + index) % 7);
  return Math.max(0, Math.round((base + swing * Math.sin(index * 0.9 + phase) + swing * 0.5 * Math.cos(index * 2.3 + phase)) * (weekend ? 0.25 : 1)));
};
const series = <Id extends string>(rows: readonly (readonly [Id, string, string, number, number, number])[]) => rows.map(([id, label, color, base, swing, phase]) => ({ id, label, color: `var(--chart-${color})`, values: Array.from({ length: 30 }, (_, index) => daily(index, base, swing, phase)) }));

/** Synthetic assistant analytics for 30 days. Backend gap, none of it served today: messages per day by kind, tool calls per tool per day, proposed actions per day by outcome. The model is fixed to GPT-6.1 Sol, so nothing splits by model. */
export const STATUS_MOCK_ASSISTANT = {
  messages: series([["questions", "Questions", "1", 17, 6, 0.4], ["actions", "Actions", "2", 7, 3, 1.7], ["reports", "Reports", "3", 4, 2, 2.9]]),
  tools: series([["lookup", "Person Lookup", "1", 12, 5, 0.9], ["queue", "Queue search", "2", 8, 3, 2.1], ["logs", "Logs", "3", 6, 2, 3.3], ["start", "Run start", "4", 4, 2, 4.2], ["sheets", "Spreadsheets", "5", 3, 1, 5.1], ["other", "Other", "6", 1, 1, 0.2]]),
  actions: series([["approved", "Approved", "done", 6, 2, 0.6], ["declined", "Declined", "attention", 1, 1, 1.4], ["failed", "Failed", "failed", 1, 1, 2.6]]),
} as const;
