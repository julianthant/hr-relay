/** Read-only descriptor facts and retained system-host wire compatibility. */
import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { workflowProjections } from "../../../workflow-kit/workflow.js";
import { listSystemEntryHosts } from "../../../models/config/instance.js";
import type { Config } from "../../../models/config/schema.js";
import {
  SettingsFactsWireSchema,
  type SettingsFactsWire,
} from "../../../models/dashboard/settings.js";

interface SettingsQueryContext {
  /** The resolved config this process runs on — never a re-read of settings.json. */
  // Settings query consumes descriptors rather than importing the composition registry.
  readonly descriptors: readonly AnyWorkflowDescriptor[];
}
export type SettingsQueryDeps = SettingsQueryContext & ({ readonly config: Config } | { readonly readConfig: () => Config });


function dryRunPostureOf(descriptor: AnyWorkflowDescriptor): unknown {
  const support = workflowProjections(descriptor).dryRun;
  if (support.state === "supported") return { state: "supported", firstTransactionNodeId: support.firstTransactionNodeId };
  if (support.reason === "no-transaction-node") {
    return { state: "unsupported", reason: "no-transaction-node" };
  }
  return { state: "unsupported", reason: "node-declares-unsupported", nodeId: support.nodeId };
}


function editDataPostureOf(descriptor: AnyWorkflowDescriptor): unknown {
  const policy = descriptor.capabilities?.editData;
  if (policy === undefined || policy === false) return { state: "read-only" };
  if (policy === true) return { state: "declared", editableFields: 0 };
  return { state: "declared", editableFields: policy.fields.length };
}

export function buildSettingsFacts(deps: SettingsQueryDeps): SettingsFactsWire {
  const config = "readConfig" in deps ? deps.readConfig() : deps.config;
  return SettingsFactsWireSchema.parse({
    systemHosts: listSystemEntryHosts(config).map((entry) => ({
      system: entry.system,
      production: entry.prod,
      test: entry.test,
    })),
    workflowCapabilities: deps.descriptors.map((descriptor) => ({
      workflowId: descriptor.id,
      dryRun: dryRunPostureOf(descriptor),
      typedStart: descriptor.surfaces.inputRun !== undefined,
      reviewPanel: descriptor.capabilities?.review === true,
      editData: editDataPostureOf(descriptor),

      operatorGates: workflowProjections(descriptor).gates
        .filter((gate) => gate.resolvedBy === "operator")
        .map((gate) => gate.nodeId),

      browserSystems: [...workflowProjections(descriptor).systems],
    })),
  });
}
