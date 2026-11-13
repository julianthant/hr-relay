import type { TypedInputDraft } from "../../../../models/workflow/ingress.js";
import { typedInputDefaults, changeTypedInput } from "../../run-start/run-start-model.js";
import type { QueueBusinessOutcome } from "../../shared/status/status-model.js";
import { manualFact, mockStepInputError, usesManualRead } from "./workflow-manual-model.js";
import { displayExtractedDate } from "../../../lib/date-format.js";
import { MOCK_WORKFLOWS, MOCK_ONBASE_TYPES, mockOnbaseDocumentType, mockWorkflow, type MockMethod, type MockStep, type MockWorkflowId } from "./workflow-mock-catalog.js";
import type { LogEntry, LogStep } from "../../run-detail/logs/log-feed-model.js";
import { WorkflowCountWireSchema } from "../../../../models/dashboard/projection.js";
import type { LogTimelineStage, LogTimelineState } from "../../run-detail/logs/log-timeline-model.js";

import type { StatusBucket, StatusCountWire, WorkflowCountWire } from "../../shell/shell-model.js";
import type { QueueSortKey } from "../../queue/queue-model.js";
import { reviewCanApprove, reviewName, reviewRecords, reviewValue, seedReviewRecords, mockInputRecord, type ReviewRecord } from "./workflow-review-model.js";
import { mockDetailEntries } from "./workflow-result-model.js";
import { mockOperationEntries, mockOperationSubsteps, mockOperationDuration, mockOperationValue } from "./workflow-operation-model.js";
import { OCR_DOCUMENT_FIXTURES, mockDocumentFixture } from "./workflow-document-model.js";

export type MockFile = Readonly<{ name: string; size: number; digest: string }>;
export type MockDraft = Readonly<{
  method: MockMethod; text: string; files: readonly MockFile[]; lookupMode: "search" | "match";
  typedValues?: TypedInputDraft;
  crmCheck: boolean; hireType: "new-hire" | "rehire"; uploadMode: "full" | "upload-only";
  formType: string; documentType: string;
  effectiveDate: string; startDate: string; endDate: string;
  dryRun: boolean; priority: "interactive" | "background"; browser: "headed" | "headless";
  selectedSteps: readonly string[];
  /** Scenario fixtures: a host whose OCR page read failed, or whose first approved person failed. */
  fault?: "page" | "member"; ocrMode?: "extract" | "manual"; manualSteps?: readonly string[]; manualValues?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}>;
export type MockRun = Readonly<{
  businessOutcome?: QueueBusinessOutcome;
  id: string; workflowId: MockWorkflowId; title: string; subject: string; draft: MockDraft;
  sourceId?: string; parentId?: string; parentWorkflowId?: MockWorkflowId; approved: boolean; seeded: boolean;
  role?: "preparation" | "person"; records?: readonly ReviewRecord[]; inputRecord?: ReviewRecord;
  ocrRunId?: string; targetWorkflowId?: MockWorkflowId; approvedCount?: number; discarded?: boolean;
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
    hireType: "new-hire", uploadMode: "full", formType: id === "i9-check-start" ? "i9" : id === "onbase" ? "onbase-emergency-contact" : id === "emergency-contact" ? "emergency-contact" : "oath",
    documentType: "Emergency Contact", effectiveDate: "2026-08-03", startDate: "2017-01-01", endDate: "2026-01-31",
    // Dry run is an explicit operator choice; every launch starts with it off.
    dryRun: false, priority: "interactive", browser: "headed",
    ocrMode: "extract", manualSteps: [], manualValues: {}, selectedSteps: flow.steps.map(step => step.key) };
}

export function mockTypedInputValues(id: string, draft: MockDraft): TypedInputDraft {
  const declaration = mockWorkflow(id).typedInput;
  return draft.typedValues ?? (declaration === undefined ? {} : { ...typedInputDefaults(declaration), mode: draft.lookupMode, crmCheck: draft.crmCheck });
}

