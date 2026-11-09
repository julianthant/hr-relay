import { useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, CheckCheck, Circle, CircleHelp, CircleStop, Eye, LockKeyhole, Monitor, MousePointer2, PanelsTopLeft, PencilLine } from "lucide-react";
import { Input, PageHeading, Select, dsFocus } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { ExplorerSource } from "./explorer-source.js";
import { defaultOptions, firstMatch, matches, resolveExplorer, specFieldSource, specValue, type ExplorerSpec, type SpecBlock, type SpecRow, type SpecValues } from "./explorer-spec.js";

type WorkflowOption = Readonly<{ id: string; title: string; disabled?: boolean }>;

function PageCard({ title, mode, children }: { title: string; mode: string; children: ReactNode }) {
  return <div className="overflow-hidden rounded-lg border border-ui-stroke bg-ui-table">
    <div className="flex min-h-11 items-center gap-2.5 border-b border-ui-stroke px-3 py-2.5"><PanelsTopLeft aria-hidden className="size-4 shrink-0 text-ui-muted" /><h4 className="m-0 text-control font-medium">{title}</h4><span className="ml-auto text-caption text-ui-muted">{mode}</span></div>
    {children}
  </div>;
}

const ROW = "grid grid-cols-[1rem_minmax(9rem,1fr)_minmax(11rem,1fr)] items-start gap-2.5 border-b border-ui-stroke text-body last:border-b-0";

function FillRow({ row, value, onSource }: { row: SpecRow; value: string; onSource?: (trigger: HTMLButtonElement) => void }) {
  const body = <>
    <PencilLine aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ui-info" /><span className="self-center">{row.label}</span>
    <span className="flex min-h-7 min-w-0 items-center justify-between gap-2 self-center rounded-md border border-ui-stroke-control bg-ui-field px-2.5 py-1 text-ui-info">{value}{onSource && <ArrowUpRight aria-hidden className="size-3.5 shrink-0" />}</span>
  </>;
  return onSource
    ? <button type="button" aria-label={`Show source for ${row.label}`} onClick={event => onSource(event.currentTarget)} className={cn(ROW, "w-full py-1.5 text-left hover:bg-ui-hover", dsFocus)}>{body}</button>
    : <div className={cn(ROW, "py-1.5")}>{body}</div>;
}

function ReadRow({ label, value }: { label: string; value: string }) {
  return <div className={cn(ROW, "py-2")}><Eye aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ui-muted" /><span className="self-center">{label}</span><span className="self-center text-right text-ui-secondary">{value}</span></div>;
}

function PickCard({ block }: { block: Extract<SpecBlock, { kind: "pick" }> }) {
  const last = block.columns.length - 1;
  // The column with the longest values takes the leftover width and truncates; the rest never wrap.
  const flex = block.columns.reduce((best, _, index) => Math.max(...block.rows.map(row => row.cells[index].length)) > Math.max(...block.rows.map(row => row.cells[best].length)) ? index : best, 0);
  return <PageCard title={block.title} mode="Pick">
    <table aria-label={block.title} className="w-full border-collapse text-left text-body">
      <thead><tr className="text-caption text-ui-muted"><th className="w-9 pl-3"><span className="sr-only">Choice</span></th>{block.columns.map((column, index) => <th key={column} className={cn("whitespace-nowrap px-3 py-2 font-normal", index === last && "text-right")}>{column}</th>)}</tr></thead>
      <tbody>
        {block.rows.map(row => <tr key={row.cells.join("|")} className="border-t border-ui-stroke">
          <td className="w-9 py-2.5 pl-3 align-middle"><Circle aria-hidden className="size-3.5 text-ui-muted" /></td>
          {row.cells.map((cell, index) => <td key={index} title={cell} className={cn("whitespace-nowrap px-3 py-2.5 tabular-nums", index === flex && "w-full max-w-0 truncate", index === last && "text-right", index === 0 ? "font-medium" : index === last && row.warning ? "text-ui-warning" : "text-ui-secondary")}>{cell}</td>)}
        </tr>)}
        <tr className="border-t border-ui-stroke">
          <td className="w-9 py-2 pl-3 align-middle"><Circle aria-hidden className="size-3.5 text-ui-muted" /></td>
          <td className="whitespace-nowrap px-3 py-2 font-medium">{block.other.label}</td>
          <td colSpan={block.columns.length - 1} className="px-3 py-1.5 text-right"><Input aria-label={block.other.label} readOnly placeholder={block.other.placeholder} className="ml-auto h-7 w-36 text-right font-medium tabular-nums" /></td>
        </tr>
      </tbody>
    </table>
  </PageCard>;
}

