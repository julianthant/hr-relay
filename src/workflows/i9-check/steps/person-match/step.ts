import { defineWorkflow } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../../../workflow-kit/validation/module-role.js";
import { ReadMatchOutcome } from "../../../../models/workflows/i9-check/check.js";
import { i9CheckWorkflow, I9_CHECK_NODE_PURPOSES, personMatch, personMatchEntries } from "../../workflow.js";

export const i9CheckPersonMatchWorkflow = defineWorkflow({
  ...i9CheckWorkflow,
  id: "i9-check-person-match", code: "icm", label: "Match person",
  surface: { shape: "single" }, details: [],
  role: defineWorkflowRole({ kind: "chunk-harness", of: "i9-check", step: "person-match" }),
  nodePurposes: I9_CHECK_NODE_PURPOSES.filter(purpose => ["identifier-match", "initial-name-search", "match-outcome"].includes(purpose.nodeId)),
  steps: author => {
    const matched = personMatchEntries(author);
    return { steps: [[personMatch, [matched.matching, matched.initialSearch, matched.initial]]], result: author.result(ReadMatchOutcome.output, [matched.initial], ({ outputs }) => outputs["match-outcome"]) };
  },
});
