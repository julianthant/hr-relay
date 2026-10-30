import { createElement as createElement_m1,createElement as createElement_m6 } from "react";
import { renderToStaticMarkup as renderToStaticMarkup_m1,renderToStaticMarkup as renderToStaticMarkup_m6 } from "react-dom/server";
import { describe as describe_m0,describe as describe_m1,describe as describe_m2,describe as describe_m3,describe as describe_m4,describe as describe_m5,describe as describe_m6,expect as expect_m0,expect as expect_m1,expect as expect_m2,expect as expect_m3,expect as expect_m4,expect as expect_m5,expect as expect_m6,it as it_m0,it as it_m1,it as it_m2,it as it_m3,it as it_m4,it as it_m5,it as it_m6 } from "vitest";
import { runDisplayId as runDisplayId_m1 } from "../../../../../src/dashboard/surfaces/shared/status/run-display-model.js";
import { activeCount as activeCount_m4,workflowStatusCounts as workflowStatusCounts_m4 } from "../../../../../src/dashboard/surfaces/shell/shell-model.js";
import { OCR_DOCUMENT_FIXTURES as OCR_DOCUMENT_FIXTURES_m1,OCR_DOCUMENT_FIXTURES as OCR_DOCUMENT_FIXTURES_m6,documentSourcePages as documentSourcePages_m1,documentSourcePages as documentSourcePages_m2,documentSourcePages as documentSourcePages_m6,mockDocumentFixture as mockDocumentFixture_m1 } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-document-model.js";
import { editableMockDraft as editableMockDraft_m2,editableMockDraft as editableMockDraft_m4,manualReadFields as manualReadFields_m2,manualReadFields as manualReadFields_m4,mockStepInputError as mockStepInputError_m2,mockStepInputError as mockStepInputError_m4,mockStepIsLocked as mockStepIsLocked_m2,mockStepIsRequiredSignIn as mockStepIsRequiredSignIn_m2 } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-manual-model.js";
import { MOCK_WORKFLOWS as MOCK_WORKFLOWS_m3,MOCK_WORKFLOWS as MOCK_WORKFLOWS_m4,mockWorkflow as mockWorkflow_m2,mockWorkflow as mockWorkflow_m3,mockWorkflow as mockWorkflow_m4,type MockWorkflowId as MockWorkflowId_m4 } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.js";
import { approveMockRun as approveMockRun_m0,approveMockRun as approveMockRun_m1,approveMockRun as approveMockRun_m2,approveMockRun as approveMockRun_m3,approveMockRun as approveMockRun_m4,approveMockRun as approveMockRun_m6,initialMockDraft as initialMockDraft_m0,initialMockDraft as initialMockDraft_m2,initialMockDraft as initialMockDraft_m3,initialMockDraft as initialMockDraft_m4,initialMockDraft as initialMockDraft_m5,initialMockDraft as initialMockDraft_m6,mockApprovalError as mockApprovalError_m2,mockConfirmationFacts as mockConfirmationFacts_m2,mockConfirmationFacts as mockConfirmationFacts_m3,mockDeletionCopy as mockDeletionCopy_m3,mockDeletionIds as mockDeletionIds_m1,mockDeletionIds as mockDeletionIds_m5,mockDraftError as mockDraftError_m2,mockDraftError as mockDraftError_m3,mockInputEntries as mockInputEntries_m3,mockLaunchCount as mockLaunchCount_m3,mockNeedsReview as mockNeedsReview_m3,mockOathDuplicate as mockOathDuplicate_m3,mockOcrReadSteps as mockOcrReadSteps_m2,mockPipeline as mockPipeline_m3,mockQueueCounts as mockQueueCounts_m3,mockQueueView as mockQueueView_m3,mockRetrySource as mockRetrySource_m1,mockRetrySource as mockRetrySource_m5,mockRunLog as mockRunLog_m0,mockRunLog as mockRunLog_m2,mockRunLog as mockRunLog_m3,mockRunLog as mockRunLog_m4,mockRunLog as mockRunLog_m6,mockRunPipeline as mockRunPipeline_m3,mockRunPipeline as mockRunPipeline_m4,mockRunsForDraft as mockRunsForDraft_m0,mockRunsForDraft as mockRunsForDraft_m1,mockRunsForDraft as mockRunsForDraft_m2,mockRunsForDraft as mockRunsForDraft_m3,mockRunsForDraft as mockRunsForDraft_m4,mockRunsForDraft as mockRunsForDraft_m5,mockRunsForDraft as mockRunsForDraft_m6,mockSelectableSteps as mockSelectableSteps_m3,mockStepState as mockStepState_m2,mockStepState as mockStepState_m3,mockStepState as mockStepState_m4,mockWorkflowCounts as mockWorkflowCounts_m4,seedMockRuns as seedMockRuns_m1,seedMockRuns as seedMockRuns_m3,seedMockRuns as seedMockRuns_m4,seedMockRuns as seedMockRuns_m6,type MockDraft as MockDraft_m3,type MockDraft as MockDraft_m4,type MockRun as MockRun_m4 } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import { mockOperationValue as mockOperationValue_m4,mockOperationValue as mockOperationValue_m6,mockOperations as mockOperations_m4 } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-operation-model.js";
import { mockQueueSurface as mockQueueSurface_m1 } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-queue-model.js";
import { completeMockReviewAction as completeMockReviewAction_m5 } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-review-action-model.js";
import { discardMockReview as discardMockReview_m4,editReviewRecord as editReviewRecord_m1,editReviewRecord as editReviewRecord_m2,editReviewRecord as editReviewRecord_m4,editReviewRecord as editReviewRecord_m6,reviewCanApprove as reviewCanApprove_m2,reviewRecords as reviewRecords_m1,reviewRecords as reviewRecords_m2,reviewRecords as reviewRecords_m3,reviewRecords as reviewRecords_m4,reviewRecords as reviewRecords_m5,reviewRecords as reviewRecords_m6,reviewValue as reviewValue_m6,seedReviewRecords as seedReviewRecords_m2,seedReviewRecords as seedReviewRecords_m6,updateMockReview as updateMockReview_m1,updateMockReview as updateMockReview_m2,updateMockReview as updateMockReview_m4,updateMockReview as updateMockReview_m6 } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-review-model.js";
import { reviewFieldBlocks as reviewFieldBlocks_m6,reviewFieldGroups as reviewFieldGroups_m6,reviewSourcePages as reviewSourcePages_m3,reviewSourcePages as reviewSourcePages_m6 } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-review-source-model.js";
import { WorkflowMockReview as WorkflowMockReview_m1,WorkflowMockReview as WorkflowMockReview_m6 } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-review.js";


{


const preparation = (id: "emergency-contact" | "onbase" | "oath-upload") => mockRunsForDraft_m0(id, { ...initialMockDraft_m0(id), files: [{ name: "fictional.pdf", size: 1024, digest: "fixture" }] }, 1);
describe_m0("complete workflow presentation mocks", () => {
  it_m0("makes Oath Upload signers independent and keeps source preparation out of their kernel logs", () => {
    const runs = preparation("oath-upload"), ocr = runs.find(run => run.workflowId === "ocr")!, result = approveMockRun_m0(runs, ocr.id), signer = result.find(run => run.role === "person")!;
    expect_m0(signer.workflowId).toBe("oath-signature"); expect_m0(signer.parentId).toBe(runs[0].id); expect_m0(signer.ocrRunId).toBe(ocr.id);
    expect_m0(mockRunLog_m0(signer).timeline.map(step => step.label)).toEqual(["Verify onboarding and oath date", "Sign in to UCPath", "Sign oath"]);
    const contact = preparation("emergency-contact"), approved = approveMockRun_m0(contact, contact[1].id);
    expect_m0(mockRunLog_m0(approved.find(run => run.id === contact[0].id)!).timeline.map(step => step.label)).not.toContain("Save emergency contact");
    expect_m0(mockRunLog_m0(approved.find(run => run.role === "person")!).timeline.map(step => step.label)).toContain("Save emergency contact");
  });
});
}

