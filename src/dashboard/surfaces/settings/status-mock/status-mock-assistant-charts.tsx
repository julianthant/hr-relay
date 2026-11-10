import { useState, type ReactNode } from "react";
import { BodySection, SegmentedChoice } from "../../../ds/ui.js";
import { ChartHeading, KeyFigures, LineChart, StackedBars, countScale } from "./status-mock-charts.js";
import { STATUS_MOCK_ASSISTANT, analyticsDays } from "./status-mock-assistant-data.js";

const PERIODS = [{ value: "7d", label: "7d" }, { value: "30d", label: "30d" }] as const;
const total = (series: readonly { values: readonly number[] }[]) => series.reduce((n, line) => n + line.values.reduce((m, value) => m + value, 0), 0);
const noun = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** A chart with its own 7d / 30d choice beside the heading; `children` gets the days and each series cut to the chosen period. */
function PeriodChart({ title, description, source, children }: { title: string; description: string; source: typeof STATUS_MOCK_ASSISTANT[keyof typeof STATUS_MOCK_ASSISTANT]; children: (days: ReturnType<typeof analyticsDays>, series: { id: string; label: string; color: string; values: readonly number[] }[]) => ReactNode }) {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["value"]>("7d");
  const count = period === "7d" ? 7 : 30;
  return <BodySection as="h3" title={title} description={description} className="relative">
    <div className="absolute right-0 top-0"><SegmentedChoice hideLabel label={`${title} period`} value={period} options={PERIODS} onChange={setPeriod} /></div>
    {children(analyticsDays(count), source.map(line => ({ ...line, values: line.values.slice(-count) })))}
  </BodySection>;
}

/** Assistant analytics: messages by kind, tool calls by tool, and proposed actions by outcome. The model is fixed to GPT-6.1 Sol, so nothing splits by model. */
export function AssistantAnalytics() {
  return <BodySection title="Assistant" description="What people ask the assistant and what it does.">
    <div className="flex flex-col gap-8">
      <PeriodChart title="Messages" description="Messages sent to the assistant each day." source={STATUS_MOCK_ASSISTANT.messages}>
        {(days, series) => { const { top, ticks } = countScale(Math.max(...series.flatMap(line => line.values)));
          return <LineChart label="Messages per day" days={days} series={series} ticks={ticks} top={top} format={String} summary={index => noun(series.reduce((n, line) => n + (line.values[index] ?? 0), 0), "message", "messages")} header={<ChartHeading label="Messages" value={String(total(series))} />} />; }}
      </PeriodChart>
      <PeriodChart title="Tools used" description="Tools the assistant called each day." source={STATUS_MOCK_ASSISTANT.tools}>
        {(days, series) => { const { top, ticks } = countScale(Math.max(...series.flatMap(line => line.values)));
          return <LineChart label="Tool calls per day" days={days} series={series} ticks={ticks} top={top} format={String} summary={index => noun(series.reduce((n, line) => n + (line.values[index] ?? 0), 0), "call", "calls")} header={<ChartHeading label="Tool calls" value={String(total(series))} />} />; }}
      </PeriodChart>
      <PeriodChart title="Actions" description="Actions the assistant proposed, by what happened." source={STATUS_MOCK_ASSISTANT.actions}>
        {(days, series) => <StackedBars label="Proposed actions per day" days={days} series={series} unit={["action", "actions"]}
          header={<ChartHeading label="Proposed actions" value={String(total(series))} />}
          footer={<div className="mt-4"><KeyFigures items={series.map(line => ({ label: line.label, color: line.color, count: line.values.reduce((n, value) => n + value, 0) }))} /></div>} />}
      </PeriodChart>
    </div>
  </BodySection>;
}
