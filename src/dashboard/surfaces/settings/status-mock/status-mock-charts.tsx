import { Tooltip, dsFocus } from "../../../ds/ui.js";
import { STATUS_MOCK_OUTCOMES, type StatusMockCounts } from "./status-mock-model.js";

const SEGMENT_GAP = 2;

const describe = (counts: StatusMockCounts) => STATUS_MOCK_OUTCOMES.map(outcome => `${counts[outcome.key]} ${outcome.label.toLowerCase()}`).join(" · ");

/** Identity is never colour alone: every swatch has its label, and the chart has a table view for screen readers. */
export function OutcomeLegend({ totals }: { totals?: StatusMockCounts }) {
  return <ul aria-label="Legend" className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 text-body text-ui-secondary">
    {STATUS_MOCK_OUTCOMES.map(outcome => <li key={outcome.key} className="flex items-center gap-2"><span aria-hidden className={`size-2.5 rounded-sm ${outcome.fill}`} />{outcome.label}{totals && <span className="tabular-nums text-ui-primary">{totals[outcome.key]}</span>}</li>)}
  </ul>;
}

/** Runs per day as stacked columns. Hover or focus a day for exact counts. */
export function RunsPerDayChart({ days, height = 168 }: { days: readonly (StatusMockCounts & { label: string })[]; height?: number }) {
  const total = (day: StatusMockCounts) => STATUS_MOCK_OUTCOMES.reduce((sum, outcome) => sum + day[outcome.key], 0);
  const max = Math.max(...days.map(total));
  const top = Math.ceil(max / 4) * 4;
  const ticks = [top, top / 2, 0];
  return <figure className="m-0 min-w-0 rounded-lg border border-ui-stroke bg-ui-panel px-3 pb-3 pt-4" aria-label="Runs per day">
    <div className="relative ml-7" style={{ height }}>
      {ticks.map(tick => <div key={tick} aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-ui-stroke" style={{ top: `${(1 - tick / top) * 100}%` }}><span className="absolute -left-7 -top-2 w-5 text-right text-caption tabular-nums text-ui-muted">{tick}</span></div>)}
      <div className="absolute inset-0 flex items-end gap-2">
        {days.map(day => <Tooltip key={day.label} content={<span className="block"><span className="block font-medium">{day.label}</span>{STATUS_MOCK_OUTCOMES.map(outcome => <span key={outcome.key} className="block tabular-nums">{outcome.label}: {day[outcome.key]}</span>)}</span>}>
          <div tabIndex={0} role="img" aria-label={`${day.label}: ${describe(day)}`} className={`relative flex h-full min-w-0 flex-1 flex-col-reverse items-center rounded-sm ${dsFocus}`}>
            <div className="flex w-3/5 max-w-12 flex-col-reverse" style={{ height: `${total(day) / top * 100}%`, gap: SEGMENT_GAP }}>
              {STATUS_MOCK_OUTCOMES.map(outcome => day[outcome.key] > 0 && <span key={outcome.key} aria-hidden className={`block w-full first:rounded-b-none last:rounded-t ${outcome.fill}`} style={{ flexGrow: day[outcome.key], flexBasis: 0 }} />)}
            </div>
            <span aria-hidden className="absolute inset-x-0 top-full mt-2 whitespace-nowrap text-center text-caption text-ui-muted">{day.label}</span>
          </div>
        </Tooltip>)}
      </div>
    </div>
    <div className="h-6" />
    <table className="sr-only"><caption>Runs per day</caption><thead><tr><th>Day</th>{STATUS_MOCK_OUTCOMES.map(outcome => <th key={outcome.key}>{outcome.label}</th>)}</tr></thead>
      <tbody>{days.map(day => <tr key={day.label}><th>{day.label}</th>{STATUS_MOCK_OUTCOMES.map(outcome => <td key={outcome.key}>{day[outcome.key]}</td>)}</tr>)}</tbody></table>
  </figure>;
}

/** One compact horizontal stacked bar per table row. */
export function OutcomeBar({ counts, label }: { counts: StatusMockCounts; label: string }) {
  const sum = STATUS_MOCK_OUTCOMES.reduce((total, outcome) => total + counts[outcome.key], 0);
  return <Tooltip content={<span className="block"><span className="block font-medium">{label}</span>{STATUS_MOCK_OUTCOMES.map(outcome => <span key={outcome.key} className="block tabular-nums">{outcome.label}: {counts[outcome.key]}</span>)}</span>}>
    <div tabIndex={0} role="img" aria-label={`${label}: ${describe(counts)}`} className={`flex h-2.5 w-full min-w-24 rounded-sm ${dsFocus}`} style={{ gap: SEGMENT_GAP }}>
      {STATUS_MOCK_OUTCOMES.map(outcome => counts[outcome.key] > 0 && <span key={outcome.key} aria-hidden className={`block h-full rounded-sm ${outcome.fill}`} style={{ flexGrow: counts[outcome.key], flexBasis: 0, minWidth: sum ? 3 : 0 }} />)}
    </div>
  </Tooltip>;
}

/** Inline share bar for a failure reason. */
export function ShareBar({ share, label }: { share: number; label: string }) {
  return <Tooltip content={label}><div tabIndex={0} role="img" aria-label={label} className={`h-2.5 w-32 rounded-sm bg-ui-stroke ${dsFocus}`}><span aria-hidden className="block h-full rounded-sm bg-ui-danger" style={{ width: `${share * 100}%` }} /></div></Tooltip>;
}
