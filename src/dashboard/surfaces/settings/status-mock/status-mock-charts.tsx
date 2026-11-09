import { Tooltip, dsFocus } from "../../../ds/ui.js";
import { STATUS_MOCK_OUTCOMES, type StatusMockCounts } from "./status-mock-model.js";

const SEGMENT_GAP = 2;
const AXIS = "text-[12px] leading-4 tabular-nums text-ui-muted";

const total = (counts: StatusMockCounts) => STATUS_MOCK_OUTCOMES.reduce((sum, outcome) => sum + counts[outcome.key], 0);
const describe = (counts: StatusMockCounts) => STATUS_MOCK_OUTCOMES.map(outcome => `${counts[outcome.key]} ${outcome.label.toLowerCase()}`).join(" · ");

/** The key figures: a coloured left edge, the outcome, its count and its share of finished runs. Colour is never the only cue; every figure carries its label. */
export function KeyFigures({ totals, inline = false }: { totals: StatusMockCounts; inline?: boolean }) {
  const finished = total(totals);
  return <ul aria-label="Key figures" className={`m-0 flex list-none p-0 ${inline ? "flex-wrap gap-x-6 gap-y-2" : "gap-3"}`}>
    {STATUS_MOCK_OUTCOMES.map(outcome => <li key={outcome.key} className={`flex gap-2 border-l-2 pl-3 ${outcome.edge} ${inline ? "items-baseline" : "min-w-0 flex-1 flex-col"}`}>
      <span className="text-[12px] leading-4 text-ui-muted">{outcome.label}</span>
      <span className="text-[15px] leading-5 tabular-nums text-ui-primary">{totals[outcome.key]} · {Math.round(totals[outcome.key] / finished * 100)}%</span>
    </li>)}
  </ul>;
}

/** Runs per day as stacked columns. Hover or focus a day for exact counts. */
export function RunsPerDayChart({ days, height = 160 }: { days: readonly (StatusMockCounts & { label: string })[]; height?: number }) {
  const top = Math.max(6, Math.ceil(Math.max(...days.map(total)) / 6) * 6);
  const ticks = [top, top * 2 / 3, top / 3, 0];
  return <figure className="m-0 min-w-0" aria-label="Runs per day">
    <div className="relative ml-7" style={{ height }}>
      {ticks.map(tick => <div key={tick} aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-ui-stroke" style={{ top: `${(1 - tick / top) * 100}%` }}><span className={`absolute -left-7 -top-2 w-5 text-right ${AXIS}`}>{tick}</span></div>)}
      <div className="absolute inset-0 flex items-end gap-2">
        {days.map(day => <Tooltip key={day.label} content={<span className="block"><span className="block font-medium">{day.label}</span>{STATUS_MOCK_OUTCOMES.map(outcome => <span key={outcome.key} className="block tabular-nums">{outcome.label}: {day[outcome.key]}</span>)}</span>}>
          <div tabIndex={0} role="img" aria-label={`${day.label}: ${describe(day)}`} className={`relative flex h-full min-w-0 flex-1 flex-col-reverse items-center rounded-sm ${dsFocus}`}>
            <div className="flex w-3/5 max-w-12 flex-col-reverse" style={{ height: `${total(day) / top * 100}%`, gap: SEGMENT_GAP }}>
              {STATUS_MOCK_OUTCOMES.map(outcome => day[outcome.key] > 0 && <span key={outcome.key} aria-hidden className={`block w-full first:rounded-b-none last:rounded-t ${outcome.fill}`} style={{ flexGrow: day[outcome.key], flexBasis: 0 }} />)}
            </div>
            <span aria-hidden className={`absolute inset-x-0 top-full mt-2 whitespace-nowrap text-center ${AXIS}`}>{day.label}</span>
          </div>
        </Tooltip>)}
      </div>
    </div>
    <div className="h-6" />
    <table className="sr-only"><caption>Runs per day</caption><thead><tr><th>Day</th>{STATUS_MOCK_OUTCOMES.map(outcome => <th key={outcome.key}>{outcome.label}</th>)}</tr></thead>
      <tbody>{days.map(day => <tr key={day.label}><th>{day.label}</th>{STATUS_MOCK_OUTCOMES.map(outcome => <td key={outcome.key}>{day[outcome.key]}</td>)}</tr>)}</tbody></table>
  </figure>;
}

export interface TimeSeries { id: string; label: string; color: string; seconds: readonly number[] }

const clock = (seconds: number) => `${Math.floor(seconds / 60)}m ${String(Math.round(seconds % 60)).padStart(2, "0")}s`;

/** A small line chart, one line per workflow, typical time per day. Hover or focus a day for every workflow's time. */
export function TimeLines({ series, days, height = 112 }: { series: readonly TimeSeries[]; days: readonly string[]; height?: number }) {
  const top = Math.ceil(Math.max(...series.flatMap(line => line.seconds)) / 60) * 60;
  const ticks = [top, top / 2, 0];
  const x = (index: number) => (index + 0.5) / days.length * 100;
  return <figure className="m-0 min-w-0" aria-label="Typical time per day">
    <div className="relative ml-9" style={{ height }}>
      {ticks.map(tick => <div key={tick} aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-ui-stroke" style={{ top: `${(1 - tick / top) * 100}%` }}><span className={`absolute -left-9 -top-2 w-7 text-right ${AXIS}`}>{tick === 0 ? "0" : `${tick / 60}m`}</span></div>)}
      <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
        {series.map(line => <polyline key={line.id} fill="none" stroke={line.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" points={line.seconds.map((value, index) => `${x(index)},${100 - value / top * 100}`).join(" ")} />)}
      </svg>
      <div className="absolute inset-0 flex">
        {days.map((day, index) => <Tooltip key={day} content={<span className="block"><span className="block font-medium">{day}</span>{series.map(line => <span key={line.id} className="block tabular-nums">{line.label}: {clock(line.seconds[index] ?? 0)}</span>)}</span>}>
          <div tabIndex={0} role="img" aria-label={`${day}: ${series.map(line => `${line.label} ${clock(line.seconds[index] ?? 0)}`).join(" · ")}`} className={`relative h-full min-w-0 flex-1 rounded-sm ${dsFocus}`}>
            <span aria-hidden className={`absolute inset-x-0 top-full mt-2 whitespace-nowrap text-center ${AXIS}`}>{day}</span>
          </div>
        </Tooltip>)}
      </div>
    </div>
    <div className="h-6" />
    <ul aria-label="Legend" className="m-0 mt-3 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 text-[12px] leading-4 text-ui-secondary">
      {series.map(line => <li key={line.id} className="flex items-center gap-2"><span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: line.color }} />{line.label}</li>)}
    </ul>
  </figure>;
}
