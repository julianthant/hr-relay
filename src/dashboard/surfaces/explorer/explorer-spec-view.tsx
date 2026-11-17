import { useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCheck, LockKeyhole, Monitor, Workflow } from "lucide-react";
import type { ExplorerReviewSpec } from "../../../models/dashboard/explorer-review-spec.js";
import { dsFocus, PageHeading, Select } from "../../ds/ui.js";
import { FieldRow, FieldRows } from "../shared/steps/field-row.js";
import { ClickLine } from "../shared/steps/click-line.js";
import { NoteLine } from "../shared/steps/note-line.js";
import { PageCard } from "../shared/steps/page-card.js";
import { PickTableView } from "../shared/steps/pick-table-view.js";
import { StepFrame } from "../shared/steps/step-frame.js";
import { ExplorerSource } from "./explorer-source.js";
import type { ExplorerPickerEntry } from "./explorer-picker-model.js";
import { fieldSource, resolveExplorer, rowValue, systemName, visible, type SpecCard, type SpecDecision, type SpecRow, type SpecValues } from "./explorer-spec.js";

type ExplorerWorkflowOption = Pick<ExplorerPickerEntry, "id" | "title"> & Partial<Pick<ExplorerPickerEntry, "depth">>;

// The step number sits in a circle beside the title; a rail joins the circles.
const STEP = "border-b last:border-b-0 [--spacing-log-time:2.75rem]";

type Source = Readonly<{ row: SpecRow; stepId: string; card: string }>;

