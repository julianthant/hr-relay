import { MOCK_WORKFLOWS, mockWorkflow, type MockMethod, type MockStep, type MockWorkflowId } from "./workflow-mock-catalog.js";
import type { LogStep } from "./log-feed-model.js";
import type { LogTimelineStage, LogTimelineState } from "./logs/log-timeline-model.js";

import type { StatusBucket, StatusCountWire } from "./shell-model.js";
import type { QueueSortKey } from "./queue-model.js";
import { reviewCanApprove, reviewName, reviewRecords, reviewValue, seedReviewRecords, type ReviewRecord } from "./workflow-review-model.js";
import { mockDetailEntries } from "./workflow-result-model.js";

export type MockFile = Readonly<{ name: string; size: number; digest: string }>;
export type MockDraft = Readonly<{
  method: MockMethod; text: string; files: readonly MockFile[]; lookupMode: "search" | "match";
  crmCheck: boolean; hireType: "new-hire" | "rehire"; uploadMode: "full" | "upload-only";
  roster: "existing" | "download" | "none"; formType: string; documentType: string;
  effectiveDate: string; startDate: string; endDate: string; workers: number | "auto";
  dryRun: boolean; priority: "interactive" | "background"; browser: "headed" | "headless";
  captures: boolean; selectedSteps: readonly string[];
}>;
export type MockRun = Readonly<{
  id: string; workflowId: MockWorkflowId; title: string; subject: string; draft: MockDraft;
  sourceId?: string; parentId?: string; parentWorkflowId?: MockWorkflowId; approved: boolean; seeded: boolean;
  role?: "preparation" | "person"; records?: readonly ReviewRecord[]; discarded?: boolean;
}>;
const prep: readonly MockStep[] = [
  { key: "prep:loading-roster", label: "Load roster", message: "Load the selected roster for identity matching." },
  { key: "prep:ocr", label: "Read PDF records", message: "Extract form records from the PDF." },
  { key: "prep:person-lookup", label: "Match extracted people", system: "UCPath", message: "Resolve extracted identities against UCPath and the roster." },
  { key: "prep:awaiting-approval", label: "Review extracted records", message: "Inspect the extracted records before starting downstream work." },
];

export function initialMockDraft(id: string): MockDraft {
  const flow = mockWorkflow(id);
  return { method: flow.methods[0], text: "", files: [], lookupMode: "search", crmCheck: true,
    hireType: "new-hire", uploadMode: "full", roster: "existing", formType: id === "i9-check" ? "i9" : id === "onbase" ? "onbase-emergency-contact" : id === "emergency-contact" ? "emergency-contact" : "oath",
    documentType: "Emergency Contact", effectiveDate: "2026-08-03", startDate: "2017-01-01", endDate: "2026-01-31", workers: id === "old-kronos-reports" ? 4 : "auto",
    dryRun: flow.methods[0] === "pdf" ? false : flow.dryRun, priority: "interactive", browser: "headed", captures: true,
    selectedSteps: flow.steps.map(step => step.key) };
}

export function mockInputEntries(id: string, draft: MockDraft): readonly string[] {
  if (draft.method !== "typed") return [];
  return draft.text.split(id === "person-lookup" ? /[;\n]/u : /[,;\n]/u).map(value => value.trim()).filter(Boolean);
}
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
export function mockDraftError(id: string, draft: MockDraft): string | undefined {
  const flow = mockWorkflow(id);
  if (!flow.methods.includes(draft.method)) return "This input method is unavailable for this workflow.";
  if (draft.method === "delegated") return "I-9 Lookup is delegated by its parent workflow and cannot start independently.";
  if (draft.method === "pdf" && draft.files.length === 0) return "Choose at least one PDF.";
  if (draft.method === "pdf" && draft.files.some(file => !/\.pdf$/iu.test(file.name) || file.size <= 0 || !file.digest)) return "Every attachment must be a nonempty PDF.";
  if (draft.method === "typed") {
    const entries = mockInputEntries(id, draft);
    if (!entries.length) return `Enter ${flow.inputLabel}.`;
    for (const entry of entries) {
      if (id === "person-lookup") {
        if (draft.lookupMode === "match") {
          const parts = entry.split(",").map(part => part.trim());
          if (parts.length < 4 || parts.some(part => !part)) return "Use Last, First, DOB, SSN; separate people with semicolons.";
          if (/^x$/iu.test(parts.at(-2)!) && /^x$/iu.test(parts.at(-1)!)) return "Match needs DOB or SSN; both cannot be x.";
        }
      } else if (id === "onboarding" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(entry)) return "Enter valid email addresses.";
      else if (id === "separations" && !/^\d+$/u.test(entry)) return "Kuali ID must contain digits.";
      else if (id === "crm-doc-download" && !/^\d{5,}$/u.test(entry) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(entry)) return "Enter Employee IDs (5+ digits) or email addresses.";
      else if (!["onboarding", "separations", "crm-doc-download"].includes(id) && !/^\d{5,}$/u.test(entry)) return "Employee IDs must contain at least five digits.";
    }
  }
  if (id === "work-study" && !validDate(draft.effectiveDate)) return "Choose a valid effective date.";
  if (id === "old-kronos-reports" && (!validDate(draft.startDate) || !validDate(draft.endDate) || draft.startDate > draft.endDate)) return "Choose a valid report date range; start must precede end.";
  if (draft.workers !== "auto" && (!Number.isInteger(draft.workers) || draft.workers < 1 || (id !== "old-kronos-reports" && draft.workers > 8))) return "Workers must be a positive whole number.";
  if (id === "ocr" && !["oath", "emergency-contact", "onbase-emergency-contact", "verify", "i9"].includes(draft.formType)) return "Choose a supported form type.";
  if (id === "onbase" && draft.documentType !== "Emergency Contact") return "Only Emergency Contact is wired for OnBase import.";
  if (draft.method === "pdf" && flow.roster && !(id === "oath-upload" && draft.uploadMode === "upload-only") && draft.roster === "none") return "Choose an existing roster or download the configured roster.";
  return undefined;
}

