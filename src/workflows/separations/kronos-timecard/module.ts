import { defineWorkflowRole } from "../../../domain/workflow/module-role.js";
import { newKronosStore } from "../../../stores/new-kronos/index.js";
import { separationsKronosTimecardDescriptor } from "./descriptor.js";
import { KRONOS_TIMECARD_STEP } from "./step.js";

/**
 * The server composition value: the bundle-safe descriptor plus the concrete
 * stores its contracts resolve through. One store, because this chunk touches
 * exactly one system — which is the point of proving it alone.
 */
export const separationsKronosTimecardModule = Object.freeze({
  descriptor: separationsKronosTimecardDescriptor,
  stores: Object.freeze([newKronosStore]),
  // A proving harness for one step of `separations`, never a peer workflow (D219) —
  // the step it proves is the folder it lives in, read from that folder's own
  // declaration rather than re-typed here (D265 §1.2.2 rule 3).
  role: defineWorkflowRole({ kind: "chunk-harness", of: "separations", step: KRONOS_TIMECARD_STEP.key }),
});
