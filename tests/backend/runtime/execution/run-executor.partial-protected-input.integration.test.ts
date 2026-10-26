import { retainAuthoritySourceClosure } from "../../../../src/backend/storage/source-closure.js";
import { testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import assert from "node:assert/strict";
import { it } from "vitest";
import { requireLifecycleApplied,workerRunLifecyclePort } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { buildQueuedRun } from "../../../../src/backend/runs/start/enqueue.js";
import { planStart,resolveInstances } from "../../../../src/backend/runs/start/plan.js";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { RunInputStorageSchema } from "../../../../src/models/run/record.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { ProtectedInputBindingSchema,retainedRunProtectedBindings,valueFreeProtectedInput } from "../../../../src/models/write-safety/protected-input.js";
import { deriveTraceId } from "../../../../src/rules/identity/identifiers.js";
import { sourceBoundHarness } from "../../../support/fixtures/integration/source-bound-fixtures.js";
import { ManualScheduler,recordingEmitter,recordingLogger } from "../../../support/helpers/phase1f-executor-harness.js";
import { protectedSecretSource } from "../../../support/helpers/protected-secret-source.js";
import { separationsDescriptor } from "../../../support/helpers/registered-workflows.js";
import { testDataInputSource } from "../../../support/helpers/test-data/test-data-source.js";

const retainedPartialInputOwners = new Set<object>();

it("refuses partial signer metadata from a genuinely admitted private producer before executor scope or effects", async () => {
  const h = sourceBoundHarness(separationsDescriptor);
  retainedPartialInputOwners.add(h);
  try {
    const source = testDataInputSource({ separationsKualiFinalizationCanaryDocumentNumber: "4502" });
    const document = source.read("separationsKualiFinalizationCanaryDocumentNumber");
    assert.ok(document);
    const documentBinding = ProtectedInputBindingSchema.parse({ kind: "test-data-local", inputPath: "documentNumber",
      name: "separationsKualiFinalizationCanaryDocumentNumber", sourceId: document.valueId });
    const secretSource = protectedSecretSource({ timekeeperName: "Synthetic signer" });
    let credentialReads = 0;
    const snapshot = h.database.authority.runtimeConfig.get();
    assert.ok(snapshot);
    const plan = planStart({ authority: h.database, clock: h.clock, ids: h.planIds, planTtlMs: 600_000,
      protectedSecrets: { read: () => { credentialReads += 1; return secretSource.read(); } } }, {
      descriptor: separationsDescriptor, submissions: [{ documentNumber: document.value }],
      protectedSubmissionBindings: [documentBinding], dryRun: true, priority: "bulk", shape: "single",
      configFingerprint: snapshot.configFingerprint, configSnapshotId: snapshot.configSnapshotId, plannedBy: "local-operator",
    });
    assert.equal(plan.refused.length, 0);
    const planned = plan.planned[0];
    assert.ok(planned);
    assert.deepEqual(planned.input.protectedBindings?.map(binding => binding.kind), ["test-data-local", "protected-store"]);
    const runId = h.ids.uuid();
    const run = buildQueuedRun({ descriptor: separationsDescriptor, runId, itemId: planned.itemId,
      traceId: deriveTraceId(separationsDescriptor.code, runId, h.clock), rawInput: planned.rawInput,
      canonicalInput: planned.input, ingressSchemaHash: deriveSchemaHash(separationsDescriptor.input, "input"),
      configFingerprint: snapshot.configFingerprint, configSnapshotId: snapshot.configSnapshotId,
      resolvedInstance: resolveInstances(separationsDescriptor, undefined), shape: "single", priority: "bulk", dryRun: true,
      attempt: 1, runNumber: 1, appVersion: "0.1.0", now: h.clock.now().toISOString() });
    h.database.authority.runs.enqueue(run);
    const slot = h.database.authority.workerSlots.list(separationsDescriptor.id)[0];
    assert.ok(slot);
    const claimed = requireLifecycleApplied(h.lifecycle.claimNext({ commandId: h.ids.uuid(), workflow: separationsDescriptor.id,
      workerId: slot.workerId, workerLifetime: testWorkerLifetime(h.database, separationsDescriptor.id, slot.poolIndex).workerLifetime, runtimeConfig: { generation: snapshot.generation, settingsRevision: snapshot.settingsRevision,
        settingsFingerprint: snapshot.settingsFingerprint, configFingerprint: snapshot.configFingerprint } }));
    const partial = { ...claimed, input: { ...claimed.input, parsed: { ...claimed.input.parsed, protectedBindings: [documentBinding] } } };
    assert.throws(() => RunInputStorageSchema.parse(partial.input), /timekeeperName binding is absent/u);
    assert.throws(() => retainedRunProtectedBindings(partial), /timekeeperName binding is absent/u);
    assert.throws(() => valueFreeProtectedInput(partial.input.parsed.value, partial.input.parsed.protectedBindings), /timekeeperName binding is absent/u);
    const generation = h.database.getMeta().authorityGeneration;
    const reads = credentialReads;
    await assert.rejects(() => executeClaimedRun({ descriptor: separationsDescriptor,
      lifecycle: workerRunLifecyclePort(h.lifecycle), stores: h.stores, authority: h.database, sessions: h.manager,
      emitter: recordingEmitter().emitter, clock: h.clock, ids: h.ids, scheduler: new ManualScheduler(h.clock),
      taskDeadlineMs: 60_000, log: recordingLogger().log }, {
      run: partial, claim: { workerId: slot.workerId, claimGeneration: claimed.claimGeneration }, signal: new AbortController().signal,
    }), /timekeeperName binding is absent/u);
    assert.equal(credentialReads, reads);
    assert.deepEqual(h.world.events, []);
    assert.deepEqual(h.database.authority.runs.get(run.envelope.runId), claimed);
    assert.equal(h.database.getMeta().authorityGeneration, generation);
    assert.equal(h.lifecycle.requeue({ commandId: h.ids.uuid(), runId: claimed.envelope.runId, expectedVersion: claimed.version, cause: "recovery", claim: { workerId: slot.workerId, claimGeneration: claimed.claimGeneration } }).state, "applied");
    h.dispose();
    retainedPartialInputOwners.delete(h);
  } catch (error) { throw retainAuthoritySourceClosure([error], { admission: h }); }
});