export function mockPipeline(id: string, draft: MockDraft): readonly MockStep[] {
  const flow = mockWorkflow(id);
  if (id === "ocr") return prep.map(step => step.key === "prep:awaiting-approval" ? { ...step, label: "Inspect extracted records", message: "Inspect the standalone OCR report. No downstream approval is available." } : step);
  const pdf = draft.method === "pdf" && !(id === "oath-upload" && draft.uploadMode === "upload-only");
  const preparation = pdf ? prep.filter(step => !(step.key === "prep:awaiting-approval" && id === "i9-check")).map(step => ({ ...step,
    ...(step.key === "prep:loading-roster" && id === "i9-check" ? { message: "Load the configured Action History roster for I-9 retention matching." } : {}),
    ...(step.key === "prep:ocr" && id === "i9-check" ? { message: "Pair the packet's I-9 Section 1 and Section 2 records." } : {}),
    ...(step.key === "prep:person-lookup" && id === "ocr" && draft.formType === "verify" ? { message: "Resolve the extracted person and read CRM first day of service and oath date for Verify." } : {}),
    ...(step.key === "prep:awaiting-approval" && id === "ocr" ? { label: "Extracted records", message: "Extraction complete." } : {}),
  })) : [];
  const steps = flow.steps.filter(step => !(id === "oath-upload" && draft.uploadMode === "upload-only" && ["wait-approval", "wait-signatures"].includes(step.key)));
  return [...(draft.roster === "download" && pdf && flow.roster ? mockWorkflow("sharepoint-download").steps.map(step => ({ ...step, key: `roster:${step.key}` })) : []), ...preparation, ...steps];
}
export function mockNeedsReview(run: MockRun): boolean {
  return run.draft.method === "pdf" && !run.approved && !run.discarded && run.role !== "person" && !(run.workflowId === "oath-upload" && run.draft.uploadMode === "upload-only") && !["i9-check", "ocr"].includes(run.workflowId);
}
export function mockQueueStatus(run: MockRun): "cancelled" | "awaiting-approval" | "done" {
  return run.discarded ? "cancelled" : mockNeedsReview(run) ? "awaiting-approval" : "done";
}
export function mockRunStatus(run: MockRun): string {
  if (run.discarded) return "Discarded";
  if (mockNeedsReview(run)) return "Needs review";
  return run.draft.dryRun && mockWorkflow(run.workflowId).dryRun ? "Dry run complete" : "Completed";
}
export function mockStepState(run: MockRun, step: MockStep): LogTimelineState {
  const draft = run.draft;
  if (run.workflowId === "person-lookup" && ((step.key === "cross-verification" && (!draft.crmCheck || /^\d{5,}$/u.test(run.subject))) || (step.key === "active-status" && draft.lookupMode === "match") || step.key === "crm-dates")) return "skipped";
  if (run.workflowId === "onboarding" && step.key === "i9-creation" && draft.hireType === "rehire") return "skipped";
  if (!step.key.startsWith("roster:") && !prep.some(item => item.key === step.key) && !draft.selectedSteps.includes(step.key) && !["members", "rollup"].includes(step.key)) return "skipped";
  if (run.discarded) return "cancelled";
  if (mockNeedsReview(run) && run.workflowId !== "ocr") {
    const pipeline = mockRunPipeline(run);
    const reviewIndex = pipeline.findIndex(item => item.key === "prep:awaiting-approval");
    const index = pipeline.indexOf(step);
    // Keys identify copied steps; callers may hold a separately composed pipeline.
    const position = index < 0 ? pipeline.findIndex(item => item.key === step.key) : index;
    if (position === reviewIndex) return "waiting";
    if (position > reviewIndex) return "pending";
  }
  if (draft.dryRun && step.write) return "skipped";
  return "completed";
}
export function mockRunPipeline(run: MockRun): readonly MockStep[] {
  if (run.role === "preparation" && ["emergency-contact", "onbase", "oath-signature", "i9-check"].includes(run.workflowId)) return [...mockPipeline(run.workflowId, run.draft).filter(step => step.key.startsWith("prep:") || step.key.startsWith("roster:")),
    { key: "members", label: run.workflowId === "i9-check" ? "Process extracted people" : "Start approved people", message: run.workflowId === "i9-check" ? "Process each matched person." : "Start one independent run per selected, resolved record." },
    { key: "rollup", label: "Collect person outcomes", message: run.workflowId === "i9-check" ? "Collect per-person retention results." : "Collect per-person outcomes." }];
  return run.role === "person" ? mockWorkflow(run.workflowId).steps : mockPipeline(run.workflowId, run.draft);
}
export function mockRunsForDraft(id: MockWorkflowId, draft: MockDraft, sequence: number, sourceId?: string): readonly MockRun[] {
  const error = mockDraftError(id, draft);
  if (error) throw new Error(error);
  const subjects = draft.method === "typed" ? mockInputEntries(id, draft) : draft.method === "roster" ? ["Onboarding Roster"] : id === "onbase" ? [draft.files.map(file => file.name).join(" + ")] : draft.files.map(file => file.name);
  const created: readonly MockRun[] = subjects.map((subject, index) => ({ id: `mock:${id}:${sequence}:${index}`, workflowId: id, subject,
    title: `${mockWorkflow(id).label} · ${subject}`, draft: structuredClone({ ...draft, ...(draft.method === "typed" ? { text: subject } : id === "onbase" ? {} : { files: [draft.files[index]] }) }),
    ...(sourceId ? { sourceId } : {}), ...(draft.method === "pdf" ? { role: "preparation" as const, records: seedReviewRecords({ workflowId: id, draft }) } : {}), approved: false, seeded: false }));
  return created.flatMap(automaticMockPeople);
}
export function seedMockRuns(): readonly MockRun[] {
  return MOCK_WORKFLOWS.map(flow => {
    const draft = { ...initialMockDraft(flow.id), text: flow.example, files: flow.methods.includes("pdf") ? [{ name: flow.example.endsWith(".pdf") ? flow.example : "oaths.pdf", size: 4096, digest: `fixture:${flow.id}` }] : [] };
    return { id: `mock:${flow.id}:sample`, workflowId: flow.id, subject: flow.example, title: `${flow.label} · ${flow.example}`, draft, ...(draft.method === "pdf" ? { role: "preparation" as const, records: seedReviewRecords({ workflowId: flow.id, draft }) } : {}), approved: false, seeded: true };
  }).flatMap(automaticMockPeople);
}
function automaticMockPeople(run: MockRun): readonly MockRun[] {
  if (run.workflowId !== "i9-check" || run.role !== "preparation") return [run];
  return [run, ...reviewRecords(run).map((record, index) => ({ ...run, id: `${run.id}:person:${index}`, sourceId: undefined, title: `I-9 Check · ${reviewName(record)}`, subject: reviewName(record), role: "person" as const, parentId: run.id, parentWorkflowId: run.workflowId, records: [record], approved: true }))];
}
export function approveMockRun(runs: readonly MockRun[], id: string): readonly MockRun[] {
  const source = runs.find(run => run.id === id);
  if (!source || !mockNeedsReview(source) || source.workflowId === "ocr") throw new Error("MOCK_APPROVAL_UNAVAILABLE");
  const records = reviewRecords(source).filter(reviewCanApprove);
  if (!records.length) throw new Error("MOCK_APPROVAL_NO_RECORDS");
  const approved = runs.map(run => run.id === id ? { ...run, approved: true } : run);
  const target = source.workflowId === "oath-upload" ? "oath-signature" : source.workflowId;
  const children: MockRun[] = records.map((record, index) => {
    const draft = { ...initialMockDraft(target), ...source.draft, ...(target === "oath-signature" ? { method: "typed" as const, text: reviewValue(record, "employeeId"), selectedSteps: mockWorkflow(target).steps.map(step => step.key) } : {}) };
    return { id: `${id}:person:${index}`, workflowId: target, parentId: id, parentWorkflowId: source.workflowId, subject: reviewName(record), title: `${mockWorkflow(target).label} · ${reviewName(record)}`, draft, records: [structuredClone(record)], role: "person", approved: true, seeded: source.seeded };
  });
  return [...children, ...approved];
}
function usDate(value: string): string { const [year, month, day] = value.split("-"); return `${month}/${day}/${year}`; }
function resultFields(run: MockRun): readonly (readonly [string, string])[] {
  if (run.discarded) return [["Outcome", "Preparation discarded; no downstream work started"]];
  if (mockNeedsReview(run)) return [["Extracted employee", reviewName(reviewRecords(run)[0])], ["Employee ID", reviewValue(reviewRecords(run)[0], "employeeId")], ["Source PDF", run.draft.files.map(file => file.name).join(", ")]];
  if (run.workflowId === "ocr") return [["Records", String(reviewRecords(run).length)], ...reviewRecords(run).flatMap(record => record.fields.filter(field => field.value).map(field => [field.label, field.kind === "boolean" ? field.value === "true" ? "Yes" : "No" : field.value] as const))];
  if (run.role === "preparation" && run.workflowId !== "oath-upload") return [["Source PDF", run.draft.files.map(file => file.name).join(", ")], ["Completed people", String(reviewRecords(run).filter(record => run.workflowId === "i9-check" || reviewCanApprove(record)).length)]];
  const record = reviewRecords(run)[0];
  const edited: Readonly<Record<string, string>> = run.role === "person" ? { "Employee": reviewName(record), "Employee ID": reviewValue(record, "employeeId"), "UCPath ID": reviewValue(record, "employeeId"), "Contact": reviewValue(record, "contactName"), "Relationship": reviewValue(record, "relationship"), "Contact phone": reviewValue(record, "cellPhone"), "Source page": String(record.page) } : {};
  const fields = mockWorkflow(run.workflowId).result.map(([label, value]) => [label, edited[label] || (label === "Kuali ID" || label === "Email" || (label === "Employee ID" && /^\d{5,}$/u.test(run.subject)) ? run.subject : label === "PDF" ? run.draft.files.map(file => file.name).join(", ") : label === "Signers" ? String(reviewRecords(run).filter(reviewCanApprove).length) : label === "Effective date" && run.workflowId === "work-study" ? usDate(run.draft.effectiveDate) : value)] as const);
  if (run.workflowId === "old-kronos-reports") fields.push(["Report start", usDate(run.draft.startDate)], ["Report end", usDate(run.draft.endDate)]);
  if (run.workflowId === "onbase") fields.push(["Combined PDFs", String(run.draft.files.length)]);
  return fields.filter(([label]) => !(run.draft.dryRun && ["HR ticket", "Signature date"].includes(label)) && !(label === "HR ticket" && !run.draft.selectedSteps.includes("submit")) && !(label === "Signature date" && !run.draft.selectedSteps.includes("transaction")) && !(run.workflowId === "oath-upload" && run.draft.uploadMode === "upload-only" && label === "Signers"));
}
export function mockRunLog(run: MockRun): { steps: readonly LogStep[]; timeline: readonly LogTimelineStage[] } {
  const pipeline = mockRunPipeline(run);
  const timeline = pipeline.map((step, index) => ({ id: `${run.id}:${step.key}`, label: step.label, state: mockStepState(run, step), time: `09:${String(index + 10).padStart(2, "0")}:00`, stepId: `${run.id}:${step.key}`, substeps: [] }));
  const steps: LogStep[] = pipeline.map((step, index) => ({ id: timeline[index].id, time: timeline[index].time, title: step.label, ...(step.system ? { system: step.system } : {}), entries: [{ kind: "note", id: `${run.id}:${step.key}:note`, time: timeline[index].time, message: timeline[index].state === "cancelled" ? "Preparation discarded. No downstream work was started." : timeline[index].state === "skipped" ? run.draft.dryRun && step.write ? "Dry run: submission skipped." : "Step omitted for this input or selected mode." : timeline[index].state === "pending" ? "Waiting for extracted records to be approved." : step.message }, ...mockDetailEntries(run, step, timeline[index].state, timeline[index].time)] }));
  const resultTitle = mockNeedsReview(run) ? "Extracted records" : "Result";
  steps.push({ id: `${run.id}:result`, time: "09:30:00", title: resultTitle, entries: [{ kind: "fields", id: `${run.id}:fields`, fields: resultFields(run).map(([label, value], index) => ({ id: `${run.id}:field:${index}`, time: "09:30:00", kind: "read", label, value })) }] });
  timeline.push({ id: `${run.id}:result`, label: resultTitle, state: run.discarded ? "cancelled" : "completed", time: "09:30:00", stepId: `${run.id}:result`, substeps: [] });
  return { steps, timeline };
}

