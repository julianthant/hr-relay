import type { TypedInputSurface } from "../../../../models/workflow/ingress.js";
import { FingerprintSchema } from "../../../../rules/identity/ids.js";
/** Label inventory copied from legacy hr-automation@9bb973672666b9267569a22d3fa0af722e4c5e87 src/dashboard/components/dev/rebuild-demo/demo-wire.ts; presentation only. */
const WORKFLOW_PREVIEW_DEFINITIONS = [{"id": "separations", "label": "Separations", "category": "Separations"}, {"id": "onboarding", "label": "Onboarding", "category": "Onboarding"}, {"id": "person-lookup", "label": "Person Lookup", "category": "Search"}, {"id": "i9-lookup", "label": "I-9 Lookup", "category": "Search"}, {"id": "work-study", "label": "Work-Study", "category": "Work Study"}, {"id": "kronos-pay-rule", "label": "Kronos Pay Rule", "category": "Payroll"}, {"id": "ocr", "label": "OCR", "category": "Utils"}, {"id": "oath-signature", "label": "Oath Signature", "category": "Onboarding"}, {"id": "oath-upload", "label": "Oath Upload", "category": "Onboarding"}, {"id": "emergency-contact", "label": "Emergency Contact", "category": "Onboarding"}, {"id": "onbase", "label": "OnBase", "category": "OnBase"}, {"id": "i9-check", "label": "I-9 Check", "category": "Separations"}, {"id": "crm-doc-download", "label": "CRM Doc Download", "category": "Utils"}, {"id": "sharepoint-download", "label": "SharePoint Download", "category": "Utils"}, {"id": "old-kronos-reports", "label": "Old Kronos Reports", "category": "Timekeeping"}] as const;


/** Copied contracts: legacy hr-automation@9bb973672666b9267569a22d3fa0af722e4c5e87
 * src/dashboard/lib/{input-run-registry,run-modal-registry,onbase-document-types,run-settings}.ts */
