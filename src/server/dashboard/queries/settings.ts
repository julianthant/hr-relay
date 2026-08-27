/**
 * The Settings status projection (D274 item 6, ledger 3 SE40–SE42): *System
 * hosts* and *Workflow capabilities*, both READ-ONLY.
 *
 * Neither section has an authority of its own. Every fact here is re-read from
 * something this process ALREADY composed — the resolved config, and the
 * descriptor tuple the kernel plans with — so there is no table to keep up to
 * date and no snapshot to go stale. That is the whole claim SE42's banner makes
 * to the operator, and it holds only as long as this file derives rather than
 * enumerates: nothing below branches on a workflow id, and a capability that
 * cannot be derived gets a descriptor field, never a special case here.
 *
 * There is deliberately NO mutating counterpart. Editable settings are the
 * deferred `apply-settings` command family (doc 04) and D274 item 6's rejected
 * option C was exactly "couple these reads to the writes" — so the wire has
 * nowhere to send one and the surface cannot offer one.
 */
import type { AnyWorkflowDescriptor } from "../../../base/workflow.js";
import { workflowProjections } from "../../../base/workflow.js";
import { listSystemEntryHosts } from "../../../domain/config/instance.js";
import type { Config } from "../../../domain/config/schema.js";
import {
  SettingsFactsWireSchema,
  type SettingsFactsWire,
} from "../../../domain/dashboard/settings.js";

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
      ...(entry.test === undefined ? {} : { test: entry.test }),
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
      browserSystems: [...workflowProjections(descriptor).systems].sort(),
    })),
  });
}