{


describe_m1("document-complete OCR previews", () => {
  it_m1("covers the five OCR documents and excludes the non-OCR sick-hours checklist", () => {
    expect_m1(OCR_DOCUMENT_FIXTURES_m1.map(doc => [doc.name, doc.pages.length, doc.records.length])).toEqual([
      ["single-oath.pdf", 1, 1], ["multiple-oath.pdf", 4, 4], ["emergency-contacts.pdf", 3, 3],
      ["i9.pdf", 4, 2], ["detect-test.pdf", 7, 4],
    ]);
    const ocr = seedMockRuns_m1().filter(run => run.workflowId === "ocr");
    expect_m1(ocr.map(run => run.subject).sort()).toEqual(OCR_DOCUMENT_FIXTURES_m1.map(doc => doc.name).sort());
    expect_m1(ocr.every(run => run.parentId && run.targetWorkflowId)).toBe(true);
    expect_m1(ocr.reduce((count, run) => count + reviewRecords_m1(run).length, 0)).toBe(14);
    const separation = seedMockRuns_m1().find(run => run.workflowId === "separations")!;
    expect_m1(separation.ocrRunId).toBeUndefined();
  });
  it_m1("renders every document response field, including blank, boolean and unresolved values", () => {
    for (const run of seedMockRuns_m1().filter(run => run.workflowId === "ocr")) for (const record of reviewRecords_m1(run)) {
      const markup = renderToStaticMarkup_m1(createElement_m1(WorkflowMockReview_m1, { run: { ...run, records: [record] }, onChange: () => {}, onApprove: () => {}, onRestore: () => {} }));
      for (const field of record.fields) expect_m1(markup).toContain(field.label.replaceAll("&", "&amp;"));
      expect_m1(record.fields.some(field => field.value === "")).toBe(true);
    }
    const contact = seedMockRuns_m1().find(run => run.subject === "detect-test.pdf" && run.workflowId === "ocr")!;
    expect_m1(contact.draft.formType).toBe("emergency-contact");
    expect_m1(reviewRecords_m1(contact).map(record => [record.kind, record.page])).toEqual([["contact", 1], ["contact", 2], ["contact", 4], ["contact", 6]]);
    expect_m1(reviewRecords_m1(contact)[1]).toMatchObject({ match: "unresolved", selected: false });
  });
  it_m1("retains the original image URLs and reverse-order I-9 page pairing across corrections", () => {
    const run = seedMockRuns_m1().find(run => run.subject === "i9.pdf" && run.workflowId === "ocr")!;
    expect_m1(reviewRecords_m1(run).map(record => documentSourcePages_m1(run.draft, record)!.map(page => page.page))).toEqual([[2, 1], [4, 3]]);
    expect_m1(documentSourcePages_m1(run.draft, reviewRecords_m1(run)[0])!.map(page => page.label)).toEqual(["Section 1 · Page 2", "Section 2 · Page 1"]);
    const original = reviewRecords_m1(run)[0], pages = documentSourcePages_m1(run.draft, original);
    const edited = editReviewRecord_m1(original, "firstName", "Corrected");
    expect_m1(documentSourcePages_m1(run.draft, edited)).toEqual(pages);
    expect_m1(pages!.every(page => /i9-\d\.webp/u.test(page.imageUrl))).toBe(true);
    expect_m1(mockDocumentFixture_m1({ files: [{ ...run.draft.files[0], digest: "user-upload" }] })).toBeUndefined();
    expect_m1(() => documentSourcePages_m1(run.draft, { ...original, page: 90 })).toThrow("MOCK_DOCUMENT_PAGE_MISSING");
  });
  it_m1("copies all corrected contact fields to the contact preview and preserves the source history", () => {
    const runs = seedMockRuns_m1(), run = runs.find(run => run.subject === "detect-test.pdf" && run.workflowId === "ocr")!;
    const records = reviewRecords_m1(run).map(record => ({ ...editReviewRecord_m1(record, "employeeId", "10001234"), selected: true }));
    const updated = updateMockReview_m1(runs, run.id, records), approved = approveMockRun_m1(updated, run.id);
    const children = approved.filter(child => child.ocrRunId === run.id && child.role === "person");
    expect_m1(children).toHaveLength(4);
    expect_m1(children.map(child => child.workflowId)).toEqual(Array(4).fill("emergency-contact"));
    children.forEach((child, index) => { expect_m1(child.inputRecord).toEqual(records[index]); expect_m1(child.inputRecord).not.toBe(records[index]); });
    expect_m1(reviewRecords_m1(run)[1].match).toBe("unresolved");
  });
  it_m1("retries a delegated document with its original schema and deletes a complete local tree", () => {
    const runs = seedMockRuns_m1(), parent = runs.find(run => run.workflowId === "oath-signature")!;
    const retried = mockRunsForDraft_m1(parent.workflowId, parent.draft, 100, parent.id);
    expect_m1(retried).toHaveLength(2); expect_m1(retried[1].subject).toBe("single-oath.pdf");
    expect_m1(reviewRecords_m1(retried[1])[0].kind).toBe("oath");
    const separation = runs.find(run => run.workflowId === "separations")!;
    expect_m1(mockRunsForDraft_m1(separation.workflowId, separation.draft, 101, separation.id)).toHaveLength(1);
    const ocr = runs.find(run => run.workflowId === "ocr" && run.parentId === parent.id)!;
    const approved = approveMockRun_m1(runs, ocr.id), ids = mockDeletionIds_m1(approved, ocr.id);
    expect_m1(ids).toContain(parent.id); expect_m1(ids).toContain(ocr.id); expect_m1(ids).toHaveLength(3);
    expect_m1(approved.filter(run => !ids.includes(run.id)).some(run => run.parentId && ids.includes(run.parentId))).toBe(false);
    expect_m1(() => mockDeletionIds_m1(runs, "missing")).toThrow("MOCK_DELETE_TARGET_MISSING");
  });
  it_m1("uses stable uppercase workflow aliases with eight decimal digits without changing command IDs", () => {
    const rows = seedMockRuns_m1().map(run => mockQueueSurface_m1(run, "2026-08-03T16:10:00.000Z"));
    const aliases = rows.map(row => runDisplayId_m1(row.runId, row.traceId));
    expect_m1(aliases.every(alias => /^[A-Z0-9]{1,4}\d{8}$/u.test(alias))).toBe(true);
    expect_m1(new Set(aliases).size).toBe(rows.length);
    const row = rows.find(row => row.workflowId === "separations")!;
    expect_m1(runDisplayId_m1(row.runId, row.traceId)).toMatch(/^SP\d{8}$/u);
    expect_m1(row.runId).toMatch(/^[0-9a-f-]{36}$/u);
    expect_m1(runDisplayId_m1(row.runId, row.traceId)).toBe(runDisplayId_m1(row.runId, row.traceId));
  });
  it_m1("retries delegation-only lookups through their exact OCR and runnable parent", () => {
    const runs = seedMockRuns_m1(), lookup = runs.find(run => run.workflowId === "i9-lookup")!;
    const ocr = runs.find(run => run.id === lookup.parentId)!;
    expect_m1(ocr).toMatchObject({ workflowId: "ocr", subject: "detect-test.pdf" });
    const source = mockRetrySource_m1(runs, lookup.id);
    expect_m1(source).toBe(runs.find(run => run.id === ocr.parentId));
    expect_m1(source.workflowId).toBe("onbase");
    expect_m1(mockRetrySource_m1(runs, source.id)).toBe(source);
    expect_m1(mockDeletionIds_m1(runs, ocr.id)).toContain(lookup.id);
    expect_m1(() => mockRetrySource_m1(runs.filter(run => run.id !== source.id), lookup.id)).toThrow("MOCK_RETRY_SOURCE_MISSING");
    expect_m1(() => mockRetrySource_m1([{ ...lookup, parentId: lookup.id }], lookup.id)).toThrow("MOCK_RETRY_PARENT_CYCLE");
  });
});
}

