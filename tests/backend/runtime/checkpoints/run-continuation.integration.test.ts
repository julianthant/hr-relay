import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { sourceBoundHarness } from "../../../support/fixtures/integration/source-bound-fixtures.js";
import { failedSourceReadDescriptor, sourceBoundReadStores } from "../../../support/fixtures/source-bound-read-fixtures.js";
import { readRunCheckpoint } from "../../../../src/backend/runtime/checkpoints/run-checkpoint-reader.js";
import { validateRunContinuation, RunContinuationRefusedError } from "../../../../src/backend/runtime/checkpoints/run-continuation.js";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectRunRuntime } from "../../../../src/backend/runs/settings/run-settings.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

it("reuses a completed always-rerun task after downstream failure and does not invoke it again", async () => {
  const h = await sourceBoundHarness(failedSourceReadDescriptor, world => sourceBoundReadStores(world, 2)); cleanups.push(h.dispose);
  const source = h.start(h.proposal());
  assert.equal((await h.execute(source)).state, "failed");
  const failed = h.fresh(source);
  assert.deepEqual(h.world.events, ["read:absent"]);
  const next = requireLifecycleApplied(h.lifecycle.retry({ commandId: h.ids.uuid(), runId: failed.envelope.runId, expectedVersion: failed.version,
    runtimeConfig: selectRunRuntime(h.database.authority), appVersion: "0.1.0" }, h.descriptor,
    { title: "Fixture continuation", actorId: "local-operator" }));
  const retained = readRunCheckpoint(h.database.authority, next.envelope, "read", true); assert.ok(retained);
  assert.equal(retained.runId, source.envelope.runId);
  assert.equal((await h.execute(next)).state, "done");
  assert.deepEqual(h.world.events, ["read:absent", "read:absent"]);
});

it("rejects serialized continuation without exact durable issuance before reading any retained checkpoint", async () => {
  const h = await sourceBoundHarness(failedSourceReadDescriptor, world => sourceBoundReadStores(world, 2)); cleanups.push(h.dispose);
  const source = h.start(h.proposal()); await h.execute(source);
  const failed = h.fresh(source);
  const forged = { ...failed.envelope, continuation: { sources: [{ runId: failed.envelope.runId, version: failed.version, attempt: failed.envelope.attempt }], checkpoints: [], gates: [] } };
  assert.throws(() => validateRunContinuation({ ...h.database.authority, runs: { get: () => ({ ...failed, envelope: forged }) } }, forged), RunContinuationRefusedError);
});
