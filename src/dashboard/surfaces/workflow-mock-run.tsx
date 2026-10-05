import { useState } from "react";
import { Check, ArrowLeft, ArrowRight, Play } from "lucide-react";
import { BareButton, Banner, Button, Checkbox, ChoicePicker, DateInput, DialogBody, DialogFooter, Field, Input, Badge, MetaLine, SectionLabel, SegmentedChoice, Textarea } from "../ds/ui.js";
import { MOCK_FORM_TYPES, MOCK_ONBASE_TYPES, mockWorkflow, type MockWorkflowId } from "./workflow-mock-catalog.js";
import { initialMockDraft, mockConfirmationFacts, mockDraftError, mockInputEntries, mockLaunchCount, mockSelectableSteps, mockOathDuplicate, mockRunStatus, mockStepState, type MockDraft, type MockFile, type MockRun } from "./workflow-mock-model.js";
import "./launch-presentation.css";
import { cn } from "../lib/utils.js";
import { RunConfirmLayout, RunOptionsLayout, RunStepsList } from "./run-launch-layout.js";
import { RunFlagChips } from "./run-start-kit.js";

export function WorkflowMockRunForm({ workflowId, source, runs, onClose, onSubmit }: {
  workflowId: MockWorkflowId; source?: MockRun; runs: readonly MockRun[]; onClose: () => void;
  onSubmit: (id: MockWorkflowId, draft: MockDraft, sourceId?: string) => void;
}) {
  const flow = mockWorkflow(workflowId);
  const [draft, setDraft] = useState<MockDraft>(() => source ? structuredClone(source.draft) : initialMockDraft(workflowId));
  const [stage, setStage] = useState(source ? "Steps" : "Input");
  const [fileError, setFileError] = useState<string>();
  const [reading, setReading] = useState(false);
  const [optionalSteps, setOptionalSteps] = useState(false);
  const stages = source ? ["Steps", "Values", "Options", "Confirm"] : ["Input", "Options", ...(optionalSteps ? ["Steps"] : []), "Confirm"];
  const index = stages.indexOf(stage);
  const error = fileError ?? mockDraftError(workflowId, draft) ?? (workflowId === "oath-upload" ? mockOathDuplicate(runs, draft) : undefined);
  const pdf = draft.method === "pdf";
  const uploadOnly = workflowId === "oath-upload" && draft.uploadMode === "upload-only";
  const typedEntries = mockInputEntries(workflowId, draft);
  const count = mockLaunchCount(workflowId, draft);
  const steps = mockSelectableSteps(workflowId, draft);
  const included = steps.filter(step => draft.selectedSteps.includes(step.key)).length;
  const patch = (next: Partial<MockDraft>) => setDraft(previous => ({ ...previous, ...next }));
  const chooseFiles = async (files: FileList | null) => {
    setReading(true); setFileError(undefined);
    try {
      const selected: MockFile[] = [];
      for (const file of Array.from(files ?? [])) {
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
      {source ? <aside aria-label="Source run" className="launch-workflow-rail flex shrink-0 flex-col border-r border-ui-stroke p-3 pt-[18px]">
        <SectionLabel>Source</SectionLabel><p className="mt-3 text-body font-semibold">{flow.label}</p><p className="mt-1 break-words text-caption text-ui-secondary">{source.subject}</p><p className="mt-3 text-caption text-ui-muted">{mockRunStatus(source)}</p><p className="mt-auto text-caption text-ui-muted">Creates a new run with its own history.</p>
      </aside> : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col"><ol aria-label="Run configuration path" className="launch-stagebar m-0 list-none">
        {stages.map((name, position) => <li key={name} aria-current={name === stage ? "step" : undefined}><BareButton aria-label={`${position + 1} ${name}`} onClick={() => setStage(name)} disabled={position > index}>
          <span aria-hidden className="launch-stage-marker" data-current={name === stage || undefined} data-completed={position < index || undefined}>{position < index ? <Check className="size-3" aria-hidden /> : position + 1}</span><span className={cn("text-body", name === stage ? "font-semibold" : "text-ui-secondary")}>{name}</span></BareButton></li>)}
      </ol><DialogBody className="launch-content @container">
        <section className="flex flex-col gap-1"><div className="flex items-baseline justify-between gap-3"><h3 className="text-heading font-semibold">{stage === "Options" ? "Run options" : stage === "Steps" ? source ? "Choose what to run again" : "Workflow steps" : stage === "Confirm" ? "Review the plan" : source ? "Values for the new run" : "Run input"}</h3>{stage === "Steps" && <span className="text-caption text-ui-muted">{included} / {steps.length} included</span>}</div>
          {stage !== "Confirm" && <p className="text-body text-ui-secondary">{stage === "Options" ? "Set how this work enters the queue." : stage === "Steps" ? source ? "Select steps for the new run. Statuses show the source outcome." : "Choose the steps to include in this run." : flow.methods[0] === "delegated" ? "I-9 Lookup runs inside its parent workflow." : pdf ? "Choose the documents to process." : "Each entry starts one run."}</p>}
        </section>
        <div className="flex min-w-0 flex-col gap-[var(--ds-space-loose)]">
        {(stage === "Input" || stage === "Values") && <section aria-label={stage} className="flex flex-col gap-3">
          {flow.methods.length > 1 && <SegmentedChoice label="Input method" value={draft.method} options={flow.methods.map(value => ({ value, label: value === "typed" ? "Employee IDs" : "PDFs" }))} onChange={method => patch({ method, dryRun: method === "pdf" ? false : flow.dryRun })} />}
          {workflowId === "oath-upload" && <SegmentedChoice label="Processing mode" value={draft.uploadMode} options={[{ value: "full", label: "Full process" }, { value: "upload-only", label: "Upload-only" }]} onChange={uploadMode => patch({ uploadMode })} />}
          {workflowId === "person-lookup" && <><SegmentedChoice label="Lookup mode" value={draft.lookupMode} options={[{ value: "search", label: "Search" }, { value: "match", label: "Match" }]} onChange={lookupMode => patch({ lookupMode, crmCheck: lookupMode === "search" })} /><Checkbox label="CRM check" checked={draft.crmCheck} onCheckedChange={value => patch({ crmCheck: value === true })} /></>}
          {draft.method === "typed" && <>
            <Field label={workflowId === "person-lookup" && draft.lookupMode === "match" ? "Name, DOB and SSN" : flow.inputLabel} description={workflowId === "person-lookup" ? draft.lookupMode === "match" ? "Last, First, DOB, SSN. Use x for an unavailable DOB or SSN, but not both. Separate people with semicolons." : "Separate people with a semicolon or a new line." : "Separate values with a comma or a new line."}>
              <Textarea autoFocus rows={4} value={draft.text} placeholder={workflowId === "person-lookup" && draft.lookupMode === "match" ? "Lee, Jordan, 01/01/2000, x" : flow.placeholder} onChange={event => patch({ text: event.target.value })} />
            </Field>
            {typedEntries.length > 0 && <ul aria-label="Parsed inputs" className="launch-parsed-input m-0 flex list-none flex-col gap-1 p-0">{typedEntries.map((entry, number) => <li key={number} className="flex items-center gap-2 rounded-md border border-ui-stroke px-2 text-body"><span className="text-ui-muted">{number + 1}</span><span className="truncate">{entry}</span></li>)}</ul>}
          </>}
          {pdf && <>
            <div className="grid grid-cols-2 items-start gap-3">
              <Field label="PDFs"><Input type="file" multiple accept="application/pdf,.pdf" onChange={event => { void chooseFiles(event.target.files); }} /></Field>
              {flow.roster && !uploadOnly && <ChoicePicker label="Roster" value={draft.roster} options={[{ value: "existing", label: "Existing Onboarding Roster" }, { value: "download", label: "Download Onboarding Roster" }]} onChange={roster => { if (roster === "existing" || roster === "download") patch({ roster }); }} />}
            </div>
            {reading && <p role="status">Reading PDFs…</p>}
            {draft.files.length > 0 && <ul className="m-0 list-none p-0 text-body">{draft.files.map((file, number) => <li key={number} className="flex items-center justify-between border-b border-ui-stroke py-2"><span className="truncate">{file.name}</span><span className="text-caption text-ui-muted">{Math.ceil(file.size / 1024)} KB</span></li>)}</ul>}
            {workflowId === "onbase" && <><ChoicePicker label="Document type" value={draft.documentType} options={MOCK_ONBASE_TYPES} onChange={documentType => patch({ documentType })} /><p className="text-caption text-ui-secondary">Selected PDFs merge into one document. Approved pages import separately for each person.</p></>}
            {workflowId === "ocr" && <ChoicePicker label="Form type" value={draft.formType} options={MOCK_FORM_TYPES} onChange={formType => patch({ formType })} />}
          </>}
          {draft.method === "roster" && <ChoicePicker label="Spreadsheet" value="onboarding" options={[{ value: "onboarding", label: "Onboarding Roster" }]} onChange={() => undefined} />}
          {draft.method === "delegated" && <Banner tone="info" title="Delegated lookup">Searches I-9 Complete by last and first name, optionally SSN, then reads the Section 2 signer and status. The parent owns this run.</Banner>}
          {workflowId === "work-study" && <DateInput label="Effective date" required value={draft.effectiveDate} onChange={effectiveDate => patch({ effectiveDate })} />}
          {workflowId === "old-kronos-reports" && <div className="grid grid-cols-2 gap-4"><DateInput label="Report start" required value={draft.startDate} onChange={startDate => patch({ startDate })} /><DateInput label="Report end" required value={draft.endDate} onChange={endDate => patch({ endDate })} /></div>}
          {error && draft.method !== "delegated" && (draft.text || draft.files.length || fileError) && <p role="alert" className="text-caption text-ui-danger">{error}</p>}
        </section>}
        {stage === "Options" && <RunOptionsLayout priority={draft.priority === "background" ? "bulk" : "interactive"} onPriorityChange={priority => patch({ priority: priority === "bulk" ? "background" : "interactive" })} browserMode={draft.browser} onBrowserModeChange={browser => patch({ browser })}
          flags={<>
            {!source && steps.length > 0 && <Checkbox label="Customize steps" description="Choose optional steps." checked={optionalSteps} onCheckedChange={value => { setOptionalSteps(value === true); if (value !== true) patch({ selectedSteps: flow.steps.map(step => step.key) }); }} />}
            {flow.dryRun && <Checkbox label="Dry run" description="Stop before submission." checked={draft.dryRun} onCheckedChange={value => patch({ dryRun: value === true })} />}
            <Checkbox label="Capture screenshots" description="Keep browser captures." checked={draft.captures} onCheckedChange={value => patch({ captures: value === true })} />
          </>}>
          {(workflowId === "onboarding" || workflowId === "old-kronos-reports" || (pdf && !uploadOnly) || draft.method === "typed") && <div className={cn("grid gap-4", workflowId === "onboarding" && "grid-cols-2")}>
            {workflowId === "onboarding" && <SegmentedChoice label="Hire type" value={draft.hireType} options={[{ value: "new-hire", label: "New hire" }, { value: "rehire", label: "Rehire" }]} onChange={hireType => patch({ hireType })} />}
            {workflowId === "old-kronos-reports" ? <Field label="Workers"><Input type="number" min={1} step={1} value={draft.workers} onChange={event => patch({ workers: Number(event.target.value) })} /></Field> : (pdf && !uploadOnly) || draft.method === "typed" ? <ChoicePicker label="Workers" value={String(draft.workers)} options={[{ value: "auto", label: "Auto" }, ...Array.from({ length: 8 }, (_, number) => ({ value: String(number + 1), label: String(number + 1) }))]} onChange={workers => patch({ workers: workers === "auto" ? "auto" : Number(workers) })} /> : null}
          </div>}
        </RunOptionsLayout>}
        {stage === "Steps" && <section aria-label="Steps" className="flex flex-col gap-[var(--ds-space-cozy)]"><h4 id="run-start-steps" className="sr-only">Steps</h4><RunStepsList>{steps.length ? steps.map(step => {
          const state = source ? mockStepState(source, step) : undefined;
          return <li key={step.key} className="launch-step-row flex min-w-0 flex-col gap-2"><div className="flex items-start gap-[var(--ds-space-base)]">
            <Checkbox label={step.label} description={step.system} checked={draft.selectedSteps.includes(step.key)} onCheckedChange={value => patch({ selectedSteps: value === true ? [...draft.selectedSteps, step.key] : draft.selectedSteps.filter(key => key !== step.key) })} />
            {source && <Badge tone={state === "completed" ? "success" : "neutral"} className="launch-step-status" data-status={state}>{state === "completed" ? "Completed" : state === "skipped" ? "Skipped" : "Not started"}</Badge>}
          </div></li>;
        }) : <li className="p-3 text-body text-ui-secondary">OCR preparation reads and matches the PDF records.</li>}</RunStepsList></section>}
        {stage === "Confirm" && <RunConfirmLayout count={count} flags={<RunFlagChips dryRun={flow.dryRun && draft.dryRun} priority={draft.priority === "background" ? "bulk" : "interactive"} />}
          description={source ? "A new run linked to the source." : pdf && !uploadOnly ? workflowId === "onbase" ? "One combined document sent to OCR for review." : "One run per PDF. OCR reviews records before downstream work." : "One run for each accepted entry."}
          facts={[...mockConfirmationFacts(workflowId, draft), ...(source ? [{ key: "Source", value: source.subject }] : [])]}>
          {error && <p role="alert" className="text-caption text-ui-danger">{error}</p>}
        </RunConfirmLayout>}
        </div>

      </DialogBody></div>
    <DialogFooter meta={<MetaLine tone="faint" items={[source ? "Source run · new run" : `${count} ${count === 1 ? "run" : "runs"}`, flow.label, ...(stage === "Confirm" ? [`${count} to create`] : [])]} />}>
      {index > 0 && <Button variant="ghost" icon={<ArrowLeft className="size-3" aria-hidden />} onClick={() => setStage(stages[index - 1])}>Back</Button>}<Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" icon={stage === "Confirm" ? <Play className="size-[14px]" aria-hidden /> : undefined} iconAfter={stage !== "Confirm" ? <ArrowRight className="size-[14px]" aria-hidden /> : undefined} disabled={Boolean(error) || reading || (stage === "Steps" && steps.length > 0 && included === 0)} onClick={() => stage === "Confirm" ? onSubmit(workflowId, draft, source?.id) : setStage(stages[index + 1])}>{stage === "Confirm" ? source ? "Create rerun" : "Start preview" : stages[index + 1] === "Confirm" ? "Preview plan" : "Continue"}</Button>
    </DialogFooter>
  </>;
}