{


describe_m2("manual OCR and reading inputs", () => {
  it_m2("omits Notes from every OCR document shape", () => {
    expect_m2(seedReviewRecords_m2({ workflowId: "oath-signature", draft: initialMockDraft_m2("oath-signature") })[0].fields.some(field => field.key === "notes")).toBe(false);
    for (const formType of ["oath", "emergency-contact", "onbase-emergency-contact", "i9"]) {
      for (const record of seedReviewRecords_m2({ workflowId: "ocr", draft: { ...initialMockDraft_m2("ocr"), formType } })) expect_m2(record.fields.some(field => field.key === "notes")).toBe(false);
    }
  });
  it_m2("delegates without extraction, seeds blank fields and requires explicit approval", () => {
    const draft = { ...initialMockDraft_m2("oath-signature"), method: "pdf" as const, ocrMode: "manual" as const, dryRun: false, files: [{ name: "single-oath.pdf", size: 4096, digest: "fixture:document:single-oath.pdf" }] };
    let runs = mockRunsForDraft_m2("oath-signature", draft, 1);
    const child = runs.find(run => run.workflowId === "ocr")!;
    expect_m2(child.parentId).toBe(runs[0].id);
    expect_m2(reviewRecords_m2(child)).toHaveLength(1);
    let record = reviewRecords_m2(child)[0];
    expect_m2(record.match).toBe("unresolved");
    expect_m2(record.fields.every(field => field.value === "" || field.value === "false")).toBe(true);
    expect_m2(reviewCanApprove_m2(record)).toBe(false);
    expect_m2(() => approveMockRun_m2(runs, child.id)).toThrow("MOCK_APPROVAL_NO_RECORDS");
    for (const key of ["prep:loading-roster", "prep:ocr", "prep:person-lookup"]) expect_m2(mockStepState_m2(child, { key, label: key, message: "" })).toBe("skipped");
    expect_m2(mockStepState_m2(child, { key: "prep:awaiting-approval", label: "Review", message: "" })).toBe("waiting");
    for (const [key, value] of [["employeeId", "10000022"], ["firstName", "Sam"], ["lastName", "Rivera"], ["dateSigned", "10/06/2026"], ["employeeSigned", "true"], ["officerSigned", "true"]]) record = editReviewRecord_m2(record, key, value);
    expect_m2(reviewCanApprove_m2(record)).toBe(true);
    runs = updateMockReview_m2(runs, child.id, [record]);
    const approved = approveMockRun_m2(runs, child.id);
    const person = approved.find(run => run.role === "person")!;
    expect_m2(person.inputRecord).toEqual(record);
    expect_m2(person.draft.ocrMode).toBe("manual");
    expect_m2(mockRunLog_m2(person).steps.flatMap(step => step.entries).flatMap(entry => entry.kind === "fields" ? entry.fields : []).some(field => field.label === "Signature date" && field.value === "10/06/2026")).toBe(true);
    expect_m2(runs.every(run => !run.approved)).toBe(true);
  });
  it_m2("shows one selectable OCR read with an internal approval gate in either extraction mode", () => {
    for (const ocrMode of ["extract", "manual"] as const) {
      const draft = { ...initialMockDraft_m2("emergency-contact"), ocrMode, files: [{ name: "contact.pdf", size: 100, digest: "synthetic" }] };
      expect_m2(mockOcrReadSteps_m2("emergency-contact", draft).map(step => step.key)).toEqual(["read-document"]);
      expect_m2(mockConfirmationFacts_m2("emergency-contact", draft).find(fact => fact.key === "Steps")?.value).toBe(ocrMode === "manual" ? "3 / 4 included" : "4 / 4 included");
      const [parent, ocr] = mockRunsForDraft_m2("emergency-contact", draft, 1);
      expect_m2(parent.ocrRunId).toBe(ocr.id);
      expect_m2(mockOcrReadSteps_m2("emergency-contact", draft)[0]).toMatchObject({ label: "Read emergency contact", system: "OCR" });
      expect_m2(ocr.draft.formType).toBe("emergency-contact");
      expect_m2(mockStepState_m2(parent, { key: "read-document", label: "Read emergency contact", message: "" })).toBe(ocrMode === "manual" ? "skipped" : "waiting");
      expect_m2(mockStepState_m2(parent, { key: "fill-form", label: "Fill", message: "" })).toBe("pending");
      expect_m2(mockStepState_m2(parent, { key: "save", label: "Save", message: "" })).toBe("pending");
      expect_m2(draft.selectedSteps).not.toContain("read-document");
    }
    expect_m2(mockOcrReadSteps_m2("oath-upload", { ...initialMockDraft_m2("oath-upload"), uploadMode: "upload-only" })).toEqual([]);
    expect_m2(mockOcrReadSteps_m2("onboarding", initialMockDraft_m2("onboarding"))).toEqual([]);
  });
  it_m2("refuses omitted form filling and submit steps", () => {
    const flow = mockWorkflow_m2("emergency-contact");
    const draft = { ...initialMockDraft_m2(flow.id), files: [{ name: "contact.pdf", size: 100, digest: "synthetic" }], selectedSteps: ["navigation", "save"] };
    expect_m2(mockDraftError_m2(flow.id, draft)).toMatch(/Fill emergency contact.*required/u);
    expect_m2(() => mockRunsForDraft_m2(flow.id, draft, 1)).toThrow(/required/u);
  });
  it_m2("validates manual reading values, logs their provenance and passes the date to the form", () => {
    const draft = { ...initialMockDraft_m2("oath-signature"), text: "10000022", dryRun: false, selectedSteps: ["ucpath-auth", "transaction"], manualSteps: ["crm-verify"], manualValues: { "crm-verify": { "crm-onboarding": "Record found", "process-stage": "Onboarding complete", "first-day-of-service": "10/06/2026", "signed-date": "10/06/2026" } } };
    expect_m2(mockDraftError_m2("oath-signature", { ...draft, manualValues: {} })).toMatch(/Enter CRM onboarding for verify onboarding and oath date\./u);
    expect_m2(mockDraftError_m2("oath-signature", { ...draft, manualValues: { "crm-verify": { ...draft.manualValues["crm-verify"], "signed-date": "02/30/2026" } } })).toMatch(/valid date/u);
    expect_m2(mockDraftError_m2("oath-signature", draft)).toBeUndefined();
    const run = mockRunsForDraft_m2("oath-signature", draft, 2)[0];
    const log = mockRunLog_m2(run);
    const manual = log.steps.find(step => step.id.endsWith(":crm-verify"))!;
    expect_m2(manual.entries.some(entry => entry.kind === "fields" && entry.title === "Operator-entered values")).toBe(true);
    expect_m2(manual.entries.some(entry => entry.kind === "click" || entry.kind === "note" && entry.tone === "positive")).toBe(false);
    const fields = log.steps.flatMap(step => step.entries).flatMap(entry => entry.kind === "fields" ? entry.fields : []);
    expect_m2(fields.filter(field => field.label === "Signature date").every(field => field.value === "10/06/2026")).toBe(true);
    expect_m2(fields.filter(field => field.label === "Signature date").length).toBeGreaterThan(0);
    expect_m2(mockRunsForDraft_m2("oath-signature", run.draft, 3, run.id)[0].draft).toEqual(run.draft);
  });
  it_m2("refuses applying one person's manual facts across a typed batch", () => {
    const draft = { ...initialMockDraft_m2("oath-signature"), text: "10000001, 10000002", manualSteps: ["crm-verify"] };
    expect_m2(mockDraftError_m2("oath-signature", draft)).toMatch(/one person/u);
  });
  it_m2("keeps blank multi-page sources viewable and records the operator's source page on approval", () => {
    const draft = { ...initialMockDraft_m2("oath-signature"), method: "pdf" as const, ocrMode: "manual" as const, files: [{ name: "multiple-oath.pdf", size: 4096, digest: "fixture:document:multiple-oath.pdf" }] };
    const runs = mockRunsForDraft_m2("oath-signature", draft, 1), ocr = runs[1], record = reviewRecords_m2(ocr)[0];
    expect_m2(documentSourcePages_m2(draft, record)?.map(page => page.page)).toEqual([1, 2, 3, 4]);
    expect_m2(record.fields.every(field => field.value === "" || field.value === "false")).toBe(true);
    expect_m2(record.fields.some(field => field.key === "notes")).toBe(false);
    expect_m2(documentSourcePages_m2(draft, { ...record, page: 3 })).toEqual(documentSourcePages_m2(draft, record));
  });
  it_m2("keeps sign-in included while a required action on the same system remains", () => {
    const oathSignIn = mockWorkflow_m2("oath-signature").steps.find(step => step.key === "ucpath-auth")!;
    expect_m2(mockStepIsRequiredSignIn_m2("oath-signature", oathSignIn)).toBe(true);
    expect_m2(mockStepIsLocked_m2("oath-signature", oathSignIn)).toBe(true);
    expect_m2(mockStepInputError_m2("oath-signature", { ...initialMockDraft_m2("oath-signature"), selectedSteps: ["crm-verify", "transaction"] })).toBe("Sign in to UCPath is required.");
    const crmSignIn = mockWorkflow_m2("onboarding").steps.find(step => step.label === "Sign in to CRM")!;
    expect_m2(mockStepIsRequiredSignIn_m2("onboarding", crmSignIn)).toBe(false);
    expect_m2(mockStepIsLocked_m2("onboarding", crmSignIn)).toBe(false);
  });
  it_m2("restores required form actions in an editable rerun without changing the source", () => {
    const source = { ...initialMockDraft_m2("emergency-contact"), selectedSteps: ["navigation", "save"] };
    const edit = editableMockDraft_m2("emergency-contact", source);
    expect_m2(edit.selectedSteps).toContain("fill-form");
    expect_m2(source.selectedSteps).toEqual(["navigation", "save"]);
  });
  it_m2("lets manual I-9 review bind sections to different source pages without changing their images", () => {
    const draft = { ...initialMockDraft_m2("i9-check"), ocrMode: "manual" as const, files: [{ name: "i9.pdf", size: 4096, digest: "fixture:document:i9.pdf" }] };
    const runs = mockRunsForDraft_m2("i9-check", draft, 1), ocr = runs[1];
    let record = reviewRecords_m2(ocr)[0];
    for (const [key, value] of [["employeeId", "10000022"], ["firstName", "Sam"], ["lastName", "Rivera"], ["dateOfBirth", "01/01/2000"], ["hireDate", "10/06/2026"], ["section1", "3"], ["section2", "4"]]) record = editReviewRecord_m2(record, key, value);
    expect_m2(record.page).toBe(3);
    expect_m2(reviewCanApprove_m2(record)).toBe(true);
    expect_m2(reviewCanApprove_m2(editReviewRecord_m2(record, "section2", "99"))).toBe(false);
    const approved = approveMockRun_m2(updateMockReview_m2(runs, ocr.id, [record]), ocr.id);
    expect_m2(approved.find(run => run.role === "person")?.inputRecord).toEqual(record);
    expect_m2(documentSourcePages_m2(draft, record)?.map(page => page.page)).toEqual([1, 2, 3, 4]);
  });
  it_m2("uses the selected manual document type rather than a different fixture's extracted shape", () => {
    const files = [{ name: "emergency-contacts.pdf", size: 4096, digest: "fixture:document:emergency-contacts.pdf" }];
    for (const documentType of ["Oath", "I-9 Section 1", "I-9 Section 2"]) {
      const draft = { ...initialMockDraft_m2("onbase"), ocrMode: "manual" as const, documentType, files };
      const ocr = mockRunsForDraft_m2("onbase", draft, 1)[1], record = reviewRecords_m2(ocr)[0];
      expect_m2(record.kind).toBe(documentType === "Oath" ? "oath" : "i9");
      expect_m2(record.fields.some(field => field.key === "contactName")).toBe(false);
      if (documentType !== "Oath") {
        const section = documentType.endsWith("1") ? 1 : 2;
        expect_m2(record.i9Section).toBe(section);
        expect_m2(record.fields.some(field => field.key === `section${section}`)).toBe(true);
        expect_m2(record.fields.some(field => field.key === `section${section === 1 ? 2 : 1}`)).toBe(false);
      }
      expect_m2(record.fields.filter(field => !/^section[12]$/u.test(field.key)).every(field => field.value === "" || field.value === "false")).toBe(true);
      expect_m2(documentSourcePages_m2(ocr.draft, record)?.length).toBe(record.sourcePageCount);
    }
    const pairedI9 = { ...initialMockDraft_m2("onbase"), ocrMode: "manual" as const, documentType: "I-9 Section 1", files: [{ name: "i9.pdf", size: 4096, digest: "fixture:document:i9.pdf" }] };
    const record = reviewRecords_m2(mockRunsForDraft_m2("onbase", pairedI9, 1)[1])[0];
    expect_m2(record.i9Section).toBe(1);
    expect_m2(record.fields.some(field => field.key === "section2")).toBe(false);
    expect_m2(record.sourcePageCount).toBe(4);
  });
  it_m2("preserves manually replaced reading steps in same-workflow OCR fanout", () => {
    const manualValues = Object.fromEntries(manualReadFields_m2("emergency-contact", "navigation").map(field => [field.key, field.options?.[0] ?? (field.token === "$employeeId" ? "10000022" : field.token === "$name" ? "Sam Rivera" : "None")]));
    const draft = { ...initialMockDraft_m2("emergency-contact"), files: [{ name: "contact.pdf", size: 100, digest: "synthetic" }], selectedSteps: ["fill-form", "save"], manualSteps: ["navigation"], manualValues: { navigation: manualValues } };
    const runs = mockRunsForDraft_m2("emergency-contact", draft, 1), source = runs[1];
    expect_m2(mockApprovalError_m2(source)).toMatch(/differs/u);
    expect_m2(() => approveMockRun_m2(runs, source.id)).toThrow(/differs/u);
    let record = reviewRecords_m2(source)[0];
    for (const [key, value] of [["employeeId", "10000022"], ["firstName", "Sam"], ["lastName", "Rivera"]]) record = editReviewRecord_m2(record, key, value);
    const approved = approveMockRun_m2(updateMockReview_m2(runs, source.id, [record]), source.id);
    const person = approved.find(run => run.role === "person")!;
    expect_m2(person.draft.selectedSteps).toEqual(["fill-form", "save"]);
    expect_m2(person.draft.manualSteps).toEqual(["navigation"]);
    expect_m2(person.draft.manualValues).toEqual(draft.manualValues);
    expect_m2(mockRunLog_m2(person).steps.flatMap(step => step.entries).some(entry => entry.kind === "fields" && entry.title === "Operator-entered values")).toBe(true);
  });
});
}

