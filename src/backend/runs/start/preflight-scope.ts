import { descriptorRuntimeNodes, workflowDelegatedDescriptor, workflowProjections, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { PreflightAdmissionScopeSchema, PreflightAdmissionRefusal, type PreflightAdmissionScope } from "../../../rules/preflight/preflight-admission.js";
import { RuntimeCapabilitySchema, type RuntimeCapability } from "../../../models/preflight/preflight-contract.js";
import type { InstanceSelection } from "../../../models/run/envelope.js";
import { resolveInstances } from "./plan.js";

/** The admitted graph owns dependencies; caller-supplied capability lists never authorize a run. */
export function workflowPreflightScope(descriptor: AnyWorkflowDescriptor, input: Readonly<{
  configSnapshotId: string; configFingerprint: string; descriptorFingerprint?: string;
  resolvedInstance?: InstanceSelection;
}>): PreflightAdmissionScope {
  if (input.descriptorFingerprint !== undefined && input.descriptorFingerprint !== descriptor.contractFingerprint) {
    throw new PreflightAdmissionRefusal("scope-mismatch", "Preflight descriptor changed; review the workflow again.");
  }
  const projection = workflowProjections(descriptor);
  const capabilities = new Set<RuntimeCapability>(["executor.run"]);
  const workflows = new Set([descriptor]);
  for (const workflow of workflows) {
    const instances = resolveInstances(workflow, workflow === descriptor ? input.resolvedInstance : undefined);
    for (const [system, instance] of Object.entries(instances)) {
      capabilities.add(RuntimeCapabilitySchema.parse(`system.${system}.${instance}`));
    }
    for (const node of descriptorRuntimeNodes(workflow)) {
      if (node.kind === "child-run") workflows.add(workflowDelegatedDescriptor(workflow, node.target.id));
    }
  }
  if ((descriptor.protectedInputs ?? []).some(declaration => declaration.name === "timekeeperName")) capabilities.add("workflow.kuali-fill");
  for (const contract of projection.contracts) {
    if (contract.id.startsWith("sharepoint/")) capabilities.add("workflow.sharepoint-download");
    for (const provider of contract.providers ?? []) {
      switch (provider) {
        case "geocode.census": capabilities.add("provider.census"); break;
        case "geocode.nominatim": capabilities.add("provider.nominatim"); break;
      }
    }
  }
  return PreflightAdmissionScopeSchema.parse({
    configSnapshotId: input.configSnapshotId, configFingerprint: input.configFingerprint,
    descriptorFingerprint: descriptor.contractFingerprint, requestedCapabilities: [...capabilities].sort(),
  });
}
