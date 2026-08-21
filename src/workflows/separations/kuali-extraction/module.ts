import { defineWorkflowRole } from "../../../domain/workflow/module-role.js";
import { kualiStore } from "../../../stores/kuali/index.js";
import { separationsStore } from "../../../stores/separations/index.js";
import { separationsKualiReadDescriptor } from "./descriptor.js";
import { KUALI_EXTRACTION_STEP } from "./step.js";

/**
 * The server composition value: the bundle-safe descriptor plus the concrete
 * stores its contracts resolve through. Two stores — the Kuali browser store
 * for the page visit, and the `separations` pure mini-store for §4a's
 * resolution, which contributes no browser session by construction.
 */
export const separationsKualiReadModule = Object.freeze({
  descriptor: separationsKualiReadDescriptor,
  stores: Object.freeze([kualiStore, separationsStore]),
  // A proving harness for one step of `separations`, never a peer workflow (D219) —
  // the step it proves is the folder it lives in, read from that folder's own
  // declaration rather than re-typed here (D265 §1.2.2 rule 3).
  role: defineWorkflowRole({ kind: "chunk-harness", of: "separations", step: KUALI_EXTRACTION_STEP.key }),
});
