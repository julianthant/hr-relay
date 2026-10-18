import { z } from "zod";
import { defineWorkflow } from "../../workflow-kit/workflow-definition.js";
import { requireFact } from "../../workflow-kit/workflow.js";
import { CANONICAL_FIELDS } from "../../models/fields/registry.js";
import { defineIntakeProjection } from "../../models/intake/projection.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { PersonLookupInput, PersonLookupCanonicalInput, personLookupTitle } from "../../models/workflows/person-lookup/input.js";
import { SearchPersonOrg } from "../../models/systems/ucpath/search-person-org.js";
import { SearchPersonMatch } from "../../models/systems/ucpath/search-person-match.js";
import { CrmReadOnboardingResults } from "../../models/systems/crm/read-onboarding-results.js";
import { CrmVerifyOnboardingRecord } from "../../models/systems/crm/verify-onboarding-record.js";
import { CrmSearchOnboardingRecords } from "../../models/systems/crm/search-onboarding-records.js";
import { CrmReadOnboardingDates, ReadOnboardingDatesOutputSchema } from "../../models/systems/crm/read-onboarding-dates.js";
import { ReadResolvedIdentity } from "../../models/workflows/person-lookup/read-resolved-identity.js";
import { ReadActiveStatus, ActiveStatusOutcomeSchema } from "../../models/workflows/person-lookup/read-active-status.js";
import { derivePersonLookupOutcome } from "../../rules/matching/person-lookup.js";
import { sha256Hex } from "../../rules/validation/sha256.js";

const lookupMethodDisplay = { cases: [
  { value: "ucpath", text: "UCPath search" }, { value: "eid-match", text: "Employee ID agrees with CRM" },
  { value: "date-match", text: "Start dates within one week" }, { value: "crm-only", text: "CRM only" },
  { value: "multiple-matches", text: "Multiple matches" }, { value: "no-match", text: "No match" }, { value: "match", text: "UCPath Match" },
] } as const;

export { PersonLookupInput, PersonLookupCanonicalInput };
export const PersonLookupResultSchema = z.strictObject({ activeStatus: ActiveStatusOutcomeSchema,
  crmDates: z.discriminatedUnion("state", [z.strictObject({ state: z.literal("included"), dates: ReadOnboardingDatesOutputSchema }), z.strictObject({ state: z.literal("not-requested") })]) });
