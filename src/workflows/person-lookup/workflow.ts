import type { AuthoredExplorerPart as Part, WorkflowExplorerPreview } from "../../models/workflow/explorer-preview.js";
import { CANONICAL_FIELDS } from "../../models/fields/registry.js";
import { defineIntakeProjection } from "../../models/intake/projection.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { PersonLookupCanonicalInput, PersonLookupInput, personLookupTitle } from "../../models/workflows/person-lookup/input.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { defineWorkflow } from "../../workflow-kit/workflow-definition.js";
import { personLookupActiveStatusDefinition } from "./steps/active-status/step.js";
import { personLookupCrmDatesDefinition } from "./steps/crm-dates/step.js";
import { personLookupCrossVerifyDefinition } from "./steps/cross-verify/step.js";
import { personLookupSearchingDefinition } from "./steps/searching/step.js";

export { PersonLookupCanonicalInput, PersonLookupInput };

export const personLookupIntake = defineIntakeProjection(PersonLookupInput, { emplId: CANONICAL_FIELDS.eid, name: CANONICAL_FIELDS.fullName });

export const PERSON_LOOKUP_NODE_PURPOSES = [
  { nodeId: "searching", purpose: "Read UCPath Person Org candidates for the submitted employee ID or name." },
  { nodeId: "matching", purpose: "Match identifying data in UCPath and confirm displayed identities." },
  { nodeId: "search-identity", purpose: "Resolve the initial UCPath identity without selecting an ambiguous person." },
  { nodeId: "cross-verify", purpose: "Read exact displayed CRM identities from plausible onboarding records." },
  { nodeId: "crm-identity", purpose: "Resolve one person from UCPath observations and CRM evidence." },
  { nodeId: "crm-results", purpose: "Restore and revalidate unresolved CRM search results." },
  { nodeId: "crm-selected-record", purpose: "Reopen the selected CRM record and verify its current identity and facts." },
  { nodeId: "crm-only-recovery", purpose: "Read UCPath again for the uniquely identified CRM employee ID." },
  { nodeId: "active-status", purpose: "Derive employment status and final details from current verified observations." },
  { nodeId: "crm-dates", purpose: "Read optional employment and oath dates from an exact CRM identity." },
] as const;


const action = (text: string, icon: "click" | "compute" = "click"): Part => ({ kind: "action", text, icon });
const note = (text: string): Part => ({ kind: "note", text });
const form = (id: string, title: string, mode: string, values: readonly (readonly [string, string])[], fill = false): Part => ({ kind: "form", id, title, mode, parts: [{ kind: "rows", fields: values.map(([label, value], index) => ({ id: `${id}-${index}`, label, value, mode: fill ? "fill" : "read", ...(fill ? { source: "search-criteria" } : {}) })) }] });
const searchPurpose = "Search UCPath's Person Org Summary for the typed EID or name and narrow to a single person.";
const crmPurpose = "Match the UCPath person against the CRM onboarding record, so a name collision cannot resolve to the wrong person.";
const search = { mode: ["search"] };
const crm = { ...search, crm: ["on"], identifier: ["name"] };

