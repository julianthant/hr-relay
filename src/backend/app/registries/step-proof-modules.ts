import type { AnyWorkflowDefinition } from "../../../workflow-kit/workflow-definition.js";
import { WORKFLOW_REGISTRATIONS } from "../../../workflows/registry.js";
import { CHILD_ONLY_WORKFLOW_MODULES, composeRegisteredWorkflow, WORKFLOW_MODULES } from "./workflow-registry.js";

export const STEP_PROOF_MODULES = Object.freeze(WORKFLOW_REGISTRATIONS
  .flatMap(({ proofs }): readonly { readonly definition: AnyWorkflowDefinition; readonly order: number }[] => proofs)
  .toSorted((left, right) => left.order - right.order)
  .map(({ definition }) => composeRegisteredWorkflow(definition)));
const registeredIds = [...WORKFLOW_MODULES, ...CHILD_ONLY_WORKFLOW_MODULES, ...STEP_PROOF_MODULES].map(({ descriptor }) => String(descriptor.id));
if (new Set(registeredIds).size !== registeredIds.length) {
  throw new Error("step proof ids repeat or equal a registered workflow id");
}

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
