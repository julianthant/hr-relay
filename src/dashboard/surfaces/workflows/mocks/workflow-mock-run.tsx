import { RequiredCaptureStatus } from "../../run-detail/logs/log-screenshots.js";
import { useViewState } from "../../../app/navigation/view-route-model.js";
import { useState } from "react";
import { Check, ArrowLeft, ArrowRight, Play } from "lucide-react";
import { BareButton, Banner, Button, Checkbox, ChoicePicker, DateInput, DialogBody, DialogFooter, Field, Input, Badge, MetaLine, SegmentedChoice, Textarea } from "../../../ds/ui.js";
import { MOCK_FORM_TYPES, MOCK_ONBASE_TYPES, mockWorkflow, type MockWorkflowId } from "./workflow-mock-catalog.js";
import { mockTypedInputValues, changeMockTypedInput, initialMockDraft, mockConfirmationFacts, mockDraftError, mockDraftInputError, mockInputEntries, mockLaunchCount, mockSelectableSteps, mockOcrReadSteps, mockOathDuplicate, mockStepState, type MockDraft, type MockFile, type MockRun } from "./workflow-mock-model.js";
import "../../run-start/launch-presentation.css";
import { cn } from "../../../lib/utils.js";
import { RunConfirmLayout, RunOptionsLayout, RunStepsList } from "../../run-start/run-launch-layout.js";
import { TypedInput, RunFlagChips } from "../../run-start/run-start-kit.js";
import { editableMockDraft, manualReadFields, mockStepInputError, mockStepIsLocked, mockStepIsDependency, mockStepIsRequiredSignIn, usesManualRead } from "./workflow-manual-model.js";
import { Select } from "../../../ds/ui.js";
import { WorkflowPdfInput } from "./workflow-pdf-input.js";

