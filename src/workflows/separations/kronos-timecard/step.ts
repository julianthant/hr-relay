/**
 * D265 §1.2.2 rule 2 — this folder IS one declared step of `separations`'
 * timeline, and this file is where the step's name is written once.
 *
 * The Kronos passage: find the employee, read the separation timecard verbatim, and fold out the dates the UCPath transaction files under.
 *
 * The composition (`../descriptor.ts`) spreads this pair into its `timeline`
 * entry and adds the nodes; the harness in this folder reads `.key` for its
 * `chunk-harness.step`. Nobody re-types either string.
 */
import { defineWorkflowStep } from "../../../base/workflow.js";

export const KRONOS_TIMECARD_STEP = defineWorkflowStep({
  key: "kronos-timecard",
  label: "Kronos timecard",
});
