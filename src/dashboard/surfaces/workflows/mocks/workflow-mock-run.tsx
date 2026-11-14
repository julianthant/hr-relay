import { useViewState } from "../../../app/navigation/view-route-model.js";
import { useEffect, useRef, useState } from "react";
import { Check, ArrowLeft, ArrowRight, Lock, Play } from "lucide-react";
import { BareButton, Banner, Button, Switch, ChoicePicker, DateInput, DialogBody, DialogFooter, Field, Input, Badge, MetaLine, SegmentedChoice, Textarea } from "../../../ds/ui.js";
import { MOCK_ONBASE_TYPES, mockWorkflow, type MockWorkflowId } from "./workflow-mock-catalog.js";
import { mockTypedInputValues, changeMockTypedInput, initialMockDraft, mockDraftError, mockDraftInputError, mockInputEntries, mockSelectableSteps, mockOcrReadSteps, mockOathDuplicate, mockStepState, type MockDraft, type MockFile, type MockRun } from "./workflow-mock-model.js";
import "../../run-start/launch-presentation.css";
import { cn } from "../../../lib/utils.js";
import { RunList, RunListRow, RunSection } from "../../../ds/primitives/run-list.js";
import { TypedInput } from "../../run-start/run-start-kit.js";
import { editableMockDraft, manualReadFields, mockStepInputError, mockStepIsLocked, mockStepIsDependency, mockStepIsRequiredSignIn, usesManualRead } from "./workflow-manual-model.js";
import { Select } from "../../../ds/ui.js";
import { StatusMockReadiness, StatusMockRosterPicker } from "../../settings/status-mock/status-mock.js";
import { statusMockDefaultPicks, statusMockPicksBlocked, type StatusMockPicks } from "../../settings/status-mock/status-mock-picks.js";
import { statusMock } from "../../settings/status-mock/status-mock-model.js";
import { WorkflowPdfInput } from "./workflow-pdf-input.js";