export const MOCK_LEGACY_COMMIT = "9bb973672666b9267569a22d3fa0af722e4c5e87";
export type MockWorkflowId = typeof WORKFLOW_PREVIEW_DEFINITIONS[number]["id"];
export type MockMethod = "typed" | "pdf" | "roster" | "delegated";
export type MockStep = Readonly<{ key: string; label: string; system?: string; message: string; write?: boolean }>;
export type MockWorkflow = Readonly<{
  id: MockWorkflowId; label: string; category: string; runnable: boolean; methods: readonly MockMethod[];
  typedInput?: TypedInputSurface;
  inputLabel: string; placeholder: string; example: string; dryRun: boolean; roster: boolean;
  steps: readonly MockStep[]; result: readonly (readonly [string, string])[];
}>;
const step = (key: string, label: string, system: string | undefined, message: string, write = false): MockStep => ({ key, label, system, message, ...(write ? { write } : {}) });
type Contract = Omit<MockWorkflow, "id" | "label" | "category">;
const contracts: Record<MockWorkflowId, Contract> = {
  "person-lookup": { typedInput: {
    modeField: "mode", modeLabel: "Lookup mode", initialMode: "search", description: "Each entry starts one run.",
    modes: [
      { value: "search", label: "Search", inputLabel: "Employee IDs or names", hint: "Separate people with a semicolon or a new line.", placeholder: "10000001; Lee, Jordan",
        defaults: [{ field: "crmCheck", value: { kind: "boolean", value: true } }, { field: "keepNonHdh", value: { kind: "boolean", value: false } }, { field: "includeCrmDates", value: { kind: "boolean", value: false } }],
        parser: { kind: "entries", spec: { split: { kind: "delimited", delimiters: [";", "\n"] }, rules: [{ when: { kind: "pattern", pattern: "eid" }, emit: "emplId" }, { when: { kind: "otherwise" }, emit: "name" }] } },
        display: { kind: "first-present", fields: ["emplId", "name"] }, identityFields: ["emplId", "name"],
      },
      { value: "match", label: "Match", inputLabel: "Name, DOB and SSN", hint: "Last, First, DOB, SSN. Use x for an unavailable DOB or SSN, but not both. Separate people with semicolons.", placeholder: "Lee, Jordan, 01/01/2000, x",
        defaults: [{ field: "crmCheck", value: { kind: "boolean", value: false } }, { field: "includeCrmDates", value: { kind: "boolean", value: false } }],
        parser: { kind: "name-tuple", delimiter: ";", familyName: "lastName", givenName: "firstName", identifiers: [{ field: "dob", canonicalField: "text" }, { field: "ssn", canonicalField: "ssn" }], missing: "x", missingIdentifiersCode: "PERSON_LOOKUP_MATCH_INPUT_MISSING_IDENTIFIERS" },
        display: { kind: "tuple", fields: ["lastName", "firstName", "dob", "ssn"], separator: ", ", missing: "x", masked: ["ssn"] }, identityFields: ["lastName", "firstName", "dob", "ssn"],
      },
    ],
    controls: [
      { field: "crmCheck", label: "CRM check", placement: "input", modes: ["search", "match"], requires: [] },
      { field: "keepNonHdh", label: "Keep non-HDH candidates", placement: "hidden", modes: ["search"], requires: [] },
      { field: "includeCrmDates", label: "Read CRM dates", placement: "step", modes: ["search"], requires: ["crmCheck"] },
    ],
  }, runnable: true, methods: ["typed"], inputLabel: "Employee IDs or names", placeholder: "10000001; Lee, Jordan", example: "10000001", dryRun: false, roster: false, steps: [
    step("searching", "Search for person", "UCPath", "Search Person Org Summary by Employee ID or name; Match uses HR-Tasks person matching."),
    step("cross-verification", "Cross-check identity", "CRM", "Cross-check the name match against CRM when CRM check is enabled."),
    step("active-status", "Read employment status", "UCPath", "Read department, HR status and employment dates."),
    step("crm-dates", "Read CRM dates", "CRM", "Read first day of service and oath date only when requested by a parent workflow."),
  ], result: [["Employee ID", "10000001"], ["Employee", "Jordan Lee"], ["Department", "HDH"], ["HR status", "Active"]] },
  separations: { runnable: true, methods: ["typed"], inputLabel: "Kuali ID", placeholder: "48216, 48220", example: "48216", dryRun: true, roster: false, steps: [
    step("kuali-extraction", "Read Kuali document", "Kuali", "Read the RRSS separation document and its employee and separation dates."),
    step("identity-check", "Verify employee identity", "UCPath", "Verify the supplied Employee ID or resolve the name before continuing."),
    step("ucpath-job-summary", "Read job summary", "UCPath", "Read Workforce Job Summary and resolve the department before the timecard check."),
    step("kronos-search", "Read timecard", "New Kronos", "Read the HDH employee's timecard and reconcile the last day worked."),
    step("transaction-check", "Check pending termination", "UCPath", "Check for a pending termination before preparing another transaction."),
    step("ucpath-transaction", "Submit termination", "UCPath", "File and verify the Smart HR termination transaction.", true),
    step("kuali-finalization", "Finalize Kuali document", "Kuali", "Finalize the RRSS document after the UCPath termination is verified.", true),
  ], result: [["Kuali ID", "48216"], ["Employee", "Jordan Lee"], ["Employee ID", "10000001"], ["Last day worked", "08/02/2026"], ["Separation date", "08/02/2026"]] },
  onboarding: { runnable: true, methods: ["typed"], inputLabel: "Emails", placeholder: "jordan.lee@example.com, sam.rivera@example.com", example: "jordan.lee@example.com", dryRun: true, roster: false, steps: [
    step("crm-auth", "Sign in to CRM", "CRM", "Open the HR CRM workspace."), step("crm-search", "Find onboarding record", "CRM", "Find the onboarding record by email."),
    step("extraction", "Read entry sheet", "CRM", "Read identity, position, wage, address and effective date from the UCPath entry sheet."),
    step("pdf-download", "Download onboarding documents", "CRM", "Download the record's onboarding PDFs."), step("ucpath-auth", "Sign in to UCPath", "UCPath", "Open UCPath."),
    step("person-search", "Match existing person", "UCPath", "Check whether the person already exists before choosing the hire transaction."),
    step("i9-creation", "Create I-9 profile", "I-9 Complete", "Create an I-9 profile for a new hire; rehires and dry runs skip this step.", true),
    step("transaction", "Submit hire", "UCPath", "New hire uses UC_FULL_HIRE; rehire uses UC_CONC_HIRE on the matched Employee ID.", true),
  ], result: [["Email", "jordan.lee@example.com"], ["Position number", "DEMO-POS-001"], ["Wage", "$17.75 per hour"], ["Effective date", "08/03/2026"]] },
  "i9-lookup": { runnable: false, methods: ["delegated"], inputLabel: "Person", placeholder: "Lee, Jordan", example: "Lee, Jordan", dryRun: false, roster: false, steps: [
    step("lookup", "Read Section 2 signer", "I-9 Complete", "Search by last and first name, optionally SSN, and read the authorized official signer and I-9 status."),
  ], result: [["Authorized official signer", "Jamie Morgan"], ["I-9 status", "Section 2 complete"]] },
  "work-study": { runnable: true, methods: ["typed"], inputLabel: "Employee IDs", placeholder: "10000001, 10000002", example: "10000001", dryRun: false, roster: false, steps: [
    step("ucpath-auth", "Sign in to UCPath", "UCPath", "Open UCPath for the employee."), step("transaction", "Submit work-study transaction", "UCPath", "File the PayPath work-study transaction on the supplied effective date.", true),
  ], result: [["Employee", "Jordan Lee"], ["Employee ID", "10000001"], ["Effective date", "08/03/2026"]] },
  "kronos-pay-rule": { runnable: true, methods: ["typed"], inputLabel: "Employee IDs", placeholder: "10000001, 10000002", example: "10000001", dryRun: false, roster: false, steps: [
    step("csv-lookup", "Read OT election", undefined, "Find the employee in the configured OT Elections Tracker CSV."),
    step("determine-action", "Determine pay-rule change", undefined, "Use union code and election status to decide the CT/OT change."),
    step("kronos-auth", "Sign in to New Kronos", "New Kronos", "Open the People timekeeper workspace."),
    step("update-pay-rule", "Update pay rule", "New Kronos", "Apply the elected pay rule effective 07/01/2026.", true),
  ], result: [["Employee ID", "10000001"], ["Union code", "SX"], ["Current pay rule", "DEMO-CT-BASE"], ["New pay rule", "DEMO-OT-BASE"], ["Old code", "CT"], ["New code", "OT"], ["Effective date", "07/01/2026"]] },
  ocr: { runnable: true, methods: ["pdf"], inputLabel: "PDFs", placeholder: "", example: "scan.pdf", dryRun: false, roster: true, steps: [], result: [["Records", "1"], ["Employee", "Jordan Lee"], ["Employee ID", "10000001"]] },
  "oath-signature": { runnable: true, methods: ["typed", "pdf"], inputLabel: "Employee IDs", placeholder: "10000001, 10000002", example: "10000001", dryRun: true, roster: true, steps: [
    step("crm-verify", "Verify onboarding and oath date", "CRM", "Verify the employee's CRM onboarding record and the date to sign."),
    step("ucpath-auth", "Sign in to UCPath", "UCPath", "Open the employee's oath transaction."), step("transaction", "Sign oath", "UCPath", "Record the oath signature with the verified signature date.", true),
  ], result: [["Employee ID", "10000001"], ["Employee", "Jordan Lee"], ["Signature date", "08/03/2026"]] },
  "oath-upload": { runnable: true, methods: ["pdf"], inputLabel: "PDFs", placeholder: "", example: "oaths.pdf", dryRun: true, roster: true, steps: [
    step("wait-approval", "Wait for OCR approval", undefined, "Wait for approval of the extracted oath records."),
    step("wait-signatures", "Wait for all signatures", undefined, "Wait for every independently queued Oath Signature member to succeed before opening ServiceNow."),
    step("servicenow-auth", "Sign in to ServiceNow", "ServiceNow", "Open ServiceNow after all signers finish."), step("open-hr-form", "Open HR inquiry", "ServiceNow", "Open the HR inquiry form."),
    step("fill-form", "Attach oath PDF", "ServiceNow", "Set the subject to HDH New Hire Oaths and attach the paper oath PDF."), step("submit", "File HR ticket", "ServiceNow", "Submit the inquiry and capture its ticket number.", true),
  ], result: [["PDF", "oaths.pdf"], ["Signers", "1"], ["HR ticket", "DEMO-HR-001"]] },
  "emergency-contact": { runnable: true, methods: ["pdf"], inputLabel: "PDFs", placeholder: "", example: "emergency-contact.pdf", dryRun: true, roster: true, steps: [
    step("navigation", "Read existing contacts", "UCPath", "Find the employee and inspect existing emergency contacts to avoid an exact duplicate."),
    step("fill-form", "Fill emergency contact", "UCPath", "Enter the reviewed contact's name, relationship, phone and available address."),
    step("save", "Save emergency contact", "UCPath", "Save the contact and verify the result; an exact existing contact is skipped.", true),
  ], result: [["Employee", "Jordan Lee"], ["Employee ID", "10000001"], ["Contact", "Alex Lee"], ["Relationship", "Sibling"], ["Contact phone", "(202) 555-0102"]] },
  onbase: { runnable: true, methods: ["pdf"], inputLabel: "PDFs", placeholder: "", example: "emergency-contact.pdf", dryRun: true, roster: true, steps: [
    step("authenticate", "Sign in to OnBase", "OnBase", "Open the OnBase import workspace."), step("prepare-import", "Prepare person page", "OnBase", "Split the approved person's page from the combined PDF and select X_HR_Emergency Contact."),
    step("fill-keywords", "Fill document keywords", "OnBase", "Use the UCPath ID keyset autofill, with reviewed name values as the fallback."),
    step("import", "Import document", "OnBase", "Import the person's emergency-contact document and verify completion.", true),
  ], result: [["Employee", "Jordan Lee"], ["UCPath ID", "10000001"], ["Document type", "X_HR_Emergency Contact"], ["Source page", "1"]] },
  "i9-check": { runnable: true, methods: ["pdf"], inputLabel: "PDFs", placeholder: "", example: "i9-packet.pdf", dryRun: false, roster: false, steps: [
    step("person-match", "Match person in UCPath", "UCPath", "Use the paired Section 1/2 identity to search UCPath."),
    step("employment-dates", "Read employment dates", "UCPath", "Read the employment and separation dates; no UCPath transaction is submitted."),
    step("roster-match", "Append retention tracker row", undefined, "Match the configured Action History roster by Employee ID and append a retention-tracker row. A rerun appends again."),
  ], result: [["Employee", "Jordan Lee"], ["Employee ID", "10000001"], ["PPS ID", "DEMO-PPS-001"], ["Section 1 present", "Yes"], ["Section 2 present", "Yes"], ["Found in UCPath?", "Yes"]] },
  "crm-doc-download": { runnable: true, methods: ["typed"], inputLabel: "Employee IDs or emails", placeholder: "10000001, jordan.lee@example.com", example: "10000001", dryRun: false, roster: false, steps: [
    step("search-record", "Find CRM record", "CRM", "Search for the onboarding record using Employee ID or email."), step("download", "Download documents", "CRM", "Download the record's stored PDFs into the employee folder."),
    step("archive", "Archive downloaded documents", undefined, "Finish the document folder and record the downloaded PDF paths."),
  ], result: [["PDFs", "entry-sheet.pdf, onboarding-packet.pdf"], ["Folder", "Jordan Lee"]] },
  "sharepoint-download": { runnable: false, methods: ["roster"], inputLabel: "Spreadsheet", placeholder: "", example: "Onboarding Roster", dryRun: false, roster: false, steps: [
    step("navigate", "Open configured spreadsheet", "SharePoint", "Resolve the configured Onboarding Roster destination and open SharePoint."),
    step("download", "Download roster", "SharePoint", "Download the spreadsheet into the roster folder used by roster-backed workflows."),
  ], result: [["Spreadsheet", "Onboarding Roster"], ["File", "onboarding-roster.xlsx"]] },
  "old-kronos-reports": { runnable: true, methods: ["typed"], inputLabel: "Employee IDs", placeholder: "10000001, 10000002", example: "10000001", dryRun: false, roster: false, steps: [
    step("searching", "Find employee", "Old Kronos", "Search the employee ID in Workforce Central."), step("extracting", "Read employee name", "Old Kronos", "Read the employee's name from the selected row."),
    step("downloading", "Download Time Detail report", "Old Kronos", "Download the Time Detail PDF for the requested date range, validate the report and record its tracker row."),
  ], result: [["Employee", "Jordan Lee"], ["Employee ID", "10000001"], ["Report", "Time Detail_Jordan Lee (10000001).pdf"]] },
};
export const MOCK_WORKFLOWS: readonly MockWorkflow[] = WORKFLOW_PREVIEW_DEFINITIONS.map(flow => ({ ...flow, ...contracts[flow.id] }));
export const MOCK_WORKFLOW_CATALOG = Object.freeze({
  sourceCommit: "631cc3ae35ac28de443210ebcc5f33648a77df6c",
  sourcePath: "tests/parity/helpers/fixture-identity.ts",
  personLookupContractFingerprint: "e8b456516a5fe0d4afe33f45190a36f9771a768147d75f28929b8b5c130bf024",
  descriptorSetHash: FingerprintSchema.parse("3f01d7b694c62026589ece077fbced67f7ca4e0852858a6324a2b5009be0e405"),
  workflows: MOCK_WORKFLOWS,
});
export const MOCK_FORM_TYPES = [{ value: "oath", label: "Oath" }, { value: "emergency-contact", label: "Emergency Contact" }, { value: "onbase-emergency-contact", label: "OnBase Emergency Contact" }, { value: "i9", label: "I-9" }] as const;
export const MOCK_ONBASE_TYPES = [
  { value: "Oath", label: "Oath", formType: "oath" },
  { value: "I-9 Section 1", label: "I-9 Section 1", formType: "i9", i9Section: 1 },
  { value: "I-9 Section 2", label: "I-9 Section 2", formType: "i9", i9Section: 2 },
  { value: "Emergency Contact", label: "Emergency Contact", formType: "onbase-emergency-contact" },
] as const;
export function mockOnbaseDocumentType(value: string) {
  const type = MOCK_ONBASE_TYPES.find(candidate => candidate.value === value);
  if (!type) throw new Error("MOCK_ONBASE_DOCUMENT_TYPE_UNKNOWN");
  return type;
}
export function mockWorkflow(id: string): MockWorkflow {
  const flow = MOCK_WORKFLOWS.find(candidate => candidate.id === id);
  if (!flow) throw new Error("MOCK_WORKFLOW_UNKNOWN");
  return flow;
}
