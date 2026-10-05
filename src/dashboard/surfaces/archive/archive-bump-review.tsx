import { useLayoutEffect, useRef } from 'react';
import { formatRuntimeVersion, type RuntimeVersionTransition } from '../../../domain/archive/runtime-version.js';
import './archive-bump.css';

export function ArchiveBumpStepHeading({ step, description }: { step: 'select' | 'review'; description: string }) {
 const heading = useRef<HTMLHeadingElement>(null);
 useLayoutEffect(() => { heading.current?.focus({ preventScroll: true }); }, [step]);
 return <div className="archive-bump-step-heading">
  <div><h3 ref={heading} tabIndex={-1}>{step === 'select' ? 'Choose what to update' : 'Review version change'}</h3><p>{description}</p></div>
  <span className="archive-bump-step-number">Step {step === 'select' ? 1 : 2} of 2</span>
 </div>;
}

export function ArchiveBumpVersionSummary({ before, after, affected, workflows }: {
 before: RuntimeVersionTransition['before']; after: RuntimeVersionTransition['after']; affected: readonly string[];
 workflows: readonly { workflowId: string; label: string }[];
}) {
 const rows = [{ id: 'dashboard', label: 'Dashboard', before: before.dashboard, after: after.dashboard }, ...affected.map(id => ({
  id, label: workflows.find(row => row.workflowId === id)?.label ?? id,
  before: before.workflows.find(row => row.workflowId === id)?.version,
  after: after.workflows.find(row => row.workflowId === id)?.version,
 }))];
 return <div className="archive-bump-version-frame"><table className="archive-bump-version-table" aria-label="Version changes">
  <thead><tr><th scope="col">Workflow</th><th scope="col">Current</th><th scope="col">New version</th></tr></thead>
  <tbody>{rows.map(row => {
   const current = row.before === undefined ? 'Version unavailable' : formatRuntimeVersion(row.before);
   const next = row.after === undefined ? 'Version unavailable' : formatRuntimeVersion(row.after);
   const unchanged = row.before !== undefined && row.after !== undefined && current === next;
   return <tr key={row.id}><th scope="row">{row.label}</th><td>{current}</td><td data-changed={!unchanged || undefined}>{next}{unchanged && <span className="archive-bump-unchanged">Unchanged</span>}</td></tr>;
  })}</tbody>
 </table></div>;
}
