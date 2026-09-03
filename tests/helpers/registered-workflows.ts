/**
 * The two definition-backed workflows as their REGISTERED products (D311/D317).
 *
 * `src/workflows/<id>/workflow.ts` authors a definition and nothing else; the
 * descriptor and server module are compiled at the composition root. Tests
 * that need those products read them from here, so no test re-derives a
 * second descriptor object beside the registered one.
 */
import {
  personLookupModule,
  separationsKronosTimecardModule,
  separationsKualiFinalizationModule,
  separationsKualiReadModule,
  separationsModule,
  separationsUcpathTerminationModule,
} from "../../src/control/workflow-registry.js";

export {
  personLookupModule,
  separationsKronosTimecardModule,
  separationsKualiFinalizationModule,
  separationsKualiReadModule,
  separationsModule,
  separationsUcpathTerminationModule,
};
export const personLookupDescriptor = personLookupModule.descriptor;
export const separationsDescriptor = separationsModule.descriptor;
export const separationsKronosTimecardDescriptor = separationsKronosTimecardModule.descriptor;
export const separationsUcpathTerminationDescriptor = separationsUcpathTerminationModule.descriptor;
export const separationsKualiFinalizationDescriptor = separationsKualiFinalizationModule.descriptor;
export const separationsKualiReadDescriptor = separationsKualiReadModule.descriptor;
