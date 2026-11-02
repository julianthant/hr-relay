import { z } from "zod";
import { CrmReadOnboardingResults } from "../../../../models/systems/crm/read-onboarding-results.js";
import { CrmSearchOnboardingRecords } from "../../../../models/systems/crm/search-onboarding-records.js";
import { CrmVerifyOnboardingRecord } from "../../../../models/systems/crm/verify-onboarding-record.js";
import { SearchPersonMatch } from "../../../../models/systems/ucpath/search-person-match.js";
import { SearchPersonOrg } from "../../../../models/systems/ucpath/search-person-org.js";
import { PersonLookupInput, personLookupTitle } from "../../../../models/workflows/person-lookup/input.js";
import { ReadResolvedIdentity } from "../../../../models/workflows/person-lookup/read-resolved-identity.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, defineStepEntries, inheritStepProof } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep, requireFact } from "../../../../workflow-kit/workflow.js";
import { buildSearching, lookupMethodDisplay } from "../searching/step.js";

export function crmQuery(input: z.output<typeof PersonLookupInput>, person?: z.output<typeof SearchPersonOrg.output>, match?: z.output<typeof SearchPersonMatch.output>) {
  const name = input.mode === "match" ? personLookupTitle(input) : "name" in input ? input.name : person?.selection.selected?.name;
  return { ...(name === undefined ? {} : { name }), ...("emplId" in input ? { eid: input.emplId } : input.mode === "match" ? { eid: match?.confirmed[0]?.emplId } : {}) };
}

export const CROSS_VERIFY_STEP = Object.freeze({
  ...defineWorkflowStep({ key: "cross-verify", label: "Cross-check identity" }),
  description: "Compare the person’s name, department and employee ID with CRM records.",
  system: "crm",
  selection: { inputField: "crmCheck", selectedWhen: true },
  operatorFields: [
    ...[["name", "Name", "Quillan, Petra A."], ["department", "Department", "CAMPUS DINING OPERATIONS"], ["emplId", "Employee ID", "10000001"], ["firstDayOfService", "Start date", "3/14/2031"]].map(([path, label, example]) => ({
      label, example, sources: [
        ...["cross-verify", "crm-selected-record", "crm-results"].map(nodeId => ({ nodeId, kind: "output" as const, fieldPath: `records.${path}` })),
        ...["crmIdentity", "crmRecord", "unselectedCrmRecords"].map(prefix => ({ nodeId: "crm-identity", kind: "output" as const, fieldPath: `${prefix}.${path}` })),
      ]
    })),
    { label: "CRM", visibility: "logs", example: "Found", sources: [{ nodeId: "crm-identity", kind: "output", fieldPath: "crmState" }] },
    { label: "How found", visibility: "logs", display: lookupMethodDisplay, sources: [{ nodeId: "crm-identity", kind: "output", fieldPath: "method" }] },
  ],
} as const);

const crossVerifyEntries = defineStepEntries(CROSS_VERIFY_STEP);

export const CROSS_VERIFY_NODE = "cross-verify";

export const crossVerifyNode = crossVerifyEntries.task(CROSS_VERIFY_NODE, CrmSearchOnboardingRecords, {
  label: "Cross-check identity",
  replay: "checkpoint",
  when: { kind: "is-true", of: { from: "node", nodeId: "search-identity", path: "shouldCheckCrm" } }
});

export const CRM_IDENTITY_NODE = "crm-identity";

export const crmIdentityNode = crossVerifyEntries.task(CRM_IDENTITY_NODE, ReadResolvedIdentity, {
  label: "Resolve cross-checked identity",
  replay: "always-rerun",
  when: { kind: "is-true", of: { from: "node", nodeId: "search-identity", path: "shouldCheckCrm" } }
});

export const SELECTED_RECORD_NODE = "crm-selected-record";

export const selectedRecordNode = crossVerifyEntries.task(SELECTED_RECORD_NODE, CrmVerifyOnboardingRecord, {
  replay: "checkpoint",
  when: { kind: "is-present", of: { from: "node", nodeId: "crm-identity", path: "crmRecord" } }
});

export const CRM_RESULTS_NODE = "crm-results";

export const crmResultsNode = crossVerifyEntries.task(CRM_RESULTS_NODE, CrmReadOnboardingResults, {
  replay: "checkpoint",
  when: { kind: "is-present", of: { from: "node", nodeId: "crm-identity", path: "unselectedCrmRecords" } }
});

export function buildCrossVerify(author: WorkflowAuthor<typeof PersonLookupInput>, search: ReturnType<typeof buildSearching>) {
  const { task, result } = author;
  const { searching, matching, initial } = search;
  const crossVerify = task(crossVerifyNode, [initial, searching, matching], ({ input, outputs }) => crmQuery(input, outputs.searching, outputs.matching));
  const identity = task(crmIdentityNode, [initial, crossVerify, searching, matching], ({ input, outputs }) => ({ input, person: outputs.searching, match: outputs.matching, crm: outputs["cross-verify"] }));
  const selectedRecord = task(selectedRecordNode, [identity], ({ outputs }) => {
    const record = requireFact(outputs["crm-identity"]?.crmRecord, "crm-identity", "crmRecord"); return record;
  });
  const crmResults = task(crmResultsNode, [initial, crossVerify, identity, searching, matching], ({ input, outputs }) => ({
    query: crmQuery(input, outputs.searching, outputs.matching), records: requireFact(outputs["crm-identity"]?.unselectedCrmRecords, "crm-identity", "unselectedCrmRecords"),
  }));
  return {
    crossVerify, identity, selectedRecord, crmResults, steps: [[CROSS_VERIFY_STEP, [crossVerify, identity, selectedRecord, crmResults]]] as const,
    result: result(z.strictObject({ identity: ReadResolvedIdentity.output, verifiedCrm: CrmVerifyOnboardingRecord.output.optional(), crmResults: CrmReadOnboardingResults.output.optional() }), [initial, identity, selectedRecord, crmResults], ({ outputs }) => ({ identity: outputs["crm-identity"] ?? outputs["search-identity"], ...(outputs["crm-selected-record"] === undefined ? {} : { verifiedCrm: outputs["crm-selected-record"] }), ...(outputs["crm-results"] === undefined ? {} : { crmResults: outputs["crm-results"] }) }))
  };
}

export const personLookupCrossVerifyDefinition = defineStep({
  group: CROSS_VERIFY_STEP,
  build: buildCrossVerify,
  proof: {
    id: "person-lookup-cross-verify", order: 6,
    build: (parent: WorkflowDefinition<typeof PersonLookupInput>) => ({
      ...inheritStepProof(parent), code: "plc", label: CROSS_VERIFY_STEP.label,
      summary: "Proves the Person Lookup cross-verify step with its prerequisite reads.",
      steps: (author: WorkflowAuthor<typeof PersonLookupInput>) => {
        const searching = buildSearching(author);
        const built = buildCrossVerify(author, searching);
        return { steps: [...searching.steps, ...built.steps], result: built.result };
      },
    }),
  },
});
