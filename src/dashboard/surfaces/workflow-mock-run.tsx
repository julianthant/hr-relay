import { useState } from "react";
import { Check, ArrowRight } from "lucide-react";
import { BareButton, Banner, Button, Checkbox, ChoicePicker, DateInput, DialogBody, DialogFooter, Field, Input, KeyValueList, SectionLabel, SegmentedChoice, Textarea } from "../ds/ui.js";
import { MOCK_FORM_TYPES, MOCK_ONBASE_TYPES, mockWorkflow, type MockWorkflowId } from "./workflow-mock-catalog.js";
import { initialMockDraft, mockConfirmationFacts, mockDraftError, mockInputEntries, mockOathDuplicate, mockPipeline, mockRunStatus, mockStepState, type MockDraft, type MockFile, type MockRun } from "./workflow-mock-model.js";
import "./launch-presentation.css";

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
  const planRun: MockRun = { id: "mock:plan", workflowId, title: flow.label, subject: typedEntries[0] ?? "", draft, approved: true, seeded: false };
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
        {stages.map((name, position) => <li key={name} aria-current={name === stage ? "step" : undefined}><BareButton onClick={() => setStage(name)} disabled={position > index}>
          <span className="launch-stage-marker" data-current={name === stage || undefined} data-completed={position < index || undefined}>{position < index ? <Check className="size-3" aria-hidden /> : position + 1}</span>{name}</BareButton></li>)}
      </ol><DialogBody className="launch-content @container">
        <section><h3>{stage === "Options" ? "Run options" : stage === "Steps" ? source ? "Choose what to run again" : "Workflow steps" : stage === "Confirm" ? "Review the plan" : source ? "Values for the new run" : "Run input"}</h3>
          <p className="text-body text-ui-secondary">{stage === "Options" ? "Set how this work enters the queue." : stage === "Steps" ? "Select the steps for the new run." : stage === "Confirm" ? "Review the input and selected options." : flow.methods[0] === "delegated" ? "I-9 Lookup runs inside its parent workflow." : pdf ? "Choose the documents to process." : "Each entry starts one run."}</p>
        </section>
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
            {workflowId === "onbase" && <><Field label="Document type"><Input value="X_HR_Emergency Contact" readOnly /></Field><details className="text-caption text-ui-muted"><summary>Other document types</summary><ul className="list-none p-0">{MOCK_ONBASE_TYPES.filter(type => type !== "Emergency Contact").map(type => <li key={type}>{type} · Unavailable</li>)}</ul></details><p className="text-caption text-ui-secondary">Selected PDFs merge into one document. Approved pages import separately for each person.</p></>}
            {workflowId === "ocr" && <ChoicePicker label="Form type" value={draft.formType} options={MOCK_FORM_TYPES} onChange={formType => patch({ formType })} />}
          </>}
          {draft.method === "roster" && <ChoicePicker label="Spreadsheet" value="onboarding" options={[{ value: "onboarding", label: "Onboarding Roster" }]} onChange={() => undefined} />}
          {draft.method === "delegated" && <Banner tone="info" title="Delegated lookup">Searches I-9 Complete by last and first name, optionally SSN, then reads the Section 2 signer and status. The parent owns this run.</Banner>}
          {workflowId === "work-study" && <DateInput label="Effective date" required value={draft.effectiveDate} onChange={effectiveDate => patch({ effectiveDate })} />}
          {workflowId === "old-kronos-reports" && <div className="grid grid-cols-2 gap-4"><DateInput label="Report start" required value={draft.startDate} onChange={startDate => patch({ startDate })} /><DateInput label="Report end" required value={draft.endDate} onChange={endDate => patch({ endDate })} /></div>}
          {error && draft.method !== "delegated" && (draft.text || draft.files.length || fileError) && <p role="alert" className="text-caption text-ui-danger">{error}</p>}
        </section>}
        {stage === "Options" && <section aria-label="Options" className="launch-options flex flex-col gap-3">
          <div className="launch-options-grid"><SegmentedChoice label="Priority" value={draft.priority} options={[{ value: "interactive", label: "Interactive" }, { value: "background", label: "Background" }]} onChange={priority => patch({ priority })} /><SegmentedChoice label="Browser" value={draft.browser} options={[{ value: "headed", label: "Visible" }, { value: "headless", label: "Headless" }]} onChange={browser => patch({ browser })} /></div>
          {workflowId === "onboarding" && <SegmentedChoice label="Hire type" value={draft.hireType} options={[{ value: "new-hire", label: "New hire" }, { value: "rehire", label: "Rehire" }]} onChange={hireType => patch({ hireType })} />}
          <div className="launch-flags">{flow.dryRun && <Checkbox label="Dry run" description="Skip final submissions" checked={draft.dryRun} onCheckedChange={value => patch({ dryRun: value === true })} />}<Checkbox label="Captures" description="Keep diagnostic captures" checked={draft.captures} onCheckedChange={value => patch({ captures: value === true })} /></div>
          {workflowId === "old-kronos-reports" ? <Field label="Workers"><Input type="number" min={1} step={1} value={draft.workers} onChange={event => patch({ workers: Number(event.target.value) })} /></Field> : (pdf && !uploadOnly) || draft.method === "typed" ? <ChoicePicker label="Workers" value={String(draft.workers)} options={[{ value: "auto", label: "Auto" }, ...Array.from({ length: 8 }, (_, number) => ({ value: String(number + 1), label: String(number + 1) }))]} onChange={workers => patch({ workers: workers === "auto" ? "auto" : Number(workers) })} /> : null}
          {!source && flow.steps.length > 0 && <Checkbox label="Choose steps" checked={optionalSteps} onCheckedChange={value => setOptionalSteps(value === true)} />}
        </section>}
        {stage === "Steps" && <section aria-label="Steps"><ul className="m-0 list-none divide-y divide-ui-stroke rounded-md border border-ui-stroke p-0">{flow.steps.length ? flow.steps.map(step => <li key={step.key} className="launch-step-row"><Checkbox label={step.label} description={step.system} checked={draft.selectedSteps.includes(step.key)} onCheckedChange={value => patch({ selectedSteps: value === true ? [...draft.selectedSteps, step.key] : draft.selectedSteps.filter(key => key !== step.key) })} /></li>) : <li className="p-3 text-body text-ui-secondary">OCR preparation reads and matches the PDF records.</li>}</ul></section>}
        {stage === "Confirm" && <section aria-label="Confirm" className="flex flex-col gap-3">
          <KeyValueList items={[...mockConfirmationFacts(workflowId, draft)]} />
          <ol aria-label="Workflow plan" className="m-0 flex list-decimal flex-col gap-1 pl-5 text-body text-ui-secondary">{mockPipeline(workflowId, draft).map(step => <li key={step.key}>{step.label}{mockStepState(planRun, step) === "skipped" ? draft.dryRun && step.write ? " · skipped in dry run" : " · skipped" : ""}</li>)}</ol>
          {error && <p role="alert" className="text-caption text-ui-danger">{error}</p>}
        </section>}
      </DialogBody></div>
    <DialogFooter><span className="mr-auto text-caption text-ui-muted">{flow.label}</span>{index > 0 && <Button variant="ghost" onClick={() => setStage(stages[index - 1])}>Back</Button>}<Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={Boolean(error) || reading || (stage === "Steps" && flow.steps.length > 0 && draft.selectedSteps.length === 0)} onClick={() => stage === "Confirm" ? onSubmit(workflowId, draft, source?.id) : setStage(stages[index + 1])}>{stage === "Confirm" ? source ? "Create rerun" : "Start preview" : "Continue"}{stage !== "Confirm" && <ArrowRight className="size-3" aria-hidden />}</Button>
    </DialogFooter>
  </>;
}
