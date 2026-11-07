import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDownToLine, Check, ChevronRight, Copy, Eye, LoaderCircle, Monitor, MousePointer2, PanelsTopLeft, PencilLine } from "lucide-react";
import { Button, Field, IconButton, Input, SearchInput, useToasts } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";
import { LogScreenshots } from "../logs/log-screenshots.js";
import type { MockBlock, MockDecision, MockRow, MockSceneData, MockState, MockStep, MockTable, MockTableRow } from "./decision-mock-model.js";

export function PageCard({ title, mode, children }: { title: string; mode: string; children: ReactNode }) {
  return <div className="overflow-hidden rounded-lg border border-ui-stroke bg-ui-table">
    <div className="flex min-h-11 items-center gap-2.5 border-b border-ui-stroke px-3 py-2.5"><PanelsTopLeft aria-hidden className="size-4 shrink-0 text-ui-muted" /><h4 className="m-0 text-control font-semibold">{title}</h4><span className="ml-auto text-caption text-ui-muted">{mode}</span></div>
    {children}
  </div>;
}

function Rows({ rows }: { rows: readonly MockRow[] }) {
  return <dl className="m-0 px-3">{rows.map(row => {
    const Icon = row.kind === "fill" ? PencilLine : Eye;
    return <div key={row.label} className="grid grid-cols-[1rem_minmax(8rem,.85fr)_minmax(0,1.15fr)] items-baseline gap-x-3 border-b border-ui-stroke py-2.5 last:border-b-0">
      <Icon aria-hidden className={cn("size-3.5 translate-y-0.5 self-start", row.kind === "fill" ? "text-ui-info" : "text-ui-muted")} />
      <dt className="text-body font-medium">{row.label}</dt>
      <dd className={cn("m-0 text-right text-body tabular-nums", row.kind === "fill" ? "font-medium text-ui-info" : "text-ui-secondary")}>{row.value}</dd>
    </div>;
  })}</dl>;
}