{


const file = { name: "packet.pdf", size: 100, digest: "copied-pdf-digest" };
const draft = (id: string, changes: Partial<MockDraft_m3> = {}): MockDraft_m3 => ({ ...initialMockDraft_m3(id), text: mockWorkflow_m3(id).example, files: [file], ...changes });

describe_m3("legacy workflow previews", () => {
  it_m3("parses names without splitting their commas and requires one Match identifier", () => {
    expect_m3(mockInputEntries_m3("person-lookup", draft("person-lookup", { text: "Lee, Jordan; Rivera, Sam" }))).toEqual(["Lee, Jordan", "Rivera, Sam"]);
    expect_m3(mockDraftError_m3("person-lookup", draft("person-lookup", { lookupMode: "match", text: "Lee, Jordan, x, x" }))).toMatch(/both cannot be x/);
    expect_m3(mockDraftError_m3("person-lookup", draft("person-lookup", { lookupMode: "match", text: "Lee, Jordan, 01/01/2000, x" }))).toBeUndefined();
    expect_m3(mockDraftError_m3("crm-doc-download", draft("crm-doc-download", { text: "bad-email" }))).toMatch(/Employee IDs/);
    expect_m3(mockDraftError_m3("i9-lookup", draft("i9-lookup"))).toMatch(/cannot start independently/);
  });
  it_m3("uses real input cardinality and keeps a combined OnBase preparation", () => {
    expect_m3(mockRunsForDraft_m3("oath-signature", draft("oath-signature", { text: "10000001, 10000002" }), 1)).toHaveLength(2);
    expect_m3(mockRunsForDraft_m3("emergency-contact", draft("emergency-contact", { files: [file, { ...file, name: "second.pdf", digest: "second" }] }), 1)).toHaveLength(4);
    const combined = mockRunsForDraft_m3("onbase", draft("onbase", { files: [file, { ...file, name: "second.pdf" }] }), 1);
    expect_m3(combined).toHaveLength(2); expect_m3(combined[0].draft.files).toHaveLength(2);
    expect_m3(mockDraftError_m3("onbase", draft("onbase", { documentType: "Benefits" }))).toBe("Choose a supported document type.");
    expect_m3(() => mockRunsForDraft_m3("onbase", draft("onbase", { documentType: "Benefits" }), 1)).toThrow("Choose a supported document type.");
  });
  it_m3.each([
    ["Oath", "oath", "oath"],
    ["I-9 Section 1", "i9", "i9"],
    ["I-9 Section 2", "i9", "i9"],
    ["Emergency Contact", "onbase-emergency-contact", "contact"],
  ] as const)("carries %s through confirmation, OCR, approval, logs and rerun", (documentType, formType, kind) => {
    const input = draft("onbase", { documentType });
    expect_m3(mockDraftError_m3("onbase", input)).toBeUndefined();
    expect_m3(mockConfirmationFacts_m3("onbase", input)).toContainEqual({ key: "Document type", value: documentType });
    const runs = mockRunsForDraft_m3("onbase", input, 1), ocr = runs[1];
    expect_m3(ocr.draft.formType).toBe(formType);
    const record = reviewRecords_m3(ocr)[0];
    expect_m3(record.kind).toBe(kind);
    if (documentType.startsWith("I-9")) {
      const section = documentType === "I-9 Section 1" ? 1 : 2;
      expect_m3(record.i9Section).toBe(section);
      expect_m3(record.fields.some(field => field.key === `section${section === 1 ? 2 : 1}`)).toBe(false);
      expect_m3(reviewSourcePages_m3(record).map(page => page.label)).toEqual([`Section ${section} · Page 1`]);
    }
    const approved = approveMockRun_m3(runs, ocr.id), person = approved.find(run => run.role === "person")!;
    expect_m3(person.draft.documentType).toBe(documentType);
    expect_m3(person.inputRecord).toEqual(record);
    const log = mockRunLog_m3(person);
    const documentFields = log.steps.flatMap(step => step.entries).flatMap(entry => entry.kind === "fields" ? entry.fields : []).filter(field => field.label === "Document type");
    expect_m3(documentFields.length).toBeGreaterThan(0);
    expect_m3(documentFields.every(field => field.value === documentType)).toBe(true);
    const rerun = mockRunsForDraft_m3("onbase", runs[0].draft, 2, runs[0].id);
    expect_m3(rerun[0].draft.documentType).toBe(documentType);
    expect_m3(rerun[1].draft.formType).toBe(formType);
    expect_m3(input.formType).toBe("onbase-emergency-contact");
  });
  it_m3("counts the root runs shown in confirmation without counting delegated children", () => {
    expect_m3(mockLaunchCount_m3("oath-signature", draft("oath-signature", { text: "10000001, 10000002" }))).toBe(2);
    const files = [file, { ...file, name: "second.pdf", digest: "second" }];
    expect_m3(mockLaunchCount_m3("emergency-contact", draft("emergency-contact", { files }))).toBe(2);
    expect_m3(mockLaunchCount_m3("onbase", draft("onbase", { files }))).toBe(1);
    expect_m3(mockLaunchCount_m3("sharepoint-download", draft("sharepoint-download"))).toBe(1);
    expect_m3(mockLaunchCount_m3("onbase", draft("onbase", { files: [] }))).toBe(0);
  });
  it_m3("shows only the current processing mode's customizable steps", () => {
    const upload = draft("oath-upload", { uploadMode: "upload-only" });
    expect_m3(mockSelectableSteps_m3("oath-upload", upload).map(step => step.key)).toEqual(["servicenow-auth", "open-hr-form", "fill-form", "submit"]);
    const facts = mockConfirmationFacts_m3("oath-upload", upload);
    expect_m3(facts.find(row => row.key === "Steps")?.value).toBe("4 / 4 included");
    expect_m3(facts.some(row => row.key === "Roster" || row.key === "Workers")).toBe(false);
  });
  it_m3("confirms edited execution settings and omitted steps in operator language", () => {
    const options = draft("onboarding", { priority: "background", browser: "headless", hireType: "rehire", selectedSteps: ["transaction"] });
    const facts = Object.fromEntries(mockConfirmationFacts_m3("onboarding", options).map(row => [row.key, row.value]));
    expect_m3(facts.Queue).toBe("Bulk");
    expect_m3(facts.Browser).toBe("Headless · screenshots required");
    expect_m3(Object.hasOwn(options, "captures")).toBe(false);
    expect_m3(Object.hasOwn(options, "workers")).toBe(false);
    expect_m3(Object.hasOwn(facts, "Workers")).toBe(false);
    expect_m3(facts["Hire type"]).toBe("Rehire · UC_CONC_HIRE");
    expect_m3(facts.Steps).toBe("1 / 8 included · Omitted: Sign in to CRM, Find onboarding record, Read entry sheet, Download onboarding documents, Sign in to UCPath, Match existing person, Create I-9 profile");
  });
  it_m3("keeps upload-only out of OCR and signature waits", () => {
    const keys = mockPipeline_m3("oath-upload", draft("oath-upload", { uploadMode: "upload-only" })).map(step => step.key);
    expect_m3(keys).toEqual(["servicenow-auth", "open-hr-form", "fill-form", "submit"]);
    const full = mockPipeline_m3("oath-upload", draft("oath-upload")).map(step => step.key);
    expect_m3(full.indexOf("wait-signatures")).toBeLessThan(full.indexOf("servicenow-auth"));
    expect_m3(full[0]).toBe("read-document");
  });
  it_m3("holds downstream work for approval, then creates independent oath signers", () => {
    const runs = mockRunsForDraft_m3("oath-upload", draft("oath-upload"), 1), run = runs[0];
    const log = mockRunLog_m3(run);
    expect_m3(log.timeline.find(step => step.label === "Sign in to ServiceNow")!.state).toBe("pending");
    expect_m3(log.timeline.slice(0, 3).map(step => step.state)).toEqual(["waiting", "pending", "pending"]);
    const after = approveMockRun_m3(runs, runs[1].id);
    expect_m3(after.find(candidate => candidate.id === run.id)!.approved).toBe(true);
    expect_m3(after.find(candidate => candidate.workflowId === "oath-signature")!.parentId).toBe(run.id);
    expect_m3(run.approved).toBe(false);
    const standalone = mockRunsForDraft_m3("ocr", draft("ocr"), 1)[0];
    expect_m3(() => approveMockRun_m3([standalone], standalone.id)).toThrow("MOCK_APPROVAL_UNAVAILABLE");
  });
  it_m3("keeps I-9 downstream processing behind OCR approval and gives every log a unique step identity", () => {
    const run = mockRunsForDraft_m3("i9-check", draft("i9-check"), 1)[0];
    expect_m3(mockNeedsReview_m3(run)).toBe(false);
    const { steps } = mockRunLog_m3(run);
    expect_m3(new Set(steps.map(step => step.id)).size).toBe(steps.length);
    const rerun = mockRunsForDraft_m3("i9-check", run.draft, 2, run.id);
    expect_m3(rerun).toHaveLength(2); expect_m3(rerun[0].sourceId).toBe(run.id);
    expect_m3(rerun[1].workflowId).toBe("ocr"); expect_m3(mockNeedsReview_m3(rerun[1])).toBe(true); expect_m3(rerun[1].parentId).toBe(rerun[0].id); expect_m3(rerun[1].id).not.toBe(`${run.id}:person:0`);
    expect_m3(steps.some(step => step.title === "Result")).toBe(false);
  });
  it_m3("starts every launch with Dry run off", () => {
    for (const flow of MOCK_WORKFLOWS_m3) expect_m3(initialMockDraft_m3(flow.id).dryRun).toBe(false);
  });
  it_m3("skips write terminals in dry run, rehire I-9 and normal lookup CRM dates", () => {
    const run = mockRunsForDraft_m3("separations", draft("separations", { dryRun: true }), 1)[0];
    for (const step of mockWorkflow_m3("separations").steps.filter(step => step.write)) expect_m3(mockStepState_m3(run, step)).toBe("skipped");
    const rehire = mockRunsForDraft_m3("onboarding", draft("onboarding", { hireType: "rehire" }), 1)[0];
    expect_m3(mockStepState_m3(rehire, mockWorkflow_m3("onboarding").steps.find(step => step.key === "i9-creation")!)).toBe("skipped");
    const lookup = mockRunsForDraft_m3("person-lookup", draft("person-lookup"), 1)[0];
    expect_m3(mockRunLog_m3(lookup).timeline.filter(step => step.state === "skipped").map(step => step.label)).toEqual(["Cross-check identity", "Read CRM dates"]);
  });
  it_m3("rejects reversed and invalid dates", () => {
    expect_m3(mockDraftError_m3("old-kronos-reports", draft("old-kronos-reports", { startDate: "2026-02-01", endDate: "2026-01-31" }))).toMatch(/date range/);
    expect_m3(mockDraftError_m3("work-study", draft("work-study", { effectiveDate: "2026-02-30" }))).toMatch(/effective date/);
  });
  it_m3("retains source history on rerun and matches duplicates by content, not filename", () => {
    const source = mockRunsForDraft_m3("oath-upload", draft("oath-upload", { uploadMode: "upload-only", dryRun: false }), 1)[0];
    const before = JSON.stringify(source);
    const rerun = mockRunsForDraft_m3("oath-upload", source.draft, 2, source.id)[0];
    expect_m3(rerun.sourceId).toBe(source.id); expect_m3(rerun.id).not.toBe(source.id);
    expect_m3(JSON.stringify(source)).toBe(before);
    expect_m3(mockOathDuplicate_m3([source], { ...source.draft, files: [{ ...file, name: "renamed.pdf" }] })).toMatch(/already filed/);
    expect_m3(mockOathDuplicate_m3([source], { ...source.draft, files: [{ ...file, digest: "different-content" }] })).toBeUndefined();
    expect_m3(mockOathDuplicate_m3([{ ...source, draft: { ...source.draft, dryRun: true } }], source.draft)).toBeUndefined();
  });
  it_m3("scopes status filters, counts and order to the selected preview queue", () => {
    const waiting = mockRunsForDraft_m3("emergency-contact", draft("emergency-contact"), 1)[1];
    const done = { ...waiting, id: "done", approved: true };
    expect_m3(mockQueueCounts_m3([waiting, done])).toEqual([{ status: "awaiting-approval", count: 1 }, { status: "running", count: 0 }, { status: "done", count: 1 }, { status: "cancelled", count: 0 }]);
    expect_m3(mockQueueView_m3([done, waiting], ["needsYou"], "newest")).toEqual([waiting]);
    expect_m3(mockQueueView_m3([done, waiting], ["done"], "newest")).toEqual([done]);
    expect_m3(mockQueueView_m3([done, waiting], ["all"], "attention")).toEqual([waiting, done]);
    expect_m3(mockQueueView_m3([done, waiting], ["all"], "oldest")).toEqual([waiting, done]);
  });
  it_m3("seeds each workflow with its own fictional input and log graph", () => {
    const runs = seedMockRuns_m3(); expect_m3(runs.filter(run => !run.parentId)).toHaveLength(19);
    expect_m3(runs).toHaveLength(26);
    for (const id of ["i9-lookup", "sharepoint-download"]) expect_m3(runs.find(run => run.workflowId === id)!.parentId).toBe("mock:onbase:sample:ocr");
    expect_m3(runs.find(run => run.id === "mock:onbase:sample:ocr")!.draft.roster).toBe("download");
    expect_m3(runs.filter(run => run.parentId && run.workflowId === "ocr")).toHaveLength(5);
    expect_m3(runs.filter(run => run.records !== undefined).every(run => run.workflowId === "ocr")).toBe(true);
    for (const run of runs) {
      expect_m3(run.title).toBe(run.subject);
      const { steps } = mockRunLog_m3(run);
      expect_m3(steps.map(step => step.title)).toEqual(mockRunPipeline_m3(run).map(step => step.label));
      expect_m3(new Set(steps.map(step => step.id)).size).toBe(steps.length);
    }
  });
});

describe_m3("mock deletion confirmation copy", () => {
  it_m3("states linked runs only when they exist and agrees in number", () => {
    expect_m3(mockDeletionCopy_m3(0)).toBe("Remove this run from the queue.");
    expect_m3(mockDeletionCopy_m3(1)).toBe("Remove this run and 1 linked run from the queue.");
    expect_m3(mockDeletionCopy_m3(3)).toBe("Remove this run and 3 linked runs from the queue.");
    expect_m3(() => mockDeletionCopy_m3(-1)).toThrow("MOCK_DELETE_LINK_COUNT_INVALID");
  });
});
}