export function WorkflowMockRunForm({ workflowId, source, runs, onClose, onSubmit, initialDraft, onDraftChange }: {
  initialDraft?: MockDraft; onDraftChange?: (draft: MockDraft) => void;
  workflowId: MockWorkflowId; source?: MockRun; runs: readonly MockRun[]; onClose: () => void;
  onSubmit: (id: MockWorkflowId, draft: MockDraft, sourceId?: string) => void;
}) {
  const flow = mockWorkflow(workflowId);
  const [draft, setDraft] = useState<MockDraft>(() => editableMockDraft(workflowId, initialDraft ?? source?.draft ?? initialMockDraft(workflowId)));
  const [stage, setStage] = useViewState("launchStage", source ? "Steps" : "Input");
  const [fileError, setFileError] = useState<string>();
  const [reading, setReading] = useState(false);
  const [optionalSteps, setOptionalSteps] = useViewState("launchCustomize", false);
  const stages: Array<"Steps" | "Values" | "Options" | "Confirm" | "Input"> = source ? ["Steps", "Values", "Options", "Confirm"] : ["Input", "Options", ...(optionalSteps ? ["Steps" as const] : []), "Confirm"];
  const index = stages.findIndex(candidate => candidate === stage);
  const error = fileError ?? (stage === "Steps" || stage === "Confirm" ? mockDraftError(workflowId, draft) : mockDraftInputError(workflowId, draft)) ?? (workflowId === "oath-upload" ? mockOathDuplicate(runs, draft) : undefined);
  const pdf = draft.method === "pdf";
  const uploadOnly = workflowId === "oath-upload" && draft.uploadMode === "upload-only";
  const typedEntries = mockInputEntries(workflowId, draft);
  const count = mockLaunchCount(workflowId, draft);
  const steps = mockSelectableSteps(workflowId, draft);
  const preparation = mockOcrReadSteps(workflowId, draft);
  const planSteps = [...preparation, ...steps];
  const included = (draft.ocrMode === "manual" ? 0 : preparation.length) + steps.filter(step => draft.selectedSteps.includes(step.key)).length;
  const patch = (next: Partial<MockDraft>) => { const value = { ...draft, ...next }; setDraft(value); onDraftChange?.(value); };
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
        {stages.map((name, position) => <li key={name} aria-current={name === stage ? "step" : undefined}><BareButton aria-label={`${position + 1} ${name}`} onClick={() => setStage(name)} disabled={position > index}>
          <span aria-hidden className="launch-stage-marker" data-current={name === stage || undefined} data-completed={position < index || undefined}>{position < index ? <Check className="size-3" aria-hidden /> : position + 1}</span><span className={cn("text-body", name === stage ? "font-semibold" : "text-ui-secondary")}>{name}</span></BareButton></li>)}
      </ol><DialogBody className="launch-content @container">
        <section className="flex flex-col gap-1"><div className="flex items-baseline justify-between gap-3"><h3 className="text-heading font-semibold">{stage === "Options" ? "Run options" : stage === "Steps" ? source ? "Choose what to run again" : "Workflow steps" : stage === "Confirm" ? "Review the plan" : source ? "Values for the new run" : "Run input"}</h3>{stage === "Steps" && <span className="text-caption text-ui-muted">{included} / {planSteps.length} included</span>}</div>
          {stage !== "Confirm" && <p className="text-body text-ui-secondary">{stage === "Options" ? "Set how this work enters the queue." : stage === "Steps" ? source ? "Select steps for the new run. Statuses show the source outcome." : "Replace reading steps with manual values. Form actions stay included." : flow.methods[0] === "delegated" ? "I-9 Lookup runs inside its parent workflow." : pdf ? "Choose the documents to process." : "Each entry starts one run."}</p>}
        </section>
        <div className="flex min-w-0 flex-col gap-[var(--ds-space-loose)]">
        {(stage === "Input" || stage === "Values") && <section aria-label={stage} className="flex flex-col gap-3">
          {flow.methods.length > 1 && <SegmentedChoice label="Input method" value={draft.method} options={flow.methods.map(value => ({ value, label: value === "typed" ? "Employee IDs" : "PDFs" }))} onChange={method => patch({ method })} />}
          {workflowId === "oath-upload" && <SegmentedChoice label="Processing mode" value={draft.uploadMode} options={[{ value: "full", label: "Full process" }, { value: "upload-only", label: "Upload-only" }]} onChange={uploadMode => patch({ uploadMode })} />}
          {draft.method === "typed" && (flow.typedInput ? <TypedInput presentation="mock" workflowId={workflowId}
            surface={{ typedInput: flow.typedInput, placeholder: flow.placeholder, parser: { split: { kind: "whole-text" }, rules: [{ when: { kind: "otherwise" }, emit: "value" }] } }}
            text={draft.text} onText={text => patch({ text })} draft={mockTypedInputValues(workflowId, draft)}
            onValue={(field, value) => patch(changeMockTypedInput(workflowId, draft, field, value))}
            preview={{ entries: typedEntries.map((sourceText, index) => ({ index, sourceText })), submissions: [], problem: null }} /> : <>
            <Field label={flow.inputLabel} description="Separate values with a comma or a new line.">
              <Textarea autoFocus rows={4} value={draft.text} placeholder={flow.placeholder} onChange={event => patch({ text: event.target.value })} />
            </Field>
            {typedEntries.length > 0 && <ul aria-label="Parsed inputs" className="launch-parsed-input m-0 flex list-none flex-col gap-1 p-0">{typedEntries.map((entry, number) => <li key={number} className="flex items-center gap-2 rounded-md border border-ui-stroke px-2 text-body"><span className="text-ui-muted">{number + 1}</span><span className="truncate">{entry}</span></li>)}</ul>}
          </>)}
          {pdf && <>
            <WorkflowPdfInput files={draft.files} busy={reading} onChoose={files => { void chooseFiles(files); }} onRemove={index => { patch({ files: draft.files.filter((_, number) => number !== index) }); setFileError(undefined); }} />
            <div className={cn("grid min-w-0 gap-3", flow.roster && !uploadOnly && (workflowId === "ocr" || workflowId === "onbase") && "grid-cols-2")}>
            {flow.roster && !uploadOnly && <ChoicePicker label="Roster" value={draft.roster} options={[{ value: "existing", label: "Existing Onboarding Roster" }, { value: "download", label: "Download Onboarding Roster" }]} onChange={roster => { if (roster === "existing" || roster === "download") patch({ roster }); }} />}
            {workflowId === "onbase" && <ChoicePicker label="Document type" value={draft.documentType} options={MOCK_ONBASE_TYPES} onChange={documentType => patch({ documentType })} />}
            {workflowId === "ocr" && <ChoicePicker label="Form type" value={draft.formType} options={MOCK_FORM_TYPES} onChange={formType => patch({ formType })} />}
            </div>
            {workflowId === "onbase" && <p className="text-caption text-ui-secondary">Selected PDFs merge into one document. Approved pages import separately for each person.</p>}
          </>}
          {draft.method === "roster" && <ChoicePicker label="Spreadsheet" value="onboarding" options={[{ value: "onboarding", label: "Onboarding Roster" }]} onChange={() => undefined} />}
          {draft.method === "delegated" && <Banner tone="info" title="Delegated lookup">Searches I-9 Complete by last and first name, optionally SSN, then reads the Section 2 signer and status. The parent owns this run.</Banner>}
          {workflowId === "work-study" && <DateInput label="Effective date" required value={draft.effectiveDate} onChange={effectiveDate => patch({ effectiveDate })} />}
          {workflowId === "old-kronos-reports" && <div className="grid grid-cols-2 gap-4"><DateInput label="Report start" required value={draft.startDate} onChange={startDate => patch({ startDate })} /><DateInput label="Report end" required value={draft.endDate} onChange={endDate => patch({ endDate })} /></div>}
          {error && draft.method !== "delegated" && (draft.text || draft.files.length || fileError) && <p role="alert" className="text-caption text-ui-danger">{error}</p>}
        </section>}
        {stage === "Options" && <RunOptionsLayout priority={draft.priority === "background" ? "bulk" : "interactive"} onPriorityChange={priority => patch({ priority: priority === "bulk" ? "background" : "interactive" })} browserMode={draft.browser} onBrowserModeChange={browser => patch({ browser })}
          flags={<>
            {!source && planSteps.length > 0 && <Checkbox label="Customize steps" description="Choose optional steps." checked={optionalSteps} onCheckedChange={value => { setOptionalSteps(value === true); if (value !== true) patch({ selectedSteps: flow.steps.map(step => step.key), manualSteps: [] }); }} />}
            {pdf && !uploadOnly && <Checkbox label="Extract with OCR" description="Turn off to enter records manually in OCR review." checked={draft.ocrMode !== "manual"} onCheckedChange={value => patch({ ocrMode: value === true ? "extract" : "manual" })} />}
            {flow.dryRun && <Checkbox label="Dry run" description="Stop before submission." checked={draft.dryRun} onCheckedChange={value => patch({ dryRun: value === true })} />}
            <RequiredCaptureStatus state="required" />
          </>}>
          {workflowId === "onboarding" && <div className="grid grid-cols-2 gap-4">
            <SegmentedChoice label="Hire type" value={draft.hireType} options={[{ value: "new-hire", label: "New hire" }, { value: "rehire", label: "Rehire" }]} onChange={hireType => patch({ hireType })} />
          </div>}
        </RunOptionsLayout>}
        {stage === "Steps" && <section aria-label="Steps" className="flex flex-col gap-[var(--ds-space-cozy)]"><h4 id="run-start-steps" className="sr-only">Steps</h4><RunStepsList>{planSteps.length ? planSteps.map(step => {
          const state = source ? mockStepState(source, step) : undefined;
          const locked = mockStepIsLocked(workflowId, step), dependency = mockStepIsDependency(step);
          const fields = manualReadFields(workflowId, step.key), manual = usesManualRead(draft, step.key);
          const setManual = (value: boolean) => patch({ manualSteps: value ? [...new Set([...(draft.manualSteps ?? []), step.key])] : (draft.manualSteps ?? []).filter(key => key !== step.key) });
          return <li key={step.key} className="launch-step-row flex min-w-0 flex-col gap-2"><div className="flex items-start gap-[var(--ds-space-base)]">
            {step.key === "read-document" ? <Checkbox label={step.label} description={step.system} checked={draft.ocrMode !== "manual"} onCheckedChange={value => patch({ ocrMode: value === true ? "extract" : "manual" })} /> : dependency ? <span className="text-body">{step.label}{" "}<span className="ml-2 text-caption text-ui-muted">{step.key === "wait-approval" ? "Approval required" : "Automatic"}</span></span> : <Checkbox label={step.label} description={locked ? mockStepIsRequiredSignIn(workflowId, step) ? `${step.system ?? "Sign-in"} · required` : "Form action · required" : step.system} disabled={locked} checked={draft.selectedSteps.includes(step.key)} onCheckedChange={value => {
              const included = value === true;
              patch({ selectedSteps: included ? [...new Set([...draft.selectedSteps, step.key])] : draft.selectedSteps.filter(key => key !== step.key),
                manualSteps: !included && fields.length ? [...new Set([...(draft.manualSteps ?? []), step.key])] : (draft.manualSteps ?? []).filter(key => key !== step.key) });
            }} />}
            {source && <Badge tone={state === "completed" ? "success" : "neutral"} className="launch-step-status" data-status={state}>{state === "completed" ? "Completed" : state === "skipped" ? "Skipped" : "Not started"}</Badge>}
          </div>
          {locked && fields.length > 0 && <Checkbox className="ml-6" label={`Enter reading values manually for ${step.label.toLowerCase()}`} checked={manual} onCheckedChange={value => setManual(value === true)} />}
          {manual && <div role="group" aria-label={`Manual values for ${step.label}`} className="ml-6 space-y-3 border-l border-ui-stroke pl-3"><p className="m-0 text-caption text-ui-secondary">Enter the values this step would read. Use “None” for an absent value. These values are operator supplied.</p><div className="grid grid-cols-2 gap-3">
            {fields.map(field => <Field key={field.key} label={field.label}><InputOrSelect field={field} value={draft.manualValues?.[step.key]?.[field.key] ?? ""} onChange={value => patch({ manualValues: { ...draft.manualValues, [step.key]: { ...draft.manualValues?.[step.key], [field.key]: value } } })} /></Field>)}
          </div></div>}
          </li>;
        }) : <li className="p-3 text-body text-ui-secondary">OCR preparation reads and matches the PDF records.</li>}</RunStepsList>{mockStepInputError(workflowId, draft) && <p role="alert" className="text-caption text-ui-danger">{mockStepInputError(workflowId, draft)}</p>}</section>}
        {stage === "Confirm" && <RunConfirmLayout count={count} flags={<RunFlagChips dryRun={flow.dryRun && draft.dryRun} priority={draft.priority === "background" ? "bulk" : "interactive"} />}
          description={source ? "A new run linked to the source." : pdf && !uploadOnly ? workflowId === "onbase" ? "One combined document sent to OCR for review." : workflowId === "ocr" ? "One OCR run per PDF. Results stay in Records." : "One run per PDF. OCR reviews records before downstream work." : "One run for each accepted entry."}
          facts={[...mockConfirmationFacts(workflowId, draft), ...(source ? [{ key: "Source", value: source.subject }] : [])]}>
          {error && <p role="alert" className="text-caption text-ui-danger">{error}</p>}
        </RunConfirmLayout>}
        </div>

      </DialogBody></div>
    <DialogFooter meta={<MetaLine tone="faint" items={[source ? "Source run · new run" : `${count} ${count === 1 ? "run" : "runs"}`, flow.label, ...(stage === "Confirm" ? [`${count} to create`] : [])]} />}>
      {index > 0 && <Button variant="ghost" icon={<ArrowLeft className="size-3" aria-hidden />} onClick={() => setStage(stages[index - 1])}>Back</Button>}<Button variant="muted" onClick={onClose}>Cancel</Button>
      <Button variant="primary" icon={stage === "Confirm" ? <Play className="size-[14px]" aria-hidden /> : undefined} iconAfter={stage !== "Confirm" ? <ArrowRight className="size-[14px]" aria-hidden /> : undefined} disabled={Boolean(error) || reading} onClick={() => stage === "Confirm" ? onSubmit(workflowId, draft, source?.id) : setStage(stages[index + 1])}>{stage === "Confirm" ? source ? "Create rerun" : "Start preview" : stages[index + 1] === "Confirm" ? "Preview plan" : "Continue"}</Button>
    </DialogFooter>
  </>;
}

function InputOrSelect({ field, value, onChange }: { field: ReturnType<typeof manualReadFields>[number]; value: string; onChange: (value: string) => void }) {
  return field.options ? <Select aria-label={field.label} value={value} onChange={event => onChange(event.target.value)}><option value="">Choose…</option>{field.options.map(option => <option key={option} value={option}>{option}</option>)}</Select>
    : <Input aria-label={field.label} value={value} placeholder={field.date ? "MM/DD/YYYY" : undefined} onChange={event => onChange(event.target.value)} />;
}
