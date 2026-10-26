/** `person-lookup-searching` — read-only proof of the searching step with its prerequisite reads. */
import { defineWorkflow } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../../../workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../models/workflow/presentation.js";
import { ReadResolvedIdentity } from "../../../../models/workflows/person-lookup/read-resolved-identity.js";
import {
  PersonLookupInput,
  PersonLookupCanonicalInput,
  personLookupWorkflow,
  PERSON_LOOKUP_NODE_PURPOSES,
  SEARCHING_STEP,
  searchingNode,
  matchingNode,
  searchIdentityNode,
  SEARCH_IDENTITY_NODE,
} from "../../workflow.js";

export const personLookupSearchingWorkflow = defineWorkflow({
  id: "person-lookup-searching",
  version: 1,
  code: "pls",
  label: SEARCHING_STEP.label,
  summary: "Proves the Person Lookup searching step with its prerequisite reads.",
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
  nodePurposes: PERSON_LOOKUP_NODE_PURPOSES.filter(({ nodeId }) => [searchingNode, matchingNode, searchIdentityNode].some(entry => entry.id === nodeId)),
  scenarios: personLookupWorkflow.scenarios,
  role: defineWorkflowRole({ kind: "chunk-harness", of: "person-lookup", step: SEARCHING_STEP.key }),
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
    return {
      steps: [[SEARCHING_STEP, [searching, matching, initial]]],
      result: result(ReadResolvedIdentity.output, [initial], ({ outputs }) => outputs[SEARCH_IDENTITY_NODE]),
    };
  },
});
