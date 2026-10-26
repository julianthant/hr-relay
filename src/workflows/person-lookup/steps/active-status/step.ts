/** `person-lookup-active-status` — read-only proof of the active-status step with its prerequisite reads. */
import { defineWorkflow } from "../../../../workflow-kit/workflow-definition.js";
import { requireFact } from "../../../../workflow-kit/workflow.js";
import { defineWorkflowRole } from "../../../../workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../models/workflow/presentation.js";
import { derivePersonLookupOutcome } from "../../../../rules/matching/person-lookup.js";
import { ActiveStatusOutcomeSchema } from "../../../../models/workflows/person-lookup/read-active-status.js";
import {
  PersonLookupInput,
  PersonLookupCanonicalInput,
  personLookupWorkflow,
  PERSON_LOOKUP_NODE_PURPOSES,
  SEARCHING_STEP,
  CROSS_VERIFY_STEP,
  ACTIVE_STATUS_STEP,
  searchingNode,
  matchingNode,
  searchIdentityNode,
  crossVerifyNode,
  crmIdentityNode,
  selectedRecordNode,
  crmResultsNode,
  recoveryNode,
  activeStatusNode,
  crmQuery,
  CRM_IDENTITY_NODE,
  SELECTED_RECORD_NODE,
  SEARCH_IDENTITY_NODE,
  ACTIVE_STATUS_NODE,
  MATCHING_NODE,
} from "../../workflow.js";

export const personLookupActiveStatusWorkflow = defineWorkflow({
  id: "person-lookup-active-status",
  version: 1,
  code: "pla",
  label: ACTIVE_STATUS_STEP.label,
  summary: "Proves the Person Lookup active-status step with its prerequisite reads.",
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
  nodePurposes: PERSON_LOOKUP_NODE_PURPOSES.filter(({ nodeId }) => [searchingNode, matchingNode, searchIdentityNode, crossVerifyNode, crmIdentityNode, selectedRecordNode, crmResultsNode, recoveryNode, activeStatusNode].some(entry => entry.id === nodeId)),
  scenarios: personLookupWorkflow.scenarios,
  role: defineWorkflowRole({ kind: "chunk-harness", of: "person-lookup", step: ACTIVE_STATUS_STEP.key }),
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
    const recovery = task(recoveryNode, [identity, selectedRecord, crmResults], ({ outputs }) => ({ kind: "by-eid" as const, emplId: requireFact(outputs["crm-identity"]?.recoveryEid, "crm-identity", "recoveryEid") }));
    const activeStatus = task(activeStatusNode, [initial, identity, recovery, selectedRecord, crmResults], ({ input, outputs }) => ({ input, identity: outputs["crm-identity"] ?? outputs["search-identity"], verifiedCrm: outputs["crm-selected-record"], recovered: outputs["crm-only-recovery"] }));
    return {
      steps: [[SEARCHING_STEP, [searching, matching, initial]],
        [CROSS_VERIFY_STEP, [crossVerify, identity, selectedRecord, crmResults]],
        [ACTIVE_STATUS_STEP, [recovery, activeStatus]]],
      result: result(ActiveStatusOutcomeSchema, [initial, identity, matching, selectedRecord, crmResults, activeStatus], ({ input, outputs }) => outputs[ACTIVE_STATUS_NODE] ?? derivePersonLookupOutcome({ input, identity: outputs[CRM_IDENTITY_NODE] ?? outputs[SEARCH_IDENTITY_NODE], match: outputs[MATCHING_NODE], verifiedCrm: outputs[SELECTED_RECORD_NODE] })),
    };
  },
});
