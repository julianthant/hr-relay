/**
 * D265 §1.2.2 rule 2 — the *Job summary* step's node fragments: UCPath's Job
 * Summary grid read verbatim, and the two pure folds over it — the one active
 * employment the filing is against and the Kuali department option it maps to.
 *
 * A fragment owns a node's IDENTITY — id, contract, label, replay — and takes
 * its WIRING (`dependsOn` + `bind`) from the graph that applies it (see
 * `src/base/flow.ts`, "node fragments"). This step has no harness of its own:
 * the composition wires `job-summary` from the resolved subject, and the
 * identity-check / write harnesses wire it straight from their ingress EID
 * (rule 3 — they IMPORT it rather than restating it).
 */
import { defineTaskNode } from "../../../base/flow.js";
import { defineWorkflowStepNodes } from "../../../base/workflow.js";
import { SeparationsMatchActiveEmployment } from "../../../domain/contracts/separations/match-active-employment.js";
import { SeparationsMatchDepartmentOption } from "../../../domain/contracts/separations/match-department-option.js";
import { UcpathReadJobSummary } from "../../../domain/contracts/ucpath/read-job-summary.js";
import { JOB_SUMMARY_STEP } from "./step.js";

export const JOB_SUMMARY_NODE = "job-summary";
export const EMPLOYMENT_NODE = "employment";
export const DEPARTMENT_NODE = "department-option";

/**
 * `replay: "checkpoint"` is safe here for chunk 2's reason read the same way:
 * this node's product is its VALUE, not browser state. Nothing downstream
 * stands on the page it opened — the consumers are pure folds and one operator
 * gate — and a gate resume ALWAYS lands in a fresh browser, because the
 * executor releases every session on the way into a park. A node whose
 * product were browser state could not be replayed across a park at all.
 */
export const jobSummaryNode = defineTaskNode(JOB_SUMMARY_STEP, JOB_SUMMARY_NODE, UcpathReadJobSummary, {
  label: "Job Summary",
  replay: "checkpoint",
});

export const employmentNode = defineTaskNode(JOB_SUMMARY_STEP, EMPLOYMENT_NODE, SeparationsMatchActiveEmployment, {
  label: "Employment",
  replay: "checkpoint",
});

export const departmentOptionNode = defineTaskNode(JOB_SUMMARY_STEP, DEPARTMENT_NODE, SeparationsMatchDepartmentOption, {
  label: "Department Option",
  replay: "checkpoint",
});

/** The step's timeline category — key and label from `step.ts`, nodes from the fragments above. */
export const JOB_SUMMARY_STEP_NODES = defineWorkflowStepNodes(JOB_SUMMARY_STEP, [
  jobSummaryNode,
  employmentNode,
  departmentOptionNode,
]);