function Line({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <p className="m-0 flex items-center gap-2.5 text-body text-ui-secondary">{icon}<span>{children}</span></p>;
}

export function ExplorerSpecView({ spec, workflowId, workflows, onWorkflow }: { spec: ExplorerSpec; workflowId: string; workflows: readonly WorkflowOption[]; onWorkflow: (id: string) => void }) {
  const [options, setOptions] = useState<SpecValues>(() => defaultOptions(spec));
  const [decisions, setDecisions] = useState<SpecValues>({});
  const [source, setSource] = useState<{ row: SpecRow; step: string; card: string }>();
  const origin = useRef<HTMLButtonElement | null>(null);
  const { values, steps, stop } = useMemo(() => resolveExplorer(spec, options, decisions), [spec, options, decisions]);
  const numberOf = (id: string) => { const index = steps.findIndex(step => step.id === id); return index < 0 ? undefined : index + 1; };
  const drawer = source && spec.sources[source.row.source ?? ""];
  const closeSource = () => { setSource(undefined); origin.current?.focus({ preventScroll: true }); };
  const field = (row: SpecRow, step: string, card: string) => <FillRow key={row.label} row={row} value={specValue(row.value, values)}
    onSource={row.source && spec.sources[row.source] ? trigger => { origin.current = trigger; setSource({ row, step, card }); } : undefined} />;

  return <section aria-label="Workflow explorer preview" className="settings-reference-page settings-data-section ui-theme-scope text-ui-primary">
    <PageHeading title="Explorer" description="Browse workflows, their steps and field sources." className="settings-heading-actions" actions={
      <Select aria-label="Explorer workflow" className="settings-heading-select" value={workflowId} onChange={event => { if (event.target.value !== workflowId) onWorkflow(event.target.value); }}>
        {workflows.map(workflow => <option key={workflow.id} value={workflow.id} disabled={workflow.disabled}>{workflow.title}</option>)}
      </Select>
    } />
    {spec.options.length > 0 && <section aria-labelledby="run-options" className="mb-8 mt-6 border-b border-ui-stroke pb-6">
      <h2 id="run-options" className="m-0 mb-4 ds-text-section font-semibold">Run options</h2>
      <div className="grid grid-cols-4 gap-4">{spec.options.map(option => <div key={option.id} className="flex min-w-0 flex-col gap-1.5">
        <span id={`option-${option.id}`} className="text-body font-medium text-ui-secondary">{option.label}</span>
        <Select aria-labelledby={`option-${option.id}`} value={options[option.id]} onChange={event => { setOptions(current => ({ ...current, [option.id]: event.target.value })); setSource(undefined); }}>
          {option.choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
        </Select>
      </div>)}</div>
    </section>}
    <ol aria-label="Workflow steps" className="relative m-0 list-none pl-10 before:absolute before:bottom-5 before:left-3.5 before:top-3 before:w-px before:bg-ui-stroke">
      {steps.map((step, index) => {
        const description = firstMatch(step.description, values);
        return <li key={step.id} id={`explorer-step-${index + 1}`} data-step-number={index + 1} tabIndex={-1} className="relative border-b border-ui-stroke pb-6 pt-6 first:pt-0 last:border-b-0">
          <span aria-hidden className={cn("absolute -left-10 flex size-7 items-center justify-center rounded-full border border-ui-stroke bg-ui-panel text-caption tabular-nums text-ui-secondary", index === 0 ? "top-0" : "top-6")}>{index + 1}</span>
          <div className="mb-3 flex min-h-7 flex-wrap items-center gap-3"><h2 className="m-0 ds-text-section font-semibold">{step.title}</h2>{step.system && <span className="flex items-center gap-1.5 border-l border-ui-stroke pl-3 text-caption text-ui-muted"><Monitor aria-hidden className="size-3.5" />{step.system}</span>}</div>
          <div className="flex min-w-0 flex-col gap-3">
            {step.sessions && <div className="flex flex-wrap gap-2">{step.sessions.filter(session => matches(session, values)).map(session => <span key={session.system} className="flex h-9 items-center gap-2 rounded-md border border-ui-stroke bg-ui-table px-3 text-body"><Monitor aria-hidden className="size-4 text-ui-muted" />{session.system}<LockKeyhole aria-hidden className="ml-2 size-3 text-ui-muted" /></span>)}</div>}
            {description && <p className="m-0 text-body text-ui-secondary">{description.text}</p>}
            {step.checks.filter(check => matches(check, values)).map(check => <Line key={check.text} icon={<CheckCheck aria-hidden className="size-3.5 shrink-0 text-ui-positive" />}>{check.text}</Line>)}
            {step.blocks.filter(block => matches(block, values)).map((block, blockIndex) => {
              if (block.kind === "click") return <p key={blockIndex} className="m-0 flex items-center gap-2.5 text-body text-ui-secondary"><MousePointer2 aria-hidden className="size-3.5 shrink-0 text-ui-muted" /><span>Clicks <span className="font-medium text-ui-primary">{block.target}</span></span></p>;
              if (block.kind === "pick") return <div key={blockIndex} className="flex flex-col gap-3"><PickCard block={block} /><Line icon={<CircleHelp aria-hidden className="size-3.5 shrink-0 text-ui-muted" />}><span className="font-medium text-ui-primary">{block.question.title}</span> {block.question.context}</Line></div>;
              if (block.kind === "decision") {
                const outcomes = block.outcomes.filter(outcome => matches(outcome, values));
                const outcome = outcomes.find(item => item.value === values[block.id]) ?? outcomes[0];
                return <div key={blockIndex} className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <Select aria-label={block.label} className="w-60" value={outcome.value} onChange={event => { setDecisions(current => ({ ...current, [block.id]: event.target.value })); setSource(undefined); }}>{outcomes.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</Select>
                  {!outcome.stops && <span className="text-body text-ui-secondary">{outcome.then}</span>}
                </div>;
              }
              const rows = block.rows.filter(row => matches(row, values));
              return <PageCard key={blockIndex} title={block.title} mode={block.mode === "fill" ? "Fill" : "Read"}><div className="px-4 py-1.5">{rows.map(row => block.mode === "fill" ? field(row, step.id, block.title) : <ReadRow key={row.label} label={row.label} value={specValue(row.value, values)} />)}</div></PageCard>;
            })}
          </div>
        </li>;
      })}
    </ol>
    {stop && <p className="ml-10 mt-3 flex items-center gap-2.5 border-t border-ui-stroke pt-4 text-body text-ui-danger"><CircleStop aria-hidden className="size-3.5" />{stop.then}</p>}
    {source && drawer && <ExplorerSource key={source.row.label} label={source.row.label} destination={`${steps.find(step => step.id === source.step)?.system ?? "Local"} · ${source.card}`} source={specFieldSource(drawer, numberOf)} onClose={closeSource}
      onJump={step => { setSource(undefined); const target = document.getElementById(`explorer-step-${step}`); target?.scrollIntoView({ block: "start", behavior: "instant" }); target?.focus({ preventScroll: true }); }} />}
  </section>;
}
