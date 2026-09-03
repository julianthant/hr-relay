/**
 * The bundle-safe descriptor tuple — the dashboard's view of the ONE workflow
 * composition root.
 *
 * `src/control/workflow-registry.ts` remains the composition root; its
 * `WORKFLOW_MODULES` tuple carries the server composition values (`module.ts`)
 * and therefore cannot be bundled. Descriptors, by D106, value-import only
 * zod + `src/domain/**` + audited `src/base/**` builders — "the same
 * declaration drives the daemon and the dashboard" — so this tuple is the one
 * browser-legal aggregation of the same descriptors. It is NOT a second
 * registry: `tests/unit/workflows/descriptor-registry.test.ts` pins that every
 * entry here is the exact object `WORKFLOW_MODULES` composes, in the same
 * order, so the two tuples cannot drift.
 */
import { compileWorkflow } from "../base/workflow-definition.js";
import { personLookupWorkflow } from "./person-lookup/workflow.js";
import { separationsIdentityCheckDescriptor } from "./separations/identity-check/descriptor.js";
import { separationsKronosTimecardWorkflow } from "./separations/kronos-timecard/workflow.js";
import { separationsKualiFinalizationWorkflow } from "./separations/kuali-finalization/workflow.js";
import { separationsKualiReadDescriptor } from "./separations/kuali-extraction/descriptor.js";
import { separationsUcpathTerminationWorkflow } from "./separations/ucpath-transaction/workflow.js";
import { separationsWorkflow } from "./separations/workflow.js";

export const WORKFLOW_DESCRIPTORS = Object.freeze([
  compileWorkflow(personLookupWorkflow).descriptor,
  compileWorkflow(separationsKronosTimecardWorkflow).descriptor,
  separationsKualiReadDescriptor,
  separationsIdentityCheckDescriptor,
  compileWorkflow(separationsUcpathTerminationWorkflow).descriptor,
  compileWorkflow(separationsKualiFinalizationWorkflow).descriptor,
  compileWorkflow(separationsWorkflow).descriptor,
] as const);
