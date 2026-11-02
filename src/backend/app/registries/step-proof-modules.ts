import { STEP_PROOF_MODULES } from "./generated-step-proof-modules.js";
export * from "./generated-step-proof-modules.js";
export const STEP_PROOF_DESCRIPTORS = Object.freeze(
  STEP_PROOF_MODULES.map((module) => module.descriptor),
);

export function stepProofModuleOf(id: string) {
  return STEP_PROOF_MODULES.find(
    (module) => String(module.descriptor.id) === id,
  );
}

export function stepProofDescriptorOf(id: string) {
  return stepProofModuleOf(id)?.descriptor;
}
