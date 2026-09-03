/**
 * D265 §1.2.2 rule 2 — this folder IS one declared step of `separations`'
 * timeline, and this file is where the step's name is written once.
 *
 * The last write: one save over the twelve staged fields of the Kuali document, closing the separation where it was filed.
 *
 * The composition (`../descriptor.ts`) uses this exact value as a recipe
 * group and lists the owned node fragments beside it; the harness reads `.key`
 * for its `chunk-harness.step`. Nobody re-types either string.
 */
import { defineWorkflowStep } from "../../../base/workflow.js";

export const KUALI_FINALIZATION_STEP = defineWorkflowStep({
  key: "kuali-finalization",
  label: "Kuali finalization",
});
