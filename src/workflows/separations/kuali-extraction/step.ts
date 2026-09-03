/**
 * D265 §1.2.2 rule 2 — this folder IS one declared step of `separations`'
 * timeline, and this file is where the step's name is written once.
 *
 * The run's first reads: the Kuali action the document number resolves to, the whole RRSS separation form, the write plan it implies, and the termination type it maps to.
 *
 * The composition (`../descriptor.ts`) uses this exact value as a recipe
 * group and lists the owned node fragments beside it; the harness reads `.key`
 * for its `chunk-harness.step`. Nobody re-types either string.
 */
import { defineWorkflowStep } from "../../../base/workflow.js";

export const KUALI_EXTRACTION_STEP = defineWorkflowStep({
  key: "kuali-extraction",
  label: "Kuali extraction",
});