export const personLookupIntake = defineIntakeProjection(PersonLookupInput, { emplId: CANONICAL_FIELDS.eid, name: CANONICAL_FIELDS.fullName });
function crmQuery(input: z.output<typeof PersonLookupInput>, person?: z.output<typeof SearchPersonOrg.output>, match?: z.output<typeof SearchPersonMatch.output>) {
  const name = input.mode === "match" ? personLookupTitle(input) : "name" in input ? input.name : person?.selection.selected?.name;
  return { ...(name === undefined ? {} : { name }), ...("emplId" in input ? { eid: input.emplId } : input.mode === "match" ? { eid: match?.confirmed[0]?.emplId } : {}) };
}
export const personLookupWorkflow = defineWorkflow({
  id: "person-lookup", version: 3, code: "pl", label: "Person Lookup", summary: "Searches or matches one person in UCPath, cross-checks CRM, and reads employment status and selected CRM dates.",
  icon: "Search", category: "search", canonicalInput: PersonLookupCanonicalInput,
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
  surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
  capabilities: { review: false, editData: { fields: [
    { nodeId: "crm-dates", fieldPath: "employmentDate", label: "Employment date" },
    { nodeId: "crm-dates", fieldPath: "oathDate", label: "Oath date" },
  ] } },
  verdicts: [{ key: "not-found", label: "Not found", tone: "warning" }, { key: "inactive", label: "Inactive", tone: "warning", tag: true }, { key: "multiple-matches", label: "Multiple matches", tone: "warning" }],
  surfaces: { inputRun: { typedInput: {
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
  }, placeholder: "Enter employee IDs or names separated by semicolons or new lines", parser: {
    split: { kind: "delimited", delimiters: [";", "\n"] }, rules: [{ when: { kind: "pattern", pattern: "eid" }, emit: "emplId" }, { when: { kind: "otherwise" }, emit: "name" }],
    constants: [{ field: "mode", value: { kind: "text", text: "search" } }, { field: "crmCheck", value: { kind: "boolean", value: true } }, { field: "keepNonHdh", value: { kind: "boolean", value: false } }, { field: "includeCrmDates", value: { kind: "boolean", value: false } }],
  }, examples: [{ key: "one-eid", label: "One employee ID", text: "10000001", note: "Search one employee ID" }] } },
  details: [
    { key: "active-state", label: "Outcome", source: { kind: "result", fieldPath: "activeStatus.state" }, display: "badge" },
    { key: "detail-eid", label: "EID", source: { kind: "result", fieldPath: "activeStatus.details.eid" }, display: "text" },
  ],
  identity: { matchKey: (input) => input.mode === "match" ? ["match", sha256Hex(JSON.stringify([input.lastName.toLowerCase(), input.firstName.toLowerCase(), input.dob, input.ssn]))].join(":") : "emplId" in input ? `eid:${input.emplId}` : `name:${input.name.toLowerCase()}` },
  presentation: { title: personLookupTitle, subtitle: () => "Person Lookup" },
  input: PersonLookupInput, intake: personLookupIntake, role: defineWorkflowRole({ kind: "standalone" }),
  scenarios: ["person-lookup/s1", ...Array.from({ length: 15 }, (_, index) => `person-lookup/s${index + 2}`), "person-lookup/m1b", ...Array.from({ length: 5 }, (_, index) => `person-lookup/m${index + 1}`), ...Array.from({ length: 5 }, (_, index) => `person-lookup/f${index + 1}`)],
  nodePurposes: [
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
  ],
  steps: ({ task, result }) => {
    const searching = task({ id: "searching", contract: SearchPersonOrg, label: "Search for person", replay: "checkpoint", when: { kind: "equals", of: { from: "input", path: "mode" }, value: "search" } }, [], ({ input }) => {
      if (input.mode !== "search") throw new Error("Search node requires Search mode");
      return "emplId" in input ? { kind: "by-eid" as const, emplId: input.emplId } : { kind: "by-name" as const, name: input.name, keepNonHdh: input.keepNonHdh };
    });
    const matching = task({ id: "matching", contract: SearchPersonMatch, label: "Match person", replay: "checkpoint", when: { kind: "equals", of: { from: "input", path: "mode" }, value: "match" } }, [searching], ({ input }) => {
      if (input.mode !== "match") throw new Error("Match node requires Match mode");
      return { lastName: input.lastName, firstName: input.firstName, ...(input.dob === undefined ? {} : { dob: input.dob }), ...(input.ssn === undefined ? {} : { ssn: input.ssn }) };
    });
    const initial = task({ id: "search-identity", contract: ReadResolvedIdentity, label: "Resolve UCPath identity", replay: "always-rerun" }, [searching, matching], ({ input, outputs }) => ({ input, person: outputs.searching, match: outputs.matching }));
    const crossVerify = task({ id: "cross-verify", contract: CrmSearchOnboardingRecords, label: "Cross-check identity", replay: "checkpoint", when: { kind: "is-true", of: { from: "node", nodeId: "search-identity", path: "shouldCheckCrm" } } }, [initial, searching, matching], ({ input, outputs }) => crmQuery(input, outputs.searching, outputs.matching));
    const identity = task({ id: "crm-identity", contract: ReadResolvedIdentity, label: "Resolve cross-checked identity", replay: "always-rerun", when: { kind: "is-true", of: { from: "node", nodeId: "search-identity", path: "shouldCheckCrm" } } }, [initial, crossVerify, searching, matching], ({ input, outputs }) => ({ input, person: outputs.searching, match: outputs.matching, crm: outputs["cross-verify"] }));
    const selectedRecord = task({ id: "crm-selected-record", contract: CrmVerifyOnboardingRecord, replay: "checkpoint", when: { kind: "is-present", of: { from: "node", nodeId: "crm-identity", path: "crmRecord" } } }, [identity], ({ outputs }) => {
      const record = requireFact(outputs["crm-identity"]?.crmRecord, "crm-identity", "crmRecord"); return record;
    });
    const crmResults = task({ id: "crm-results", contract: CrmReadOnboardingResults, replay: "checkpoint", when: { kind: "is-present", of: { from: "node", nodeId: "crm-identity", path: "unselectedCrmRecords" } } }, [initial, crossVerify, identity, searching, matching], ({ input, outputs }) => ({
      query: crmQuery(input, outputs.searching, outputs.matching), records: requireFact(outputs["crm-identity"]?.unselectedCrmRecords, "crm-identity", "unselectedCrmRecords"),
    }));
    const recovery = task({ id: "crm-only-recovery", contract: SearchPersonOrg, replay: "checkpoint", when: { kind: "is-present", of: { from: "node", nodeId: "crm-identity", path: "recoveryEid" } } }, [identity, selectedRecord, crmResults], ({ outputs }) => ({ kind: "by-eid" as const, emplId: requireFact(outputs["crm-identity"]?.recoveryEid, "crm-identity", "recoveryEid") }));
    const activeStatus = task({ id: "active-status", contract: ReadActiveStatus, replay: "always-rerun", when: { kind: "equals", of: { from: "input", path: "mode" }, value: "search" } }, [initial, identity, recovery, selectedRecord, crmResults], ({ input, outputs }) => ({ input, identity: outputs["crm-identity"] ?? outputs["search-identity"], verifiedCrm: outputs["crm-selected-record"], recovered: outputs["crm-only-recovery"] }));
    const crmDates = task({ id: "crm-dates", contract: CrmReadOnboardingDates, replay: "checkpoint", when: { kind: "is-present", of: { from: "node", nodeId: "active-status", path: "datesEid" } } }, [activeStatus], ({ outputs }) => ({ eid: requireFact(outputs["active-status"]?.details.eid, "active-status", "details.eid"), ...(outputs["active-status"]?.details.name == null ? {} : { name: outputs["active-status"].details.name }) }));
    return { steps: [
      [{ key: "searching", label: "Search for person", description: "Search UCPath by employee ID or name and read the matching person records.", system: "ucpath", operatorFields: [
        ...[["emplId", "Employee ID", "10000001"], ["name", "Name", "Quillan, Petra A."], ["department", "Department", "CAMPUS DINING OPERATIONS"], ["jobTitle", "Job title", "Fictional analyst"], ["hrStatus", "HR status", "Active"]].map(([path, label, example]) => ({ label, example, sources: [
          ...(["emplId", "name"].includes(path) ? [{ nodeId: "searching", kind: "input" as const, fieldPath: path }] : []),
          ...["results", "selection.selected"].map(prefix => ({ nodeId: "searching", kind: "output" as const, fieldPath: `${prefix}.${path}` })),
          { nodeId: "search-identity", kind: "output" as const, fieldPath: `selected.${path}` },
          ...(["emplId", "name"].includes(path) ? ["hits", "confirmed", "dropped"].map(prefix => ({ nodeId: "matching", kind: "output" as const, fieldPath: `${prefix}.${path}` })) : []),
        ] })),
        { label: "Drop reason", visibility: "logs", sources: [{ nodeId: "matching", kind: "output", fieldPath: "dropped.reason" }] },
        { label: "How found", display: lookupMethodDisplay, sources: [{ nodeId: "search-identity", kind: "output", fieldPath: "method" }] },
      ] }, [searching, matching, initial]],
      [{ key: "cross-verify", label: "Cross-check identity", description: "Compare the person’s name, department and employee ID with CRM records.", system: "crm", selection: { inputField: "crmCheck", selectedWhen: true }, operatorFields: [
        ...[["name", "Name", "Quillan, Petra A."], ["department", "Department", "CAMPUS DINING OPERATIONS"], ["emplId", "Employee ID", "10000001"], ["firstDayOfService", "Start date", "3/14/2031"]].map(([path, label, example]) => ({ label, example, sources: [
          ...["cross-verify", "crm-selected-record", "crm-results"].map(nodeId => ({ nodeId, kind: "output" as const, fieldPath: `records.${path}` })),
          ...["crmIdentity", "crmRecord", "unselectedCrmRecords"].map(prefix => ({ nodeId: "crm-identity", kind: "output" as const, fieldPath: `${prefix}.${path}` })),
        ] })),
        { label: "CRM", example: "Found", sources: [{ nodeId: "crm-identity", kind: "output", fieldPath: "crmState" }] },
        { label: "How found", display: lookupMethodDisplay, sources: [{ nodeId: "crm-identity", kind: "output", fieldPath: "method" }] },
      ] }, [crossVerify, identity, selectedRecord, crmResults]],
      [{ key: "active-status", label: "Read employment status", description: "Determine employment status and read department and termination details when applicable.", system: "local", operatorFields: [
        { label: "Employment status", example: "Active", display: { cases: [
          { value: "active", text: "Active" }, { value: "inactive", text: "Inactive" }, { value: "crm-only", text: "CRM only" },
          { value: "multiple-matches", text: "Multiple matches" }, { value: "not-found", text: "Not found" },
          { value: "undetermined", text: "Undetermined" }, { value: "found", text: "Found" }, { value: "not-found-in-ucpath", text: "Not found in UCPath" },
        ] }, sources: [{ nodeId: "active-status", kind: "output", fieldPath: "state" }] },
        { label: "HDH department", example: "Yes", display: { cases: [{ value: true, text: "Yes" }, { value: false, text: "No" }] }, sources: [{ nodeId: "active-status", kind: "output", fieldPath: "hdh" }] },
        ...[["details.department", "Department", "CAMPUS DINING OPERATIONS"], ["details.endDate", "End date", "4/25/2031"], ["details.terminationReason", "Termination reason", "Appointment ended"]].map(([fieldPath, label, example]) => ({ label, example,
          sources: [{ nodeId: "active-status", kind: "output" as const, fieldPath }] })),
        ...[["details.ucpath", "UCPath", "Found"], ["details.crm", "CRM", "Not checked"]].map(([fieldPath, label, example]) => ({ label, example,
          sources: [{ nodeId: "active-status", kind: "output" as const, fieldPath }] })),
        { label: "Status note", visibility: "logs", sources: [{ nodeId: "active-status", kind: "output", fieldPath: "reason" }] },
      ] }, [recovery, activeStatus]],
      [{ key: "crm-dates", label: "Read CRM dates", description: "Read employment and oath dates from the selected CRM record.", system: "crm", selection: { inputField: "includeCrmDates", selectedWhen: true }, operatorFields: [
        ...[["employmentDate", "Employment date", "3/14/2031"], ["oathDate", "Oath date", "3/10/2031"]].map(([fieldPath, label, example]) => ({ label, example,
          sources: [{ nodeId: "crm-dates", kind: "output" as const, fieldPath }] })),
      ] }, [crmDates]],
    ], result: result(PersonLookupResultSchema, [initial, identity, matching, selectedRecord, crmResults, activeStatus, crmDates], ({ input, outputs }) => ({
      activeStatus: outputs["active-status"] ?? derivePersonLookupOutcome({ input, identity: outputs["crm-identity"] ?? outputs["search-identity"], match: outputs.matching, verifiedCrm: outputs["crm-selected-record"] }),
      crmDates: outputs["crm-dates"] === undefined ? { state: "not-requested" as const } : { state: "included" as const, dates: outputs["crm-dates"] },
    })) };
  },
});
