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
import { CrmVerifyOnboardingRecord } from "../../models/systems/crm/verify-onboarding-record.js";
import { CrmSearchOnboardingRecords } from "../../models/systems/crm/search-onboarding-records.js";
import { CrmReadOnboardingDates, ReadOnboardingDatesOutputSchema } from "../../models/systems/crm/read-onboarding-dates.js";
import { ReadResolvedIdentity } from "../../models/workflows/person-lookup/read-resolved-identity.js";
import { ReadActiveStatus, ActiveStatusOutcomeSchema } from "../../models/workflows/person-lookup/read-active-status.js";
import { derivePersonLookupOutcome } from "../../rules/matching/person-lookup.js";
import { sha256Hex } from "../../rules/validation/sha256.js";

export { PersonLookupInput, PersonLookupCanonicalInput };
export const PersonLookupResultSchema = z.strictObject({ activeStatus: ActiveStatusOutcomeSchema,
  crmDates: z.discriminatedUnion("state", [z.strictObject({ state: z.literal("included"), dates: ReadOnboardingDatesOutputSchema }), z.strictObject({ state: z.literal("not-requested") })]) });
export const personLookupIntake = defineIntakeProjection(PersonLookupInput, { emplId: CANONICAL_FIELDS.eid, name: CANONICAL_FIELDS.fullName });
export const personLookupWorkflow = defineWorkflow({
  id: "person-lookup", version: 2, code: "pl", label: "Person Lookup", summary: "Searches or matches one person in UCPath, cross-checks CRM, and reads employment status and selected CRM dates.",
  icon: "Search", category: "search", canonicalInput: PersonLookupCanonicalInput,
  inputSubject: (input) => input.mode === "match" ? "name" : "emplId" in input ? "eid" : "name",
  subjectProjection: { nodeId: "searching", fieldPath: "selection.selected.name" },
  surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
  capabilities: { review: false, editData: { fields: [
    { nodeId: "crm-dates", fieldPath: "employmentDate", label: "Employment date" },
    { nodeId: "crm-dates", fieldPath: "oathDate", label: "Oath date" },
  ] } },
  verdicts: [{ key: "not-found", label: "Not found", tone: "warning" }, { key: "inactive", label: "Inactive", tone: "warning", tag: true }, { key: "multiple-matches", label: "Multiple matches", tone: "warning" }],
  surfaces: { inputRun: { placeholder: "Enter employee IDs or names separated by semicolons or new lines", parser: {
    split: { kind: "delimited", delimiters: [";", "\n"] }, rules: [{ when: { kind: "pattern", pattern: "eid" }, emit: "emplId" }, { when: { kind: "otherwise" }, emit: "name" }],
    constants: [{ field: "mode", value: { kind: "text", text: "search" } }, { field: "crmCheck", value: { kind: "boolean", value: true } }, { field: "keepNonHdh", value: { kind: "boolean", value: false } }, { field: "includeCrmDates", value: { kind: "boolean", value: false } }],
  }, examples: [{ key: "one-eid", label: "One employee ID", text: "10000001", note: "Search one employee ID" }] } },
  details: [
    { key: "active-state", label: "Outcome", source: { nodeId: "active-status", fieldPath: "state" }, display: "badge" },
    ...[
      ["search", "Search"], ["name", "Name"], ["eid", "EID"], ["department", "Dept"], ["hrStatus", "HR Status"],
      ["ucpath", "UCPath"], ["crm", "CRM"], ["startDate", "Start Date"], ["endDate", "End Date"], ["terminationReason", "Term Reason"],
      ["foundInUcpath", "Found in UCPath"], ["matchedEid", "Matched EID"], ["matchedName", "Matched Name"],
    ].map(([field, label]) => ({ key: `detail-${field.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`, label: label, source: { nodeId: "active-status", fieldPath: `details.${field}` }, display: "text" as const })),
  ],
  identity: { matchKey: (input) => input.mode === "match" ? ["match", sha256Hex(JSON.stringify([input.lastName.toLowerCase(), input.firstName.toLowerCase(), input.dob, input.ssn]))].join(":") : "emplId" in input ? `eid:${input.emplId}` : `name:${input.name.toLowerCase()}` },
  presentation: { title: personLookupTitle, subtitle: () => "Person Lookup" },
  input: PersonLookupInput, intake: personLookupIntake, role: defineWorkflowRole({ kind: "standalone" }),
  scenarios: ["person-lookup/s1", ...Array.from({ length: 15 }, (_, index) => `person-lookup/s${index + 2}`), "person-lookup/m1b", ...Array.from({ length: 5 }, (_, index) => `person-lookup/m${index + 1}`), ...Array.from({ length: 5 }, (_, index) => `person-lookup/f${index + 1}`)],
  steps: ({ task, result }) => {
    const searching = task({ id: "searching", contract: SearchPersonOrg, label: "Search for person", replay: "checkpoint", when: { kind: "equals", of: { from: "input", path: "mode" }, value: "search" } }, [], ({ input }) => {
      if (input.mode !== "search") throw new Error("Search node requires Search mode");
      return "emplId" in input ? { kind: "by-eid" as const, emplId: input.emplId } : { kind: "by-name" as const, name: input.name, keepNonHdh: input.keepNonHdh };
    });
    const matching = task({ id: "matching", contract: SearchPersonMatch, label: "Match person", replay: "checkpoint", when: { kind: "equals", of: { from: "input", path: "mode" }, value: "match" } }, [searching], ({ input }) => {
      if (input.mode !== "match") throw new Error("Match node requires Match mode");
      return { lastName: input.lastName, firstName: input.firstName, ...(input.dob === undefined ? {} : { dob: input.dob }), ...(input.ssn === undefined ? {} : { ssn: input.ssn }) };
    });
    const initial = task({ id: "search-identity", contract: ReadResolvedIdentity, replay: "always-rerun" }, [searching, matching], ({ input, outputs }) => ({ input, person: outputs.searching, match: outputs.matching }));
    const crossVerify = task({ id: "cross-verify", contract: CrmSearchOnboardingRecords, label: "Cross-check identity", replay: "checkpoint", when: { kind: "is-true", of: { from: "node", nodeId: "search-identity", path: "shouldCheckCrm" } } }, [initial, searching, matching], ({ input, outputs }) => {
      const name = input.mode === "match" ? personLookupTitle(input) : "name" in input ? input.name : outputs.searching?.selection.selected?.name;
      return { ...(name === undefined ? {} : { name }), ...("emplId" in input ? { eid: input.emplId } : input.mode === "match" ? { eid: outputs.matching?.confirmed[0]?.emplId } : {}) };
    });
    const identity = task({ id: "crm-identity", contract: ReadResolvedIdentity, replay: "always-rerun", when: { kind: "is-true", of: { from: "node", nodeId: "search-identity", path: "shouldCheckCrm" } } }, [initial, crossVerify, searching, matching], ({ input, outputs }) => ({ input, person: outputs.searching, match: outputs.matching, crm: outputs["cross-verify"] }));
    const selectedRecord = task({ id: "crm-selected-record", contract: CrmVerifyOnboardingRecord, replay: "checkpoint", when: { kind: "is-present", of: { from: "node", nodeId: "crm-identity", path: "crmRecord" } } }, [identity], ({ outputs }) => {
      const record = requireFact(outputs["crm-identity"]?.crmRecord, "crm-identity", "crmRecord"); return record;
    });
    const recovery = task({ id: "crm-only-recovery", contract: SearchPersonOrg, replay: "checkpoint", when: { kind: "is-present", of: { from: "node", nodeId: "crm-identity", path: "recoveryEid" } } }, [identity, selectedRecord], ({ outputs }) => ({ kind: "by-eid" as const, emplId: requireFact(outputs["crm-identity"]?.recoveryEid, "crm-identity", "recoveryEid") }));
    const activeStatus = task({ id: "active-status", contract: ReadActiveStatus, replay: "always-rerun", when: { kind: "equals", of: { from: "input", path: "mode" }, value: "search" } }, [initial, identity, recovery, selectedRecord], ({ input, outputs }) => ({ input, identity: outputs["crm-identity"] ?? outputs["search-identity"], verifiedCrm: outputs["crm-selected-record"], recovered: outputs["crm-only-recovery"] }));
    const crmDates = task({ id: "crm-dates", contract: CrmReadOnboardingDates, replay: "checkpoint", when: { kind: "is-present", of: { from: "node", nodeId: "active-status", path: "datesEid" } } }, [activeStatus], ({ outputs }) => ({ eid: requireFact(outputs["active-status"]?.details.eid, "active-status", "details.eid"), name: requireFact(outputs["active-status"]?.details.name, "active-status", "details.name") }));
    return { steps: [
      [{ key: "searching", label: "Search for person" }, [searching, matching, initial]],
      [{ key: "cross-verify", label: "Cross-check identity" }, [crossVerify, identity, selectedRecord]],
      [{ key: "active-status", label: "Read employment status" }, [recovery, activeStatus]],
      [{ key: "crm-dates", label: "Read CRM dates" }, [crmDates]],
    ], result: result(PersonLookupResultSchema, [initial, identity, matching, selectedRecord, activeStatus, crmDates], ({ input, outputs }) => ({
      activeStatus: outputs["active-status"] ?? derivePersonLookupOutcome({ input, identity: outputs["crm-identity"] ?? outputs["search-identity"], match: outputs.matching, verifiedCrm: outputs["crm-selected-record"] }),
      crmDates: outputs["crm-dates"] === undefined ? { state: "not-requested" as const } : { state: "included" as const, dates: outputs["crm-dates"] },
    })) };
  },
});
