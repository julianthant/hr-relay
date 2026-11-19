import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { StatusDot, dsElev, dsSurface, dsText, type DsStatus } from "../../ds/ui.js";
import "./analytics-charts.css";
import { RUNS_CHART_HEIGHT, SMALL_LINE_HEIGHT, countScale } from "./analytics-model.js";

const AXIS = "text-body tabular-nums text-ui-secondary";

export interface ChartDay { label: string; date: string }
export interface ChartSeries { id: string; label: string; status?: DsStatus; color: string; values: readonly (number | null)[] }
interface Tip { title: string; rows: readonly { name: string; value: string; status?: DsStatus }[] }
interface Hover { index: number; x: number; top: number }

const sumAt = (series: readonly ChartSeries[], index: number) => series.reduce((total, line) => total + (line.values[index] ?? 0), 0);
/** A small label above a big number. */
export function ChartHeading({ label, value }: { label: string; value: string }) {
  return <div className="mb-4"><p className="m-0 text-body text-ui-secondary">{label}</p><p className={`m-0 ${dsText.display} tabular-nums text-ui-primary`}>{value}</p></div>;
}

/** The legend: a status dot, the label, then the count and share. Colour is never the only cue. */
export function KeyFigures({ items, inline = false }: { items: readonly { label: string; status: DsStatus; count: number }[]; inline?: boolean }) {
  const finished = items.reduce((total, item) => total + item.count, 0) || 1;
  return <ul aria-label="Key figures" className={`m-0 flex list-none p-0 ${inline ? "flex-wrap gap-x-6 gap-y-2" : "gap-3"}`}>
    {items.map(item => <li key={item.label} className={`flex flex-col ${inline ? "" : "min-w-0 flex-1"}`}>
      <span className="flex items-center gap-2 text-body text-ui-secondary"><StatusDot status={item.status} />{item.label}</span>
      <span className={`${dsText.title} tabular-nums text-ui-primary`}>{item.count} · {Math.round(item.count / finished * 100)}%</span>
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
    {hover && active && <div ref={tipBox} aria-hidden className={`ds-chart-tip ${dsSurface.overlay} ${dsElev.mid}`}>
      <p className="m-0 text-body font-medium text-ui-primary">{active.title}</p>
      <p className="m-0 text-body text-ui-muted">{days[hover.index]?.date}</p>
      <ul className="ds-chart-tip-rows">{active.rows.map(row => <li key={row.name} className="text-body">
        {row.status && <StatusDot status={row.status} />}<span className="min-w-0 flex-1 truncate text-ui-muted">{row.name}</span><span className="tabular-nums text-ui-primary">{row.value}</span>
      </li>)}</ul>
    </div>}
    <table className="sr-only"><caption>{label}</caption><thead><tr><th>Day</th>{tip(0).rows.map(row => <th key={row.name}>{row.name}</th>)}</tr></thead>
      <tbody>{days.map((day, index) => <tr key={day.date}><th>{day.label}</th>{tip(index).rows.map(row => <td key={row.name}>{row.value}</td>)}</tr>)}</tbody></table>
  </figure>;
}

/** Stacked columns per day, flush, only the top segment rounded; the hovered column lifts. */
export function StackedBars({ label, days, series, unit, height = RUNS_CHART_HEIGHT, header, footer }: {
  label: string; days: readonly ChartDay[]; series: readonly ChartSeries[]; unit: readonly [string, string]; height?: number; header?: ReactNode; footer?: ReactNode;
}) {
  const { top, ticks } = countScale(Math.max(...days.map((_, index) => sumAt(series, index))));
  return <ChartFrame label={label} days={days} ticks={ticks} top={top} height={height} header={header} footer={footer}
    tip={index => ({ title: `${sumAt(series, index)} ${sumAt(series, index) === 1 ? unit[0] : unit[1]}`, rows: series.map(line => ({ name: line.label, value: String(line.values[index] ?? 0), status: line.status })) })}
    plot={active => <div className="pointer-events-none absolute inset-0 flex items-end">
      {days.map((day, index) => <div key={day.date} className="flex h-full min-w-0 flex-1 flex-col-reverse items-center">
        <div className="flex w-3/5 max-w-12 flex-col-reverse" style={{ height: `${sumAt(series, index) / top * 100}%`, filter: active === index ? "var(--chart-lift)" : undefined }}>
          {series.map(line => (line.values[index] ?? 0) > 0 && <span key={line.id} aria-hidden className="block w-full last:rounded-t-[var(--ds-radius-xs)]" style={{ flexGrow: line.values[index] ?? 0, flexBasis: 0, background: line.color }} />)}
        </div>
      </div>)}
    </div>} />;
}

/** A small neutral line of one daily count; the latest day carries a dot, and the hovered day takes it. */
export function SmallLine({ label, name, days, values, summary, header }: {
  label: string; name: string; days: readonly ChartDay[]; values: readonly number[]; summary: (index: number) => string; header?: ReactNode;
}) {
  const { top } = countScale(Math.max(0, ...values));
  const x = (index: number) => (index + 0.5) / days.length * 100;
  const y = (value: number) => 100 - value / top * 100;
  return <ChartFrame label={label} days={days} ticks={[]} top={top} height={SMALL_LINE_HEIGHT} header={header}
    tip={index => ({ title: summary(index), rows: [{ name, value: String(values[index] ?? 0) }] })}
    plot={active => {
      const mark = active ?? values.length - 1;
      return <>
        <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline fill="none" stroke="var(--ui-secondary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" points={values.map((value, index) => `${x(index)},${y(value)}`).join(" ")} />
        </svg>
        {values.length > 0 && <span aria-hidden className="ds-chart-dot" style={{ left: `${x(mark)}%`, top: `${y(values[mark] ?? 0)}%`, background: "var(--ui-secondary)" }} />}
      </>;
    }} />;
}
