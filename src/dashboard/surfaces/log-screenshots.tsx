import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Expand, ImageOff } from "lucide-react";
import { Button, Dialog, DialogBody, DialogContent, DialogTrigger, IconButton } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import type { LogScreenshot } from "./log-feed-model.js";

function CaptureImage({ screenshot, className, eager = false, actual = false }: { screenshot: LogScreenshot; className?: string; eager?: boolean; actual?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <p role="alert" className="m-0 flex min-h-28 items-center justify-center gap-2 px-3 text-body text-ui-danger"><ImageOff aria-hidden className="size-4 shrink-0" />Screenshot could not be displayed.</p>;
  return <img src={screenshot.src} alt={screenshot.alt} width={screenshot.width} height={screenshot.height} loading={eager ? "eager" : "lazy"} className={className} style={actual ? { width: screenshot.width, maxWidth: "none" } : undefined} onError={() => setFailed(true)} onLoad={event => {
    if (event.currentTarget.naturalWidth !== screenshot.width || event.currentTarget.naturalHeight !== screenshot.height) setFailed(true);
  }} />;
}

function CaptureKind({ screenshot }: { screenshot: LogScreenshot }) {
  switch (screenshot.kind) {
    case "fields": return <>Filled fields</>;
    case "form": return <>Full form</>;
    case "browser": return <>Browser</>;
    case "person": return <>Person</>;
    case undefined: return <>Screenshot</>;
  }
}

export function LogScreenshots({ screenshots }: { screenshots: readonly LogScreenshot[] }) {
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<"width" | "whole" | "actual">("width");
  const viewport = useRef<HTMLDivElement>(null);
  if (!screenshots.length) return null;
  const browserGroup = screenshots.length > 1 && screenshots.every(screenshot => screenshot.kind === "browser");
  const capture = screenshots[selected];
  if (!capture) throw new Error("log-screenshot-selection-missing");
  const choose = (index: number) => {
    setSelected(index);
    setMode("width");
    viewport.current?.scrollTo({ top: 0, left: 0 });
  };
  return <Dialog onOpenChange={open => { if (open) setMode("width"); }}>
    <div className={cn("mt-3 grid min-w-0 gap-3", browserGroup ? "grid-cols-2 min-[1280px]:grid-cols-3" : screenshots.length > 1 ? "grid-cols-2" : "max-w-log-capture grid-cols-1")} aria-label="Screenshots">
      {screenshots.map((screenshot, index) => <figure key={`${screenshot.src}-${screenshot.time}-${index}`} className="m-0 min-w-0 overflow-hidden rounded-md border border-ui-stroke">
        <DialogTrigger asChild>
          <button type="button" onClick={() => choose(index)} className="group relative block w-full cursor-zoom-in overflow-hidden bg-ui-table text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ui-info" aria-label={`Enlarge screenshot captured at ${screenshot.time}`}>
            <div className={cn("overflow-hidden", browserGroup ? "h-28" : screenshot.kind === "form" || screenshot.height > screenshot.width ? "h-40" : "flex h-40 items-center justify-center")}>
              <CaptureImage key={`${screenshot.src}-${screenshot.width}-${screenshot.height}`} screenshot={screenshot} className={cn("block w-full", browserGroup || screenshot.kind === "form" || screenshot.height > screenshot.width ? "h-auto" : "h-full object-contain")} />
            </div>
            <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-sm border border-ui-stroke-control bg-ui-panel px-1.5 py-1 text-caption text-ui-secondary"><Expand aria-hidden className="size-3" />Open</span>
          </button>
        </DialogTrigger>
        <figcaption className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-ui-stroke bg-ui-panel px-2.5 py-2 text-caption">
          <span className="min-w-0 text-ui-secondary">{screenshot.system && `${screenshot.system} · `}{screenshot.label ?? <CaptureKind screenshot={screenshot} />}</span>
          <span className="text-ui-muted"><CaptureKind screenshot={screenshot} /> · <time className="tabular-nums">{screenshot.time}</time></span>
        </figcaption>
      </figure>)}
    </div>
    <DialogContent className="ui-theme-scope bg-ui-panel font-ui text-ui-primary" title="Screenshot" description={`${capture.system ? `${capture.system} · ` : ""}${capture.label ?? "Capture"} · ${capture.time}`} size="xl">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-ui-stroke px-3 py-2">
        <Button size="sm" variant={mode === "width" ? "primary" : "ghost"} aria-pressed={mode === "width"} onClick={() => { setMode("width"); viewport.current?.scrollTo({ top: 0, left: 0 }); }}>Fit width</Button>
        <Button size="sm" variant={mode === "whole" ? "primary" : "ghost"} aria-pressed={mode === "whole"} onClick={() => { setMode("whole"); viewport.current?.scrollTo({ top: 0, left: 0 }); }}>Whole image</Button>
        <Button size="sm" variant={mode === "actual" ? "primary" : "ghost"} aria-pressed={mode === "actual"} onClick={() => setMode("actual")}>100%</Button>
        <span className="ml-auto text-caption tabular-nums text-ui-muted">{capture.width} × {capture.height}</span>
        {screenshots.length > 1 && <span className="inline-flex items-center gap-1 pl-2">
          <IconButton label="Previous screenshot" icon={<ChevronLeft aria-hidden className="size-3.5" />} disabled={selected === 0} onClick={() => choose(selected - 1)} />
          <span className="text-caption tabular-nums text-ui-secondary" role="status">{selected + 1} / {screenshots.length}</span>
          <IconButton label="Next screenshot" icon={<ChevronRight aria-hidden className="size-3.5" />} disabled={selected === screenshots.length - 1} onClick={() => choose(selected + 1)} />
        </span>}
      </div>
      <DialogBody className="p-3">
        <div ref={viewport} role="region" aria-label="Screenshot image" tabIndex={0} className="max-h-[52vh] overflow-auto rounded-sm border border-ui-stroke bg-ui-table focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ui-info">
          <CaptureImage key={`${capture.src}-${capture.time}-${capture.width}-${capture.height}`} screenshot={capture} eager actual={mode === "actual"} className={cn("block h-auto", mode === "width" && "w-full", mode === "whole" && "mx-auto max-h-[50vh] max-w-full object-contain")} />
        </div>
      </DialogBody>
      {screenshots.length > 1 && <div role="group" className="flex shrink-0 gap-1 overflow-x-auto border-t border-ui-stroke px-3 py-2" aria-label="Capture selection">{screenshots.map((screenshot, index) => <Button key={`${screenshot.src}-${index}`} size="sm" variant={index === selected ? "primary" : "ghost"} aria-pressed={index === selected} onClick={() => choose(index)}>{screenshot.system ?? "Capture"} · {screenshot.label ?? index + 1}</Button>)}</div>}
    </DialogContent>
  </Dialog>;
}
