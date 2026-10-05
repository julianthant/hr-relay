import { useViewState } from "../../app/navigation/view-route-model.js";
import { ArrowLeft, ArrowRight, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { formatRuntimeVersion } from '../../../domain/archive/runtime-version.js';
import { Button, Checkbox, DialogBody, DialogFooter, Popover, PopoverContent, PopoverTrigger, dsIcon } from '../../ds/ui.js';
import { archiveRuntimeVersionPreview } from './archive-runtime-model.js';
import { ArchiveBumpStepHeading, ArchiveBumpVersionSummary } from './archive-bump-review.js';
import { MOCK_ARCHIVE_VERSIONS } from './archive-mock-model.js';

export function MockArchiveBump({ contextWorkflow, onCancel, onFinish }: {
 contextWorkflow?: string; onCancel: () => void; onFinish: () => void;
}) {
 const [scope, setScope] = useViewState('bumpScope', 'workflows');
 const [selected, setSelected] = useViewState('bumpSelection', () => {
  const match = contextWorkflow === undefined ? MOCK_ARCHIVE_VERSIONS.workflows[0] : MOCK_ARCHIVE_VERSIONS.workflows.find(row => row.workflowId === contextWorkflow);
  return match ? [match.workflowId] : [];
 });
 const [pickerOpen, setPickerOpen] = useState(false);
 const [reviewedKey, setReviewedKey] = useViewState('bumpReview', null);
 const preview = archiveRuntimeVersionPreview(MOCK_ARCHIVE_VERSIONS, scope, selected);
 const key = preview === null ? null : JSON.stringify(preview.scope);
 const reviewed = key !== null && key === reviewedKey;
 const affected = preview?.transition.affectedWorkflowIds ?? [];
 const selectionLabel = selected.length === 0 ? 'Select a workflow' : selected.length === 1
  ? MOCK_ARCHIVE_VERSIONS.workflows.find(row => row.workflowId === selected[0])?.label : `${selected.length} workflows selected`;
 return <>
  <DialogBody className="archive-bump-body">
   <ArchiveBumpStepHeading step={reviewed ? 'review' : 'select'} description={reviewed ? `${affected.length} ${affected.length === 1 ? 'workflow' : 'workflows'} will advance to the new version.` : 'Select the workflows to include in this change.'} />
   {!reviewed && <fieldset aria-label="Version bump scope" className="archive-bump-scopes">
    <div className="archive-bump-scope" data-active={scope === 'workflows' || undefined}>
     <label className="archive-bump-label"><input className="ds-focus" type="radio" name="archive-mock-bump" checked={scope === 'workflows'} onChange={() => { setScope('workflows'); setReviewedKey(null); }} />Selected workflow</label>
     {scope === 'workflows' && <div className="archive-bump-picker">
      <span className="text-caption text-[color:var(--ds-fg-muted)]">Workflow to bump</span>
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
       <PopoverTrigger asChild><Button variant="secondary" className="w-full justify-between" aria-label="Workflow to bump" iconAfter={<ChevronDown className={dsIcon.sm} />}>{selectionLabel}</Button></PopoverTrigger>
       <PopoverContent title="Workflow to bump" align="start" className="ds-body-scope ds-body-overlay !z-50 !w-[min(360px,calc(100vw-32px))] !bg-[var(--ds-surface-overlay)]">
        <fieldset aria-label="Workflows to bump" className="flex max-h-[300px] flex-col gap-[12px] overflow-y-auto p-[16px]">
         {MOCK_ARCHIVE_VERSIONS.workflows.map(row => {
          const next = preview?.transition.after.workflows.find(item => item.workflowId === row.workflowId)?.version ?? row.version;
          return <Checkbox key={row.workflowId} checked={selected.includes(row.workflowId)} onCheckedChange={checked => {
           setSelected(current => checked ? [...current, row.workflowId] : current.filter(id => id !== row.workflowId));
           setReviewedKey(null);
          }} label={<span className="flex flex-col gap-[3px]"><span>{row.label}</span><span className="text-caption text-[color:var(--ds-fg-muted)]">{selected.includes(row.workflowId) ? `${formatRuntimeVersion(row.version)} → ${formatRuntimeVersion(next)}` : `Unchanged · ${formatRuntimeVersion(row.version)}`}</span></span>} />;
         })}
        </fieldset>
       </PopoverContent>
      </Popover>
      {contextWorkflow !== undefined && !MOCK_ARCHIVE_VERSIONS.workflows.some(row => row.workflowId === contextWorkflow) && <p className="text-caption text-[color:var(--ds-fg-muted)]">Choose a registered workflow.</p>}
     </div>}
    </div>
    <div className="archive-bump-scope" data-active={scope === 'dashboard' || undefined}>
     <label className="archive-bump-label"><input className="ds-focus" type="radio" name="archive-mock-bump" checked={scope === 'dashboard'} onChange={() => { setScope('dashboard'); setReviewedKey(null); }} />All workflows</label>
     <p className="ml-[22px] mt-[8px] text-caption text-[color:var(--ds-fg-muted)]">Dashboard 1.4 → 2.0 · All workflow versions advance together</p>
    </div>
   </fieldset>}
   {reviewed && preview !== null && <section className="archive-bump-review" aria-label="Version change review">
    <ArchiveBumpVersionSummary before={preview.transition.before} after={preview.transition.after} affected={affected} workflows={MOCK_ARCHIVE_VERSIONS.workflows} />
    <p className="archive-bump-note">Fictional preview. Applying closes this preview; no version or run changes.</p>
   </section>}
  </DialogBody>
  <DialogFooter meta={reviewed ? <Button variant="ghost" icon={<ArrowLeft className={dsIcon.sm} />} onClick={() => setReviewedKey(null)}>Back</Button> : undefined}><Button variant="secondary" onClick={onCancel}>Cancel</Button>{reviewed
   ? <Button variant="primary" onClick={onFinish}>Apply reviewed change</Button>
   : <Button variant="primary" iconAfter={<ArrowRight className={dsIcon.sm} />} disabled={preview === null} onClick={() => { setPickerOpen(false); setReviewedKey(key); }}>Review change</Button>}
  </DialogFooter>
 </>;
}