{


const file = { name: "forms.pdf", size: 1024, digest: "operation-source" };
const create = (id: MockWorkflowId_m4, changes: Partial<MockDraft_m4> = {}) => mockRunsForDraft_m4(id, { ...initialMockDraft_m4(id), text: mockWorkflow_m4(id).example, files: [file], dryRun: false, ...changes }, 42);
const completed = (id: MockWorkflowId_m4, changes: Partial<MockDraft_m4> = {}) => {
  const runs = create(id, changes), ocr = runs.find(run => run.workflowId === "ocr");
  return ocr ? approveMockRun_m4(runs, ocr.id) : runs;
};
const person = (id: MockWorkflowId_m4) => completed(id, { method: "pdf" }).find(run => run.role === "person")!;
const fields = (run: MockRun_m4) => mockRunLog_m4(run).steps.flatMap(step => step.entries.flatMap(entry => entry.kind === "fields" ? entry.fields : []));
const clicks = (run: MockRun_m4) => mockRunLog_m4(run).steps.flatMap(step => step.entries.flatMap(entry => entry.kind === "click" ? [entry.label] : []));

describe_m4("source-backed workflow operation detail", () => {
  it_m4("populates every workflow's declared step and preserves coherent timeline identities and durations", () => {
    const runs = seedMockRuns_m4();
    const all = [...runs, ...runs.filter(run => run.workflowId === "ocr").flatMap(run => approveMockRun_m4(runs, run.id).filter(child => child.role === "person" && child.ocrRunId === run.id))];
    expect_m4(new Set(all.map(run => run.workflowId))).toEqual(new Set(MOCK_WORKFLOWS_m4.map(flow => flow.id)));
    for (const run of all) {
      const log = mockRunLog_m4(run); expect_m4(run.title).toBe(run.subject);
      for (const step of mockRunPipeline_m4(run)) {
        const operations = mockOperations_m4(run, step); expect_m4(operations.length, `${run.workflowId}:${step.key}`).toBeGreaterThan(0);
        for (const operation of operations) for (const [, value] of operation.fields ?? []) expect_m4(mockOperationValue_m4(run, value).length).toBeGreaterThan(0);
      }
      expect_m4(new Set(log.steps.map(step => step.id)).size).toBe(log.steps.length);
      const entryIds = log.steps.flatMap(step => step.entries.map(entry => entry.id)); expect_m4(new Set(entryIds).size).toBe(entryIds.length);
      expect_m4(log.timeline.map(stage => stage.stepId)).toEqual(log.steps.map(step => step.id));
      expect_m4(log.timeline.map(stage => stage.time)).toEqual([...log.timeline.map(stage => stage.time)].sort());
      for (const stage of log.timeline.slice(0, -1)) {
        expect_m4(stage.substeps.length).toBeGreaterThan(0);
        for (const child of stage.substeps) if (child.state !== "completed") expect_m4(child.durationLabel).toBeUndefined();
        if (["pending", "waiting", "cancelled"].includes(stage.state)) expect_m4(stage.durationLabel).toBeUndefined();
      }
    }
  });
  it_m4("includes the complete new-hire tab walk and changes the actual form for rehire", () => {
    const hire = completed("onboarding")[0], rehire = completed("onboarding", { hireType: "rehire" })[0];
    expect_m4(clicks(hire)).toEqual(expect_m4.arrayContaining(["Create Transaction", "Job Data", "Earns Dist", "Employee Experience", "Return to Personal Data", "Save and Submit"]));
    expect_m4(fields(hire)).toEqual(expect_m4.arrayContaining([expect_m4.objectContaining({ label: "Template", value: "UC_FULL_HIRE" }), expect_m4.objectContaining({ label: "Compensation rate code", value: "UCHRLY" }), expect_m4.objectContaining({ label: "Expected job end date", value: "06/30/2027" })]));
    expect_m4(fields(rehire)).toEqual(expect_m4.arrayContaining([expect_m4.objectContaining({ label: "Template", value: "UC_CONC_HIRE" }), expect_m4.objectContaining({ label: "Reason", value: "Concurrent Hire - Non Dual Emp" })]));
    const transaction = mockRunLog_m4(rehire).steps.find(step => step.title === "Submit hire")!;
    expect_m4(transaction.entries.filter(entry => entry.kind === "fields").map(entry => entry.title)).not.toContain("Personal Data");
    expect_m4(clicks(rehire)).not.toContain("Employee Experience");
    expect_m4(clicks(rehire)).toEqual(expect_m4.arrayContaining(["Acknowledge the matching Person ID already exists", "Personal Data"]));
    expect_m4(fields(rehire)).toEqual(expect_m4.arrayContaining([expect_m4.objectContaining({ label: "Resolved name", value: "Jordan Lee" }), expect_m4.objectContaining({ label: "Legal name", value: "Jordan Lee" }), expect_m4.objectContaining({ label: "Comments", value: "Concurrent Hire as Dining Student Effective 08/03/2026. PCN DEMO-POS-001. Job number #DEMO-REC-001." })]));
    expect_m4(mockRunLog_m4(rehire).timeline.find(stage => stage.label === "Create I-9 profile")!.substeps.every(step => step.state === "skipped")).toBe(true);
  });
  it_m4("shows staged onboarding fields in dry run while keeping commits, receipts and omitted steps skipped", () => {
    const dry = completed("onboarding", { dryRun: true })[0], log = mockRunLog_m4(dry);
    expect_m4(fields(dry)).toEqual(expect_m4.arrayContaining([expect_m4.objectContaining({ label: "Compensation rate", value: "$17.75 per hour" })]));
    expect_m4(clicks(dry)).not.toEqual(expect_m4.arrayContaining(["Save and Submit"])); expect_m4(clicks(dry)).not.toContain("Save & Continue");
    expect_m4(fields(dry).map(field => field.label)).not.toContain("Transaction number");
    const transaction = log.timeline.find(stage => stage.label === "Submit hire")!;
    expect_m4(transaction.state).toBe("skipped"); expect_m4(transaction.substeps.find(step => step.label === "Job Data")!.state).toBe("completed");
    expect_m4(transaction.substeps.find(step => step.label === "Save and Submit")!.state).toBe("skipped");
    const missingI9 = { ...initialMockDraft_m4("onboarding"), text: mockWorkflow_m4("onboarding").example,
      selectedSteps: mockWorkflow_m4("onboarding").steps.filter(step => step.key !== "i9-creation").map(step => step.key) };
    expect_m4(mockStepInputError_m4("onboarding", missingI9)).toBe("Create I-9 profile is required.");
    expect_m4(() => create("onboarding", missingI9)).toThrow("Create I-9 profile is required.");
    expect_m4(editableMockDraft_m4("onboarding", missingI9).selectedSteps).toContain("i9-creation");
    const rehire = completed("onboarding", { dryRun: true, hireType: "rehire" })[0];
    const i9 = mockRunLog_m4(rehire).timeline.find(stage => stage.label === "Create I-9 profile")!;
    expect_m4(i9.substeps.every(step => step.state === "skipped")).toBe(true);
    const readValues = Object.fromEntries(manualReadFields_m4("onboarding", "crm-search")
      .map(field => [field.key, field.options?.[0] ?? (field.token === "$email" ? "sam.rivera@example.com" : "None")]));
    const omitted = completed("onboarding", { dryRun: true,
      selectedSteps: mockWorkflow_m4("onboarding").steps.filter(step => step.key !== "crm-search").map(step => step.key),
      manualSteps: ["crm-search"], manualValues: { "crm-search": readValues } })[0];
    expect_m4(mockStepState_m4(omitted, mockWorkflow_m4("onboarding").steps.find(step => step.key === "crm-search")!)).toBe("skipped");
    const concurrent = completed("onboarding", { dryRun: true, hireType: "rehire" })[0];
    expect_m4(clicks(concurrent)).toContain("Cancel unsubmitted draft"); expect_m4(clicks(concurrent)).not.toContain("Save and Submit");
    expect_m4(fields(concurrent)).toEqual(expect_m4.arrayContaining([expect_m4.objectContaining({ label: "Draft status", value: "Cancelled" })]));
  });
  it_m4("carries exact Work-Study comments and OnBase import settings and all required keywords", () => {
    const work = completed("work-study", { effectiveDate: "2026-09-12" })[0];
    expect_m4(fields(work)).toEqual(expect_m4.arrayContaining([expect_m4.objectContaining({ label: "Position change reason", value: "JRL" }), expect_m4.objectContaining({ label: "Comments", value: "Updated pool id to F per work study award 09/12/2026" })]));
    expect_m4(clicks(work)).toEqual(expect_m4.arrayContaining(["Job Data", "Additional Pay Data", "Save and Submit"]));
    const imported = person("onbase"), values = fields(imported);
    expect_m4(values).toEqual(expect_m4.arrayContaining([expect_m4.objectContaining({ label: "File type", value: "PDF (.pdf)" }), expect_m4.objectContaining({ label: "Document name", value: "EMERGENCY CONTACT INFORMATION" })]));
    expect_m4(values.map(field => field.label)).toEqual(expect_m4.arrayContaining(["UCPath ID", "Last name", "First name", "Document name", "Department name", "Department code", "Vice Chancellor", "Vice Chancellor code"]));
    expect_m4(clicks(imported)).toContain("Find → Select Employee");
  });
  it_m4("preserves extracted identity history and passes edited contact data to a separate person run", () => {
    const runs = create("emergency-contact"), ocr = runs[1], original = reviewRecords_m4(ocr)[0];
    const changed = editReviewRecord_m4(editReviewRecord_m4(editReviewRecord_m4(original, "employeeId", "10000009"), "contactName", "Sam Lee"), "sameAddress", "false");
    const edited = updateMockReview_m4(runs, ocr.id, [changed]), history = fields(edited[1]);
    expect_m4(history).toEqual(expect_m4.arrayContaining([expect_m4.objectContaining({ label: "Employee ID", value: "10000001" })]));
    const child = approveMockRun_m4(edited, ocr.id).find(run => run.role === "person")!;
    expect_m4(fields(child)).toEqual(expect_m4.arrayContaining([expect_m4.objectContaining({ label: "Contact name", value: "Sam Lee" }), expect_m4.objectContaining({ label: "Employee ID", value: "10000009" })]));
    expect_m4(mockRunLog_m4(child).steps.flatMap(step => step.entries).some(entry => entry.kind === "fields" && entry.title === "Contact address")).toBe(true);
    expect_m4(mockRunLog_m4(person("emergency-contact")).steps.flatMap(step => step.entries).some(entry => entry.kind === "fields" && entry.title === "Contact address")).toBe(false);
  });
  it_m4("contains the exact HR inquiry, oath commit boundary, I-9 retention row and validated report range", () => {
    const upload = completed("oath-upload").find(run => run.workflowId === "oath-upload")!;
    expect_m4(fields(upload)).toEqual(expect_m4.arrayContaining([expect_m4.objectContaining({ label: "Specifically", value: "Signing Ceremony (Oath)" }), expect_m4.objectContaining({ label: "Category", value: "Payroll" }), expect_m4.objectContaining({ label: "Description", value: "Please see attached oaths for employees hired under HDH." })]));
    expect_m4(clicks(person("oath-signature"))).toEqual(expect_m4.arrayContaining(["OK · stage oath row", "Save · commit oath"]));
    expect_m4(fields(person("i9-check")).map(field => field.label)).toEqual(expect_m4.arrayContaining(["Section 1 page", "Section 2 page", "Hire date match", "PPS ID", "Section 1 present", "Section 2 present"]));
    const report = completed("old-kronos-reports", { startDate: "2018-02-03", endDate: "2019-04-05" })[0];
    expect_m4(fields(report)).toEqual(expect_m4.arrayContaining([expect_m4.objectContaining({ label: "Start date", value: "02/03/2018" }), expect_m4.objectContaining({ label: "End date", value: "04/05/2019" }), expect_m4.objectContaining({ label: "Identity match", value: "Confirmed" })]));
  });
  it_m4("derives rail counts from the same queue and updates approval, cancellation and child totals", () => {
    const runs = create("emergency-contact"), counts = mockWorkflowCounts_m4(runs);
    expect_m4(counts.find(row => row.workflowId === "emergency-contact")!.count).toBe(1); expect_m4(activeCount_m4(workflowStatusCounts_m4(counts, "emergency-contact"))).toBe(1);
    expect_m4(activeCount_m4(workflowStatusCounts_m4(counts, "ocr"))).toBe(0);
    const approved = mockWorkflowCounts_m4(approveMockRun_m4(runs, runs[1].id));
    expect_m4(approved.find(row => row.workflowId === "emergency-contact")!.count).toBe(2); expect_m4(activeCount_m4(workflowStatusCounts_m4(approved, "emergency-contact"))).toBe(0);
    const discarded = mockWorkflowCounts_m4(discardMockReview_m4(runs, runs[1].id));
    expect_m4(discarded.find(row => row.workflowId === "ocr")!.statusCounts).toContainEqual({ status: "cancelled", count: 1 });
    for (const row of [...counts, ...approved, ...discarded]) expect_m4(row.statusCounts.reduce((sum, status) => sum + status.count, 0)).toBe(row.count);
  });
  it_m4("does not claim conditional identity correction or primary-contact demotion in the default path", () => {
    for (const run of [completed("separations")[0], person("emergency-contact")]) {
      const notes = mockRunLog_m4(run).steps.flatMap(step => step.entries.flatMap(entry => entry.kind === "note" ? [entry.message] : []));
      expect_m4(notes.join(" ")).not.toContain("the demoted row re-read"); expect_m4(notes.join(" ")).not.toContain("the corrected name re-read");
    }
  });
});
}