const personLookupExplorer: WorkflowExplorerPreview = {
  choices: [
    { key: "mode", label: "Lookup path", options: [["search", "Search"], ["match", "Match"]] },
    { key: "crm", label: "CRM cross-check", options: [["on", "Enabled"], ["off", "Disabled"]] },
    { key: "identifier", label: "Search identifier", options: [["name", "Name"], ["eid", "Employee ID"]] },
    { key: "dates", label: "Caller CRM dates", options: [["none", "Not requested"], ["requested", "Requested by parent"]] },
  ],
  steps: [
    { nodes: [], title: "Person Lookup", system: "You", parts: [note("Searches Person Org by EID/name or matches a legal identity in HR-Tasks, with an optional CRM cross-check on either mode. It writes nothing, anywhere — so every run of it is already a rehearsal."), ...["mode", "crm", "identifier", "dates"].map<Part>(key => ({ kind: "preview-choice", key }))] },
    { nodes: ["searching", "search-identity"], title: "Searching", system: "UCPath", when: search, parts: [note(searchPurpose),
      form("search-criteria", "Search criteria", "Fill", [["Employee ID", "10000001"], ["Name", "Jordan Lee"], ["Campus", "SDCMP"]], true), action("Search Person Organizational Summary"),
      form("person", "UCPath person", "Read", [["Employee ID", "10000001"], ["Name", "Jordan Lee"], ["Department", "HDH"], ["Job title", "Student assistant"], ["Job record", "0"], ["HR status", "Active"]]),
    ] },
    { nodes: ["cross-verify", "crm-identity", "crm-results", "crm-selected-record"], title: "Cross-verification", system: "CRM", when: crm, parts: [note(crmPurpose), note("Condition: Search mode and CRM check is enabled."), form("cross-contract", "Cross-verification", "Read and process", [["CRM match", "Confirmed"]]), action("Find the onboarding record in CRM"), form("cross-result", "Identity cross-check", "Read", [["UCPath name", "Jordan Lee"], ["CRM name", "Jordan Lee"], ["Campus email", "jordan.lee@example.com"], ["Start date", "08/03/2026"], ["Match", "Confirmed"]])] },
    { nodes: ["active-status", "crm-only-recovery"], title: "Active status", system: "UCPath", when: search, parts: [note("Read the HR status. A separated person is a successful lookup with a negative answer, never a failure."), form("status-contract", "Active status", "Read and process", [["Termination date", "None"]]), action("Open Workforce Job Summary"), form("status", "Employment status", "Read", [["HR status", "Active"], ["Start date", "08/03/2026"], ["End date", "—"], ["Termination reason", "—"], ["Found in UCPath", "Yes"]])] },
    { nodes: ["crm-dates"], title: "CRM dates", system: "CRM", when: { mode: ["search"], crm: ["on"], dates: ["requested"] }, parts: [note("Read the hire and oath dates the caller asked for, and report them back."), note("Condition: Search mode, CRM check is enabled, and the caller asked for CRM dates."), form("crm-dates", "Caller-requested CRM dates", "Read", [["Employment date", "08/03/2026"], ["Oath date", "08/03/2026"]])] },
    { nodes: ["matching", "search-identity"], title: "Search", system: "UCPath", when: { mode: ["match"] }, parts: [note("Search UCPath HR-Tasks with legal name plus SSN and/or DOB, and answer whether UCPath already knows this person."), form("match", "Search", "Read and process", [["Found", "Yes"], ["Matched EID", "10000001"], ["Matched name", "Jordan Lee"], ["Candidates", "1 confirmed person"]])] },
    { nodes: ["cross-verify", "crm-identity", "crm-selected-record", "crm-results"], title: "Match CRM check", system: "CRM", when: { mode: ["match"], crm: ["on"] }, parts: [note("Optionally cross-check the HR-Tasks match against CRM and read its start date."), note("Condition: Match mode and CRM check is enabled."), form("match-crm", "Match CRM check", "Read and process", [["Start date", "08/03/2026"], ["CRM match", "Confirmed"]])] },
  ],
  sources: { "search-criteria": { origin: "UCPath · Search criteria", detail: searchPurpose } },
};