/** A page's rows as one table; `pick` adds the radio column that makes the evidence the choice. */
export function DataTable({ table, pick }: { table: MockTable; pick?: { chosen?: string; choose: (id: string) => void } }) {
  const [open, setOpen] = useState(false);
  const total = table.rows.length + (table.folded?.rows.length ?? 0);
  const cell = (row: MockTableRow, index: number) => <td key={index} className={cn("py-2.5 tabular-nums", pick && index === 0 ? "pr-3" : "px-3", index === 0 ? "font-medium" : row.tone === "danger" && index === row.cells.length - 1 ? "text-ui-danger" : "text-ui-secondary")}>{row.cells[index]}</td>;
  return <PageCard title={table.title} mode={`${total} rows · Read`}>
    <table aria-label={table.label} className="w-full border-collapse text-left text-body">
      <thead><tr className="text-caption text-ui-muted">{pick && <th className="w-10 px-3 py-2 font-normal"><span className="sr-only">Choose</span></th>}{table.columns.map((column, index) => <th key={column} className={cn("py-2 font-normal", pick && index === 0 ? "pr-3" : "px-3")}>{column}</th>)}</tr></thead>
      <tbody>{table.rows.map(row => {
        const selected = pick?.chosen === row.id;
        return <tr key={row.id} onClick={pick ? () => pick.choose(row.id) : undefined} className={cn("border-t border-ui-stroke", pick && "cursor-pointer hover:bg-ui-hover", selected && "bg-ui-hover")}>
          {pick && <td className="px-3 py-2.5 align-middle"><input type="radio" name="mock-choice" className="block size-4 accent-[var(--ui-info)]" checked={selected} onChange={() => pick.choose(row.id)} aria-label={row.cells.join(", ")} /></td>}
          {row.cells.map((_, index) => cell(row, index))}
        </tr>;
      })}
      {table.folded && <tr className="border-t border-ui-stroke"><td colSpan={table.columns.length + (pick ? 1 : 0)} className="p-0"><button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-body text-ui-secondary hover:bg-ui-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ui-info"><ChevronRight aria-hidden className={cn("size-3.5", open && "rotate-90")} />{table.folded.label}</button></td></tr>}
      {open && table.folded?.rows.map(row => <tr key={row.id} className="border-t border-ui-stroke">{row.cells.map((_, index) => cell(row, index))}</tr>)}</tbody>
    </table>
  </PageCard>;
}

function Line({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <p className="m-0 flex items-center gap-2.5 text-body text-ui-secondary">{icon}<span>{children}</span></p>;
}

function Question({ text, note, danger }: { text: string; note?: string; danger?: boolean }) {
  return <div className="flex flex-col gap-1 pt-2"><h4 className={cn("m-0 text-heading", danger && "text-ui-danger")}>{text}</h4>{note && <p className="m-0 text-body text-ui-secondary">{note}</p>}</div>;
}

function Actions({ primary, disabled, secondary }: { primary?: string; disabled?: boolean; secondary: readonly string[] }) {
  return <>{primary && <Button variant="primary" disabled={disabled}>{primary}</Button>}{secondary.map(label => <Button key={label}>{label}</Button>)}</>;
}

/** Answer in the evidence: question, one note, the evidence or input, actions. */
function Decision({ decision }: { decision: MockDecision }) {
  const [chosen, choose] = useState<string>();
  const [text, setText] = useState(decision.kind === "answer" ? decision.field?.value ?? "" : "");
  switch (decision.kind) {
    case "pick": {
      const row = decision.table.rows.find(item => item.id === chosen);
      return <div className="flex flex-col gap-3"><Question text={decision.question} /><DataTable table={decision.table} pick={{ chosen, choose }} />
        <div className="flex flex-wrap gap-2"><Actions primary={row ? decision.continueLabel(row.name) : "Continue"} disabled={!row} secondary={decision.secondary} /></div></div>;
    }
    case "compare": return <div className="flex flex-col gap-3"><Question text={decision.question} note={decision.note} />
      <PageCard title={decision.title} mode="Read"><table aria-label={decision.title} className="w-full border-collapse text-left text-body">
        <thead><tr className="text-caption text-ui-muted"><th className="px-3 py-2 font-normal"><span className="sr-only">Field</span></th><th className="px-3 py-2 font-normal">Request</th><th className="px-3 py-2 font-normal">UCPath</th></tr></thead>
        <tbody>{decision.rows.map(row => <tr key={row.label} className="border-t border-ui-stroke"><th scope="row" className="px-3 py-2.5 text-left font-medium">{row.label}</th><td className="px-3 py-2.5 tabular-nums text-ui-secondary">{row.requested}</td>
          <td className={cn("px-3 py-2.5 tabular-nums", row.requested === row.found ? "text-ui-secondary" : "font-semibold text-ui-warning")}>{row.found}{row.requested !== row.found && <span className="sr-only"> (differs)</span>}</td></tr>)}</tbody>
      </table></PageCard>
      <div className="flex flex-wrap gap-2"><Actions primary={decision.primary} secondary={decision.secondary} /></div></div>;
    case "answer": return <div className="flex flex-col gap-3"><Question text={decision.question} note={decision.note} danger={decision.tone === "danger"} />
      <div className="flex flex-wrap items-end gap-2">{decision.field && <Field label={decision.field.label} className="w-56"><Input value={text} onChange={event => setText(event.target.value)} /></Field>}
        <Actions primary={decision.primary} disabled={decision.field !== undefined && !text.trim()} secondary={decision.secondary} /></div></div>;
    case "line": return <Line icon={<LoaderCircle aria-hidden className="size-3.5 shrink-0 text-ui-muted" />}>{decision.text}</Line>;
  }
}

function Block({ block }: { block: Exclude<MockBlock, { kind: "decision" }> }) {
  switch (block.kind) {
    case "page": return <PageCard title={block.title} mode={block.mode}><Rows rows={block.rows} /></PageCard>;
    case "table": return <DataTable table={block.table} />;
    case "click": return <Line icon={<MousePointer2 aria-hidden className="size-3.5 shrink-0 text-ui-muted" />}>Clicked <span className="font-medium text-ui-primary">{block.label}</span></Line>;
    case "capture": return <LogScreenshots screenshots={block.shots} presentation={block.submit ? "submit" : undefined} />;
  }
}

const GUTTER: Readonly<Record<MockState, { label: string; className: string }>> = {
  review: { label: "Waiting", className: "text-ui-warning" }, parked: { label: "Parked", className: "text-ui-warning" }, failed: { label: "Failed", className: "text-ui-danger" },
  paused: { label: "Paused", className: "text-ui-muted" }, stalled: { label: "No progress", className: "text-ui-danger" }, cancelling: { label: "Cancelling", className: "text-ui-muted" },
};

function StepBody({ step, decision }: { step: MockStep; decision: MockDecision }) {
  const blocks = step.blocks.filter((block): block is Exclude<MockBlock, { kind: "decision" }> => block.kind !== "decision");
  return <>
    {blocks.map((block, index) => <Block key={index} block={block} />)}
    {step.outcome && <Line icon={<Check aria-hidden className="size-3.5 shrink-0 text-ui-positive" />}>{step.outcome}</Line>}
    {blocks.length !== step.blocks.length && <Decision decision={decision} />}
  </>;
}

export function DecisionMockFeed({ data }: { data: MockSceneData }) {
  const { toast } = useToasts();
  const shown = useRef(false);
  useEffect(() => {
    if (!data.toast || shown.current) return;
    shown.current = true;
    toast({ tone: "warning", title: data.toast.title, description: data.toast.description, duration: 600_000 });
  }, [data.toast, toast]);
  const gutter = GUTTER[data.state];
  const count = data.steps.reduce((total, step) => total + step.blocks.reduce((sum, block) => sum + (block.kind === "page" ? block.rows.length : block.kind === "click" ? 1 : block.kind === "table" ? block.table.rows.length : 0), 0), 0);
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-ui-panel text-body text-ui-primary" data-decision={data.id}>
    <div role="region" aria-label="Run logs" tabIndex={0} className="min-w-0 flex-1 overflow-y-auto px-4 pb-6 pt-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ui-info">
      {data.steps.map(step => <section key={step.id} aria-label={step.title} className="grid min-w-0 grid-cols-[var(--spacing-log-time)_minmax(0,1fr)] gap-x-4 border-b border-ui-stroke py-5 first:pt-0 last:border-b-0">
        <div className="flex flex-col gap-1 pt-0.5"><time className="text-caption tabular-nums text-ui-muted">{step.time}</time>{step.current && <span className={cn("flex flex-col text-caption", gutter.className)}><span>{gutter.label}</span>{data.waited && <span className="tabular-nums">{data.waited}</span>}</span>}</div>
        <div className="min-w-0"><header className="mb-4 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"><h3 className="m-0 text-heading">{step.title}</h3>{step.system && <span className="inline-flex items-center gap-1.5 border-l border-ui-stroke pl-3 text-caption text-ui-muted"><Monitor aria-hidden className="size-3.5" />{step.system}</span>}</header>
          <div className="flex min-w-0 flex-col gap-3"><StepBody step={step} decision={data.decision} /></div></div>
      </section>)}
    </div>
    <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-ui-stroke bg-ui-panel px-3 py-2">
      <SearchInput className="w-44" aria-label="Search logs" placeholder="Search logs…" value="" onChange={() => undefined} onClear={() => undefined} />
      <span className="text-caption tabular-nums text-ui-muted">{count} actions</span>
      <span className="ml-auto inline-flex items-center gap-1"><IconButton label="Copy logs" icon={<Copy aria-hidden className="size-3.5" />} /><IconButton label="Go to latest action" icon={<ArrowDownToLine aria-hidden className="size-3.5" />} /></span>
    </footer>
  </div>;
}
