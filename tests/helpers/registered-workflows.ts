/**
 * The two definition-backed workflows as their REGISTERED products (D311/D317).
 *
 * `src/workflows/<id>/workflow.ts` authors a definition and nothing else; the
 * descriptor and server module are compiled at the composition root. Tests
 * that need those products read them from here, so no test re-derives a
 * second descriptor object beside the registered one.
 */
import { personLookupModule, separationsModule } from "../../src/control/workflow-registry.js";

export { personLookupModule, separationsModule };
export const personLookupDescriptor = personLookupModule.descriptor;
export const separationsDescriptor = separationsModule.descriptor;
