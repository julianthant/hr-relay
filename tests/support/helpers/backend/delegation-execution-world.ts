import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { deriveSettingsPatchFingerprint, SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/settings.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { bindWorkflowDelegationTargets,type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { childExecutionStores } from "../../fixtures/child-execution-workflows.js";
import { canonicalChildExecution } from "./canonical-child-execution.js";
import { createRunExecutorTestWorld } from "./run-executor-world.js";
import { createCredentialStore } from "../synthetic-storage-admission.js";

export function createDelegationExecutionWorld(defaults: { root: { descriptor: AnyWorkflowDescriptor }; modules: readonly { descriptor: AnyWorkflowDescriptor }[] }) {
  const world = createRunExecutorTestWorld();
  async function fixture(stores = childExecutionStores, mode: "ok" | "fail" = "ok", workflows: { root: { descriptor: AnyWorkflowDescriptor }; modules: readonly { descriptor: AnyWorkflowDescriptor }[] } = defaults, text = "parallel") {
    const { root, modules } = workflows;
    bindWorkflowDelegationTargets(modules.map(module => module.descriptor));
    const h = await world.executorHarness({ descriptor: root.descriptor, stores });
    const { database, clock, path, stateRoot } = h.authority;
    const patch = { "actor.label": { set: "Synthetic operator" } } as const;
    assert.equal(executeSettingsCommand({ authority: database, clock, ids: { uuid: randomUUID },
      settings: createSettingsApplicationExecutor(value => resolveConfigWithProvenance(value, hostConfigFacts({}), clock), createCredentialStore({ stateRoot })) },
    { commandId: randomUUID(), family: "settings", type: "apply-settings", source: "settings-surface", requestedBy: "local-operator",
      requestedAt: clock.now().toISOString(), target: { expectedRevision: 1 },
      payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } }).state, "applied");
    const execution = canonicalChildExecution(h.deps, database, path, id => modules.find(module => module.descriptor.id === id)?.descriptor);
    const run = execution.start(root.descriptor, { emplId: "10800000", text, mode }, { dryRun: false });
    return { ...h.authority, execution, run, modules };
  }

  return { fixture,cleanup: world.cleanup,SIGNAL: world.SIGNAL };
}