export function mockOathDuplicate(runs: readonly MockRun[], draft: MockDraft): string | undefined {
  const digests = new Set<string>();
  for (const file of draft.files) {
    if (digests.has(file.digest)) return `${file.name} is attached more than once.`;
    digests.add(file.digest);
    if (runs.some(run => run.workflowId === "oath-upload" && !run.seeded && !run.discarded && !run.draft.dryRun && run.draft.selectedSteps.includes("submit") && !mockNeedsReview(run) && run.draft.files.some(prior => prior.digest === file.digest))) return `${file.name} was already filed in this preview.`;
  }
  return undefined;
}

export function mockQueueView(runs: readonly MockRun[], filters: readonly StatusBucket[], sort: QueueSortKey): readonly MockRun[] {
  const visible = runs.filter(run => filters.length === 0 || filters.includes("all") || filters.includes(mockQueueStatus(run)) || (mockNeedsReview(run) && filters.includes("needsYou")));
  if (sort === "oldest") return [...visible].reverse();
  if (sort === "longest") return [...visible].sort((left, right) => mockPipeline(right.workflowId, right.draft).length - mockPipeline(left.workflowId, left.draft).length);
  if (sort === "attention") return [...visible].sort((left, right) => Number(mockNeedsReview(right)) - Number(mockNeedsReview(left)));
  return visible;
}
export function mockQueueCounts(runs: readonly MockRun[]): readonly StatusCountWire[] {
  return (["awaiting-approval", "done", "cancelled"] as const).map(status => ({ status, count: runs.filter(run => mockQueueStatus(run) === status).length }));
}

