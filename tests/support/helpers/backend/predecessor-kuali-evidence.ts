import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import { predecessorEvidenceSchemaHash } from "../../../../src/backend/storage/sqlite/evidence-schema-upgrade.js";

/** Produce persisted predecessor wire identities through the real executor and receipt writer. */
export async function predecessorKualiEvidence() {
  vi.resetModules();
  vi.doMock("../../../../src/models/validation/schema-bound-value.js", async importOriginal => {
    const current = await importOriginal<typeof import("../../../../src/models/validation/schema-bound-value.js")>();
    const { FingerprintSchema } = await import("../../../../src/rules/identity/ids.js");
    return { ...current, deriveSchemaHash: (schema: Parameters<typeof current.deriveSchemaHash>[0], io: "input" | "output") =>
      FingerprintSchema.parse(predecessorEvidenceSchemaHash(schema, io)) };
  });
  const valueId = randomUUID();
  const { createFinalizationTerminalTestWorld } = await import("./finalization-terminal-world.js");
  const world = createFinalizationTerminalTestWorld({ kind: "protected-store", inputPath: "timekeeperName", name: "timekeeperName", valueId });
  let value: Awaited<ReturnType<typeof world.harness>> | undefined;
  try {
    value = await world.harness();
    const { executeClaimedRun } = await import("../../../../src/backend/runtime/execution/run-executor.js");
    const { createReceiptService } = await import("../../../../src/backend/runs/trust/receipt-service.js");
    const { testRunService } = await import("../../fixtures/run-lifecycle-fixtures.js");
    const { separationsKualiFinalizationDescriptor: descriptor, separationsDescriptor } = await import("../registered-workflows.js");
    const { FINALIZATION_RUN_ID: runId, FINALIZATION_VARIABLES } = await import("../kuali-finalization-fixtures.js");
    const claimed = await world.parkApproveAndReclaim(value);
    const completed = await value.bound(() => executeClaimedRun(world.executorDependencies(value!), { ...claimed, signal: world.signal }));
    assert.equal(completed.state, "done");
    const run = value.database.authority.runs.get(runId), result = value.database.authority.runResults.get(runId);
    assert.ok(run && result);
    const checkpoints = value.database.authority.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId);
    const intents = value.database.authority.writeIntents.listByRun(runId);
    const writes = intents.map(intent => ({ intent, attempts: value!.database.authority.writeAttempts.listByIntent(intent.writeIntentId) }));
    const gates = value.database.authority.gateResults.listByRun(runId);
    const receipt = createReceiptService({ database: value.database, runReader: testRunService(value.database, value.clock), descriptors: [descriptor] }).ensureReceipt(runId);
    const { RunRecordSchema } = await import("../../../../src/models/run/record.js");
    const { deriveSchemaHash } = await import("../../../../src/models/validation/schema-bound-value.js");
    const { SeparationsInput } = await import("../../../../src/workflows/separations/workflow.js");
    const { completion: _completion, ...seed } = run;
    const { startAt: _startAt, ...envelope } = run.envelope;
    const separationsRun = RunRecordSchema.parse({ ...seed, envelope: { ...envelope, runId: randomUUID(), itemId: randomUUID(),
      workflow: separationsDescriptor.id, descriptorVersion: separationsDescriptor.version, contractFingerprint: separationsDescriptor.contractFingerprint },
      // The generation-1 Separations input hash, from before the stored timekeeper initials.
      input: { raw: { documentNumber: "4444" }, parsed: { schemaHash: "66dc2f33bf56808164be764f921a1e5a2a95afd5e0a7b760fdba687ee81575dc",
        value: { documentNumber: "4444", timekeeperName: FINALIZATION_VARIABLES.timekeeperName, searchTimeoutMs: 15000 },
        protectedBindings: [{ kind: "protected-store", inputPath: "timekeeperName", name: "timekeeperName", valueId }] },
        ingressSchemaHash: deriveSchemaHash(SeparationsInput, "input") }, lifecycle: { state: "queued" }, claimGeneration: 0, version: 1 });
    assert.equal(value.database.authority.runs.enqueue(separationsRun).state, "inserted");
    const paths = { workspace: value.profile.workspace, stateRoot: value.profile.stateRoot, machineRoot: value.profile.machine.stateRoot, path: value.path,
      profileId: value.profile.admission.profileBinding.profileId };
    const { captureProfileCredentialFixture, installPredecessorProfileCredentials } = await import("../predecessor-profile-credentials.js");
    const source = captureProfileCredentialFixture(value.profile.admission);
    await value.closeController();
    installPredecessorProfileCredentials(source, FINALIZATION_VARIABLES.timekeeperName, valueId);
    return { ...paths, run, separationsRun, result, checkpoints, writes, gates, receipt, valueId, cleanup: world.cleanup };
  } catch (error) {
    if (value !== undefined) await value.closeController();
    await world.cleanup(); throw error;
  } finally {
    vi.doUnmock("../../../../src/models/validation/schema-bound-value.js");
    vi.resetModules();
  }
}
