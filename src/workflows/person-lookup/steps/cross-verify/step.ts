/** `person-lookup-cross-verify` — read-only proof of the cross-verify step with its prerequisite reads. */
import { z } from "zod";
import { defineWorkflow } from "../../../../workflow-kit/workflow-definition.js";
import { requireFact } from "../../../../workflow-kit/workflow.js";
import { defineWorkflowRole } from "../../../../workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../models/workflow/presentation.js";
import { ReadResolvedIdentity } from "../../../../models/workflows/person-lookup/read-resolved-identity.js";
import { CrmVerifyOnboardingRecord } from "../../../../models/systems/crm/verify-onboarding-record.js";
import { CrmReadOnboardingResults } from "../../../../models/systems/crm/read-onboarding-results.js";
import {
  PersonLookupInput,
  PersonLookupCanonicalInput,
  personLookupWorkflow,
  PERSON_LOOKUP_NODE_PURPOSES,
  SEARCHING_STEP,
  CROSS_VERIFY_STEP,
  searchingNode,
  matchingNode,
  searchIdentityNode,
  crossVerifyNode,
  crmIdentityNode,
  selectedRecordNode,
  crmResultsNode,
  crmQuery,
  CRM_IDENTITY_NODE,
  SELECTED_RECORD_NODE,
  CRM_RESULTS_NODE,
  SEARCH_IDENTITY_NODE,
} from "../../workflow.js";

export const personLookupCrossVerifyWorkflow = defineWorkflow({
  id: "person-lookup-cross-verify",
  version: 1,
  code: "plc",
  label: CROSS_VERIFY_STEP.label,
  summary: "Proves the Person Lookup cross-verify step with its prerequisite reads.",
  icon: "Search",
  category: "search",
  input: PersonLookupInput,
  canonicalInput: PersonLookupCanonicalInput,
  inputSubject: personLookupWorkflow.inputSubject,
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: personLookupWorkflow.surfaces,
  verdicts: [],
  details: [],
  identity: personLookupWorkflow.identity,
  presentation: personLookupWorkflow.presentation,
  nodePurposes: PERSON_LOOKUP_NODE_PURPOSES.filter(({ nodeId }) => [searchingNode, matchingNode, searchIdentityNode, crossVerifyNode, crmIdentityNode, selectedRecordNode, crmResultsNode].some(entry => entry.id === nodeId)),
  scenarios: personLookupWorkflow.scenarios,
  role: defineWorkflowRole({ kind: "chunk-harness", of: "person-lookup", step: CROSS_VERIFY_STEP.key }),
  steps: ({ task, result }) => {
    const searching = task(searchingNode, [], ({ input }) => {
      if (input.mode !== "search") throw new Error("Search node requires Search mode");
      return "emplId" in input ? { kind: "by-eid" as const, emplId: input.emplId } : { kind: "by-name" as const, name: input.name, keepNonHdh: input.keepNonHdh };
    });
    const matching = task(matchingNode, [searching], ({ input }) => {
      if (input.mode !== "match") throw new Error("Match node requires Match mode");
      return { lastName: input.lastName, firstName: input.firstName, ...(input.dob === undefined ? {} : { dob: input.dob }), ...(input.ssn === undefined ? {} : { ssn: input.ssn }) };
    });
    const initial = task(searchIdentityNode, [searching, matching], ({ input, outputs }) => ({ input, person: outputs.searching, match: outputs.matching }));
    const crossVerify = task(crossVerifyNode, [initial, searching, matching], ({ input, outputs }) => crmQuery(input, outputs.searching, outputs.matching));
    const identity = task(crmIdentityNode, [initial, crossVerify, searching, matching], ({ input, outputs }) => ({ input, person: outputs.searching, match: outputs.matching, crm: outputs["cross-verify"] }));
    const selectedRecord = task(selectedRecordNode, [identity], ({ outputs }) => {
      const record = requireFact(outputs["crm-identity"]?.crmRecord, "crm-identity", "crmRecord"); return record;
    });
    const crmResults = task(crmResultsNode, [initial, crossVerify, identity, searching, matching], ({ input, outputs }) => ({
      query: crmQuery(input, outputs.searching, outputs.matching), records: requireFact(outputs["crm-identity"]?.unselectedCrmRecords, "crm-identity", "unselectedCrmRecords"),
    }));
    return {
      steps: [[SEARCHING_STEP, [searching, matching, initial]],
        [CROSS_VERIFY_STEP, [crossVerify, identity, selectedRecord, crmResults]]],
      result: result(z.strictObject({ identity: ReadResolvedIdentity.output, verifiedCrm: CrmVerifyOnboardingRecord.output.optional(), crmResults: CrmReadOnboardingResults.output.optional() }), [initial, identity, selectedRecord, crmResults], ({ outputs }) => ({ identity: outputs[CRM_IDENTITY_NODE] ?? outputs[SEARCH_IDENTITY_NODE], ...(outputs[SELECTED_RECORD_NODE] === undefined ? {} : { verifiedCrm: outputs[SELECTED_RECORD_NODE] }), ...(outputs[CRM_RESULTS_NODE] === undefined ? {} : { crmResults: outputs[CRM_RESULTS_NODE] }) })),
    };
  },
});
