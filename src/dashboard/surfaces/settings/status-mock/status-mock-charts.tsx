import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import "./status-mock-charts.css";

const AXIS = "text-[12px] leading-4 tabular-nums text-ui-secondary";

export interface ChartDay { label: string; date: string }
export interface ChartSeries { id: string; label: string; color: string; values: readonly number[] }
interface Tip { title: string; rows: readonly { name: string; value: string; color: string }[] }
interface Hover { index: number; x: number; top: number }

const sumAt = (series: readonly ChartSeries[], index: number) => series.reduce((total, line) => total + (line.values[index] ?? 0), 0);
export const clock = (seconds: number) => `${Math.floor(seconds / 60)}m ${String(Math.round(seconds % 60)).padStart(2, "0")}s`;
/** Four evenly spaced ticks from 0 up to a round top, for counts. */
export function countScale(max: number) {
  const raw = Math.max(max, 1) / 3, magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find(factor => factor * magnitude >= raw) ?? 10) * magnitude;
  return { top: step * 3, ticks: [3, 2, 1, 0].map(k => ({ value: k * step, label: String(k * step) })) };
}

/** A small label above a big number. */
export function ChartHeading({ label, value }: { label: string; value: string }) {
  return <div className="mb-4"><p className="m-0 text-[12px] leading-[18px] text-ui-primary">{label}</p><p className="m-0 text-[28px] leading-8 tabular-nums text-ui-primary">{value}</p></div>;
}

/** The legend bars: a 4px rounded bar spanning the label and the value (count and share). Colour is never the only cue. */
export function KeyFigures({ items, inline = false }: { items: readonly { label: string; color: string; count: number }[]; inline?: boolean }) {
  const finished = items.reduce((total, item) => total + item.count, 0) || 1;
  return <ul aria-label="Key figures" className={`m-0 flex list-none p-0 ${inline ? "flex-wrap gap-x-6 gap-y-2" : "gap-3"}`}>
    {items.map(item => <li key={item.label} className={`flex gap-3 ${inline ? "" : "min-w-0 flex-1"}`}>
      <span aria-hidden className="w-1 shrink-0 rounded-full" style={{ background: item.color }} />
      <span className="flex flex-col"><span className="text-[12px] leading-4 text-ui-primary">{item.label}</span><span className="text-[16px] leading-6 tabular-nums text-ui-primary">{item.count} · {Math.round(item.count / finished * 100)}%</span></span>
    </li>)}
  </ul>;
}

/** The chart card. One hover design for every chart: a guide line at the day, the chart's own mark for that day, and a card beside it that stays inside this card. Focus a day (arrow keys move between days) for the same card. */
function ChartFrame({ label, days, ticks, top, height, header, footer, tip, plot }: {
  label: string; days: readonly ChartDay[]; ticks: readonly { value: number; label: string }[]; top: number; height: number;
  header?: ReactNode; footer?: ReactNode; tip: (index: number) => Tip; plot: (active: number | null) => ReactNode;
}) {
  const card = useRef<HTMLElement>(null), plotArea = useRef<HTMLDivElement>(null), tipBox = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [current, setCurrent] = useState(0);
  const stride = days.length > 10 ? Math.ceil(days.length / 6) : 1;
  const show = (index: number, cell: HTMLElement) => {
    const outer = card.current?.getBoundingClientRect(), inner = plotArea.current?.getBoundingClientRect(), box = cell.getBoundingClientRect();
    if (outer && inner) setHover({ index, x: box.left + box.width / 2 - outer.left, top: inner.top - outer.top });
  };
  useLayoutEffect(() => {
    const box = tipBox.current, outer = card.current;
    if (!hover || !box || !outer) return;
    const flip = hover.x + 14 + box.offsetWidth > outer.clientWidth - 8;
    box.style.left = `${Math.max(8, flip ? hover.x - 14 - box.offsetWidth : hover.x + 14)}px`;
    box.style.top = `${Math.max(8, Math.min(hover.top, outer.clientHeight - box.offsetHeight - 8))}px`;
  }, [hover]);
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") return setHover(null);
    const next = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: days.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    (event.currentTarget.children[Math.min(days.length - 1, Math.max(0, next))] as HTMLElement | undefined)?.focus();
  };
  const active = hover ? tip(hover.index) : null;
  return <figure ref={card} aria-label={label} className="ds-chart relative m-0 min-w-0 rounded-[var(--ds-row-radius)] border border-ui-stroke bg-[var(--ds-card-bg)] px-[var(--ds-row-pad-x)] py-4">
    {header}
    <div ref={plotArea} className="relative ml-9" style={{ height }}>
      {ticks.map(tick => <div key={tick.value} aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-ui-stroke" style={{ top: `${(1 - tick.value / top) * 100}%` }}><span className={`absolute -left-9 -top-2 w-7 text-right ${AXIS}`}>{tick.label}</span></div>)}
      {hover && <span aria-hidden className="ds-chart-guide" style={{ left: `${(hover.index + 0.5) / days.length * 100}%` }} />}
      {plot(hover?.index ?? null)}
      <div className="absolute inset-0 flex" onKeyDown={move}>
        {days.map((day, index) => <div key={day.date} tabIndex={index === current ? 0 : -1} role="img" aria-label={`${day.label}: ${tip(index).rows.map(row => `${row.name} ${row.value}`).join(" · ")}`}
          className="relative h-full min-w-0 flex-1 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--ds-accent)]"
          onPointerEnter={event => show(index, event.currentTarget)} onPointerLeave={() => setHover(null)} onFocus={event => { setCurrent(index); show(index, event.currentTarget); }} onBlur={() => setHover(null)}>
          {index % stride === 0 && <span aria-hidden className={`absolute inset-x-0 top-full mt-2 whitespace-nowrap text-center ${AXIS}`}>{day.label}</span>}
        </div>)}
      </div>
    </div>
    <div className="h-6" />
    {footer}
    {hover && active && <div ref={tipBox} aria-hidden className="ds-chart-tip">
      <p className="m-0 text-[12px] font-medium leading-[18px] text-ui-primary">{active.title}</p>
      <p className="m-0 text-[12px] leading-[18px] text-ui-muted">{days[hover.index]?.date}</p>
      <ul className="ds-chart-tip-rows">{active.rows.map(row => <li key={row.name} className="text-[12px] leading-5">
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: row.color }} /><span className="min-w-0 flex-1 truncate text-ui-muted">{row.name}</span><span className="tabular-nums text-ui-primary">{row.value}</span>
      </li>)}</ul>
    </div>}
    <table className="sr-only"><caption>{label}</caption><thead><tr><th>Day</th>{tip(0).rows.map(row => <th key={row.name}>{row.name}</th>)}</tr></thead>
      <tbody>{days.map((day, index) => <tr key={day.date}><th>{day.label}</th>{tip(index).rows.map(row => <td key={row.name}>{row.value}</td>)}</tr>)}</tbody></table>
  </figure>;
}