{


const draft = { ...initialMockDraft_m5("emergency-contact"), files: [{ name: "contact.pdf", size: 100, digest: "synthetic" }] };
describe_m5("completed review action notifications", () => {
  it_m5("confirms approval only after the guarded transition and preserves the source records", () => {
    const runs = mockRunsForDraft_m5("emergency-contact", draft, 1), id = runs[1].id;
    const result = completeMockReviewAction_m5(runs, id, "approve");
    expect_m5(result.notice).toEqual({ title: "Records approved", description: "1 record released to the parent workflow." });
    expect_m5(result.runs.find(run => run.role === "person")?.inputRecord).toEqual(reviewRecords_m5(runs[1])[0]);
    expect_m5(runs.every(run => !run.approved)).toBe(true);
    expect_m5(() => completeMockReviewAction_m5(result.runs, id, "approve")).toThrow("MOCK_APPROVAL_UNAVAILABLE");
    expect_m5(() => completeMockReviewAction_m5(mockRunsForDraft_m5("emergency-contact", { ...draft, ocrMode: "manual" }, 2), "mock:emergency-contact:2:0:ocr", "approve")).toThrow("MOCK_APPROVAL_NO_RECORDS");
    expect_m5(() => completeMockReviewAction_m5(runs, "missing", "approve")).toThrow("MOCK_REVIEW_ACTION_SOURCE_MISSING");
  });
  it_m5("confirms discard and restore while retaining the parent gate and refusing replay", () => {
    const runs = mockRunsForDraft_m5("emergency-contact", draft, 1), id = runs[1].id;
    const discarded = completeMockReviewAction_m5(runs, id, "discard");
    expect_m5(discarded.notice.title).toBe("Review discarded");
    expect_m5(discarded.runs.every(run => run.discarded)).toBe(true);
    expect_m5(() => completeMockReviewAction_m5(discarded.runs, id, "discard")).toThrow("MOCK_REVIEW_READ_ONLY");
    const restored = completeMockReviewAction_m5(discarded.runs, id, "restore");
    expect_m5(restored.notice.title).toBe("Review restored");
    expect_m5(restored.runs.every(run => !run.discarded && !run.approved)).toBe(true);
    expect_m5(() => completeMockReviewAction_m5(restored.runs, id, "restore")).toThrow("MOCK_REVIEW_RESTORE_UNAVAILABLE");
  });
  it_m5("keeps standalone OCR retries and deletion independent while delegated retries retain their parent", () => {
    const standalone = mockRunsForDraft_m5("ocr", { ...initialMockDraft_m5("ocr"), files: draft.files }, 1);
    expect_m5(mockRetrySource_m5(standalone, standalone[0].id)).toBe(standalone[0]);
    expect_m5(mockDeletionIds_m5(standalone, standalone[0].id)).toEqual([standalone[0].id]);
    expect_m5(() => completeMockReviewAction_m5(standalone, standalone[0].id, "approve")).toThrow("MOCK_APPROVAL_UNAVAILABLE");
    const delegated = mockRunsForDraft_m5("emergency-contact", draft, 2);
    expect_m5(mockRetrySource_m5(delegated, delegated[1].id)).toBe(delegated[0]);
  });
  it_m5("uses the parent's predefined document fields when an uploaded fixture has another shape", () => {
    const runs = mockRunsForDraft_m5("emergency-contact", { ...draft, formType: "oath", files: [{ name: "single-oath.pdf", size: 4096, digest: "fixture:document:single-oath.pdf" }] }, 1);
    expect_m5(runs[1].draft.formType).toBe("emergency-contact");
    expect_m5(() => mockRunsForDraft_m5("ocr", { ...initialMockDraft_m5("ocr"), formType: "verify", files: draft.files }, 3)).toThrow("Choose a supported form type.");
    const record = reviewRecords_m5(runs[1])[0];
    expect_m5(record.kind).toBe("contact");
    expect_m5(record.fields.some(field => field.key === "contactName")).toBe(true);
    expect_m5(record.fields.some(field => field.key === "dateSigned")).toBe(false);
    expect_m5(record.match).toBe("unresolved");
    expect_m5(record.fields.every(field => field.value === "" || field.value === "false")).toBe(true);
  });
});
}

