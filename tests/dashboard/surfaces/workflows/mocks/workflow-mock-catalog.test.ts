import { describe as describe_m0,describe as describe_m1,expect as expect_m0,expect as expect_m1,it as it_m0,it as it_m1 } from "vitest";
import { MOCK_FORM_TYPES as MOCK_FORM_TYPES_m0,MOCK_ONBASE_TYPES as MOCK_ONBASE_TYPES_m1,MOCK_WORKFLOWS as MOCK_WORKFLOWS_m1,mockWorkflow as mockWorkflow_m1 } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.js";


{


describe_m0("frontend workflow catalog", () => {
  it_m0("lists only actual OCR document types", () => {
    expect_m0(MOCK_FORM_TYPES_m0.map(type => type.value)).toEqual(["oath", "emergency-contact", "onbase-emergency-contact", "i9"]);
  });
});
}

{


describe_m1("legacy workflow previews", () => {
  it_m1("covers all 15 permanent workflows with distinct contracts", () => {
    expect_m1(MOCK_WORKFLOWS_m1.map(flow => flow.id).sort()).toEqual(["crm-doc-download", "emergency-contact", "i9-check", "i9-lookup", "kronos-pay-rule", "oath-signature", "oath-upload", "ocr", "old-kronos-reports", "onbase", "onboarding", "person-lookup", "separations", "sharepoint-download", "work-study"].sort());
    expect_m1(mockWorkflow_m1("i9-lookup").methods).toEqual(["delegated"]);
    expect_m1(mockWorkflow_m1("sharepoint-download").methods).toEqual(["roster"]);
    expect_m1(mockWorkflow_m1("oath-signature").methods).toEqual(["typed", "pdf"]);
    expect_m1(() => mockWorkflow_m1("missing")).toThrow("MOCK_WORKFLOW_UNKNOWN");
  });
  it_m1.each([
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
    expect_m1(mockWorkflow_m1(id).steps.map(step => step.key)).toEqual(keys);
  });
  it_m1("offers exactly the four supported OnBase document types", () => {
    expect_m1(MOCK_ONBASE_TYPES_m1.map(type => type.label)).toEqual(["Oath", "I-9 Section 1", "I-9 Section 2", "Emergency Contact"]);
  });
});
}
