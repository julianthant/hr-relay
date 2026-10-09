import { describe, expect, it } from "vitest";
import { MOCK_WORKFLOWS, mockWorkflow, type MockWorkflowId } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.js";
import { approveMockRun, initialMockDraft, mockRunLog, mockRunPipeline, mockRunsForDraft, mockStepState, mockWorkflowCounts, seedMockRuns, type MockDraft, type MockRun } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import { mockOperationValue, mockOperations } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-operation-model.js";
import { discardMockReview, editReviewRecord, reviewRecords, updateMockReview } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-review-model.js";
import { manualReadFields, editableMockDraft, mockStepInputError } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-manual-model.js";
import { activeCount, workflowStatusCounts } from "../../../src/dashboard/surfaces/shell/shell-model.js";
import { buildWorkflowMock, initialWorkflowChoices, updateWorkflowChoice, workflowContractSource } from "../../../src/dashboard/surfaces/explorer/explorer-workflow-model.js";
import { allFields } from "../../../src/dashboard/surfaces/explorer/explorer-flow-model.js";

const file = { name: "forms.pdf", size: 1024, digest: "operation-source" };
const create = (id: MockWorkflowId, changes: Partial<MockDraft> = {}) => mockRunsForDraft(id, { ...initialMockDraft(id), text: mockWorkflow(id).example, files: [file], dryRun: false, ...changes }, 42);
const completed = (id: MockWorkflowId, changes: Partial<MockDraft> = {}) => {
  const runs = create(id, changes), ocr = runs.find(run => run.workflowId === "ocr");
  return ocr ? approveMockRun(runs, ocr.id) : runs;
};
const person = (id: MockWorkflowId) => completed(id, { method: "pdf" }).find(run => run.role === "person")!;
const fields = (run: MockRun) => mockRunLog(run).steps.flatMap(step => step.entries.flatMap(entry => entry.kind === "fields" ? entry.fields : []));
const clicks = (run: MockRun) => mockRunLog(run).steps.flatMap(step => step.entries.flatMap(entry => entry.kind === "click" ? [entry.label] : []));