/** Stacked columns per day, flush, only the top segment rounded; the hovered column lifts. */
export function StackedBars({ label, days, series, unit, height = 160, header, footer }: {
  label: string; days: readonly ChartDay[]; series: readonly ChartSeries[]; unit: readonly [string, string]; height?: number; header?: ReactNode; footer?: ReactNode;
}) {
  const { top, ticks } = barScale(Math.max(...days.map((_, index) => sumAt(series, index))));
  return <ChartFrame label={label} days={days} ticks={ticks} top={top} height={height} header={header} footer={footer}
    tip={index => ({ title: `${sumAt(series, index)} ${sumAt(series, index) === 1 ? unit[0] : unit[1]}`, rows: series.map(line => ({ name: line.label, value: String(line.values[index] ?? 0), color: line.color })) })}
    plot={active => <div className="pointer-events-none absolute inset-0 flex items-end">
      {days.map((day, index) => <div key={day.date} className="flex h-full min-w-0 flex-1 flex-col-reverse items-center">
        <div className="flex w-3/5 max-w-12 flex-col-reverse" style={{ height: `${sumAt(series, index) / top * 100}%`, filter: active === index ? "var(--chart-lift)" : undefined }}>
          {series.map(line => (line.values[index] ?? 0) > 0 && <span key={line.id} aria-hidden className="block w-full last:rounded-t-[4px]" style={{ flexGrow: line.values[index], flexBasis: 0, background: line.color }} />)}
        </div>
      </div>)}
    </div>} />;
}

/** Counts in multiples of 6 so four ticks fall on whole numbers. */
function barScale(max: number) {
  const top = Math.max(6, Math.ceil(max / 6) * 6);
  return { top, ticks: [top, top * 2 / 3, top / 3, 0].map(value => ({ value, label: String(value) })) };
}

/** One line per series, a dot on each line at the hovered day. `summary` is the hover card's title for a day. */
export function LineChart({ label, days, series, ticks, top, format, summary, height = 120, header }: {
  label: string; days: readonly ChartDay[]; series: readonly ChartSeries[]; ticks: readonly { value: number; label: string }[]; top: number;
  format: (value: number) => string; summary: (index: number) => string; height?: number; header?: ReactNode;
}) {
  const x = (index: number) => (index + 0.5) / days.length * 100;
  const y = (value: number) => 100 - value / top * 100;
  return <ChartFrame label={label} days={days} ticks={ticks} top={top} height={height} header={header}
    footer={<ul aria-label="Legend" className="m-0 mt-3 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[12px] leading-4 text-ui-secondary">
      {series.map(line => <li key={line.id} className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-full" style={{ background: line.color }} />{line.label}</li>)}
    </ul>}
    tip={index => ({ title: summary(index), rows: series.map(line => ({ name: line.label, value: format(line.values[index] ?? 0), color: line.color })) })}
    plot={active => <>
      <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
        {series.map(line => <polyline key={line.id} fill="none" stroke={line.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" points={line.values.map((value, index) => `${x(index)},${y(value)}`).join(" ")} />)}
      </svg>
      {active !== null && series.map(line => <span key={line.id} aria-hidden className="ds-chart-dot" style={{ left: `${x(active)}%`, top: `${y(line.values[active] ?? 0)}%`, background: line.color }} />)}
    </>} />;
}
