import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { sourceBoundHarness } from "../../../support/fixtures/integration/source-bound-fixtures.js";
import { failedSourceReadDescriptor, sourceBoundReadStores } from "../../../support/fixtures/source-bound-read-fixtures.js";
import { readRunCheckpoint } from "../../../../src/backend/runtime/checkpoints/run-checkpoint-reader.js";
import { captureRunContinuation, validateRunContinuation, RunContinuationRefusedError } from "../../../../src/backend/runtime/checkpoints/run-continuation.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectRunRuntime } from "../../../../src/backend/runs/settings/run-settings.js";
import { randomUUID } from "node:crypto";

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
  const forged = { ...failed.envelope, continuation: captureRunContinuation(h.database.authority, failed) };
  assert.throws(() => validateRunContinuation({ ...h.database.authority, runs: { get: () => ({ ...failed, envelope: forged }) } }, forged), RunContinuationRefusedError);
});

for (const change of ["deleted", "version", "attempt", "workflow", "input", "config"] as const) it(`refuses ${change} source before retained evidence lookup`, async () => {
  const h = await sourceBoundHarness(failedSourceReadDescriptor, world => sourceBoundReadStores(world, 2)); cleanups.push(h.dispose);
  const source = h.start(h.proposal()); assert.equal((await h.execute(source)).state, "failed");
  const failed = h.fresh(source);
  const next = requireLifecycleApplied(h.lifecycle.retry({ commandId: h.ids.uuid(), runId: failed.envelope.runId, expectedVersion: failed.version,
    runtimeConfig: selectRunRuntime(h.database.authority), appVersion: "0.1.0" }, h.descriptor,
    { title: "Fixture continuation", actorId: "local-operator" }));
  let lookups = 0;
  const authority = h.database.authority;
  const repositories = { ...authority, runs: { get: (id: string) => {
    const run = authority.runs.get(id);
    if (id !== failed.envelope.runId || run === undefined) return run;
    if (change === "deleted") return undefined;
    if (change === "version") return RunRecordSchema.parse({ ...run, version: run.version + 1 });
    if (change === "input") return RunRecordSchema.parse({ ...run, input: { ...run.input, raw: { eid: "10899999" } } });
    return RunRecordSchema.parse({ ...run, envelope: { ...run.envelope,
      ...(change === "attempt" ? { attempt: run.envelope.attempt + 1 }
        : change === "workflow" ? { workflow: "foreign-workflow" }
          : { configSnapshotId: randomUUID() }) } });
  } }, runCheckpoints: { ...authority.runCheckpoints,
    listByAttempt: (...args: Parameters<typeof authority.runCheckpoints.listByAttempt>) => { lookups += 1; return authority.runCheckpoints.listByAttempt(...args); } } };
  assert.throws(() => readRunCheckpoint(repositories, next.envelope, "read", true), RunContinuationRefusedError);
  assert.equal(lookups, 0);
  assert.deepEqual(h.world.events, ["read:absent"]);
});

it("rejects changed checkpoint bytes and never substitutes a different item's latest result", async () => {
  const h = await sourceBoundHarness(failedSourceReadDescriptor, world => sourceBoundReadStores(world, 2)); cleanups.push(h.dispose);
  const source = h.start(h.proposal()); await h.execute(source); const failed = h.fresh(source);
  const next = requireLifecycleApplied(h.lifecycle.retry({ commandId: h.ids.uuid(), runId: failed.envelope.runId, expectedVersion: failed.version,
    runtimeConfig: selectRunRuntime(h.database.authority), appVersion: "0.1.0" }, h.descriptor,
    { title: "Fixture continuation", actorId: "local-operator" }));
  const authority = h.database.authority;
  const cp = readRunCheckpoint(authority, next.envelope, "read", true); assert.ok(cp);
  for (const row of [undefined, RunCheckpointRecordSchema.parse({ ...cp, runId: randomUUID() }), RunCheckpointRecordSchema.parse({ ...cp, output: { ...cp.output, value: { eid: "10899999" } } })]) {
    assert.throws(() => readRunCheckpoint({ ...authority, runCheckpoints: { ...authority.runCheckpoints, get: () => row } }, next.envelope, "read", true), RunContinuationRefusedError);
  }
  assert.throws(() => readRunCheckpoint({ ...authority, lifecycleJournal: { findContinuationIssue: () => undefined } }, next.envelope, "read", true), RunContinuationRefusedError);
});

it("refreshes exact issuance through repeated pause and resume on the same run", async () => {
  const h = await sourceBoundHarness(failedSourceReadDescriptor, sourceBoundReadStores); cleanups.push(h.dispose);
  let current = h.start(h.proposal());
  for (let index = 0; index < 3; index += 1) {
    current = requireLifecycleApplied(h.lifecycle.pause({ commandId: h.ids.uuid(), runId: current.envelope.runId, expectedVersion: current.version }));
    current = requireLifecycleApplied(h.lifecycle.resumePaused({ commandId: h.ids.uuid(), runId: current.envelope.runId, expectedVersion: current.version }));
    const bumped = h.database.authority.runs.bumpPriority({ runId: current.envelope.runId, expectedVersion: current.version,
      now: h.clock.now().toISOString() });
    assert.equal(bumped.state, "applied");
    if (bumped.state !== "applied") throw new Error("fixture bump refused");
    current = bumped.run;
    assert.equal(current.envelope.continuation?.sources.length, 1);
    assert.equal(validateRunContinuation(h.database.authority, current.envelope)[0]?.envelope.runId, current.envelope.runId);
  }
  assert.equal((await h.execute(current)).state, "done");
  assert.deepEqual(h.world.events, ["read:absent", "read:absent"]);
});