export function changeMockTypedInput(id: string, draft: MockDraft, field: string, value: string | boolean): Partial<MockDraft> {
  const declaration = mockWorkflow(id).typedInput;
  if (declaration === undefined) throw new Error("Mock workflow has no declared typed inputs");
  const next = changeTypedInput(declaration, mockTypedInputValues(id, draft), field, value);
  return { typedValues: next, ...(next.mode === "search" || next.mode === "match" ? { lookupMode: next.mode } : {}), crmCheck: next.crmCheck === true };
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
export function mockDraftInputError(id: string, draft: MockDraft): string | undefined {
  const flow = mockWorkflow(id);
  if (!flow.runnable) return `${flow.label} is started by its parent workflow and cannot start independently.`;
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
  if (id === "old-kronos-reports" && (!validDate(draft.startDate) || !validDate(draft.endDate) || draft.startDate > draft.endDate)) return "Choose a valid report date range; start must precede end.";
  if (id === "onbase" && !MOCK_ONBASE_TYPES.some(type => type.value === draft.documentType)) return "Choose a supported document type.";
  return undefined;
}

export function mockDraftError(id: string, draft: MockDraft): string | undefined {
  return mockDraftInputError(id, draft) ?? (draft.manualSteps?.length && mockInputEntries(id, draft).length > 1 ? "Manual reading values apply to one person. Start one run at a time." : undefined) ?? mockStepInputError(mockWorkflow(id).id, draft);
}

export function mockOcrReadSteps(id: string, draft: MockDraft): readonly MockStep[] {
  if (draft.method !== "pdf" && !mockDocumentFixture(draft) || id === "oath-upload" && draft.uploadMode === "upload-only") return [];
  const type = id === "emergency-contact" ? "emergency-contact" : id === "i9-check-start" ? "i9" : id === "onbase" ? mockOnbaseDocumentType(draft.documentType).formType : draft.formType;
  const label = type === "emergency-contact" || type === "onbase-emergency-contact" ? "Read emergency contact" : type === "i9" ? draft.documentType.startsWith("I-9 Section ") ? `Read ${draft.documentType}` : "Read I-9 forms" : type === "verify" ? "Read onboarding forms" : type === "separation" ? "Read separation form" : "Read oath";
  const gate = { key: "read-document", label, system: "OCR", message: draft.ocrMode === "manual" ? "Enter the predefined document fields manually in OCR Records." : "Read the predefined document fields into OCR Records; downstream work waits for approval." };
  if (id !== "ocr") return [
    { key: "prep:ocr", label, system: "OCR", message: "Read the predefined document fields into OCR Records." },
    { key: "prep:person-lookup", label: "Match extracted people", system: "UCPath", message: "Resolve extracted identities against UCPath and the roster." },
    { ...gate, label: "Review extracted records", system: undefined, message: "Release the reviewed records; downstream work waits for the release." }];
  return [gate];
}
export function mockPipeline(id: string, draft: MockDraft): readonly MockStep[] {
  const flow = mockWorkflow(id);
  if (id === "ocr") return [...prep.map(step => ({ ...step,
    ...(step.key === "prep:awaiting-approval" && draft.ocrMode === "manual" ? { label: "Review records", message: "Enter the records manually and approve them before starting downstream work." } : {}),
    ...(step.key === "prep:loading-roster" && draft.formType === "i9" ? { message: "Load configured Action History for I-9 identity matching." } : {}),
    ...(step.key === "prep:ocr" ? { label: mockOcrReadSteps(id, draft)[0].label, system: "OCR" } : {}),
    ...(step.key === "prep:ocr" && draft.formType === "i9" ? { message: draft.documentType.startsWith("I-9 Section ") ? `Extract ${draft.documentType} identities and source pages.` : "Pair Section 1 and Section 2 identities and source pages." } : {}),
    ...(step.key === "prep:person-lookup" && draft.formType === "verify" ? { message: "Resolve identity and read CRM service/oath dates and I-9 signer evidence." } : {}),
  }))];
  const steps = flow.steps.filter(step => !(id === "oath-upload" && (step.key === "wait-approval" || draft.uploadMode === "upload-only" && step.key === "wait-signatures")));
  return [...mockOcrReadSteps(id, draft), ...steps];
}
/** The run whose records the operator reviews in `run`'s Logs: a host's hidden OCR child, else the run itself. */
export function mockReviewRun(run: MockRun, runs: readonly MockRun[]): MockRun {
  return run.ocrRunId === undefined ? run : runs.find(item => item.id === run.ocrRunId) ?? run;
}
export function mockNeedsReview(run: MockRun): boolean {
  return run.workflowId === "ocr" && !!run.targetWorkflowId && !!run.parentId && !run.approved && !run.discarded && run.draft.fault !== "page";
}
export function mockWaitsForOcr(run: MockRun): boolean {
  return run.workflowId !== "ocr" && !!run.ocrRunId && !run.approved && !run.discarded && run.draft.fault !== "page";
}
export function mockQueueStatus(run: MockRun): "cancelled" | "awaiting-approval" | "running" | "done" | "failed" {
  return run.discarded ? "cancelled" : mockFailedStepKey(run) !== undefined ? "failed" : mockNeedsReview(run) ? "awaiting-approval" : mockWaitsForOcr(run) ? "running" : "done";
}
export function mockRunStatus(run: MockRun): string {
  if (run.discarded) return "Discarded";
  if (mockFailedStepKey(run) !== undefined) return "Failed";
  if (mockNeedsReview(run)) return "Needs review";
  if (mockWaitsForOcr(run)) return "Waiting for OCR";
  return run.draft.dryRun && mockWorkflow(run.workflowId).dryRun ? "Dry run complete" : "Completed";
}
/** The step a scenario fixture fails: the host's OCR page read, or a person run's last step. */
export function mockFailedStepKey(run: MockRun): string | undefined {
  if (run.discarded || run.draft.fault === undefined) return undefined;
  if (run.draft.fault === "page") return run.ocrRunId !== undefined && run.role !== "person" ? "prep:ocr" : undefined;
  return run.role === "person" ? mockRunPipeline(run).at(-1)?.key : undefined;
}
export function mockStepState(run: MockRun, step: MockStep): LogTimelineState {
  const draft = run.draft;
  if (run.discarded) return "cancelled";
  const failedKey = mockFailedStepKey(run);
  if (failedKey !== undefined) {
    const keys = mockRunPipeline(run).map(item => item.key), at = keys.indexOf(step.key), failed = keys.indexOf(failedKey);
    return at < failed ? "completed" : at === failed ? "failed" : "pending";
  }
  if (draft.ocrMode === "manual" && ["prep:ocr", "prep:person-lookup"].includes(step.key) && run.workflowId !== "ocr") return "skipped";
  if (step.key === "read-document") {
    if (draft.ocrMode === "manual" && run.workflowId === "ocr") return "skipped";
    if (run.workflowId === "ocr") return mockStepState(run, { ...step, key: "prep:ocr" });
    return mockWaitsForOcr(run) ? "waiting" : "completed";
  }
  if (run.workflowId === "ocr" && draft.ocrMode === "manual" && step.key !== "prep:awaiting-approval") return "skipped";
  if (run.workflowId === "person-lookup" && ((step.key === "cross-verification" && (!draft.crmCheck || /^\d{5,}$/u.test(run.subject))) || (step.key === "active-status" && draft.lookupMode === "match") || step.key === "crm-dates")) return "skipped";
  if (run.workflowId === "onboarding" && step.key === "i9-creation" && draft.hireType === "rehire") return "skipped";
  if (!mockNeedsReview(run) && !mockWaitsForOcr(run) && !prep.some(item => item.key === step.key) && !draft.selectedSteps.includes(step.key) && !["members", "rollup"].includes(step.key)) return "skipped";
  if (mockNeedsReview(run) || mockWaitsForOcr(run)) {
    const pipeline = mockRunPipeline(run);
    const gate = run.workflowId === "ocr" ? "prep:awaiting-approval" : "read-document";
    const reviewIndex = pipeline.findIndex(item => item.key === gate);
    const position = pipeline.findIndex(item => item.key === step.key);
    if (position < 0) return "pending";
    if (position === reviewIndex) return "waiting";
    if (position > reviewIndex) return "pending";
  }
  if (draft.dryRun && step.write) return "skipped";
  return "completed";
}
export function mockRunPipeline(run: MockRun): readonly MockStep[] {
  if (run.role === "person") return mockWorkflow(run.workflowId).steps.filter(step => step.key !== "wait-approval");
  if (run.ocrRunId && run.workflowId !== "oath-upload") return [
    ...mockOcrReadSteps(run.workflowId, run.draft),
    { key: "members", label: "Start approved people", message: "Start one independent run per approved record." },
    { key: "rollup", label: "Collect person outcomes", message: "Collect the linked person outcomes." },
  ];
  return mockPipeline(run.workflowId, run.draft).map(step => run.workflowId === "ocr" && !run.parentId && step.key === "prep:awaiting-approval" ? { ...step, label: "Review records", message: "Inspect or enter the document records. This standalone run has no downstream approval." } : step);
}
function delegateMockOcr(run: MockRun): readonly MockRun[] {
  if (run.draft.method !== "pdf" && !mockDocumentFixture(run.draft) || run.workflowId === "ocr" || run.workflowId === "oath-upload" && run.draft.uploadMode === "upload-only") return [run];
  const id = `${run.id}:ocr`;
  const document = mockDocumentFixture(run.draft);
  const ocr: MockRun = { id, workflowId: "ocr", subject: document?.name ?? run.subject, title: document?.name ?? run.subject, draft: run.draft,
    parentId: run.id, parentWorkflowId: run.workflowId, targetWorkflowId: run.workflowId, role: "preparation",
    records: seedReviewRecords({ workflowId: "ocr", draft: run.draft }), approved: false, seeded: run.seeded };
  return [{ ...run, role: "preparation", ocrRunId: id }, ocr];
}
/** Clears a scenario fault, as the operator's Retry does. */
export function retryMockFault(runs: readonly MockRun[], ids: readonly string[]): readonly MockRun[] {
  return runs.map(run => ids.includes(run.id) ? { ...run, draft: { ...run.draft, fault: undefined } } : run);
}
export function mockRunsForDraft(id: MockWorkflowId, draft: MockDraft, sequence: number, sourceId?: string): readonly MockRun[] {
  const error = mockDraftError(id, draft);
  if (error) throw new Error(error);
  if (id === "onbase" || id === "emergency-contact" || id === "i9-check-start") draft = { ...draft, formType: id === "onbase" ? mockOnbaseDocumentType(draft.documentType).formType : id === "i9-check-start" ? "i9" : "emergency-contact" };
  const subjects = draft.method === "typed" ? mockInputEntries(id, draft) : draft.method === "roster" ? ["Onboarding Roster"] : id === "onbase" ? [draft.files.map(file => file.name).join(" + ")] : draft.files.map(file => file.name);
  const created: readonly MockRun[] = subjects.map((subject, index) => ({ id: `mock:${id}:${sequence}:${index}`, workflowId: id, subject,
    title: subject, draft: structuredClone({ ...draft, ...(draft.method === "typed" ? { text: subject } : id === "onbase" ? {} : { files: [draft.files[index]] }) }),
    ...(sourceId ? { sourceId } : {}), approved: false, seeded: false }));
  return created.flatMap(delegateMockOcr);
}
export function seedMockRuns(): readonly MockRun[] {
  const runs = MOCK_WORKFLOWS.filter(flow => flow.id !== "ocr").flatMap(flow => {
    const pdf = flow.methods[0] === "pdf" || flow.id === "oath-signature";
    const document = OCR_DOCUMENT_FIXTURES.find(item => item.parent === flow.id);
    const draft: MockDraft = { ...initialMockDraft(flow.id), method: pdf ? "pdf" : flow.methods[0], text: document?.formType === "separation" ? reviewValue(document.records[0], "kualiId") : flow.example,
      ...(document ? { formType: document.formType } : {}),
      files: document ? [{ name: document.name, size: 4096, digest: `fixture:document:${document.name}` }] : pdf ? [{ name: flow.example.endsWith(".pdf") ? flow.example : "oaths.pdf", size: 4096, digest: `fixture:${flow.id}` }] : [] };
    const subject = pdf ? draft.files.map(file => file.name).join(" + ") : draft.text;
    const parent: MockRun = { id: `mock:${flow.id}:sample`, workflowId: flow.id, subject, title: subject, draft, approved: false, seeded: true };
    if (flow.sampleOutcomes) return flow.sampleOutcomes.map(({ lookupMode, ...businessOutcome }, index) => {
      const subject = index === 0 ? parent.subject : `Sample lookup ${index + 1}`;
      return { ...parent, id: index === 0 ? parent.id : `${parent.id}:${index}`, subject, title: subject, businessOutcome,
        draft: { ...parent.draft, lookupMode } };
    });
    return delegateMockOcr(parent);
  });
  return runs.map(run => run.workflowId === "i9-lookup" ? { ...run, parentId: "mock:onbase:sample", parentWorkflowId: "onbase" } : run);
}

export function mockRunSubset(runs: readonly MockRun[], include: (run: MockRun) => boolean): readonly MockRun[] {
  const all = new Map(runs.map(run => [run.id, run]));
  const selected = runs.filter(include), ids = new Set(selected.map(run => run.id));
  return selected.map(run => {
    let parentId = run.parentId;
    const visited = new Set([run.id]);
    while (parentId !== undefined && !ids.has(parentId)) {
      if (visited.has(parentId)) throw new Error("MOCK_QUEUE_PARENT_CYCLE");
      visited.add(parentId);
      const parent = all.get(parentId);
      if (parent === undefined) throw new Error("MOCK_QUEUE_PARENT_UNAVAILABLE");
      parentId = parent.parentId;
    }
    const parent = parentId === undefined ? undefined : all.get(parentId);
    if (parentId === run.parentId && (run.ocrRunId === undefined || ids.has(run.ocrRunId))) return run;
    return { ...run, parentId, parentWorkflowId: parent?.workflowId,
      ocrRunId: run.ocrRunId !== undefined && ids.has(run.ocrRunId) ? run.ocrRunId : undefined };
  });
}
export function mockRetrySource(runs: readonly MockRun[], id: string): MockRun {
  let source = runs.find(run => run.id === id);
  const visited = new Set<string>();
  while (source && (!mockWorkflow(source.workflowId).runnable || source.workflowId === "ocr" && source.parentId !== undefined)) {
    if (visited.has(source.id)) throw new Error("MOCK_RETRY_PARENT_CYCLE");
    visited.add(source.id);
    source = runs.find(run => run.id === source!.parentId);
  }
  if (!source) throw new Error("MOCK_RETRY_SOURCE_MISSING");
  return source;
}
export function mockDeletionIds(runs: readonly MockRun[], id: string): readonly string[] {
  const target = runs.find(run => run.id === id);
  if (!target) throw new Error("MOCK_DELETE_TARGET_MISSING");
  const root = target.workflowId === "ocr" && target.parentId ? runs.find(run => run.id === target.parentId) : target;
  if (!root) throw new Error("MOCK_DELETE_PARENT_MISSING");
  const removed = new Set([root.id]);
  for (let previous = -1; previous !== removed.size;) {
    previous = removed.size;
    for (const run of runs) if (run.parentId && removed.has(run.parentId)) removed.add(run.id);
  }
  return [...removed];
}
export function mockDeletionCopy(linked: number): string {
  if (!Number.isSafeInteger(linked) || linked < 0) throw new Error("MOCK_DELETE_LINK_COUNT_INVALID");
  return linked === 0 ? "Remove this run from the queue." : `Remove this run and ${linked} linked ${linked === 1 ? "run" : "runs"} from the queue.`;
}
export function mockApprovalError(run: MockRun): string | undefined {
  if (!run.targetWorkflowId || run.targetWorkflowId === "oath-upload" || !run.draft.manualSteps?.length) return undefined;
  const records = reviewRecords(run).filter(reviewCanApprove);
  if (records.length > 1) return "Manual reading values apply to one person. Include one record or rerun people separately.";
  const employeeId = manualFact(run.targetWorkflowId, run.draft, "Employee ID", "$employeeId");
  if (employeeId && records.some(record => reviewValue(record, "employeeId") !== employeeId)) return "Manual Employee ID differs from the reviewed record. Correct the record or reading values before approval.";
  return undefined;
}
export function approveMockRun(runs: readonly MockRun[], id: string): readonly MockRun[] {
  const source = runs.find(run => run.id === id);
  if (!source || !mockNeedsReview(source) || !source.targetWorkflowId) throw new Error("MOCK_APPROVAL_UNAVAILABLE");
  const parent = runs.find(run => run.id === source.parentId);
  if (!parent || parent.ocrRunId !== id || parent.workflowId !== source.targetWorkflowId) throw new Error("MOCK_APPROVAL_PARENT_MISSING");
  const records = reviewRecords(source).filter(reviewCanApprove);
  if (!records.length) throw new Error("MOCK_APPROVAL_NO_RECORDS");
  const error = mockApprovalError(source);
  if (error) throw new Error(error);
  const children: MockRun[] = records.map((record, index) => {
    const target = record.targetWorkflowId ?? (parent.workflowId === "oath-upload" ? "oath-signature" : parent.workflowId);
    const sameTarget = target === parent.workflowId;
    const draft = { ...initialMockDraft(target), ...source.draft, fault: source.draft.fault === "member" && index === 0 ? "member" as const : undefined, text: reviewValue(record, record.kind === "separation" ? "kualiId" : "employeeId"),
      selectedSteps: sameTarget ? source.draft.selectedSteps : mockWorkflow(target).steps.map(step => step.key),
      manualSteps: sameTarget ? source.draft.manualSteps : [], manualValues: sameTarget ? source.draft.manualValues : {} };
    return { id: `${parent.id}:person:${index}`, workflowId: target, parentId: parent.id, parentWorkflowId: parent.workflowId,
      ocrRunId: source.id, subject: reviewName(record), title: reviewName(record), draft,
      inputRecord: structuredClone(record), role: "person", approved: true, seeded: source.seeded };
  });
  return [...children, ...runs.map(run => run.id === id || run.id === parent.id ? { ...run, approved: true, approvedCount: records.length } : run)];
}
function resultFields(run: MockRun): readonly (readonly [string, string])[] {
  if (run.discarded) return [["Outcome", "Preparation discarded; no downstream work started"]];
  if (mockNeedsReview(run)) return [["Source PDF", run.draft.files.map(file => file.name).join(", ")], ["Records ready", String(reviewRecords(run).filter(reviewCanApprove).length)]];
  if (mockWaitsForOcr(run)) return [["Source PDF", run.draft.files.map(file => file.name).join(", ")], ["Status", "Waiting for OCR approval"]];
  if (run.workflowId === "ocr") return [["Records", String(reviewRecords(run).length)], ...reviewRecords(run).flatMap(record => record.fields.filter(field => field.value).map(field => [field.label, field.kind === "boolean" ? field.value === "true" ? "Yes" : "No" : field.value] as const))];
  if (run.role === "preparation" && run.workflowId !== "oath-upload") return [["Source PDF", run.draft.files.map(file => file.name).join(", ")], ["Completed people", String(run.approvedCount ?? 0)]];
  const record = mockInputRecord(run);
  const edited: Readonly<Record<string, string>> = run.role === "person" ? { "Employee": reviewName(record), "Employee ID": reviewValue(record, "employeeId"), "UCPath ID": reviewValue(record, "employeeId"), "Contact": reviewValue(record, "contactName"), "Relationship": reviewValue(record, "relationship"), "Contact phone": reviewValue(record, "cellPhone"), "Source page": String(record.page) } : {};
  const fields = mockWorkflow(run.workflowId).result.map(([label, value]) => [label, manualFact(run.workflowId, run.draft, label) ?? (edited[label] || (label === "Document type" && run.workflowId === "onbase" ? run.draft.documentType : label === "Employee ID" ? mockOperationValue(run, "$employeeId") : label === "Kuali ID" || label === "Email" ? run.subject : label === "PDF" ? run.draft.files.map(file => file.name).join(", ") : label === "Signers" ? String(run.approvedCount ?? 0) : value))] as const);
  if (run.workflowId === "i9-check-start" && run.role === "person") fields.push(["Hire date", "08/03/2026"], ["Separation date", "Not separated"], ["Retention tracker", "Appended"]);
  if (run.workflowId === "old-kronos-reports") fields.push(["Report start", displayExtractedDate(run.draft.startDate)], ["Report end", displayExtractedDate(run.draft.endDate)]);
  if (run.workflowId === "onbase") fields.push(["Combined PDFs", String(run.draft.files.length)]);
  return fields.filter(([label]) => !(run.draft.dryRun && ["HR ticket", "Signature date"].includes(label)) && !(label === "HR ticket" && !run.draft.selectedSteps.includes("submit")) && !(label === "Signature date" && !run.draft.selectedSteps.includes("transaction")) && !(run.workflowId === "oath-upload" && run.draft.uploadMode === "upload-only" && label === "Signers"));
}
export function mockRunLog(run: MockRun): { steps: readonly LogStep[]; timeline: readonly LogTimelineStage[]; endTime: string; durationSeconds: number } {
  const pipeline = mockRunPipeline(run);
  let elapsed = 0;
  const clock = (seconds: number) => new Date(Date.UTC(2026, 7, 3, 9, 10, seconds)).toISOString().slice(11, 19);
  const timeline: LogTimelineStage[] = pipeline.map(step => {
    const state = mockStepState(run, step), substeps = mockOperationSubsteps(run, step, state);
    const seconds = substeps.reduce((total, item, position) => total + (item.state === "completed" ? mockOperationDuration(position) : 0), 0);
    const time = clock(elapsed); elapsed += seconds;
    return { id: `${run.id}:${step.key}`, label: step.label, state, time, stepId: `${run.id}:${step.key}`, substeps,
      ...(seconds > 0 ? { durationLabel: seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s` } : {}) };
  });
  const steps: LogStep[] = pipeline.map((step, index) => {
    const stage = timeline[index], time = stage.time!, operations = mockOperationEntries(run, step, stage.state, time);
    const shown = new Set(operations.flatMap(entry => entry.kind === "fields" ? entry.fields.map(field => field.label.toLowerCase()) : []));
    const details = mockDetailEntries(run, step, stage.state, time).flatMap<LogEntry>(entry => entry.kind === "fields" ? [{ ...entry, fields: entry.fields.filter(field => !shown.has(field.label.toLowerCase())) }].filter(entry => entry.fields.length) : [entry]);
    return { id: stage.id, time, title: step.label, ...(step.system ? { system: step.system } : {}), entries: [...(operations.length && stage.state === "completed" ? [] : [{ kind: "note" as const, id: `${run.id}:${step.key}:note`, time, message: usesManualRead(run.draft, step.key) ? "Automatic reading replaced with operator-entered values." : stage.state === "cancelled" ? "Preparation discarded. No downstream work was started." : stage.state === "skipped" ? run.draft.dryRun && step.write ? "Dry run: submission skipped." : "Step omitted for this input or selected mode." : stage.state === "pending" ? "Waiting for extracted records to be approved." : step.message }]), ...operations, ...details] };
  });
  if (!mockNeedsReview(run) && !mockWaitsForOcr(run) && steps.length > 0) {
    const last = steps[steps.length - 1];
    steps[steps.length - 1] = { ...last, entries: [...last.entries, { kind: "fields", id: `${run.id}:fields`, fields: resultFields(run).map(([label, value], index) => ({ id: `${run.id}:field:${index}`, time: clock(elapsed), kind: "read", label, value })) }] };
  }
  return { steps, timeline, endTime: clock(elapsed), durationSeconds: elapsed };
}

export function mockOathDuplicate(runs: readonly MockRun[], draft: MockDraft): string | undefined {
  const digests = new Set<string>();
  for (const file of draft.files) {
    if (digests.has(file.digest)) return `${file.name} is attached more than once.`;
    digests.add(file.digest);
    if (runs.some(run => run.workflowId === "oath-upload" && !run.seeded && !run.discarded && !run.draft.dryRun && run.draft.selectedSteps.includes("submit") && !mockNeedsReview(run) && !mockWaitsForOcr(run) && run.draft.files.some(prior => prior.digest === file.digest))) return `${file.name} was already filed in this preview.`;
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
  return (["awaiting-approval", "running", "done", "cancelled"] as const).map(status => ({ status, count: runs.filter(run => mockQueueStatus(run) === status).length }));
}

export function mockWorkflowCounts(runs: readonly MockRun[]): readonly WorkflowCountWire[] {
  return MOCK_WORKFLOWS.filter(flow => flow.id !== "ocr").map(flow => {
    const rows = runs.filter(run => run.workflowId === flow.id);
    return WorkflowCountWireSchema.parse({ workflowId: flow.id, count: rows.length, statusCounts: mockQueueCounts(rows) });
  });
}

export function mockLaunchCount(id: MockWorkflowId, draft: MockDraft): number {
  return draft.method === "typed" ? mockInputEntries(id, draft).length : draft.method === "roster" ? 1 : id === "onbase" ? Number(draft.files.length > 0) : draft.files.length;
}

export function mockSelectableSteps(id: MockWorkflowId, draft: MockDraft): readonly MockStep[] {
  const keys = new Set(mockWorkflow(id).steps.map(step => step.key));
  return mockPipeline(id, draft).filter(step => keys.has(step.key));
}

export function mockConfirmationFacts(id: MockWorkflowId, draft: MockDraft): readonly { key: string; value: string }[] {
  const flow = mockWorkflow(id), pdf = draft.method === "pdf";
  const uploadOnly = id === "oath-upload" && draft.uploadMode === "upload-only";
  const steps = mockSelectableSteps(id, draft), omitted = steps.filter(step => !draft.selectedSteps.includes(step.key));
  const reading = mockOcrReadSteps(id, draft).length;
  const includedReading = draft.ocrMode === "manual" ? Math.min(reading, 1) : reading;
  return [
    { key: "Workflow", value: flow.label },
    { key: "Input", value: draft.method === "typed" ? draft.text : draft.method === "roster" ? "Onboarding Roster" : draft.files.map(file => file.name).join(", ") },
    { key: "Steps", value: `${steps.length + includedReading - omitted.length} / ${steps.length + reading} included${omitted.length ? ` · Omitted: ${omitted.map(step => step.label).join(", ")}` : ""}` },
    ...(draft.manualSteps?.length ? [{ key: "Manual reading", value: steps.filter(step => usesManualRead(draft, step.key)).map(step => step.label).join(", ") }] : []),
    ...(pdf && !uploadOnly ? [{ key: "OCR extraction", value: draft.ocrMode === "manual" ? "Off · enter records in review" : "On" }] : []),
    { key: "Queue", value: draft.priority === "interactive" ? "Interactive" : "Bulk" },
    { key: "Browser", value: `${draft.browser === "headed" ? "Headed" : "Headless"} · screenshots required` },
    ...(flow.dryRun ? [{ key: "Dry run", value: draft.dryRun ? "On" : "Off" }] : []),
    ...(id === "onboarding" ? [{ key: "Hire type", value: draft.hireType === "rehire" ? "Rehire · UC_CONC_HIRE" : "New hire · UC_FULL_HIRE" }] : []),
    ...(id === "person-lookup" ? [{ key: "Lookup mode", value: draft.lookupMode }, { key: "CRM check", value: draft.crmCheck ? "On" : "Off" }] : []),
    ...(id === "oath-upload" ? [{ key: "Processing mode", value: uploadOnly ? "Upload-only" : "Full process" }] : []),
    ...(id === "onbase" ? [{ key: "Document type", value: draft.documentType }] : []),
    ...(id === "old-kronos-reports" ? [{ key: "Report dates", value: `${displayExtractedDate(draft.startDate)} – ${displayExtractedDate(draft.endDate)}` }] : []),
  ];
}
