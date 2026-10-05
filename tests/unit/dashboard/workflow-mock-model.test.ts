import { describe, expect, it } from "vitest";
import { MOCK_WORKFLOWS, mockWorkflow } from "../../../src/dashboard/surfaces/workflow-mock-catalog.js";
import { approveMockRun, initialMockDraft, mockDraftError, mockInputEntries, mockNeedsReview, mockOathDuplicate, mockPipeline, mockQueueCounts, mockQueueView, mockRunLog, mockRunsForDraft, mockStepState, seedMockRuns, type MockDraft } from "../../../src/dashboard/surfaces/workflow-mock-model.js";

const file = { name: "packet.pdf", size: 100, digest: "copied-pdf-digest" };
const draft = (id: string, changes: Partial<MockDraft> = {}): MockDraft => ({ ...initialMockDraft(id), text: mockWorkflow(id).example, files: [file], ...changes });

describe("legacy workflow previews", () => {
  it("covers all 15 permanent workflows with distinct contracts", () => {
    expect(MOCK_WORKFLOWS.map(flow => flow.id).sort()).toEqual(["crm-doc-download", "emergency-contact", "i9-check", "i9-lookup", "kronos-pay-rule", "oath-signature", "oath-upload", "ocr", "old-kronos-reports", "onbase", "onboarding", "person-lookup", "separations", "sharepoint-download", "work-study"].sort());
    expect(mockWorkflow("i9-lookup").methods).toEqual(["delegated"]);
    expect(mockWorkflow("sharepoint-download").methods).toEqual(["roster"]);
    expect(mockWorkflow("oath-signature").methods).toEqual(["typed", "pdf"]);
    expect(() => mockWorkflow("missing")).toThrow("MOCK_WORKFLOW_UNKNOWN");
  });
  it.each([
    ["separations", ["kuali-extraction", "identity-check", "ucpath-job-summary", "kronos-search", "transaction-check", "ucpath-transaction", "kuali-finalization"]],
    ["onboarding", ["crm-auth", "crm-search", "extraction", "pdf-download", "ucpath-auth", "person-search", "i9-creation", "transaction"]],
    ["work-study", ["ucpath-auth", "transaction"]],
    ["kronos-pay-rule", ["csv-lookup", "determine-action", "kronos-auth", "update-pay-rule"]],
    ["oath-signature", ["crm-verify", "ucpath-auth", "transaction"]],
    ["oath-upload", ["wait-approval", "wait-signatures", "servicenow-auth", "open-hr-form", "fill-form", "submit"]],
    ["emergency-contact", ["navigation", "fill-form", "save"]],
    ["onbase", ["authenticate", "prepare-import", "fill-keywords", "import"]],
    ["i9-check", ["person-match", "employment-dates", "roster-match"]],
    ["crm-doc-download", ["search-record", "download", "archive"]],
    ["sharepoint-download", ["navigate", "download"]],
    ["old-kronos-reports", ["searching", "extracting", "downloading"]],
  ] as const)("preserves %s's kernel step order", (id, keys) => {
    expect(mockWorkflow(id).steps.map(step => step.key)).toEqual(keys);
  });
  it("parses names without splitting their commas and requires one Match identifier", () => {
    expect(mockInputEntries("person-lookup", draft("person-lookup", { text: "Lee, Jordan; Rivera, Sam" }))).toEqual(["Lee, Jordan", "Rivera, Sam"]);
    expect(mockDraftError("person-lookup", draft("person-lookup", { lookupMode: "match", text: "Lee, Jordan, x, x" }))).toMatch(/both cannot be x/);
    expect(mockDraftError("person-lookup", draft("person-lookup", { lookupMode: "match", text: "Lee, Jordan, 01/01/2000, x" }))).toBeUndefined();
    expect(mockDraftError("crm-doc-download", draft("crm-doc-download", { text: "bad-email" }))).toMatch(/Employee IDs/);
    expect(mockDraftError("i9-lookup", draft("i9-lookup"))).toMatch(/cannot start independently/);
  });
  it("uses real input cardinality and keeps a combined OnBase preparation", () => {
    expect(mockRunsForDraft("oath-signature", draft("oath-signature", { text: "10000001, 10000002" }), 1)).toHaveLength(2);
    expect(mockRunsForDraft("emergency-contact", draft("emergency-contact", { files: [file, { ...file, name: "second.pdf", digest: "second" }] }), 1)).toHaveLength(2);
    const combined = mockRunsForDraft("onbase", draft("onbase", { files: [file, { ...file, name: "second.pdf" }] }), 1);
    expect(combined).toHaveLength(1); expect(combined[0].draft.files).toHaveLength(2);
    expect(mockDraftError("onbase", draft("onbase", { documentType: "Benefits" }))).toMatch(/Only Emergency Contact/);
  });
  it("keeps upload-only out of OCR and signature waits", () => {
    const keys = mockPipeline("oath-upload", draft("oath-upload", { uploadMode: "upload-only" })).map(step => step.key);
    expect(keys).toEqual(["servicenow-auth", "open-hr-form", "fill-form", "submit"]);
    const full = mockPipeline("oath-upload", draft("oath-upload")).map(step => step.key);
    expect(full.indexOf("wait-signatures")).toBeLessThan(full.indexOf("servicenow-auth"));
    expect(full.slice(0, 4)).toEqual(["prep:loading-roster", "prep:ocr", "prep:person-lookup", "prep:awaiting-approval"]);
  });
  it("holds downstream work for approval, then creates independent oath signers", () => {
    const run = mockRunsForDraft("oath-upload", draft("oath-upload"), 1)[0];
    const log = mockRunLog(run);
    expect(log.timeline.find(step => step.label === "Sign in to ServiceNow")!.state).toBe("pending");
    expect(log.timeline.slice(0, 4).map(step => step.state)).toEqual(["completed", "completed", "completed", "waiting"]);
    const after = approveMockRun([run], run.id);
    expect(after.find(candidate => candidate.id === run.id)!.approved).toBe(true);
    expect(after.find(candidate => candidate.workflowId === "oath-signature")!.parentId).toBe(run.id);
    expect(run.approved).toBe(false);
    const standalone = mockRunsForDraft("ocr", draft("ocr"), 1)[0];
    expect(() => approveMockRun([standalone], standalone.id)).toThrow("MOCK_APPROVAL_UNAVAILABLE");
  });
  it("keeps I-9 retention automatic and gives every composed log a unique step identity", () => {
    const run = mockRunsForDraft("i9-check", draft("i9-check"), 1)[0];
    expect(mockNeedsReview(run)).toBe(false);
    const { steps } = mockRunLog(run);
    expect(new Set(steps.map(step => step.id)).size).toBe(steps.length);
    const rerun = mockRunsForDraft("i9-check", run.draft, 2, run.id);
    expect(rerun).toHaveLength(2); expect(rerun[0].sourceId).toBe(run.id);
    expect(rerun[1].parentId).toBe(rerun[0].id); expect(rerun[1].id).not.toBe(`${run.id}:person:0`);
    expect(steps.some(step => step.title === "Result")).toBe(true);
  });
  it("skips write terminals in dry run, rehire I-9 and normal lookup CRM dates", () => {
    const run = mockRunsForDraft("separations", draft("separations"), 1)[0];
    for (const step of mockWorkflow("separations").steps.filter(step => step.write)) expect(mockStepState(run, step)).toBe("skipped");
    const rehire = mockRunsForDraft("onboarding", draft("onboarding", { hireType: "rehire" }), 1)[0];
    expect(mockStepState(rehire, mockWorkflow("onboarding").steps.find(step => step.key === "i9-creation")!)).toBe("skipped");
    const lookup = mockRunsForDraft("person-lookup", draft("person-lookup"), 1)[0];
    expect(mockRunLog(lookup).timeline.filter(step => step.state === "skipped").map(step => step.label)).toEqual(["Cross-check identity", "Read CRM dates"]);
  });
  it("rejects reversed dates and invalid workers", () => {
    expect(mockDraftError("old-kronos-reports", draft("old-kronos-reports", { startDate: "2026-02-01", endDate: "2026-01-31" }))).toMatch(/date range/);
    expect(mockDraftError("work-study", draft("work-study", { effectiveDate: "2026-02-30" }))).toMatch(/effective date/);
    expect(mockDraftError("ocr", draft("ocr", { workers: 0 }))).toMatch(/positive whole number/);
  });
  it("retains source history on rerun and matches duplicates by content, not filename", () => {
    const source = mockRunsForDraft("oath-upload", draft("oath-upload", { uploadMode: "upload-only", dryRun: false }), 1)[0];
    const before = JSON.stringify(source);
    const rerun = mockRunsForDraft("oath-upload", source.draft, 2, source.id)[0];
    expect(rerun.sourceId).toBe(source.id); expect(rerun.id).not.toBe(source.id);
    expect(JSON.stringify(source)).toBe(before);
    expect(mockOathDuplicate([source], { ...source.draft, files: [{ ...file, name: "renamed.pdf" }] })).toMatch(/already filed/);
    expect(mockOathDuplicate([source], { ...source.draft, files: [{ ...file, digest: "different-content" }] })).toBeUndefined();
    expect(mockOathDuplicate([{ ...source, draft: { ...source.draft, dryRun: true } }], source.draft)).toBeUndefined();
  });
  it("scopes status filters, counts and order to the selected preview queue", () => {
    const waiting = mockRunsForDraft("emergency-contact", draft("emergency-contact"), 1)[0];
    const done = { ...waiting, id: "done", approved: true };
    expect(mockQueueCounts([waiting, done])).toEqual([{ status: "awaiting-approval", count: 1 }, { status: "done", count: 1 }, { status: "cancelled", count: 0 }]);
    expect(mockQueueView([done, waiting], ["needsYou"], "newest")).toEqual([waiting]);
    expect(mockQueueView([done, waiting], ["done"], "newest")).toEqual([done]);
    expect(mockQueueView([done, waiting], ["all"], "attention")).toEqual([waiting, done]);
    expect(mockQueueView([done, waiting], ["all"], "oldest")).toEqual([waiting, done]);
  });
  it("seeds each workflow with its own fictional input and log graph", () => {
    const runs = seedMockRuns(); expect(runs.filter(run => !run.parentId)).toHaveLength(15);
    expect(runs.filter(run => run.parentId && run.workflowId === "i9-check")).toHaveLength(1);
    for (const run of runs) {
      expect(run.title).toContain(mockWorkflow(run.workflowId).label);
      const { steps } = mockRunLog(run);
      expect(steps.length).toBeGreaterThan(1);
      expect(new Set(steps.map(step => step.id)).size).toBe(steps.length);
    }
  });
});
