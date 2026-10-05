import { describe, expect, it } from "vitest";
import { MOCK_WORKFLOWS } from "../../../src/dashboard/surfaces/workflow-mock-catalog.js";
import { approveMockRun, initialMockDraft, mockRunLog, mockRunsForDraft, seedMockRuns } from "../../../src/dashboard/surfaces/workflow-mock-model.js";
import { addMockReviewRecord, discardMockReview, editReviewRecord, reviewCanApprove, reviewRecords, reviewValue, updateMockReview, reviewIsReadOnly, restoreMockReview } from "../../../src/dashboard/surfaces/workflow-review-model.js";
import { buildWorkflowMock, COMPLETE_EXPLORER_WORKFLOWS, initialWorkflowChoices, updateWorkflowChoice, workflowChoices, workflowContractSource } from "../../../src/dashboard/surfaces/explorer/explorer-workflow-model.js";
import { allFields } from "../../../src/dashboard/surfaces/explorer/explorer-flow-model.js";
import { workflowPreviewGraph } from "../../../src/dashboard/surfaces/workflow-preview-contracts.js";

const preparation = (id: "emergency-contact" | "onbase" | "oath-upload") => mockRunsForDraft(id, { ...initialMockDraft(id), files: [{ name: "fictional.pdf", size: 1024, digest: "fixture" }] }, 1)[0];
describe("complete workflow presentation mocks", () => {
  it("covers every rail workflow and renders every declared variant without missing contract values", () => {
    expect(new Set(COMPLETE_EXPLORER_WORKFLOWS.map(item => item.id.replace(/^fixture-/u, "")))).toEqual(new Set(MOCK_WORKFLOWS.map(item => item.id)));
    for (const flow of MOCK_WORKFLOWS) {
      const values = initialWorkflowChoices(flow.id);
      for (const scenario of [values, ...workflowChoices(flow.id).flatMap(choice => choice.options.map(([value]) => updateWorkflowChoice(flow.id, values, choice.key, value)))]) {
        const result = buildWorkflowMock(flow.id, scenario);
        expect(result.steps.length).toBeGreaterThan(1);
        for (const step of result.steps) for (const field of allFields(step.parts)) {
          expect(field.value.length).toBeGreaterThan(0);
          if (field.mode === "fill") expect(workflowContractSource(flow.id, scenario, field, step.number)).toBeDefined();
        }
      }
    }
  });
  it("keeps Work-Study's exact fields, configured SharePoint and validated Time Detail output", () => {
    const work = workflowPreviewGraph("work-study").nodes.find(node => node.id === "Transaction")!;
    expect(work.contract.map(row => row.field)).toEqual(["Effective date", "Position pool", "Change reason", "Job Data comments", "Initiator comments"]);
    expect(workflowPreviewGraph("sharepoint-download").nodes.map(node => node.id)).toEqual(["Navigate", "Download"]);
    expect(workflowPreviewGraph("old-kronos-reports").nodes.map(node => node.id)).toEqual(["Searching", "Extracting", "Downloading"]);
    expect(workflowPreviewGraph("onboarding").summary).toContain("then stages Smart HR without Save and Submit");
    const workRun = seedMockRuns().find(run => run.workflowId === "work-study")!;
    const fields = mockRunLog(workRun).steps.flatMap(step => step.entries.flatMap(entry => entry.kind === "fields" ? entry.fields : []));
    expect(fields).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Position pool", value: "F" }), expect.objectContaining({ label: "Change reason", value: "JRL" })]));
    const workProof = buildWorkflowMock("work-study", initialWorkflowChoices("work-study")).steps.find(step => step.title === "Transaction")!.parts.filter(part => part.kind === "action").map(part => part.text).join(" ");
    expect(workProof.match(/staged form readback and submission confirmation/gu)).toHaveLength(1);
    const logProof = mockRunLog(workRun).steps.flatMap(step => step.entries).filter(entry => entry.kind === "note").map(entry => entry.message).join(" ");
    expect(logProof.match(/staged form readback and submission confirmation/gu)).toHaveLength(1);
  });
  it("keeps manual identity provenance, selection gates and each approved person's edited values", () => {
    const source = preparation("emergency-contact"), original = reviewRecords(source)[0];
    const edited = editReviewRecord(editReviewRecord(original, "employeeId", "10000009"), "contactName", "Sam Lee");
    expect(edited.match).toBe("manual"); expect(edited.warnings.join(" ")).toContain("not confirmed by a UCPath lookup");
    expect(reviewCanApprove({ ...edited, unknown: true })).toBe(false);
    expect(reviewCanApprove(editReviewRecord(edited, "employeeId", "x"))).toBe(false);
    const second = { ...edited, id: "person-2", selected: false };
    const updated = updateMockReview([source], source.id, [edited, second]);
    const approved = approveMockRun(updated, source.id);
    const children = approved.filter(run => run.parentId === source.id);
    expect(children).toHaveLength(1); expect(children[0].workflowId).toBe("emergency-contact");
    expect(reviewValue(reviewRecords(children[0])[0], "contactName")).toBe("Sam Lee");
    expect(mockRunLog(children[0]).steps.flatMap(step => step.entries).some(entry => entry.kind === "fields" && entry.fields.some(field => field.value === "Sam Lee"))).toBe(true);
    expect(original.match).toBe("matched"); expect(reviewValue(original, "employeeId")).toBe("10000001");
    expect(() => approveMockRun([source], "missing")).toThrow("MOCK_APPROVAL_UNAVAILABLE");
  });
  it("adds unresolved records and refuses zero valid selections or discarded preparations", () => {
    const source = preparation("onbase"), records = addMockReviewRecord(reviewRecords(source));
    expect(records).toHaveLength(2); expect(records[1].selected).toBe(false); expect(records[1].match).toBe("unresolved");
    const empty = updateMockReview([source], source.id, records.map(record => ({ ...record, selected: false })));
    expect(() => approveMockRun(empty, source.id)).toThrow("MOCK_APPROVAL_NO_RECORDS");
    const discarded = discardMockReview(empty, source.id);
    expect(() => approveMockRun(discarded, source.id)).toThrow("MOCK_APPROVAL_UNAVAILABLE");
    expect(discarded).toHaveLength(1);
    const restored = restoreMockReview(discarded, source.id);
    expect(reviewRecords(restored[0])).toEqual(reviewRecords(empty[0]));
    expect(reviewIsReadOnly(restored[0])).toBe(false);
    expect(() => restoreMockReview([source], source.id)).toThrow("MOCK_REVIEW_RESTORE_UNAVAILABLE");
    expect(() => restoreMockReview([{ ...discarded[0], approved: true }], source.id)).toThrow("MOCK_REVIEW_RESTORE_UNAVAILABLE"); expect(mockRunLog(discarded[0]).timeline.every(step => step.state === "cancelled")).toBe(true);
  });
  it("makes Oath Upload signers independent and keeps source preparation out of their kernel logs", () => {
    const source = preparation("oath-upload"), result = approveMockRun([source], source.id), signer = result.find(run => run.parentId === source.id)!;
    expect(signer.workflowId).toBe("oath-signature"); expect(signer.role).toBe("person");
    expect(mockRunLog(signer).timeline.map(step => step.label)).toEqual(["Verify onboarding and oath date", "Sign in to UCPath", "Sign oath", "Result"]);
    const contact = preparation("emergency-contact"), approved = approveMockRun([contact], contact.id);
    expect(mockRunLog(approved.find(run => run.id === contact.id)!).timeline.map(step => step.label)).not.toContain("Save emergency contact");
    expect(mockRunLog(approved.find(run => run.parentId === contact.id)!).timeline.map(step => step.label)).toContain("Save emergency contact");
  });
  it("automatically fans out I-9 Check without approval and allows OCR corrections without downstream approval", () => {
    const runs = mockRunsForDraft("i9-check", { ...initialMockDraft("i9-check"), files: [{ name: "i9.pdf", size: 1024, digest: "fixture" }] }, 2);
    expect(runs).toHaveLength(2); expect(runs[1].parentId).toBe(runs[0].id);
    expect(() => approveMockRun(runs, runs[0].id)).toThrow("MOCK_APPROVAL_UNAVAILABLE");
    const ocr = seedMockRuns().find(run => run.workflowId === "ocr")!;
    const corrected = editReviewRecord(reviewRecords(ocr)[0], "firstName", "Sam");
    const updated = updateMockReview([ocr], ocr.id, [corrected]);
    expect(reviewIsReadOnly(ocr)).toBe(false); expect(reviewIsReadOnly(runs[0])).toBe(true);
    expect(reviewValue(reviewRecords(updated[0])[0], "firstName")).toBe("Sam");
    expect(mockRunLog(updated[0]).steps.at(-1)!.entries.some(entry => entry.kind === "fields" && entry.fields.some(field => field.label === "First name" && field.value === "Sam"))).toBe(true);
    expect(() => approveMockRun(updated, ocr.id)).toThrow("MOCK_APPROVAL_UNAVAILABLE");
    expect(() => discardMockReview(updated, ocr.id)).toThrow("MOCK_REVIEW_READ_ONLY");
    expect(() => updateMockReview(runs, runs[0].id, reviewRecords(runs[0]))).toThrow("MOCK_REVIEW_READ_ONLY");
  });
  it("keeps system verification fields immutable while correcting extracted values", () => {
    const run = seedMockRuns().find(run => run.workflowId === "ocr")!;
    const verify = reviewRecords({ ...run, records: undefined, draft: { ...run.draft, formType: "verify" } })[0];
    expect(editReviewRecord(verify, "firstName", "Sam").fields).toContainEqual(expect.objectContaining({ key: "firstName", value: "Sam" }));
    for (const key of ["serviceDate", "oathDate", "i9Status", "i9Signer"]) expect(() => editReviewRecord(verify, key, "changed")).toThrow("MOCK_REVIEW_FIELD_READ_ONLY");
    expect(() => editReviewRecord(verify, "missing", "changed")).toThrow("MOCK_REVIEW_FIELD_UNKNOWN");
  });
  it("stops Oath Upload, missing OnBase identity and unavailable I-9 at the correct dependency", () => {
    for (const [id, key, value, title] of [["oath-upload", "signers", "failed", "Wait signatures"], ["onbase", "keyset", "missing", "Fill keywords"], ["i9-lookup", "profile", "unavailable", "Lookup"]] as const) {
      const flow = buildWorkflowMock(id, updateWorkflowChoice(id, initialWorkflowChoices(id), key, value));
      expect(flow.steps.find(step => step.number === flow.stopAfter)!.title).toBe(title);
    }
    const ocr = buildWorkflowMock("ocr", initialWorkflowChoices("ocr"));
    expect(ocr.steps.map(step => step.title)).not.toContain("Your review");
    expect(() => updateWorkflowChoice("ocr", initialWorkflowChoices("ocr"), "form", "invented")).toThrow("EXPLORER_CHOICE_INVALID");
  });
});
