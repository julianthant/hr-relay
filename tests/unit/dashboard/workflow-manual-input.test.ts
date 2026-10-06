import { describe, expect, it } from "vitest";
import { approveMockRun, initialMockDraft, mockDraftError, mockApprovalError, mockRunLog, mockRunsForDraft, mockStepState, mockOcrPreparationSteps, mockConfirmationFacts } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import { reviewRecords, reviewCanApprove, editReviewRecord, seedReviewRecords, updateMockReview } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-review-model.js";
import { MOCK_WORKFLOWS, mockWorkflow } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.js";
import { editableMockDraft, manualReadFields, mockStepIsLocked, mockStepIsDependency } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-manual-model.js";
import { documentSourcePages } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-document-model.js";

describe("manual OCR and reading inputs", () => {
  it("removes Oath Notes and retains Emergency Contact Notes", () => {
    expect(seedReviewRecords({ workflowId: "oath-signature", draft: initialMockDraft("oath-signature") })[0].fields.some(field => field.key === "notes")).toBe(false);
    expect(seedReviewRecords({ workflowId: "emergency-contact", draft: initialMockDraft("emergency-contact") })[0].fields.some(field => field.key === "notes")).toBe(true);
  });
  it("delegates without extraction, seeds blank fields and requires explicit approval", () => {
    const draft = { ...initialMockDraft("oath-signature"), method: "pdf" as const, ocrMode: "manual" as const, dryRun: false, files: [{ name: "single-oath.pdf", size: 4096, digest: "fixture:document:single-oath.pdf" }] };
    let runs = mockRunsForDraft("oath-signature", draft, 1);
    const child = runs.find(run => run.workflowId === "ocr")!;
    expect(child.parentId).toBe(runs[0].id);
    expect(reviewRecords(child)).toHaveLength(1);
    let record = reviewRecords(child)[0];
    expect(record.match).toBe("unresolved");
    expect(record.fields.every(field => field.value === "" || field.value === "false")).toBe(true);
    expect(reviewCanApprove(record)).toBe(false);
    expect(() => approveMockRun(runs, child.id)).toThrow("MOCK_APPROVAL_NO_RECORDS");
    for (const key of ["prep:loading-roster", "prep:ocr", "prep:person-lookup"]) expect(mockStepState(child, { key, label: key, message: "" })).toBe("skipped");
    expect(mockStepState(child, { key: "prep:awaiting-approval", label: "Review", message: "" })).toBe("waiting");
    for (const [key, value] of [["employeeId", "10000022"], ["firstName", "Sam"], ["lastName", "Rivera"], ["dateSigned", "10/06/2026"], ["employeeSigned", "true"], ["officerSigned", "true"]]) record = editReviewRecord(record, key, value);
    expect(reviewCanApprove(record)).toBe(true);
    runs = updateMockReview(runs, child.id, [record]);
    const approved = approveMockRun(runs, child.id);
    const person = approved.find(run => run.role === "person")!;
    expect(person.inputRecord).toEqual(record);
    expect(person.draft.ocrMode).toBe("manual");
    expect(mockRunLog(person).steps.flatMap(step => step.entries).flatMap(entry => entry.kind === "fields" ? entry.fields : []).some(field => field.label === "Signature date" && field.value === "10/06/2026")).toBe(true);
    expect(runs.every(run => !run.approved)).toBe(true);
  });
  it("shows OCR delegation and approval before PDF contact work in either extraction mode", () => {
    for (const ocrMode of ["extract", "manual"] as const) {
      const draft = { ...initialMockDraft("emergency-contact"), ocrMode, files: [{ name: "contact.pdf", size: 100, digest: "synthetic" }] };
      expect(mockOcrPreparationSteps("emergency-contact", draft).map(step => step.key)).toEqual(["delegate-ocr", "wait-ocr"]);
      expect(mockConfirmationFacts("emergency-contact", draft).find(fact => fact.key === "Steps")?.value).toBe("5 / 5 included");
      const [parent, ocr] = mockRunsForDraft("emergency-contact", draft, 1);
      expect(parent.ocrRunId).toBe(ocr.id);
      expect(mockStepState(parent, { key: "wait-ocr", label: "Review", message: "" })).toBe("waiting");
      expect(mockStepState(parent, { key: "fill-form", label: "Fill", message: "" })).toBe("pending");
      expect(mockStepState(parent, { key: "save", label: "Save", message: "" })).toBe("pending");
      expect(draft.selectedSteps).not.toContain("delegate-ocr");
      expect(draft.selectedSteps).not.toContain("wait-ocr");
    }
    expect(mockOcrPreparationSteps("oath-upload", { ...initialMockDraft("oath-upload"), uploadMode: "upload-only" })).toEqual([]);
    expect(mockOcrPreparationSteps("onboarding", initialMockDraft("onboarding"))).toEqual([]);
  });
  it("refuses omitted form filling and submit steps", () => {
    const flow = mockWorkflow("emergency-contact");
    const draft = { ...initialMockDraft(flow.id), files: [{ name: "contact.pdf", size: 100, digest: "synthetic" }], selectedSteps: ["navigation", "save"] };
    expect(mockDraftError(flow.id, draft)).toMatch(/Fill emergency contact.*required/u);
    expect(() => mockRunsForDraft(flow.id, draft, 1)).toThrow(/required/u);
  });
  it("validates manual reading values, logs their provenance and passes the date to the form", () => {
    const draft = { ...initialMockDraft("oath-signature"), text: "10000022", dryRun: false, selectedSteps: ["ucpath-auth", "transaction"], manualSteps: ["crm-verify"], manualValues: { "crm-verify": { "crm-onboarding": "Record found", "process-stage": "Onboarding complete", "first-day-of-service": "10/06/2026", "signed-date": "10/06/2026" } } };
    expect(mockDraftError("oath-signature", { ...draft, manualValues: {} })).toMatch(/Enter crm onboarding/u);
    expect(mockDraftError("oath-signature", { ...draft, manualValues: { "crm-verify": { ...draft.manualValues["crm-verify"], "signed-date": "02/30/2026" } } })).toMatch(/valid date/u);
    expect(mockDraftError("oath-signature", draft)).toBeUndefined();
    const run = mockRunsForDraft("oath-signature", draft, 2)[0];
    const log = mockRunLog(run);
    const manual = log.steps.find(step => step.id.endsWith(":crm-verify"))!;
    expect(manual.entries.some(entry => entry.kind === "fields" && entry.title === "Operator-entered values")).toBe(true);
    expect(manual.entries.some(entry => entry.kind === "click" || entry.kind === "note" && entry.tone === "positive")).toBe(false);
    const fields = log.steps.flatMap(step => step.entries).flatMap(entry => entry.kind === "fields" ? entry.fields : []);
    expect(fields.filter(field => field.label === "Signature date").every(field => field.value === "10/06/2026")).toBe(true);
    expect(fields.filter(field => field.label === "Signature date").length).toBeGreaterThan(0);
    expect(mockRunsForDraft("oath-signature", run.draft, 3, run.id)[0].draft).toEqual(run.draft);
  });
  it("refuses applying one person's manual facts across a typed batch", () => {
    const draft = { ...initialMockDraft("oath-signature"), text: "10000001, 10000002", manualSteps: ["crm-verify"] };
    expect(mockDraftError("oath-signature", draft)).toMatch(/one person/u);
  });
  it("keeps blank multi-page sources viewable and records the operator's source page on approval", () => {
    const draft = { ...initialMockDraft("oath-signature"), method: "pdf" as const, ocrMode: "manual" as const, files: [{ name: "multiple-oath.pdf", size: 4096, digest: "fixture:document:multiple-oath.pdf" }] };
    const runs = mockRunsForDraft("oath-signature", draft, 1), ocr = runs[1], record = reviewRecords(ocr)[0];
    expect(documentSourcePages(draft, record)?.map(page => page.page)).toEqual([1, 2, 3, 4]);
    expect(record.fields.every(field => field.value === "" || field.value === "false")).toBe(true);
    expect(record.fields.some(field => field.key === "notes")).toBe(false);
    expect(documentSourcePages(draft, { ...record, page: 3 })).toEqual(documentSourcePages(draft, record));
  });
  it("keeps the dependency gates automatic, locks all form actions and permits manual reads inside mixed steps", () => {
    for (const flow of MOCK_WORKFLOWS) for (const step of flow.steps) {
      if (step.write || ["fill-form", "fill-keywords"].includes(step.key)) expect(mockStepIsLocked(flow.id, step)).toBe(true);
      if (mockStepIsDependency(step)) expect(manualReadFields(flow.id, step.key)).toEqual([]);
    }
    const job = mockWorkflow("separations").steps.find(step => step.key === "ucpath-job-summary")!;
    expect(mockStepIsLocked("separations", job)).toBe(true);
    expect(manualReadFields("separations", job.key).map(field => field.label)).toContain("Position number");
    expect(mockStepIsLocked("oath-signature", mockWorkflow("oath-signature").steps[0])).toBe(false);
  });
  it("restores required form actions in an editable rerun without changing the source", () => {
    const source = { ...initialMockDraft("emergency-contact"), selectedSteps: ["navigation", "save"] };
    const edit = editableMockDraft("emergency-contact", source);
    expect(edit.selectedSteps).toContain("fill-form");
    expect(source.selectedSteps).toEqual(["navigation", "save"]);
  });
  it("lets manual I-9 review bind sections to different source pages without changing their images", () => {
    const draft = { ...initialMockDraft("i9-check"), ocrMode: "manual" as const, files: [{ name: "i9.pdf", size: 4096, digest: "fixture:document:i9.pdf" }] };
    const runs = mockRunsForDraft("i9-check", draft, 1), ocr = runs[1];
    let record = reviewRecords(ocr)[0];
    for (const [key, value] of [["employeeId", "10000022"], ["firstName", "Sam"], ["lastName", "Rivera"], ["dateOfBirth", "01/01/2000"], ["hireDate", "10/06/2026"], ["section1", "3"], ["section2", "4"]]) record = editReviewRecord(record, key, value);
    expect(record.page).toBe(3);
    expect(reviewCanApprove(record)).toBe(true);
    expect(reviewCanApprove(editReviewRecord(record, "section2", "99"))).toBe(false);
    const approved = approveMockRun(updateMockReview(runs, ocr.id, [record]), ocr.id);
    expect(approved.find(run => run.role === "person")?.inputRecord).toEqual(record);
    expect(documentSourcePages(draft, record)?.map(page => page.page)).toEqual([1, 2, 3, 4]);
  });
  it("uses the selected manual document type rather than a different fixture's extracted shape", () => {
    const files = [{ name: "emergency-contacts.pdf", size: 4096, digest: "fixture:document:emergency-contacts.pdf" }];
    for (const documentType of ["Oath", "I-9 Section 1", "I-9 Section 2"]) {
      const draft = { ...initialMockDraft("onbase"), ocrMode: "manual" as const, documentType, files };
      const ocr = mockRunsForDraft("onbase", draft, 1)[1], record = reviewRecords(ocr)[0];
      expect(record.kind).toBe(documentType === "Oath" ? "oath" : "i9");
      expect(record.fields.some(field => field.key === "contactName")).toBe(false);
      if (documentType !== "Oath") {
        const section = documentType.endsWith("1") ? 1 : 2;
        expect(record.i9Section).toBe(section);
        expect(record.fields.some(field => field.key === `section${section}`)).toBe(true);
        expect(record.fields.some(field => field.key === `section${section === 1 ? 2 : 1}`)).toBe(false);
      }
      expect(record.fields.filter(field => !/^section[12]$/u.test(field.key)).every(field => field.value === "" || field.value === "false")).toBe(true);
      expect(documentSourcePages(ocr.draft, record)?.length).toBe(record.sourcePageCount);
    }
    const pairedI9 = { ...initialMockDraft("onbase"), ocrMode: "manual" as const, documentType: "I-9 Section 1", files: [{ name: "i9.pdf", size: 4096, digest: "fixture:document:i9.pdf" }] };
    const record = reviewRecords(mockRunsForDraft("onbase", pairedI9, 1)[1])[0];
    expect(record.i9Section).toBe(1);
    expect(record.fields.some(field => field.key === "section2")).toBe(false);
    expect(record.sourcePageCount).toBe(4);
  });
  it("preserves manually replaced reading steps in same-workflow OCR fanout", () => {
    const manualValues = Object.fromEntries(manualReadFields("emergency-contact", "navigation").map(field => [field.key, field.options?.[0] ?? (field.token === "$employeeId" ? "10000022" : field.token === "$name" ? "Sam Rivera" : "None")]));
    const draft = { ...initialMockDraft("emergency-contact"), files: [{ name: "contact.pdf", size: 100, digest: "synthetic" }], selectedSteps: ["fill-form", "save"], manualSteps: ["navigation"], manualValues: { navigation: manualValues } };
    const runs = mockRunsForDraft("emergency-contact", draft, 1), source = runs[1];
    expect(mockApprovalError(source)).toMatch(/differs/u);
    expect(() => approveMockRun(runs, source.id)).toThrow(/differs/u);
    let record = reviewRecords(source)[0];
    for (const [key, value] of [["employeeId", "10000022"], ["firstName", "Sam"], ["lastName", "Rivera"]]) record = editReviewRecord(record, key, value);
    const approved = approveMockRun(updateMockReview(runs, source.id, [record]), source.id);
    const person = approved.find(run => run.role === "person")!;
    expect(person.draft.selectedSteps).toEqual(["fill-form", "save"]);
    expect(person.draft.manualSteps).toEqual(["navigation"]);
    expect(person.draft.manualValues).toEqual(draft.manualValues);
    expect(mockRunLog(person).steps.flatMap(step => step.entries).some(entry => entry.kind === "fields" && entry.title === "Operator-entered values")).toBe(true);
  });
});
