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
import { personLookupDescriptor } from "./person-lookup/descriptor.js";
import { separationsIdentityCheckDescriptor } from "./separations/identity-check/descriptor.js";
import { separationsKronosTimecardDescriptor } from "./separations/kronos-timecard/descriptor.js";
import { separationsKualiFinalizationDescriptor } from "./separations/kuali-finalization/descriptor.js";
import { separationsKualiReadDescriptor } from "./separations/kuali-extraction/descriptor.js";
import { separationsUcpathTerminationDescriptor } from "./separations/ucpath-transaction/descriptor.js";
import { separationsDescriptor } from "./separations/descriptor.js";

export const WORKFLOW_DESCRIPTORS = Object.freeze([
  personLookupDescriptor,
  separationsKronosTimecardDescriptor,
  separationsKualiReadDescriptor,
  separationsIdentityCheckDescriptor,
  separationsUcpathTerminationDescriptor,
  separationsKualiFinalizationDescriptor,
  separationsDescriptor,
] as const);
