/** Read-only descriptor facts and retained system-host wire compatibility. */
import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { workflowProjections } from "../../../workflow-kit/workflow.js";
import { listSystemEntryHosts } from "../../../models/config/instance.js";
import type { Config } from "../../../models/config/schema.js";
import {
  SettingsFactsWireSchema,
  type SettingsFactsWire,
} from "../../../models/dashboard/settings.js";

export interface SettingsQueryDeps {
  /** The resolved config this process runs on — never a re-read of settings.json. */
  readonly config: Config;
  /**
   * The composition root's own descriptor tuple. It takes descriptors rather
   * than the bootstrap's module views because every fact below is the
   * DESCRIPTOR's declaration; the module's `role` is a taxonomy the bootstrap
   * already serves (D219) and repeating it here would be a second source.
   */
  readonly descriptors: readonly AnyWorkflowDescriptor[];
}

/**
 * `WorkflowDryRunSupport` → the wire arm, field for field.
 *
 * It re-states nothing: `workflowProjections(...).dryRun` is the ONE derivation
 * (D209) and this only widens the node ids to the wire's branded type through
 * the schema parse below.
 */
function dryRunPostureOf(descriptor: AnyWorkflowDescriptor): unknown {
  const support = workflowProjections(descriptor).dryRun;
  if (support.state === "supported") return { state: "supported", stopsAt: support.stopsAt };
  if (support.reason === "no-transaction-node") {
    return { state: "unsupported", reason: "no-transaction-node" };
  }
  return { state: "unsupported", reason: "node-declares-unsupported", nodeId: support.nodeId };
}

/**
 * The declared Edit Data posture (D166).
 *
 * An UNDECLARED `capabilities` block and an explicit `editData: false` are both
 * `read-only` — the rail offers no correction either way, and that is the fact
 * the cell states. `true` is `declared` with zero editable paths, which is what
 * ref data-intake-and-edit-data §6.2 says it means, and is NOT folded into
 * `read-only`: "declared, and nothing is correctable" is a decision somebody
 * made and "never declared" is not.
 */
function editDataPostureOf(descriptor: AnyWorkflowDescriptor): unknown {
  const policy = descriptor.capabilities?.editData;
  if (policy === undefined || policy === false) return { state: "read-only" };
  if (policy === true) return { state: "declared", editableFields: 0 };
  return { state: "declared", editableFields: policy.fields.length };
}

export function buildSettingsFacts(deps: SettingsQueryDeps): SettingsFactsWire {
  return SettingsFactsWireSchema.parse({
    systemHosts: listSystemEntryHosts(deps.config).map((entry) => ({
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
      // Only the gates an OPERATOR resolves. A `children-terminal` gate is the
      // kernel waiting on a fan-out and an `external` one is another system's
      // clock; listing either as operator work would tell the operator to go
      // and press something nobody can press.
      operatorGates: workflowProjections(descriptor).gates
        .filter((gate) => gate.resolvedBy === "operator")
        .map((gate) => gate.nodeId),
      // `workflowProjections(descriptor).systems` is already alphabetically
      // sorted — `defineWorkflowDescriptor` sorts it once at build time
      // (`src/base/workflow.ts`'s own `systems` derivation), from the FULL
      // contract set regardless of which node declares which system first. A
      // second `.sort()` here would be redundant AND untestable: no legitimately
      // built descriptor can ever hand this line an unsorted array, so a test
      // written against this call site could never fail (unit F11b finding 4).
      // `sorted-systems-invariant` below pins the real source of the guarantee.
      browserSystems: [...workflowProjections(descriptor).systems],
    })),
  });
}
