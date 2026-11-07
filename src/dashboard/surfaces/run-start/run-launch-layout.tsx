import type { PlannedRunOutput } from "../../../models/dashboard/run-outputs.js";
import type { ReactNode } from "react";
import { BodySection, DsBodyScope, Field, FormGroup, SegmentedChoice } from "../../ds/ui.js";

export function RunOptionsLayout({ flags, children, priority, onPriorityChange, browserMode, onBrowserModeChange, references, workflowLabel = "Workflow" }: {
  flags: ReactNode; children?: ReactNode; priority: "interactive" | "bulk";
  onPriorityChange: (value: "interactive" | "bulk") => void;
  browserMode: "headed" | "headless"; onBrowserModeChange: (value: "headed" | "headless") => void;
  references?: ReactNode; workflowLabel?: string;
}) {
  return <DsBodyScope role="region" aria-label="Options" className="launch-options flex flex-col" style={{ background: "transparent" }}>
    <BodySection title="Run"><FormGroup label="Run options">
      <div className="launch-flags">{flags}</div>
      <div className="launch-options-grid">
        <Field orientation="horizontal" label="Priority" description="Interactive runs go first."><SegmentedChoice label="Priority" value={priority} onChange={onPriorityChange} options={[{ value: "interactive", label: "Interactive" }, { value: "bulk", label: "Bulk" }]} /></Field>
        <Field orientation="horizontal" label="Browser" description="Headless runs in the background."><SegmentedChoice label="Browser mode" value={browserMode} onChange={onBrowserModeChange} options={[{ value: "headed", label: "Headed" }, { value: "headless", label: "Headless" }]} /></Field>
      </div>
    </FormGroup></BodySection>
    {references && <BodySection title="Reference data"><FormGroup label="Reference data">{references}</FormGroup></BodySection>}
    {children && <BodySection title={workflowLabel}><FormGroup label="Workflow options">{children}</FormGroup></BodySection>}
  </DsBodyScope>;
}

export function RunStepsList({ children }: { children: ReactNode }) {
  return <ul className="m-0 list-none overflow-hidden rounded-[var(--ds-radius-lg)] border border-[color:var(--ds-border)] divide-y divide-[color:var(--ds-border)] p-0">{children}</ul>;
}

export function RunConfirmLayout({ count, flags, description, facts, inputs, outputs, children }: {
  count: number; flags?: ReactNode; description: string;
  facts: readonly { key: string; value: string }[]; inputs?: readonly { label: string; kind: string }[];
  outputs?: readonly PlannedRunOutput[]; children?: ReactNode;
}) {
  const inputFacts = inputs ?? facts.filter(fact => fact.key === 'Input').map(fact => ({ label: fact.value, kind: 'Input' }));
  return <DsBodyScope role="region" aria-label="Confirm" className="launch-confirm flex flex-col gap-[var(--ds-space-section)]" style={{ background: 'transparent' }}>
    <div className="flex items-center justify-between gap-3"><div><h4 id="run-start-confirm" className="text-body font-semibold">{count} {count === 1 ? 'run' : 'runs'} ready to queue</h4><p className="mt-[6px] text-body text-ui-secondary">{description}</p></div>{flags}</div>
    <BodySection title="Plan"><FormGroup label="Run plan"><dl>{facts.filter(fact => fact.key !== 'Input').map(({ key, value }, index) => <div key={`${index}:${key}`} className="launch-confirm-row"><dt>{key}</dt><dd>{value}</dd></div>)}</dl></FormGroup></BodySection>
    {inputFacts.length > 0 && <BodySection title="Input"><FormGroup label="Run inputs"><dl>{inputFacts.map((input, index) => <div key={index} className="launch-confirm-row"><dt>{input.label}</dt><dd>{input.kind}</dd></div>)}</dl></FormGroup></BodySection>}
    {outputs && outputs.length > 0 && <BodySection title="Output"><FormGroup label="Run outputs"><dl>{outputs.map((output, index) => <div key={index} className="launch-confirm-row"><dt>{output.kind === 'workbook' ? output.name : output.kind === 'worksheet-archives' ? 'Worksheet folders and ZIP files' : `${output.folderName} / ${output.archiveName}`}</dt><dd>{output.kind === 'worksheet-archives' ? 'Assigned after roster row review' : output.kind === 'worksheet-archive' ? output.people.map(person => person.label).join(', ') : output.rows.state === 'after-review' ? `One row per ${output.rowSubject} after review` : `${output.rows.count} ${output.rowSubject === 'person' ? output.rows.count === 1 ? 'person' : 'people' : output.rows.count === 1 ? 'record' : 'records'}`}</dd></div>)}</dl></FormGroup></BodySection>}
    {children}
  </DsBodyScope>;
}