{


const preparation = () => mockRunsForDraft_m6("emergency-contact", { ...initialMockDraft_m6("emergency-contact"), files: [{ name: "contact.pdf", size: 1024, digest: "fixture" }] }, 1);
describe_m6("OCR source comparison and corrected handoff", () => {
  it_m6("presents extracted oath dates with four-digit years without changing the source image", () => {
    const run = seedMockRuns_m6().find(run => run.id === "mock:oath-signature:sample:ocr")!;
    const markup = renderToStaticMarkup_m6(createElement_m6(WorkflowMockReview_m6, { run, sourcePages: { "person-1": documentSourcePages_m6(run.draft, reviewRecords_m6(run)[0])! }, onChange: () => {}, onRestore: () => {} }));
    expect_m6(markup).toContain('value="04/27/2026"'); expect_m6(markup).toContain('value="04/23/2026"');
    expect_m6(markup).not.toContain('value="04/27/26"'); expect_m6(markup).not.toContain('value="4-23-26"');
    expect_m6(markup).toContain('single-oath-1.webp');
  });
  it_m6("accepts source image URLs separately from the extracted field response", () => {
    const run = preparation()[1];
    const markup = renderToStaticMarkup_m6(createElement_m6(WorkflowMockReview_m6, { run, sourcePages: { "person-1": [{ page: 1, imageUrl: "/retained/source-page-1.png" }] }, onChange: () => {}, onRestore: () => {} }));
    expect_m6(markup).toContain('src="/retained/source-page-1.png"');
    expect_m6(markup).not.toContain("data:image/svg");
    const missing = renderToStaticMarkup_m6(createElement_m6(WorkflowMockReview_m6, { run, sourcePages: {}, onChange: () => {}, onRestore: () => {} }));
    expect_m6(missing).toContain("No source page for this record"); expect_m6(missing).not.toContain("<img");
  });
  it_m6("preserves every response field exactly once in the editor, including blank and unknown fields", () => {
    const record = reviewRecords_m6(preparation()[1])[0];
    const additional = { ...record, fields: [...record.fields, { key: "newKey", label: "Additional field", value: "", section: "Other" }] };
    expect_m6(reviewFieldGroups_m6(additional).flatMap(group => group.fields)).toEqual(additional.fields);
    expect_m6(reviewFieldGroups_m6(additional).map(group => group.title)).toEqual(["Employee", "Employee address", "Emergency contact", "Other"]);
    for (const response of [...OCR_DOCUMENT_FIXTURES_m6.flatMap(document => document.records), additional]) {
      const displayed = reviewFieldGroups_m6(response).flatMap(group => reviewFieldBlocks_m6(group.fields).flat());
      expect_m6(displayed).toEqual(response.fields);
      expect_m6(displayed.every((field, index) => field === response.fields[index])).toBe(true);
      expect_m6(new Set(displayed.map(field => field.key)).size).toBe(response.fields.length);
    }
  });
  it_m6("preserves raw OCR date spellings and unmatched relationship values for correction", () => {
    const run = preparation()[1], record = reviewRecords_m6(run)[0];
    const corrected = editReviewRecord_m6(record, "relationship", "Cousin");
    const raw = { ...corrected, fields: [...corrected.fields, { key: "rawDate", label: "Date as printed", value: "4-23-26", kind: "date" as const }] };
    const markup = renderToStaticMarkup_m6(createElement_m6(WorkflowMockReview_m6, { run: { ...run, records: [raw] }, onChange: () => {}, onRestore: () => {} }));
    expect_m6(markup).toContain('name="rawDate"'); expect_m6(markup).toContain('value="4-23-26"');
    expect_m6(markup).not.toContain('type="date"'); expect_m6(markup).toContain("Cousin");
    const oathRuns = mockRunsForDraft_m6("oath-signature", { ...initialMockDraft_m6("oath-signature"), method: "pdf", files: [{ name: "oath.pdf", size: 1024, digest: "fixture" }] }, 1);
    const oath = oathRuns[1], original = reviewRecords_m6(oath)[0];
    for (const [date, displayed] of [["4-23-26", "4-23-26"], ["2026-04-23", "04/23/2026"], ["", "—"]]) {
      const updated = updateMockReview_m6(oathRuns, oath.id, [editReviewRecord_m6(original, "dateSigned", date)]);
      const child = approveMockRun_m6(updated, oath.id).find(run => run.role === "person")!;
      expect_m6(mockOperationValue_m6(child, "$signedDate")).toBe(displayed);
    }
  });
  it_m6("keeps the source image fixed across corrections and approval, and copies every corrected field", () => {
    const runs = preparation(), source = runs[1], original = reviewRecords_m6(source)[0];
    const image = reviewSourcePages_m6(original)[0].imageUrl;
    const corrected = original.fields.reduce((record, field) => editReviewRecord_m6(record, field.key, field.key === "employeeId" ? "10001234" : field.kind === "boolean" ? "false" : field.kind === "date" ? "2026-08-04" : `${field.value} corrected`), original);
    const updated = updateMockReview_m6(runs, source.id, [corrected]);
    expect_m6(reviewSourcePages_m6(seedReviewRecords_m6(updated[1])[0])[0].imageUrl).toBe(image);
    const approved = approveMockRun_m6(updated, source.id), child = approved.find(run => run.role === "person")!;
    expect_m6(child.inputRecord).toEqual(corrected); expect_m6(child.inputRecord).not.toBe(corrected);
    expect_m6(child.inputRecord!.fields).not.toBe(corrected.fields);
    expect_m6(reviewValue_m6(child.inputRecord!, "employeeId")).toBe("10001234");
    expect_m6(reviewSourcePages_m6(seedReviewRecords_m6(approved.find(run => run.id === source.id)!)[0])[0].imageUrl).toBe(image);
  });
  it_m6("offers both fixed I-9 source pages independently of corrected page fields", () => {
    const run = preparation()[1], original = seedReviewRecords_m6({ ...run, draft: { ...run.draft, formType: "i9" } })[0];
    const pages = reviewSourcePages_m6(original);
    expect_m6(pages.map(page => page.page)).toEqual([1, 2]);
    expect_m6(decodeURIComponent(pages[0].imageUrl)).toContain("Form I-9 · Section 1");
    expect_m6(decodeURIComponent(pages[1].imageUrl)).toContain("Form I-9 · Section 2");
    expect_m6(pages[0].imageUrl).not.toBe(pages[1].imageUrl);
    expect_m6(() => reviewSourcePages_m6({ ...original, fields: original.fields.filter(field => field.key !== "section1") })).toThrow("MOCK_SOURCE_PAGE_INVALID");
  });
  it_m6("escapes extracted source content before rendering a page image", () => {
    const record = reviewRecords_m6(preparation()[1])[0];
    const image = decodeURIComponent(reviewSourcePages_m6(editReviewRecord_m6(record, "contactName", '<script>alert("x")</script> & more'))[0].imageUrl);
    expect_m6(image).not.toContain("<script>"); expect_m6(image).toContain("&lt;script&gt;"); expect_m6(image).toContain("&amp; more");
  });
  it_m6("does not add a synthetic Result stage or a second log section", () => {
    const runs = preparation(), approved = approveMockRun_m6(runs, runs[1].id);
    for (const run of [...runs, ...approved]) {
      const log = mockRunLog_m6(run);
      expect_m6(log.timeline.map(stage => stage.id)).toEqual(log.steps.map(step => step.id));
      expect_m6(log.timeline.some(stage => stage.label === "Result" || stage.id.endsWith(":result"))).toBe(false);
      expect_m6(log.steps.some(step => step.title === "Result" || step.id.endsWith(":result"))).toBe(false);
    }
  });
});
}