export function mockConfirmationFacts(id: MockWorkflowId, draft: MockDraft): readonly { key: string; value: string }[] {
  const flow = mockWorkflow(id);
  const pdf = draft.method === "pdf";
  const uploadOnly = id === "oath-upload" && draft.uploadMode === "upload-only";
  const count = draft.method === "typed" ? mockInputEntries(id, draft).length : draft.method === "roster" ? 1 : id === "onbase" ? Number(draft.files.length > 0) : draft.files.length;
  return [
    { key: "Workflow", value: flow.label },
    { key: "Input", value: draft.method === "typed" ? draft.text : draft.method === "roster" ? "Onboarding Roster" : draft.files.map(file => file.name).join(", ") },
    { key: "Starts", value: `${count} ${pdf && !uploadOnly ? "preparation" : "run"}${count === 1 ? "" : "s"}` },
    { key: "Priority", value: draft.priority }, { key: "Browser", value: draft.browser === "headed" ? "Visible" : "Headless" },
    { key: "Captures", value: draft.captures ? "On" : "Off" },
    ...(flow.dryRun ? [{ key: "Dry run", value: draft.dryRun ? "On" : "Off" }] : []),
    ...(id === "onboarding" ? [{ key: "Hire type", value: draft.hireType === "rehire" ? "Rehire · UC_CONC_HIRE" : "New hire · UC_FULL_HIRE" }] : []),
    ...(id === "person-lookup" ? [{ key: "Lookup mode", value: draft.lookupMode }, { key: "CRM check", value: draft.crmCheck ? "On" : "Off" }] : []),
    ...(id === "oath-upload" ? [{ key: "Processing mode", value: uploadOnly ? "Upload-only" : "Full process" }] : []),
    ...(id === "ocr" ? [{ key: "Form type", value: draft.formType }] : []),
    ...(pdf && flow.roster && !uploadOnly ? [{ key: "Roster", value: draft.roster === "download" ? "Download Onboarding Roster" : "Existing Onboarding Roster" }] : []),
    ...((pdf && !uploadOnly) || draft.method === "typed" ? [{ key: "Workers", value: String(draft.workers) }] : []),
    ...(id === "work-study" ? [{ key: "Effective date", value: usDate(draft.effectiveDate) }] : []),
    ...(id === "old-kronos-reports" ? [{ key: "Report dates", value: `${usDate(draft.startDate)} – ${usDate(draft.endDate)}` }] : []),
  ];
}