export const personLookupWorkflow = defineWorkflow({
  id: "person-lookup",
  explorerPreview: personLookupExplorer,
  requiredWorkbookTypeIds: [],
  version: 3,
  code: "pl",
  label: "Person Lookup",
  summary: "Searches or matches one person in UCPath, cross-checks CRM, and reads employment status and selected CRM dates.",
  icon: "Search",
  category: "search",
  canonicalInput: PersonLookupCanonicalInput,
  inputSubject: (input) => input.mode === "match" ? "name" : "emplId" in input ? "eid" : "name",
  outcomeProjection: {
    fieldPath: "activeStatus.state",
    cases: [
      { value: "active", label: "Active", tone: "success" },
      { value: "inactive", label: "Inactive", tone: "neutral" },
      { value: "crm-only", label: "CRM only", tone: "warning" },
      { value: "multiple-matches", label: "Multiple matches", tone: "warning" },
      { value: "not-found", label: "Not found", tone: "neutral" },
      { value: "undetermined", label: "Undetermined", tone: "warning" },
      { value: "found", label: "Found", tone: "success" },
      { value: "not-found-in-ucpath", label: "Not found in UCPath", tone: "neutral" },
    ],
  },
  titleProjection: { fieldPath: "activeStatus.details.name", display: "person-name", protectedInput: "eid" },
  subtitleProjection: { fieldPath: "activeStatus.details.eid", display: "eid" },
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  capabilities: {
    review: false, editData: {
      fields: [
        { nodeId: "crm-dates", fieldPath: "employmentDate", label: "Employment date" },
        { nodeId: "crm-dates", fieldPath: "oathDate", label: "Oath date" },
      ]
    }
  },
  verdicts: [{ key: "not-found", label: "Not found", tone: "warning" }, { key: "inactive", label: "Inactive", tone: "warning", tag: true }, { key: "multiple-matches", label: "Multiple matches", tone: "warning" }],
  surfaces: {
    inputRun: {
      typedInput: {
        modeField: "mode", modeLabel: "Lookup mode", initialMode: "search", description: "Each entry starts one run.",
        modes: [
          {
            value: "search", label: "Search", inputLabel: "Employee IDs or names", hint: "Separate people with a semicolon or a new line.", placeholder: "10000001; Lee, Jordan",
            defaults: [{ field: "crmCheck", value: { kind: "boolean", value: true } }, { field: "keepNonHdh", value: { kind: "boolean", value: false } }, { field: "includeCrmDates", value: { kind: "boolean", value: false } }],
            parser: { kind: "entries", spec: { split: { kind: "delimited", delimiters: [";", "\n"] }, rules: [{ when: { kind: "pattern", pattern: "eid" }, emit: "emplId" }, { when: { kind: "otherwise" }, emit: "name" }] } },
            display: { kind: "first-present", fields: ["emplId", "name"] }, identityFields: ["emplId", "name"],
          },
          {
            value: "match", label: "Match", inputLabel: "Name, DOB and SSN", hint: "Last, First, DOB, SSN. Use x for an unavailable DOB or SSN, but not both. Separate people with semicolons.", placeholder: "Lee, Jordan, 01/01/2000, x",
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
      }, placeholder: "Enter employee IDs or names separated by semicolons or new lines", parser: {
        split: { kind: "delimited", delimiters: [";", "\n"] }, rules: [{ when: { kind: "pattern", pattern: "eid" }, emit: "emplId" }, { when: { kind: "otherwise" }, emit: "name" }],
        constants: [{ field: "mode", value: { kind: "text", text: "search" } }, { field: "crmCheck", value: { kind: "boolean", value: true } }, { field: "keepNonHdh", value: { kind: "boolean", value: false } }, { field: "includeCrmDates", value: { kind: "boolean", value: false } }],
      }, examples: [{ key: "one-eid", label: "One employee ID", text: "10000001", note: "Search one employee ID" }]
    }
  },
  details: [
    { key: "active-state", label: "Outcome", source: { kind: "result", fieldPath: "activeStatus.state" }, display: "badge" },
    { key: "detail-eid", label: "EID", source: { kind: "result", fieldPath: "activeStatus.details.eid" }, display: "text" },
  ],
  identity: { matchKey: (input) => input.mode === "match" ? ["match", sha256Hex(JSON.stringify([input.lastName.toLowerCase(), input.firstName.toLowerCase(), input.dob, input.ssn]))].join(":") : "emplId" in input ? `eid:${input.emplId}` : `name:${input.name.toLowerCase()}` },
  presentation: { title: personLookupTitle, subtitle: () => "Person Lookup" },
  input: PersonLookupInput,
  intake: personLookupIntake,
  role: defineWorkflowRole({ kind: "composition" }),
  scenarios: ["person-lookup/s1", ...Array.from({ length: 15 }, (_, index) => `person-lookup/s${index + 2}`), "person-lookup/m1b", ...Array.from({ length: 5 }, (_, index) => `person-lookup/m${index + 1}`), ...Array.from({ length: 5 }, (_, index) => `person-lookup/f${index + 1}`)],
  nodePurposes: PERSON_LOOKUP_NODE_PURPOSES,
  steps: author => {
    const searching = personLookupSearchingDefinition.build(author);
    const crossverify = personLookupCrossVerifyDefinition.build(author, searching);
    const activestatus = personLookupActiveStatusDefinition.build(author, searching, crossverify);
    const crmdates = personLookupCrmDatesDefinition.build(author, searching, crossverify, activestatus);
    return { steps: [...searching.steps, ...crossverify.steps, ...activestatus.steps, ...crmdates.steps], result: crmdates.result };
  },
});
