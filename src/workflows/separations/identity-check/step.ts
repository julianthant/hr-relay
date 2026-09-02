/**
 * D265 §1.2.2 rule 2 — this folder IS one declared step of `separations`'
 * timeline, and this file is where the step's name is written once.
 *
 * The identity-authority step: UCPath's record of the person the Kuali form claims, the comparison, the name-only operator gate when required, and the verified authority both paths yield — a wait is a state of a step, never a step of its own.
 *
 * The composition (`../descriptor.ts`) spreads this pair into its `timeline`
 * entry and adds the nodes; the harness in this folder reads `.key` for its
 * `chunk-harness.step`. Nobody re-types either string.
 */
import { defineWorkflowStep } from "../../../base/workflow.js";

export const IDENTITY_CHECK_STEP = defineWorkflowStep({
  key: "identity-check",
  label: "Identity check",
});
