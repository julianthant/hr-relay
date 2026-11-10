import { ChartHeading, KeyFigures, LineChart, StackedBars, countScale } from "./status-mock-charts.js";
import { BodySection } from "../../../ds/ui.js";
import { assistantSeries, type AnalyticsDay } from "./status-mock-assistant-data.js";

const total = (series: readonly { values: readonly number[] }[]) => series.reduce((n, line) => n + line.values.reduce((m, value) => m + value, 0), 0);
const noun = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const dayTotal = (series: readonly { values: readonly number[] }[], index: number) => series.reduce((n, line) => n + (line.values[index] ?? 0), 0);

/** Assistant analytics as sections of their own after the run sections, for the page's period: messages by kind, tool calls by tool, and proposed actions by outcome. The model is fixed to GPT-6.1 Sol, so nothing splits by model. */
export function AssistantAnalytics({ days }: { days: readonly AnalyticsDay[] }) {
  const messages = assistantSeries("messages", days), tools = assistantSeries("tools", days), actions = assistantSeries("actions", days);
  const messageScale = countScale(Math.max(...messages.flatMap(line => line.values))), toolScale = countScale(Math.max(...tools.flatMap(line => line.values)));
  return <>
    <BodySection title="Messages" description="Messages sent to the assistant each day.">
      <LineChart label="Messages per day" days={days} series={messages} ticks={messageScale.ticks} top={messageScale.top} format={String} summary={index => noun(dayTotal(messages, index), "message", "messages")} header={<ChartHeading label="Messages" value={String(total(messages))} />} />
    </BodySection>
    <BodySection title="Tools used" description="Tools the assistant called each day.">
      <LineChart label="Tool calls per day" days={days} series={tools} ticks={toolScale.ticks} top={toolScale.top} format={String} summary={index => noun(dayTotal(tools, index), "call", "calls")} header={<ChartHeading label="Tool calls" value={String(total(tools))} />} />
    </BodySection>
    <BodySection title="Actions" description="Actions the assistant proposed, by what happened.">
      <StackedBars label="Proposed actions per day" days={days} series={actions} unit={["action", "actions"]}
        header={<ChartHeading label="Proposed actions" value={String(total(actions))} />}
        footer={<div className="mt-4"><KeyFigures items={actions.map(line => ({ label: line.label, color: line.color, count: line.values.reduce((n, value) => n + value, 0) }))} /></div>} />
    </BodySection>
</>;
}
