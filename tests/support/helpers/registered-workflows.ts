
import {
  personLookupModule,
  separationsModule,
} from "../../../src/backend/app/registries/workflow-registry.js";
import {
  separationsIdentityCheckModule,
  separationsKronosTimecardModule,
  separationsKualiFinalizationModule,
  separationsKualiReadModule,
  separationsUcpathTerminationModule,
} from "../../../src/backend/app/registries/step-proof-modules.js";

export {
  personLookupModule,
  separationsIdentityCheckModule,
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
export const separationsIdentityCheckDescriptor = separationsIdentityCheckModule.descriptor;