describe("source-backed workflow operation detail", () => {
  it("populates every workflow's declared step and preserves coherent timeline identities and durations", () => {
    const runs = seedMockRuns();
    const all = [...runs, ...runs.filter(run => run.workflowId === "ocr").flatMap(run => approveMockRun(runs, run.id).filter(child => child.role === "person" && child.ocrRunId === run.id))];
    expect(new Set(all.map(run => run.workflowId))).toEqual(new Set(MOCK_WORKFLOWS.map(flow => flow.id)));
    for (const run of all) {
      const log = mockRunLog(run); expect(run.title).toBe(run.subject);
      for (const step of mockRunPipeline(run)) {
        const operations = mockOperations(run, step); expect(operations.length, `${run.workflowId}:${step.key}`).toBeGreaterThan(0);
        for (const operation of operations) for (const [, value] of operation.fields ?? []) expect(mockOperationValue(run, value).length).toBeGreaterThan(0);
      }
      expect(new Set(log.steps.map(step => step.id)).size).toBe(log.steps.length);
      const entryIds = log.steps.flatMap(step => step.entries.map(entry => entry.id)); expect(new Set(entryIds).size).toBe(entryIds.length);
      expect(log.timeline.map(stage => stage.stepId)).toEqual(log.steps.map(step => step.id));
      expect(log.timeline.map(stage => stage.time)).toEqual([...log.timeline.map(stage => stage.time)].sort());
      for (const stage of log.timeline.slice(0, -1)) {
        expect(stage.substeps.length).toBeGreaterThan(0);
        for (const child of stage.substeps) if (child.state !== "completed") expect(child.durationLabel).toBeUndefined();
        if (["pending", "waiting", "cancelled"].includes(stage.state)) expect(stage.durationLabel).toBeUndefined();
      }
    }
  });
  it("includes the complete new-hire tab walk and changes the actual form for rehire", () => {
    const hire = completed("onboarding")[0], rehire = completed("onboarding", { hireType: "rehire" })[0];
    expect(clicks(hire)).toEqual(expect.arrayContaining(["Create Transaction", "Job Data", "Earns Dist", "Employee Experience", "Return to Personal Data", "Save and Submit"]));
    expect(fields(hire)).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Template", value: "UC_FULL_HIRE" }), expect.objectContaining({ label: "Compensation rate code", value: "UCHRLY" }), expect.objectContaining({ label: "Expected job end date", value: "06/30/2027" })]));
    expect(fields(rehire)).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Template", value: "UC_CONC_HIRE" }), expect.objectContaining({ label: "Reason", value: "Concurrent Hire - Non Dual Emp" })]));
    const transaction = mockRunLog(rehire).steps.find(step => step.title === "Submit hire")!;
    expect(transaction.entries.filter(entry => entry.kind === "fields").map(entry => entry.title)).not.toContain("Personal Data");
    expect(clicks(rehire)).not.toContain("Employee Experience");
    expect(clicks(rehire)).toEqual(expect.arrayContaining(["Acknowledge the matching Person ID already exists", "Personal Data"]));
    expect(fields(rehire)).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Resolved name", value: "Jordan Lee" }), expect.objectContaining({ label: "Legal name", value: "Jordan Lee" }), expect.objectContaining({ label: "Comments", value: "Concurrent Hire as Dining Student Effective 08/03/2026. PCN DEMO-POS-001. Job number #DEMO-REC-001." })]));
    expect(mockRunLog(rehire).timeline.find(stage => stage.label === "Create I-9 profile")!.substeps.every(step => step.state === "skipped")).toBe(true);
  });
  it("shows staged onboarding fields in dry run while keeping commits, receipts and omitted steps skipped", () => {
    const dry = completed("onboarding", { dryRun: true })[0], log = mockRunLog(dry);
    expect(fields(dry)).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Compensation rate", value: "$17.75 per hour" })]));
    expect(clicks(dry)).not.toEqual(expect.arrayContaining(["Save and Submit"])); expect(clicks(dry)).not.toContain("Save & Continue");
    expect(fields(dry).map(field => field.label)).not.toContain("Transaction number");
    const transaction = log.timeline.find(stage => stage.label === "Submit hire")!;
    expect(transaction.state).toBe("skipped"); expect(transaction.substeps.find(step => step.label === "Job Data")!.state).toBe("completed");
    expect(transaction.substeps.find(step => step.label === "Save and Submit")!.state).toBe("skipped");
    const missingI9 = { ...initialMockDraft("onboarding"), text: mockWorkflow("onboarding").example,
      selectedSteps: mockWorkflow("onboarding").steps.filter(step => step.key !== "i9-creation").map(step => step.key) };
    expect(mockStepInputError("onboarding", missingI9)).toBe("Create I-9 profile is required.");
    expect(() => create("onboarding", missingI9)).toThrow("Create I-9 profile is required.");
    expect(editableMockDraft("onboarding", missingI9).selectedSteps).toContain("i9-creation");
    const rehire = completed("onboarding", { dryRun: true, hireType: "rehire" })[0];
    const i9 = mockRunLog(rehire).timeline.find(stage => stage.label === "Create I-9 profile")!;
    expect(i9.substeps.every(step => step.state === "skipped")).toBe(true);
    const readValues = Object.fromEntries(manualReadFields("onboarding", "crm-search")
      .map(field => [field.key, field.options?.[0] ?? (field.token === "$email" ? "sam.rivera@example.com" : "None")]));
    const omitted = completed("onboarding", { dryRun: true,
      selectedSteps: mockWorkflow("onboarding").steps.filter(step => step.key !== "crm-search").map(step => step.key),
      manualSteps: ["crm-search"], manualValues: { "crm-search": readValues } })[0];
    expect(mockStepState(omitted, mockWorkflow("onboarding").steps.find(step => step.key === "crm-search")!)).toBe("skipped");
    const concurrent = completed("onboarding", { dryRun: true, hireType: "rehire" })[0];
    expect(clicks(concurrent)).toContain("Cancel unsubmitted draft"); expect(clicks(concurrent)).not.toContain("Save and Submit");
    expect(fields(concurrent)).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Draft status", value: "Cancelled" })]));
  });
  it("carries exact Work-Study comments and OnBase import settings and all required keywords", () => {
    const work = completed("work-study", { effectiveDate: "2026-09-12" })[0];
    expect(fields(work)).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Position change reason", value: "JRL" }), expect.objectContaining({ label: "Comments", value: "Updated pool id to F per work study award 09/12/2026" })]));
    expect(clicks(work)).toEqual(expect.arrayContaining(["Job Data", "Additional Pay Data", "Save and Submit"]));
    const imported = person("onbase"), values = fields(imported);
    expect(values).toEqual(expect.arrayContaining([expect.objectContaining({ label: "File type", value: "PDF (.pdf)" }), expect.objectContaining({ label: "Document name", value: "EMERGENCY CONTACT INFORMATION" })]));
    expect(values.map(field => field.label)).toEqual(expect.arrayContaining(["UCPath ID", "Last name", "First name", "Document name", "Department name", "Department code", "Vice Chancellor", "Vice Chancellor code"]));
    expect(clicks(imported)).toContain("Find → Select Employee");
  });
  it("preserves extracted identity history and passes edited contact data to a separate person run", () => {
    const runs = create("emergency-contact"), ocr = runs[1], original = reviewRecords(ocr)[0];
    const changed = editReviewRecord(editReviewRecord(editReviewRecord(original, "employeeId", "10000009"), "contactName", "Sam Lee"), "sameAddress", "false");
    const edited = updateMockReview(runs, ocr.id, [changed]), history = fields(edited[1]);
    expect(history).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Employee ID", value: "10000001" })]));
    const child = approveMockRun(edited, ocr.id).find(run => run.role === "person")!;
    expect(fields(child)).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Contact name", value: "Sam Lee" }), expect.objectContaining({ label: "Employee ID", value: "10000009" })]));
    expect(mockRunLog(child).steps.flatMap(step => step.entries).some(entry => entry.kind === "fields" && entry.title === "Contact address")).toBe(true);
    expect(mockRunLog(person("emergency-contact")).steps.flatMap(step => step.entries).some(entry => entry.kind === "fields" && entry.title === "Contact address")).toBe(false);
  });
  it("contains the exact HR inquiry, oath commit boundary, I-9 retention row and validated report range", () => {
    const upload = completed("oath-upload").find(run => run.workflowId === "oath-upload")!;
    expect(fields(upload)).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Specifically", value: "Signing Ceremony (Oath)" }), expect.objectContaining({ label: "Category", value: "Payroll" }), expect.objectContaining({ label: "Description", value: "Please see attached oaths for employees hired under HDH." })]));
    expect(clicks(person("oath-signature"))).toEqual(expect.arrayContaining(["OK · stage oath row", "Save · commit oath"]));
    expect(fields(person("i9-check")).map(field => field.label)).toEqual(expect.arrayContaining(["Section 1 page", "Section 2 page", "Hire date match", "PPS ID", "Section 1 present", "Section 2 present"]));
    const report = completed("old-kronos-reports", { startDate: "2018-02-03", endDate: "2019-04-05" })[0];
    expect(fields(report)).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Start date", value: "02/03/2018" }), expect.objectContaining({ label: "End date", value: "04/05/2019" }), expect.objectContaining({ label: "Identity match", value: "Confirmed" })]));
  });
  it("derives rail counts from the same queue and updates approval, cancellation and child totals", () => {
    const runs = create("emergency-contact"), counts = mockWorkflowCounts(runs);
    expect(counts.find(row => row.workflowId === "emergency-contact")!.count).toBe(1); expect(activeCount(workflowStatusCounts(counts, "emergency-contact"))).toBe(1);
    expect(activeCount(workflowStatusCounts(counts, "ocr"))).toBe(0);
    const approved = mockWorkflowCounts(approveMockRun(runs, runs[1].id));
    expect(approved.find(row => row.workflowId === "emergency-contact")!.count).toBe(2); expect(activeCount(workflowStatusCounts(approved, "emergency-contact"))).toBe(0);
    const discarded = mockWorkflowCounts(discardMockReview(runs, runs[1].id));
    expect(discarded.find(row => row.workflowId === "ocr")!.statusCounts).toContainEqual({ status: "cancelled", count: 1 });
    for (const row of [...counts, ...approved, ...discarded]) expect(row.statusCounts.reduce((sum, status) => sum + status.count, 0)).toBe(row.count);
  });
  it("does not claim conditional identity correction or primary-contact demotion in the default path", () => {
    for (const run of [completed("separations")[0], person("emergency-contact")]) {
      const notes = mockRunLog(run).steps.flatMap(step => step.entries.flatMap(entry => entry.kind === "note" ? [entry.message] : []));
      expect(notes.join(" ")).not.toContain("the demoted row re-read"); expect(notes.join(" ")).not.toContain("the corrected name re-read");
    }
  });
  it("resolves Explorer's detailed field provenance and excludes evidence for unavailable outcomes", () => {
    for (const id of ["work-study", "onbase", "oath-upload", "old-kronos-reports", "ocr"] as const) {
      const choices = initialWorkflowChoices(id), mock = buildWorkflowMock(id, choices);
      const detail = mock.steps.flatMap(step => allFields(step.parts).filter(field => field.source?.startsWith("operation:")).map(field => [field, step.number] as const));
      expect(detail.length, id).toBeGreaterThan(0);
      for (const [field, step] of detail) expect(workflowContractSource(id, choices, field, step)?.origin).toBeTruthy();
    }
    const absent = buildWorkflowMock("i9-lookup", updateWorkflowChoice("i9-lookup", initialWorkflowChoices("i9-lookup"), "profile", "absent"));
    expect(absent.steps.flatMap(step => allFields(step.parts)).some(field => field.value === "Section 2 complete")).toBe(false);
    const mismatch = buildWorkflowMock("old-kronos-reports", updateWorkflowChoice("old-kronos-reports", initialWorkflowChoices("old-kronos-reports"), "pdf", "mismatch"));
    expect(mismatch.steps.flatMap(step => allFields(step.parts)).some(field => field.label === "Identity match" && field.value === "Confirmed")).toBe(false);
  });
});
