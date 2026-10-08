import { describe, expect, it } from "vitest";
import { MOCK_WORKFLOWS, MOCK_ONBASE_TYPES, mockWorkflow } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.js";
import { approveMockRun, initialMockDraft, mockDeletionCopy, mockConfirmationFacts, mockDraftError, mockInputEntries, mockLaunchCount, mockNeedsReview, mockOathDuplicate, mockPipeline, mockQueueCounts, mockQueueView, mockRunLog, mockRunPipeline, mockRunsForDraft, mockSelectableSteps, mockStepState, seedMockRuns, type MockDraft } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import { reviewRecords } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-review-model.js";
import { reviewSourcePages } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-review-source-model.js";

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
    expect(mockRunsForDraft("emergency-contact", draft("emergency-contact", { files: [file, { ...file, name: "second.pdf", digest: "second" }] }), 1)).toHaveLength(4);
    const combined = mockRunsForDraft("onbase", draft("onbase", { files: [file, { ...file, name: "second.pdf" }] }), 1);
    expect(combined).toHaveLength(2); expect(combined[0].draft.files).toHaveLength(2);
    expect(mockDraftError("onbase", draft("onbase", { documentType: "Benefits" }))).toBe("Choose a supported document type.");
    expect(() => mockRunsForDraft("onbase", draft("onbase", { documentType: "Benefits" }), 1)).toThrow("Choose a supported document type.");
  });
  it("offers exactly the four supported OnBase document types", () => {
    expect(MOCK_ONBASE_TYPES.map(type => type.label)).toEqual(["Oath", "I-9 Section 1", "I-9 Section 2", "Emergency Contact"]);
  });
  it.each([
    ["Oath", "oath", "oath"],
    ["I-9 Section 1", "i9", "i9"],
    ["I-9 Section 2", "i9", "i9"],
    ["Emergency Contact", "onbase-emergency-contact", "contact"],
  ] as const)("carries %s through confirmation, OCR, approval, logs and rerun", (documentType, formType, kind) => {
    const input = draft("onbase", { documentType });
    expect(mockDraftError("onbase", input)).toBeUndefined();
    expect(mockConfirmationFacts("onbase", input)).toContainEqual({ key: "Document type", value: documentType });
    const runs = mockRunsForDraft("onbase", input, 1), ocr = runs[1];
    expect(ocr.draft.formType).toBe(formType);
    const record = reviewRecords(ocr)[0];
    expect(record.kind).toBe(kind);
    if (documentType.startsWith("I-9")) {
      const section = documentType === "I-9 Section 1" ? 1 : 2;
      expect(record.i9Section).toBe(section);
      expect(record.fields.some(field => field.key === `section${section === 1 ? 2 : 1}`)).toBe(false);
      expect(reviewSourcePages(record).map(page => page.label)).toEqual([`Section ${section} · Page 1`]);
    }
    const approved = approveMockRun(runs, ocr.id), person = approved.find(run => run.role === "person")!;
    expect(person.draft.documentType).toBe(documentType);
    expect(person.inputRecord).toEqual(record);
    const log = mockRunLog(person);
    const documentFields = log.steps.flatMap(step => step.entries).flatMap(entry => entry.kind === "fields" ? entry.fields : []).filter(field => field.label === "Document type");
    expect(documentFields.length).toBeGreaterThan(0);
    expect(documentFields.every(field => field.value === documentType)).toBe(true);
    const rerun = mockRunsForDraft("onbase", runs[0].draft, 2, runs[0].id);
    expect(rerun[0].draft.documentType).toBe(documentType);
    expect(rerun[1].draft.formType).toBe(formType);
    expect(input.formType).toBe("onbase-emergency-contact");
  });
  it("counts the root runs shown in confirmation without counting delegated children", () => {
    expect(mockLaunchCount("oath-signature", draft("oath-signature", { text: "10000001, 10000002" }))).toBe(2);
    const files = [file, { ...file, name: "second.pdf", digest: "second" }];
    expect(mockLaunchCount("emergency-contact", draft("emergency-contact", { files }))).toBe(2);
    expect(mockLaunchCount("onbase", draft("onbase", { files }))).toBe(1);
    expect(mockLaunchCount("sharepoint-download", draft("sharepoint-download"))).toBe(1);
    expect(mockLaunchCount("onbase", draft("onbase", { files: [] }))).toBe(0);
  });
  it("shows only the current processing mode's customizable steps", () => {
    const upload = draft("oath-upload", { uploadMode: "upload-only" });
    expect(mockSelectableSteps("oath-upload", upload).map(step => step.key)).toEqual(["servicenow-auth", "open-hr-form", "fill-form", "submit"]);
    const facts = mockConfirmationFacts("oath-upload", upload);
    expect(facts.find(row => row.key === "Steps")?.value).toBe("4 / 4 included");
    expect(facts.some(row => row.key === "Roster" || row.key === "Workers")).toBe(false);
  });
  it("confirms edited execution settings and omitted steps in operator language", () => {
    const options = draft("onboarding", { priority: "background", browser: "headless", captures: false, workers: 3, hireType: "rehire", selectedSteps: ["transaction"] });
    const facts = Object.fromEntries(mockConfirmationFacts("onboarding", options).map(row => [row.key, row.value]));
    expect(facts.Queue).toBe("Bulk");
    expect(facts.Browser).toBe("Headless · screenshots off");
    expect(facts.Workers).toBe("3");
    expect(facts["Hire type"]).toBe("Rehire · UC_CONC_HIRE");
    expect(facts.Steps).toBe("1 / 8 included · Omitted: Sign in to CRM, Find onboarding record, Read entry sheet, Download onboarding documents, Sign in to UCPath, Match existing person, Create I-9 profile");
  });
  it("keeps upload-only out of OCR and signature waits", () => {
    const keys = mockPipeline("oath-upload", draft("oath-upload", { uploadMode: "upload-only" })).map(step => step.key);
    expect(keys).toEqual(["servicenow-auth", "open-hr-form", "fill-form", "submit"]);
    const full = mockPipeline("oath-upload", draft("oath-upload")).map(step => step.key);
    expect(full.indexOf("wait-signatures")).toBeLessThan(full.indexOf("servicenow-auth"));
    expect(full[0]).toBe("read-document");
  });
  it("holds downstream work for approval, then creates independent oath signers", () => {
    const runs = mockRunsForDraft("oath-upload", draft("oath-upload"), 1), run = runs[0];
    const log = mockRunLog(run);
    expect(log.timeline.find(step => step.label === "Sign in to ServiceNow")!.state).toBe("pending");
    expect(log.timeline.slice(0, 3).map(step => step.state)).toEqual(["waiting", "pending", "pending"]);
    const after = approveMockRun(runs, runs[1].id);
    expect(after.find(candidate => candidate.id === run.id)!.approved).toBe(true);
    expect(after.find(candidate => candidate.workflowId === "oath-signature")!.parentId).toBe(run.id);
    expect(run.approved).toBe(false);
    const standalone = mockRunsForDraft("ocr", draft("ocr"), 1)[0];
    expect(() => approveMockRun([standalone], standalone.id)).toThrow("MOCK_APPROVAL_UNAVAILABLE");
  });
  it("keeps I-9 downstream processing behind OCR approval and gives every log a unique step identity", () => {
    const run = mockRunsForDraft("i9-check", draft("i9-check"), 1)[0];
    expect(mockNeedsReview(run)).toBe(false);
    const { steps } = mockRunLog(run);
    expect(new Set(steps.map(step => step.id)).size).toBe(steps.length);
    const rerun = mockRunsForDraft("i9-check", run.draft, 2, run.id);
    expect(rerun).toHaveLength(2); expect(rerun[0].sourceId).toBe(run.id);
    expect(rerun[1].workflowId).toBe("ocr"); expect(mockNeedsReview(rerun[1])).toBe(true); expect(rerun[1].parentId).toBe(rerun[0].id); expect(rerun[1].id).not.toBe(`${run.id}:person:0`);
    expect(steps.some(step => step.title === "Result")).toBe(false);
  });
  it("starts every launch with Dry run off", () => {
    for (const flow of MOCK_WORKFLOWS) expect(initialMockDraft(flow.id).dryRun).toBe(false);
  });
  it("skips write terminals in dry run, rehire I-9 and normal lookup CRM dates", () => {
    const run = mockRunsForDraft("separations", draft("separations", { dryRun: true }), 1)[0];
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
    const waiting = mockRunsForDraft("emergency-contact", draft("emergency-contact"), 1)[1];
    const done = { ...waiting, id: "done", approved: true };
    expect(mockQueueCounts([waiting, done])).toEqual([{ status: "awaiting-approval", count: 1 }, { status: "running", count: 0 }, { status: "done", count: 1 }, { status: "cancelled", count: 0 }]);
    expect(mockQueueView([done, waiting], ["needsYou"], "newest")).toEqual([waiting]);
    expect(mockQueueView([done, waiting], ["done"], "newest")).toEqual([done]);
    expect(mockQueueView([done, waiting], ["all"], "attention")).toEqual([waiting, done]);
    expect(mockQueueView([done, waiting], ["all"], "oldest")).toEqual([waiting, done]);
  });
  it("seeds each workflow with its own fictional input and log graph", () => {
    const runs = seedMockRuns(); expect(runs.filter(run => !run.parentId)).toHaveLength(12);
    expect(runs).toHaveLength(19);
    for (const id of ["i9-lookup", "sharepoint-download"]) expect(runs.find(run => run.workflowId === id)!.parentId).toBe("mock:onbase:sample:ocr");
    expect(runs.find(run => run.id === "mock:onbase:sample:ocr")!.draft.roster).toBe("download");
    expect(runs.filter(run => run.parentId && run.workflowId === "ocr")).toHaveLength(5);
    expect(runs.filter(run => run.records !== undefined).every(run => run.workflowId === "ocr")).toBe(true);
    for (const run of runs) {
      expect(run.title).toBe(run.subject);
      const { steps } = mockRunLog(run);
      expect(steps.map(step => step.title)).toEqual(mockRunPipeline(run).map(step => step.label));
      expect(new Set(steps.map(step => step.id)).size).toBe(steps.length);
    }
  });
});

describe("mock deletion confirmation copy", () => {
  it("states linked runs only when they exist and agrees in number", () => {
    expect(mockDeletionCopy(0)).toBe("Remove this run from the queue.");
    expect(mockDeletionCopy(1)).toBe("Remove this run and 1 linked run from the queue.");
    expect(mockDeletionCopy(3)).toBe("Remove this run and 3 linked runs from the queue.");
    expect(() => mockDeletionCopy(-1)).toThrow("MOCK_DELETE_LINK_COUNT_INVALID");
  });
});
