import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ActivityVolume as Volume } from "../../../domain/dashboard/activity-volume.js";
import { dsFocus } from "../../ds/ui.js";
import { createActivityVolumeChartModel } from "../activity-chart-model.js";

export function ActivityVolume({ volume }: { volume?: Volume }) {
  const plot = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [width, setWidth] = useState(400);
  const [hovered, setHovered] = useState<string>();
  const [focused, setFocused] = useState<string>();
  const [position, setPosition] = useState<{ key: string; left: number; top: number }>();
  const tooltipId = useId();
  useLayoutEffect(() => {
    const node = plot.current;
    if (!node) return;
    const observer = new ResizeObserver(entries => { setWidth(entries[0].contentRect.width); });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const model = createActivityVolumeChartModel(volume, width - 48);
  const active = hovered ?? focused;
  const bucket = model.state === "complete" ? model.buckets.find(item => item.key === active) : undefined;
  const bucketKey = bucket?.key;
  const barHeight = bucket?.barHeightPercent;
  const intervalLabel = bucket?.intervalLabel;
  const bucketCount = model.state === "complete" ? model.buckets.length : 0;
  useLayoutEffect(() => {
    if (bucketKey === undefined || barHeight === undefined || !area.current || !tooltip.current) return;
    const button = buttons.current.get(bucketKey);
    if (!button) return;
    const bounds = area.current.getBoundingClientRect();
    const anchor = button.getBoundingClientRect();
    const size = tooltip.current.getBoundingClientRect();
    setPosition({
      key: bucketKey,
      left: Math.max(0, Math.min(anchor.left - bounds.left + anchor.width / 2 - size.width / 2, bounds.width - size.width)),
      top: Math.max(0, bounds.height * .8125 * (1 - barHeight / 100) - size.height - 8),
    });
  }, [bucketKey, barHeight, intervalLabel, bucketCount, width]);
  return <section aria-labelledby={`${tooltipId}-heading`} className="min-w-0">
    <h2 id={`${tooltipId}-heading`} className="mb-3 mt-0 text-section">{model.state === "complete" ? model.title : "Run volume"}</h2>
    <div ref={plot} className="rounded-lg border border-ui-stroke bg-ui-panel px-3 pb-3 pt-4">
      {model.state === "unavailable" ? <p className="flex h-40 items-center justify-center text-body text-ui-secondary">Volume unavailable</p> : <>
        <div ref={area} className="relative ml-6 h-40" role="group" aria-label={model.summary} onMouseLeave={() => setHovered(undefined)}>
          {model.axisTicks.map(tick => <div key={tick.value} className="pointer-events-none absolute inset-x-0 border-t border-ui-stroke" style={{ top: `${tick.topPercent * .8125}%` }}><span className="absolute -left-6 -top-2 w-4 text-right text-caption tabular-nums text-ui-muted">{tick.value}</span></div>)}
          <div className="absolute inset-x-0 top-0 flex h-[81.25%] items-end gap-1.5">
            {model.buckets.map((item, index) => <button key={item.key} ref={node => { if (node) buttons.current.set(item.key, node); else buttons.current.delete(item.key); }} type="button" aria-label={item.accessibleLabel} aria-describedby={bucketKey === item.key ? tooltipId : undefined}
              onFocus={() => { setHovered(undefined); setFocused(item.key); }} onBlur={() => setFocused(undefined)} onMouseEnter={() => setHovered(item.key)} onClick={() => setFocused(item.key)}
              onKeyDown={event => {
                if (event.key === "Escape") { setHovered(undefined); setFocused(undefined); }
                const next = event.key === "ArrowRight" ? Math.min(index + 1, model.buckets.length - 1) : event.key === "ArrowLeft" ? Math.max(index - 1, 0) : event.key === "Home" ? 0 : event.key === "End" ? model.buckets.length - 1 : undefined;
                if (next !== undefined) { event.preventDefault(); buttons.current.get(model.buckets[next].key)?.focus(); }
              }}
              className={`relative flex h-full min-w-0 flex-1 items-end justify-center rounded-sm ${bucketKey === item.key ? "bg-ui-hover/50" : ""} ${dsFocus}`}>
              <span aria-hidden className={item.runs === 0 ? "block h-px w-full max-w-8 bg-ui-stroke-control" : `block w-full max-w-8 rounded-t ${bucketKey === item.key ? "bg-ui-info" : "bg-ui-info/65"}`} style={item.runs === 0 ? undefined : { height: `${item.barHeightPercent}%` }} />
              {item.showAxisLabel && <span aria-hidden className="absolute inset-x-0 top-full mt-2 whitespace-nowrap text-center text-caption text-ui-muted">{item.axisLabel}</span>}
            </button>)}
          </div>
          {bucket && <div ref={tooltip} id={tooltipId} role="tooltip" style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position?.key === bucket.key ? "visible" : "hidden" }} className="pointer-events-none absolute w-max max-w-full rounded-md border border-ui-stroke-control bg-ui-field px-2.5 py-1.5 text-center text-caption shadow-sm"><span className="block text-ui-secondary">{bucket.intervalLabel}</span><strong className="text-ui-primary">{bucket.runs} {bucket.runs === 1 ? "run" : "runs"}</strong></div>}
        </div>
        {model.empty && <p className="mb-0 mt-2 text-center text-caption text-ui-secondary">No runs in this period</p>}
      </>}
    </div>
  </section>;
}
