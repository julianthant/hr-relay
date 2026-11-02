import { defineWorkflow } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../../../workflow-kit/validation/module-role.js";
import { ReadMatchOutcome } from "../../../../models/workflows/i9-check/check.js";
import { i9CheckWorkflow, I9_CHECK_NODE_PURPOSES, personMatch, personMatchEntries, personLookup, personLookupEntries } from "../../workflow.js";

export const i9CheckPersonLookupWorkflow = defineWorkflow({
  ...i9CheckWorkflow,
  id: "i9-check-person-lookup", code: "icl", label: "Check hire date",
  surface: { shape: "single" }, details: [],
  role: defineWorkflowRole({ kind: "chunk-harness", of: "i9-check", step: "person-lookup" }),
  nodePurposes: I9_CHECK_NODE_PURPOSES.filter(purpose => purpose.nodeId !== "retention-row"),
  steps: author => {
    const matched = personMatchEntries(author);
    const search = personLookupEntries(author, matched);
    return { steps: [[personMatch, [matched.matching, matched.initialSearch, matched.initial]], [personLookup, [search]]], result: author.result(ReadMatchOutcome.output, [matched.initial, search], ({ outputs }) => outputs["match-outcome"]) };
  },
});
