import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, Columns2, Expand, ImageOff, LockKeyhole, Minus, Monitor, Plus, RotateCw } from "lucide-react";
import { Select, Button, Dialog, DialogContent, DialogTrigger, IconButton } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";
import type { LogScreenshot } from "./log-feed-model.js";
import { captureGeometry, captureKindLabel, captureLoadProblem, captureSourceDimensions, type CaptureMode } from "./log-screenshots-model.js";
import "./log-presentation.css";

function CaptureImage({ screenshot, className, style, eager = false, onFailure, retryable = false }: { screenshot: LogScreenshot; className?: string; style?: CSSProperties; eager?: boolean; onFailure?: () => void; retryable?: boolean }) {
  const [problem, setProblem] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  if (problem) return <div role="alert" className="log-image-error"><ImageOff aria-hidden className="size-4" /><span>{problem}</span>{retryable && <Button size="sm" variant="secondary" onClick={() => { setProblem(undefined); setAttempt(value => value + 1); }}>Retry screenshot</Button>}</div>;
  return <img key={attempt} src={screenshot.src} alt={screenshot.alt} width={screenshot.width} height={screenshot.height} loading={eager ? "eager" : "lazy"} className={className} style={style} onError={() => { setProblem("Screenshot could not be loaded."); onFailure?.(); }} onLoad={event => {
    const element = event.currentTarget;
    void captureSourceDimensions(screenshot.src).then(actual => {
      if (!element.isConnected) return;
      const failure = captureLoadProblem(screenshot, actual);
      if (failure) { setProblem(failure); onFailure?.(); }
    }, () => { if (element.isConnected) { setProblem("Screenshot could not be loaded."); onFailure?.(); } });
  }} />;
}
function CapturePreview({ screenshot, onChoose, submit = false }: { screenshot: LogScreenshot; submit?: boolean; onChoose: (button: HTMLButtonElement) => void }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return <figure className={cn("log-capture", submit && "log-capture--submit")} data-kind={screenshot.kind}>
    {!submit && <div className="log-capture-header"><span><Monitor aria-hidden className="size-3.5" />{screenshot.system ?? "Capture"}</span><span>{captureKindLabel(screenshot.kind)}</span></div>}
    <DialogTrigger asChild><button type="button" onClick={event => onChoose(event.currentTarget)} className="log-capture-open" aria-label={`Enlarge screenshot captured at ${screenshot.time}`}>
      <div className="log-capture-viewport"><CaptureImage key={`${screenshot.src}-${screenshot.width}-${screenshot.height}-${attempt}`} screenshot={screenshot} onFailure={() => setFailed(true)} /></div>
      {!failed && <span className="log-capture-expand"><Expand aria-hidden className="size-3.5" /></span>}
      {screenshot.kind === "form" && !failed && <span className="log-form-hint">Full form · open to scroll</span>}
    </button></DialogTrigger>
    <figcaption><span className={screenshot.label === "Failed action" ? "text-ui-danger" : undefined}>{screenshot.label ?? captureKindLabel(screenshot.kind)}</span>{submit && !failed && <time className="font-data text-ui-muted">{screenshot.time}</time>}{failed && <Button size="sm" variant="ghost" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>Retry screenshot</Button>}</figcaption>
  </figure>;
}
function ImagePane({ capture, mode, zoom, rotation, onScale }: { capture: LogScreenshot; mode: CaptureMode; zoom?: number; rotation: number; onScale?: (scale: number) => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const update = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const geometry = captureGeometry(capture, size, mode, zoom, rotation);
  useEffect(() => { onScale?.(geometry.scale); }, [geometry.scale, onScale]);
  useEffect(() => { viewport.current?.scrollTo({ top: 0, left: 0 }); }, [capture.src, mode]);
  return <div ref={viewport} className="log-image-viewport" role="region" aria-label={`${capture.system ?? "Capture"} screenshot image`} tabIndex={0}>
    <div className="log-image-canvas" style={{ minWidth: geometry.width + 32, minHeight: geometry.height + 32 }}><div className="log-image-stage" style={{ width: geometry.width, height: geometry.height }}>
      <CaptureImage key={`${capture.src}-${capture.width}-${capture.height}`} screenshot={capture} eager retryable className="log-viewer-image" style={{ width: geometry.imageWidth, height: geometry.imageHeight, transform: `translate(-50%, -50%) rotate(${rotation}deg)` }} />
    </div></div>
  </div>;
}
function CaptureWorkspace({ screenshots, selected, choose }: { screenshots: readonly LogScreenshot[]; selected: number; choose: (index: number) => void }) {
  const [mode, setMode] = useState<CaptureMode>("width");
  const [zoom, setZoom] = useState<number>();
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [compare, setCompare] = useState(false);
  const [other, setOther] = useState(selected === 0 ? 1 : 0);
  const capture = screenshots[selected];
  if (!capture) throw new Error("log-screenshot-selection-missing");
  const reset = (next: CaptureMode) => { setMode(next); setZoom(undefined); };
  const switchCapture = (index: number) => { choose(index); reset("width"); setRotation(0); if (index === other) setOther(index === 0 ? 1 : 0); };
  const zoomBy = (amount: number) => setZoom(Math.max(.1, Math.min(4, Math.round((zoom ?? scale) * 100 + amount * 25) / 100)));
  return <div className={cn("log-viewer", screenshots.length === 1 && "log-viewer--single")} onKeyDown={event => {
    if (event.target instanceof HTMLSelectElement || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowRight" && selected < screenshots.length - 1) { event.preventDefault(); switchCapture(selected + 1); }
    if (event.key === "ArrowLeft" && selected > 0) { event.preventDefault(); switchCapture(selected - 1); }
    if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomBy(1); }
    if (event.key === "-") { event.preventDefault(); zoomBy(-1); }
    if (event.key.toLowerCase() === "r") { event.preventDefault(); setRotation(value => (value + 90) % 360); }
  }}>
    {screenshots.length > 1 && <aside className="log-capture-sidebar" aria-label="Capture selection"><p>{screenshots.length} {screenshots.length === 1 ? "capture" : "captures"}</p>{screenshots.map((item, index) => <button key={`${item.src}-${index}`} type="button" className="log-capture-tab" aria-pressed={index === selected} onClick={() => switchCapture(index)}><img src={item.src} alt="" loading="lazy" /><strong>{item.system ?? "Capture"}</strong><span>{item.label ?? captureKindLabel(item.kind)}</span></button>)}</aside>}
    <div className="log-image-workspace"><div className="log-viewer-toolbar"><div className="log-sizing">{([["width", "Fit width"], ["whole", "Whole image"], ["actual", "100%"]] as const).map(([value, label]) => <Button key={value} size="sm" variant="ghost" aria-pressed={mode === value && zoom === undefined} onClick={() => reset(value)}>{label}</Button>)}</div>
      <IconButton label="Zoom out" icon={<Minus aria-hidden className="size-3.5" />} onClick={() => zoomBy(-1)} disabled={(zoom ?? scale) <= .1} /><span className="log-zoom" role="status">{Math.round((zoom ?? scale) * 100)}%</span><IconButton label="Zoom in" icon={<Plus aria-hidden className="size-3.5" />} onClick={() => zoomBy(1)} disabled={(zoom ?? scale) >= 4} />
      <IconButton label="Rotate image" icon={<RotateCw aria-hidden className="size-3.5" />} onClick={() => setRotation(value => (value + 90) % 360)} />{screenshots.length > 1 && <IconButton label="Compare captures" icon={<Columns2 aria-hidden className="size-3.5" />} aria-pressed={compare} onClick={() => { setCompare(value => !value); reset("whole"); }} />}
      <span className="log-dimensions">{capture.width} × {capture.height}</span><IconButton label="Previous screenshot" icon={<ChevronLeft aria-hidden className="size-3.5" />} disabled={selected === 0} onClick={() => switchCapture(selected - 1)} /><span className="text-caption tabular-nums">{selected + 1} / {screenshots.length}</span><IconButton label="Next screenshot" icon={<ChevronRight aria-hidden className="size-3.5" />} disabled={selected === screenshots.length - 1} onClick={() => switchCapture(selected + 1)} />
    </div><div className={cn("log-image-panes", compare && "log-image-panes--compare")}><div className="log-image-pane">{compare && <div className="log-pane-title">{capture.system ?? "Capture"}<span>{capture.label}</span></div>}<ImagePane capture={capture} mode={mode} zoom={zoom} rotation={rotation} onScale={setScale} /></div>{compare && screenshots[other] && <div className="log-image-pane"><div className="log-pane-title">{screenshots[other].system ?? "Capture"}<span>{screenshots[other].label}</span></div><ImagePane capture={screenshots[other]} mode={mode} zoom={zoom} rotation={rotation} /></div>}</div>
    <div className="log-viewer-caption"><span>{captureKindLabel(capture.kind)}</span>{compare && <label>Compare with<Select aria-label="Comparison capture" value={other} onChange={event => setOther(Number(event.target.value))}>{screenshots.map((item, index) => index !== selected && <option key={index} value={index}>{item.system ?? "Capture"} · {item.label ?? index + 1}</option>)}</Select></label>}</div></div>
  </div>;
}
export function LogScreenshots({ screenshots, presentation }: { screenshots: readonly LogScreenshot[]; presentation?: "submit" }) {
  const [selected, setSelected] = useState(0);
  const opener = useRef<HTMLButtonElement>(null);
  if (!screenshots.length) return null;
  const capture = screenshots[selected];
  if (!capture) throw new Error("log-screenshot-selection-missing");
  const browsers = screenshots.length > 1 && screenshots.every(item => item.kind === "browser");
  return <Dialog><div className={cn("log-capture-group", browsers && "log-capture-group--browsers", screenshots.length === 1 && "log-capture-group--single", presentation === "submit" && "log-capture-group--submit")} aria-label="Screenshots">{screenshots.map((item, index) => <CapturePreview key={`${item.src}-${item.width}-${item.height}-${index}`} screenshot={item} submit={presentation === "submit"} onChoose={button => { opener.current = button; setSelected(index); }} />)}</div>
    <DialogContent className="ui-theme-scope log-viewer-dialog font-ui text-ui-primary" title={`${capture.system ?? "Capture"} · ${capture.label ?? captureKindLabel(capture.kind)}`} description={<span className="sr-only">Captured screenshot viewer</span>} size="xl" onCloseAutoFocus={event => { event.preventDefault(); opener.current?.focus(); }}><CaptureWorkspace screenshots={screenshots} selected={selected} choose={setSelected} /></DialogContent>
  </Dialog>;
}

export function RequiredCaptureStatus({ state, position }: { state: "required" | "pre-submit-failed" | "post-submit-unknown" | "post-submit-proved"; position?: "Before submit" | "After submit" }) {
  if (state === "required") return <div className="required-capture-row"><div><span className="font-medium">Screenshots</span><p className="text-caption text-ui-muted">Required by this workflow.</p></div><span className="flex items-center gap-2 text-caption"><LockKeyhole aria-hidden className="size-3.5 text-ui-muted" />Always on</span></div>;
  return <figure className="log-capture log-capture--submit log-capture--unavailable" role="status"><div className="log-capture-missing"><ImageOff aria-hidden className="size-5" /><span>Not captured</span></div><figcaption><span>{position ?? (state === "pre-submit-failed" ? "Before submit" : "After submit")}</span><span>{state === "pre-submit-failed" ? "Submit not clicked" : state === "post-submit-unknown" ? "Write outcome unknown" : "Browser closed first"}</span></figcaption><span className="sr-only">{state === "pre-submit-failed" ? "Stopped before submit. No submit was clicked." : state === "post-submit-unknown" ? "The write outcome is unknown; check UCPath without submitting again." : "The separately proved write outcome is preserved; do not submit again."}</span></figure>;
}
