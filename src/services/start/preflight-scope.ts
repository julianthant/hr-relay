import { workflowProjections, type AnyWorkflowDescriptor } from "../../base/workflow.js";
import { PreflightAdmissionScopeSchema, PreflightAdmissionRefusal, type PreflightAdmissionScope } from "../../domain/preflight-admission.js";
import { RuntimeCapabilitySchema, type RuntimeCapability } from "../../domain/preflight-contract.js";
import type { InstanceSelection } from "../../domain/run/envelope.js";
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
  const instances = resolveInstances(descriptor, input.resolvedInstance);
  const capabilities = new Set<RuntimeCapability>(["executor.run"]);
  for (const system of projection.systems) capabilities.add(RuntimeCapabilitySchema.parse(`system.${system}.${instances[system as keyof InstanceSelection]}`));
  if ((descriptor.protectedInputs ?? []).some(declaration => declaration.name === "timekeeperName")) capabilities.add("workflow.kuali-fill");
  for (const contract of projection.contracts) {
    if (contract.id.startsWith("kuali/") && (contract.requires ?? []).includes("timekeeperName")) capabilities.add("workflow.kuali-fill");
    if (contract.id.startsWith("sharepoint/")) capabilities.add("workflow.sharepoint-download");
    for (const provider of contract.providers ?? []) {
      switch (provider) {
        case "ocr.extract": capabilities.add("feature.ocr"); break;
        case "ai.advisory": capabilities.add("feature.ai-advisory"); break;
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