export function WorkflowMockRunForm({ workflowId, source, runs, onClose, onSubmit, initialDraft, onDraftChange }: {
  initialDraft?: MockDraft; onDraftChange?: (draft: MockDraft) => void;
  workflowId: MockWorkflowId; source?: MockRun; runs: readonly MockRun[]; onClose: () => void;
  onSubmit: (id: MockWorkflowId, draft: MockDraft, sourceId?: string) => void;
}) {
  const flow = mockWorkflow(workflowId);
  const mock = statusMock();
  const [draft, setDraft] = useState<MockDraft>(() => editableMockDraft(workflowId, initialDraft ?? source?.draft ?? initialMockDraft(workflowId)));
  const [stage, setStage] = useViewState("launchStage", source ? "Steps" : "Input");
  const chatGptBlocked = workflowId === "emergency-contact" && (mock === "run-b" || mock === "run-rerun" || mock === "run-rerun-options");
  const blocked = workflowId === "emergency-contact" && mock === "run-a" && stage === "Input" || chatGptBlocked && (stage === "Options" || stage === "Steps" && !source);
  const [picks, setPicks] = useState<StatusMockPicks>(() => statusMockDefaultPicks(mock));
  const [priorityTouched, setPriorityTouched] = useState(false);
  const [fileError, setFileError] = useState<string>();
  const [reading, setReading] = useState(false);
  const [optionalSteps, setOptionalSteps] = useViewState("launchCustomize", false);
  const stages: Array<"Steps" | "Values" | "Options" | "Input"> = source ? ["Steps", "Values", "Options"] : ["Input", "Options", ...(optionalSteps ? ["Steps" as const] : [])];
  const index = stages.findIndex(candidate => candidate === stage);
  const last = index === stages.length - 1;
  const error = fileError ?? (stage === "Steps" || index === stages.length - 1 ? mockDraftError(workflowId, draft) : mockDraftInputError(workflowId, draft)) ?? (workflowId === "oath-upload" ? mockOathDuplicate(runs, draft) : undefined);
  const pdf = draft.method === "pdf";
  const uploadOnly = workflowId === "oath-upload" && draft.uploadMode === "upload-only";
  const spreadsheetPicker = flow.runnable && !uploadOnly;
  const typedEntries = mockInputEntries(workflowId, draft);
  const steps = mockSelectableSteps(workflowId, draft);
  const preparation = mockOcrReadSteps(workflowId, draft);
  const planSteps = [...preparation, ...steps];
  const included = (draft.ocrMode === "manual" ? Math.min(preparation.length, 1) : preparation.length) + steps.filter(step => draft.selectedSteps.includes(step.key)).length;
  const patch = (next: Partial<MockDraft>) => { const value = { ...draft, ...next }; setDraft(value); onDraftChange?.(value); };
  // Priority follows the run's size until the operator changes it: ticked for one person, unticked for several.
  const people = pdf ? draft.files.length : typedEntries.length;
  const priority = priorityTouched ? draft.priority === "interactive" : people <= 1;
  const startDisabled = blocked || Boolean(error) || reading || (spreadsheetPicker && statusMockPicksBlocked(picks));
  const advance = () => { if (startDisabled) return; if (last) onSubmit(workflowId, { ...draft, priority: priority ? "interactive" : "background" }, source?.id); else setStage(stages[index + 1]); };
  // Enter continues (or starts on the last step); Shift+Enter keeps its newline in a textbox. Buttons, links and open pickers keep Enter for themselves.
  // Listens on the document so Enter still works when focus fell back to the dialog after a step change.
  const enterRef = useRef(advance);
  enterRef.current = advance;
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented || event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target === null || (target !== document.body && target.closest('[role="dialog"]') === null)) return;
      if (target.closest('a, button:not([role="checkbox"]):not([role="switch"]), [role="combobox"], [role="listbox"], [role="menu"], [role="option"]')) return;
      event.preventDefault();
      enterRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
  const chooseFiles = async (files: readonly File[]) => {
    setReading(true); setFileError(undefined);
    try {
      const selected: MockFile[] = [];
      for (const file of files) {
        const bytes = await file.arrayBuffer();
        if (!/\.pdf$/iu.test(file.name) || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("Choose valid PDF files.");
        const hash = await crypto.subtle.digest("SHA-256", bytes);
        selected.push({ name: file.name, size: file.size, digest: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("") });
      }
      patch({ files: selected });
    } catch (failure) { patch({ files: [] }); setFileError(failure instanceof Error ? failure.message : "Could not read PDFs."); }
    finally { setReading(false); }
  };
  return <>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ol aria-label="Run configuration path" className="launch-stagebar m-0 list-none">
        {stages.map((name, position) => <li key={name} aria-current={name === stage ? "step" : undefined}><BareButton aria-label={`${position + 1} ${name}`} onClick={() => setStage(name)} disabled={position > index + 1 || position === index + 1 && startDisabled}>
          <span aria-hidden className="launch-stage-marker" data-current={name === stage || undefined} data-completed={position < index || undefined}>{position < index ? <Check className="size-3" aria-hidden /> : position + 1}</span><span className={cn("text-body", name === stage ? "font-semibold" : "text-ui-secondary")}>{name}</span></BareButton></li>)}
      </ol><DialogBody key={stage} className="launch-content @container">
        {stage === "Steps" && <section className="flex flex-col gap-1"><div className="flex items-baseline justify-between gap-3"><h3 className="m-0 text-[length:var(--ds-row-heading)] font-normal leading-[var(--ds-row-heading-lh)] text-[color:var(--ds-fg)]">Steps</h3><span className="text-[13px] text-ui-muted">{included} of {planSteps.length} included</span></div>
          <p className="m-0 text-[13px] leading-4 text-[color:var(--ds-fg-secondary)]">{source ? "Select steps for the new run. Statuses show the source outcome." : "Replace reading steps with manual values. Form actions stay included."}</p>
        </section>}
        <div className="flex min-w-0 flex-col gap-8">
        {(stage === "Input" || stage === "Values") && <section aria-label={stage} className="flex flex-col gap-8">
          {(flow.methods.length > 1 || workflowId === "oath-upload") && <RunList label="Input options">
            {flow.methods.length > 1 && <RunListRow title="Input method" description="Type Employee IDs or upload PDF scans."><div className="w-[250px]"><SegmentedChoice hideLabel label="Input method" value={draft.method} options={flow.methods.map(value => ({ value, label: value === "typed" ? "Employee IDs" : "PDFs" }))} onChange={method => patch({ method })} /></div></RunListRow>}
            {workflowId === "oath-upload" && <RunListRow title="Processing mode" description="Full process reads, matches and uploads each scan."><div className="w-[250px]"><SegmentedChoice hideLabel label="Processing mode" value={draft.uploadMode} options={[{ value: "full", label: "Full process" }, { value: "upload-only", label: "Upload-only" }]} onChange={uploadMode => patch({ uploadMode })} /></div></RunListRow>}
          </RunList>}
          {workflowId === "work-study" && <RunList label="Dates"><RunListRow title="Effective date" description="The day the change takes effect."><div className="w-[200px]"><DateInput className="w-full" hideLabel label="Effective date" required value={draft.effectiveDate} onChange={effectiveDate => patch({ effectiveDate })} /></div></RunListRow></RunList>}
          {workflowId === "old-kronos-reports" && <RunList title="Report period"><RunListRow title="Report start" description="First day of the report."><div className="w-[200px]"><DateInput className="w-full" hideLabel label="Report start" required value={draft.startDate} onChange={startDate => patch({ startDate })} /></div></RunListRow><RunListRow title="Report end" description="Last day of the report."><div className="w-[200px]"><DateInput className="w-full" hideLabel label="Report end" required value={draft.endDate} onChange={endDate => patch({ endDate })} /></div></RunListRow></RunList>}
          {draft.method === "typed" && (flow.typedInput ? <TypedInput workflowId={workflowId}
            surface={{ typedInput: flow.typedInput, placeholder: flow.placeholder, parser: { split: { kind: "whole-text" }, rules: [{ when: { kind: "otherwise" }, emit: "value" }] } }}
            text={draft.text} onText={text => patch({ text })} draft={mockTypedInputValues(workflowId, draft)}
            onValue={(field, value) => patch(changeMockTypedInput(workflowId, draft, field, value))}
            preview={{ entries: typedEntries.map((sourceText, index) => ({ index, sourceText })), submissions: [], problem: null }} /> : <>
            <RunSection title="Input" description={`${flow.inputLabel}. Separate values with a comma or Shift+Enter.`}>
              <Textarea autoFocus rows={4} aria-label={flow.inputLabel} value={draft.text} placeholder={flow.placeholder} onChange={event => patch({ text: event.target.value })} />
            </RunSection>
            {typedEntries.length > 0 && <ul aria-label="Parsed inputs" className="launch-parsed-input m-0 flex list-none flex-col gap-1 p-0">{typedEntries.map((entry, number) => <li key={number} className="flex items-center gap-2 rounded-md border border-ui-stroke px-2 text-body"><span className="text-ui-muted">{number + 1}</span><span className="truncate">{entry}</span></li>)}</ul>}
          </>)}
          {pdf && <>
            {workflowId === "onbase" && <RunList label="Documents setup">
              <RunListRow title="Document type" description="How OnBase files the imported pages."><div className="w-[250px]"><ChoicePicker hideLabel label="Document type" value={draft.documentType} options={MOCK_ONBASE_TYPES} onChange={documentType => patch({ documentType })} /></div></RunListRow>
            </RunList>}
            <WorkflowPdfInput files={draft.files} busy={reading} onChoose={files => { void chooseFiles(files); }} onRemove={index => { patch({ files: draft.files.filter((_, number) => number !== index) }); setFileError(undefined); }} />
          </>}
          {workflowId === "emergency-contact" && mock === "run-a" && <StatusMockReadiness frame="run-a" />}
          {spreadsheetPicker && mock !== "run-a" && <StatusMockRosterPicker picks={picks} onPicks={setPicks} />}
          {draft.method === "roster" && <RunList label="Spreadsheet"><RunListRow title="Spreadsheet" description="The library spreadsheet to download."><div className="w-[250px]"><ChoicePicker hideLabel label="Spreadsheet" value="onboarding" options={[{ value: "onboarding", label: "Onboarding Roster" }]} onChange={() => undefined} /></div></RunListRow></RunList>}
          {draft.method === "delegated" && <Banner tone="info" title="Delegated lookup">Searches I-9 Complete by last and first name, optionally SSN, then reads the Section 2 signer and status. The parent owns this run.</Banner>}
          {error && draft.method !== "delegated" && (draft.text || draft.files.length || fileError) && <p role="alert" className="text-caption text-ui-danger">{error}</p>}
        </section>}
        {stage === "Options" && chatGptBlocked && <StatusMockReadiness frame="run-b" />}
        {stage === "Options" && <div className="flex flex-col gap-8">
          <RunList title="Run">
            {!source && planSteps.length > 0 && <RunListRow title="Customize steps" description="Choose optional steps."><Switch hideLabel label="Customize steps" checked={optionalSteps} onCheckedChange={value => { setOptionalSteps(value); if (!value) patch({ selectedSteps: flow.steps.map(step => step.key), manualSteps: [] }); }} className="!min-h-0 !w-auto !py-0" /></RunListRow>}
            {pdf && !uploadOnly && <RunListRow title="Extract with OCR" description="Turn off to enter records manually in OCR review."><Switch hideLabel label="Extract with OCR" checked={draft.ocrMode !== "manual"} onCheckedChange={value => patch({ ocrMode: value ? "extract" : "manual" })} className="!min-h-0 !w-auto !py-0" /></RunListRow>}
            {flow.dryRun && <RunListRow title="Dry run" description="Fill and check every step without submitting."><Switch hideLabel label="Dry run" checked={draft.dryRun} onCheckedChange={value => patch({ dryRun: value === true })} className="!min-h-0 !w-auto !py-0" /></RunListRow>}
            <RunListRow title="Screenshots" description="Required by this workflow."><span className="inline-flex items-center gap-1.5 text-[12px] text-ui-secondary"><Lock aria-hidden className="size-3" />Always on</span></RunListRow>
            <RunListRow title="Priority" description="Runs before bulk batches."><Switch hideLabel label="Priority" checked={priority} onCheckedChange={value => { setPriorityTouched(true); patch({ priority: value ? "interactive" : "background" }); }} className="!min-h-0 !w-auto !py-0" /></RunListRow>
            <RunListRow title="Browser" description="Headless runs in the background."><div className="w-[250px]"><SegmentedChoice hideLabel label="Browser mode" value={draft.browser} onChange={browser => patch({ browser })} options={[{ value: "headed", label: "Headed" }, { value: "headless", label: "Headless" }]} /></div></RunListRow>
            {workflowId === "onboarding" && <RunListRow title="Hire type" description="Applies to every item."><div className="w-[250px]"><SegmentedChoice hideLabel label="Hire type" value={draft.hireType} options={[{ value: "new-hire", label: "New hire" }, { value: "rehire", label: "Rehire" }]} onChange={hireType => patch({ hireType })} /></div></RunListRow>}
          </RunList>
        </div>}
        {stage === "Steps" && <section aria-label="Steps" className="flex flex-col gap-[var(--ds-space-cozy)]"><RunList label="Steps">{planSteps.length ? planSteps.map(step => {
          const state = source ? mockStepState(source, step) : undefined;
          const required = mockStepIsLocked(workflowId, step) || mockStepIsDependency(step);
          const fields = manualReadFields(workflowId, step.key), manual = usesManualRead(draft, step.key);
          const setManual = (value: boolean) => patch({ manualSteps: value ? [...new Set([...(draft.manualSteps ?? []), step.key])] : (draft.manualSteps ?? []).filter(key => key !== step.key) });
          const note = step.key === "prep:ocr" ? step.system : mockStepIsDependency(step) ? ["wait-approval", "read-document"].includes(step.key) ? "Approval required" : "Automatic" : required ? mockStepIsRequiredSignIn(workflowId, step) ? `${step.system ?? "Sign-in"} · required` : "Form action · required" : step.system;
          const toggle = (value: boolean) => step.key === "prep:ocr" ? patch({ ocrMode: value ? "extract" : "manual" }) : patch({
            selectedSteps: value ? [...new Set([...draft.selectedSteps, step.key])] : draft.selectedSteps.filter(key => key !== step.key),
            manualSteps: !value && fields.length ? [...new Set([...(draft.manualSteps ?? []), step.key])] : (draft.manualSteps ?? []).filter(key => key !== step.key) });
          return <RunListRow key={step.key} title={step.label} description={note}
            {...(step.key === "prep:ocr" || !required ? { check: { checked: step.key === "prep:ocr" ? draft.ocrMode !== "manual" : draft.selectedSteps.includes(step.key), onChange: toggle } } : { locked: true })}
            below={manual ? <div role="group" aria-label={`Manual values for ${step.label}`} className="grid grid-cols-2 gap-3">
              {fields.map(field => <Field key={field.key} label={field.label}><InputOrSelect field={field} value={draft.manualValues?.[step.key]?.[field.key] ?? ""} onChange={value => patch({ manualValues: { ...draft.manualValues, [step.key]: { ...draft.manualValues?.[step.key], [field.key]: value } } })} /></Field>)}
            </div> : undefined}>
            {source && <Badge tone={state === "completed" ? "success" : "neutral"} className="launch-step-status" data-status={state}>{state === "completed" ? "Completed" : state === "skipped" ? "Skipped" : "Not started"}</Badge>}
            {required && fields.length > 0 && <><span aria-hidden className="cursor-pointer text-[12px] text-ui-secondary" onClick={() => setManual(!manual)}>Enter manually</span><Switch hideLabel label={`Enter manually for ${step.label}`} checked={manual} onCheckedChange={setManual} className="!min-h-0 !w-auto !py-0" /></>}
          </RunListRow>;
        }) : <RunListRow title="OCR preparation reads and matches the PDF records." />}</RunList>{mockStepInputError(workflowId, draft) && <p role="alert" className="text-caption text-ui-danger">{mockStepInputError(workflowId, draft)}</p>}</section>}
        {index === stages.length - 1 && stage !== "Steps" && error && <p role="alert" className="text-caption text-ui-danger">{error}</p>}
        </div>

      </DialogBody></div>
    <DialogFooter meta={<MetaLine tone="faint" items={[flow.label, `${included} of ${planSteps.length} steps`, ...(pdf && !uploadOnly ? [`OCR ${draft.ocrMode === "manual" ? "off" : "on"}`] : []), ...(priority ? ["Priority"] : [])]} />}>
      {!startDisabled && <span className="text-[12px] text-ui-muted">{last ? "Enter to start" : "Enter to continue"}</span>}
      {index > 0 && <Button variant="ghost" icon={<ArrowLeft className="size-3" aria-hidden />} onClick={() => setStage(stages[index - 1])}>Back</Button>}<Button variant="muted" onClick={onClose}>Cancel</Button>
      {last ? <Button variant="primary" icon={<Play className="size-[14px]" aria-hidden />} disabled={startDisabled} onClick={advance}>{flow.dryRun ? draft.dryRun ? "Start dry run" : "Start live run" : "Start run"}</Button>
        : <Button variant="primary" iconAfter={<ArrowRight className="size-[14px]" aria-hidden />} disabled={startDisabled} onClick={advance}>Continue</Button>}
    </DialogFooter>
  </>;
}

function InputOrSelect({ field, value, onChange }: { field: ReturnType<typeof manualReadFields>[number]; value: string; onChange: (value: string) => void }) {
  return field.options ? <Select aria-label={field.label} value={value} onChange={event => onChange(event.target.value)}><option value="">Choose…</option>{field.options.map(option => <option key={option} value={option}>{option}</option>)}</Select>
    : <Input aria-label={field.label} value={value} placeholder={field.date ? "MM/DD/YYYY" : undefined} onChange={event => onChange(event.target.value)} />;
}