function Decision({ decision, values, onChoose }: { decision: SpecDecision; values: SpecValues; onChoose: (outcome: string) => void }) {
  const outcomes = visible(decision.outcomes, values);
  const outcome = outcomes.find(item => item.value === values[decision.id]) ?? outcomes[0];
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
    <Select aria-label={decision.label} className="w-80 max-w-full" value={outcome.value} onChange={event => onChoose(event.target.value)}>
      {outcomes.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
    </Select>
    {!outcome.stops && <span className="text-body text-ui-secondary">{outcome.then}</span>}
  </div>;
}

function Card({ card, values, onSource }: { card: SpecCard; values: SpecValues; onSource: (row: SpecRow, trigger: HTMLButtonElement) => void }) {
  const rows = visible(card.rows, values);
  if (rows.length === 0) return null;
  return <PageCard title={card.title} mode={card.mode === "fill" ? "Fill" : "Read"}>
    <FieldRows padded>{rows.map(row => <FieldRow key={row.id} kind={card.mode} label={row.label} value={rowValue(row, values)}
      onSource={card.mode === "fill" ? trigger => onSource(row, trigger) : undefined} />)}</FieldRows>
  </PageCard>;
}

function Pick({ pick }: { pick: Extract<SpecBlock, { kind: "pick" }> }) {
  const [chosen, setChosen] = useState<string>();
  const [typed, setTyped] = useState("");
  return <PickTableView title={pick.title} columns={pick.columns.map((label, index) => ({ id: `column-${index}`, label }))}
    rows={pick.rows.map((row, index) => ({ id: `row-${index}`, label: row.cells[0], cells: row.cells.map((value, cell) => ({ value, attention: row.warning === true && cell > 0 })) }))}
    typed={pick.other === undefined ? undefined : { id: "typed", label: pick.other.label, placeholder: pick.other.placeholder, value: typed }}
    chosen={chosen} onChoose={setChosen} onText={value => { setTyped(value); setChosen("typed"); }} />;
}

/** One line naming the workflow a step starts; choosing it shows that workflow's steps. */
function Starts({ block, onWorkflow }: { block: Extract<SpecBlock, { kind: "starts" }>; onWorkflow: (id: string) => void }) {
  return <p className="m-0 flex items-center gap-3 text-body text-ui-secondary"><Workflow aria-hidden className="size-3.5 shrink-0 text-ui-muted" />
    <span>{block.each} starts <button type="button" className={`rounded-sm font-medium text-ui-info hover:underline ${dsFocus}`} onClick={() => onWorkflow(block.workflowId)}>{block.title}</button></span></p>;
}

/** The Explorer page: heading with the workflow picker, then the spec or the state that stands in for it. */
export function ExplorerPage({ workflowId, workflows, onWorkflow, children }: { workflowId: string; workflows: readonly ExplorerWorkflowOption[]; onWorkflow: (id: string) => void; children: ReactNode }) {
  return <section aria-label="Workflow explorer preview" className="settings-reference-page settings-data-section ui-theme-scope text-ui-primary">
    <PageHeading title="Explorer" description="Browse workflows, their steps and field sources." className="settings-heading-actions" actions={
      <Select aria-label="Explorer workflow" className="settings-heading-select" value={workflowId} onChange={event => { if (event.target.value !== workflowId) onWorkflow(event.target.value); }}>
        {workflows.map(workflow => <option key={workflow.id} value={workflow.id}>{`${"\u2003".repeat(workflow.depth ?? 0)}${workflow.title}`}</option>)}
      </Select>
    } />
    {children}
  </section>;
}

export function ExplorerSpecView({ spec, workflowId, workflows, onWorkflow }: { spec: ExplorerReviewSpec; workflowId: string; workflows: readonly ExplorerWorkflowOption[]; onWorkflow: (id: string) => void }) {
  const [chosen, setChosen] = useState<SpecValues>({});
  const [decisions, setDecisions] = useState<SpecValues>({});
  const [source, setSource] = useState<Source>();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const resolved = useMemo(() => resolveExplorer(spec, chosen, decisions), [spec, chosen, decisions]);
  const { values, options, sessions, steps, stop } = resolved;
  // Step 1 is the browser sessions the run signs in to; it exists only when the chosen run signs in anywhere.
  const offset = sessions.length > 0 ? 1 : 0;
  const numberOf = (id: string) => { const index = steps.findIndex(step => step.id === id); return index < 0 ? undefined : index + 1 + offset; };
  const stepId = (number: number) => `explorer-step-${number}`;
  const marker = (number: number) => <span className="relative inline-flex size-7 items-center justify-center rounded-full border border-ui-stroke bg-ui-panel text-caption tabular-nums text-ui-secondary">{number}</span>;
  const closeSource = () => { setSource(undefined); trigger.current?.focus({ preventScroll: true }); };
  const openSource = (stepOf: string, card: string) => (row: SpecRow, opener: HTMLButtonElement) => { trigger.current = opener; setSource({ row, stepId: stepOf, card }); };
  const choose = (id: string, value: string) => { setChosen(current => ({ ...current, [id]: value })); setSource(undefined); };
  const decide = (id: string, value: string) => { setDecisions(current => ({ ...current, [id]: value })); setSource(undefined); };
  const sourceStep = source && steps.find(step => step.id === source.stepId);

  return <ExplorerPage workflowId={workflowId} workflows={workflows} onWorkflow={onWorkflow}>
    {options.length > 0 && <section aria-labelledby="run-options" className="mb-4 mt-6">
      <h2 id="run-options" className="m-0 mb-4 text-section">Run options</h2>
      <div className="grid grid-cols-4 gap-4">{options.map(option => <div key={option.id} className="flex min-w-0 flex-col gap-1.5">
        <span id={`option-${option.id}`} className="text-body font-medium text-ui-secondary">{option.label}</span>
        <Select aria-labelledby={`option-${option.id}`} value={values[option.id]} onChange={event => choose(option.id, event.target.value)}>
          {option.choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
        </Select>
      </div>)}</div>
    </section>}
    <div className="mb-6 border-b border-ui-stroke pb-4"><NoteLine message={spec.unlistedFailure} /></div>
    <div className="relative before:absolute before:bottom-5 before:left-3.5 before:top-3 before:w-px before:bg-ui-stroke">
      {offset === 1 && <StepFrame leading={marker(1)} title="Open browser sessions" titleId={stepId(1)} className={STEP}>
        <div className="flex flex-wrap gap-2">{sessions.map(system => <span key={system} className="inline-flex h-9 items-center gap-2 rounded-md border border-ui-stroke bg-ui-table px-3 text-body"><Monitor aria-hidden className="size-4 text-ui-muted" />{systemName(system)}<LockKeyhole aria-hidden className="ml-2 size-3 text-ui-muted" /></span>)}</div>
      </StepFrame>}
      {steps.map((step, index) => {
        const number = index + 1 + offset;
        return <StepFrame key={step.id} leading={marker(number)} title={step.title} system={step.system === undefined ? undefined : systemName(step.system)} titleId={stepId(number)} className={STEP}>
          {visible(step.description, values).slice(0, 1).map(line => <p key={line.text} className="m-0 text-body text-ui-secondary">{line.text}</p>)}
          {visible(step.checks, values).map(line => <NoteLine key={line.text} message={line.text} icon={<CheckCheck aria-hidden className="size-3.5 self-start translate-y-0.5 text-ui-positive" />} />)}
          {visible(step.blocks, values).map((block, position) => {
            if (block.kind === "click") return <ClickLine key={`click:${position}`} label={`Clicks ${block.target}`} />;
            if (block.kind === "starts") return <Starts key={`starts:${position}`} block={block} onWorkflow={onWorkflow} />;
            if (block.kind === "pick") return <Pick key={`pick:${position}`} pick={block} />;
            if (block.kind === "decision") return <Decision key={block.id} decision={block} values={values} onChoose={outcome => decide(block.id, outcome)} />;
            return <Card key={block.id} card={block} values={values} onSource={openSource(step.id, block.title)} />;
          })}
        </StepFrame>;
      })}
    </div>
    {stop && <div className="border-t border-ui-stroke pt-3"><NoteLine message={stop.then} tone="danger" /></div>}
    {source && sourceStep && <ExplorerSource key={source.row.id} label={source.row.label} destination={`${sourceStep.system === undefined ? "Local" : systemName(sourceStep.system)} · ${source.card}`}
      source={fieldSource(spec, source.row, numberOf)} onClose={closeSource}
      onJump={number => { setSource(undefined); const target = document.getElementById(stepId(number)); target?.scrollIntoView({ block: "start", behavior: "instant" }); target?.focus({ preventScroll: true }); }} />}
  </ExplorerPage>;
}
