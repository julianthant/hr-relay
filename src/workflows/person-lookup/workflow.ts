import type { InputParserSpec } from "../../models/workflow/ingress.js";
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
import { defineReferenceCheck } from "../../workflow-kit/reference-check.js";

export { PersonLookupCanonicalInput, PersonLookupInput };

export const personLookupIntake = defineIntakeProjection(PersonLookupInput, { emplId: CANONICAL_FIELDS.eid, name: CANONICAL_FIELDS.fullName });

/** One entry grammar for the typed Search mode and the plain input box. */
const SEARCH_ENTRIES = { split: { kind: "delimited", delimiters: [";", "\n"] }, rules: [{ when: { kind: "pattern", pattern: "eid" }, emit: "emplId" }, { when: { kind: "otherwise" }, emit: "name" }] } satisfies InputParserSpec;

export const personLookupWorkflow = defineWorkflow({
  id: "person-lookup",
  requiredWorkbookFields: [],
  referenceCheck: defineReferenceCheck({ key: "eid", input: { eid: "emplId", fullName: "name", firstName: "firstName", lastName: "lastName", dob: "dob" }, outputs: {
    matching: { eid: "confirmed[].emplId", fullName: "confirmed[].name" },
    "search-identity": { eid: "selected.emplId", fullName: "selected.name" },
    "crm-identity": { eid: "crmIdentity.emplId", fullName: "crmIdentity.name" },
    "active-status": { eid: "details.eid", fullName: "details.name" },
  } }),
  version: 4,
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
            value: "search", label: "Search", inputLabel: "Employee IDs or names", placeholder: "10000001; Lee, Jordan",
            defaults: [{ field: "crmCheck", value: { kind: "boolean", value: true } }, { field: "keepNonHdh", value: { kind: "boolean", value: false } }, { field: "includeCrmDates", value: { kind: "boolean", value: true } }],
            parser: { kind: "entries", spec: SEARCH_ENTRIES },
            display: { kind: "first-present", fields: ["emplId", "name"] }, identityFields: ["emplId", "name"],
          },
          {
            value: "match", label: "Match", inputLabel: "Name, DOB and SSN", placeholder: "Lee, Jordan, 01/01/2000, x",
            defaults: [{ field: "crmCheck", value: { kind: "boolean", value: false } }, { field: "includeCrmDates", value: { kind: "boolean", value: false } }],
            parser: { kind: "name-tuple", delimiter: ";", familyName: "lastName", givenName: "firstName", identifiers: [{ field: "dob", canonicalField: "text" }, { field: "ssn", canonicalField: "ssn" }], missing: "x", missingIdentifiersCode: "PERSON_LOOKUP_MATCH_INPUT_MISSING_IDENTIFIERS", shapeRefusal: "Use Last, First, DOB, SSN; separate people with semicolons.", missingRefusal: "Match needs DOB or SSN; both cannot be x." },
            display: { kind: "tuple", fields: ["lastName", "firstName", "dob", "ssn"], separator: ", ", missing: "x", masked: ["ssn"] }, identityFields: ["lastName", "firstName", "dob", "ssn"],
          },
        ],
        controls: [
          { field: "crmCheck", label: "CRM check", placement: "input", modes: ["search", "match"], requires: [] },
          { field: "keepNonHdh", label: "Keep non-HDH candidates", placement: "hidden", modes: ["search"], requires: [] },
          { field: "includeCrmDates", label: "Read CRM dates", placement: "step", modes: ["search"], requires: ["crmCheck"] },
        ],
      }, placeholder: "e.g. 10873698; Battistessa, Johnnie", parser: {
        ...SEARCH_ENTRIES,
        constants: [{ field: "mode", value: { kind: "text", text: "search" } }, { field: "crmCheck", value: { kind: "boolean", value: true } }, { field: "keepNonHdh", value: { kind: "boolean", value: false } }, { field: "includeCrmDates", value: { kind: "boolean", value: true } }],
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
  // The reference check reads the Employee ID the search resolved, so it shows under Search for person.
  rows: [
    { key: "searching", label: "Search for person", members: [{ step: "searching" }, { step: "reference-check" }], target: { step: "searching" } },
    { key: "cross-verify", label: "Cross-check identity", members: [{ step: "cross-verify" }], target: { step: "cross-verify" } },
    { key: "active-status", label: "Read employment status", members: [{ step: "active-status" }], target: { step: "active-status" } },
    { key: "crm-dates", label: "Read CRM dates", members: [{ step: "crm-dates" }], target: { step: "crm-dates" } },
  ],
  scenarios: ["person-lookup/s1", ...Array.from({ length: 15 }, (_, index) => `person-lookup/s${index + 2}`), "person-lookup/m1b", ...Array.from({ length: 5 }, (_, index) => `person-lookup/m${index + 1}`), ...Array.from({ length: 5 }, (_, index) => `person-lookup/f${index + 1}`)],
  steps: author => {
    const searching = personLookupSearchingDefinition.build(author);
    const crossverify = personLookupCrossVerifyDefinition.build(author, searching);
    const activestatus = personLookupActiveStatusDefinition.build(author, searching, crossverify);
    const crmdates = personLookupCrmDatesDefinition.build(author, searching, crossverify, activestatus);
    return { steps: [...searching.steps, ...crossverify.steps, ...activestatus.steps, ...crmdates.steps], result: crmdates.result };
  },
});