describe_m0("mock final employee identity", () => {
  it_m0("keeps the resolved employee ID distinct from the separation Kuali input", () => {
    const run = mockRunsForDraft_m0("separations", { ...initialMockDraft_m0("separations"), text: "48216" }, 0)[0];
    const steps = mockRunLog_m0(run).steps;
    const fields = steps.flatMap(step => step.entries.flatMap(entry => entry.kind === "fields" ? entry.fields : []));
    expect_m0(fields.filter(field => field.label === "Employee ID").map(field => field.value)).toEqual(expect_m0.arrayContaining(["10000001"]));
    expect_m0(fields.filter(field => field.label === "Employee ID").every(field => field.value === "10000001")).toBe(true);
    expect_m0(fields.find(field => field.id === `${run.id}:field:0`)).toMatchObject({ label: "Kuali ID", value: "48216" });
    expect_m0(fields.find(field => field.id === `${run.id}:field:2`)).toMatchObject({ label: "Employee ID", value: "10000001" });
  });
  it_m0("retains an eight-digit employee input in earlier steps and final readback", () => {
    const run = mockRunsForDraft_m0("work-study", { ...initialMockDraft_m0("work-study"), text: "10000009" }, 0)[0];
    const fields = mockRunLog_m0(run).steps.flatMap(step => step.entries.flatMap(entry => entry.kind === "fields" ? entry.fields : []));
    expect_m0(fields.filter(field => field.label === "Employee ID").every(field => field.value === "10000009")).toBe(true);
    expect_m0(fields.find(field => field.id === `${run.id}:field:1`)).toMatchObject({ label: "Employee ID", value: "10000009" });
  });
});
