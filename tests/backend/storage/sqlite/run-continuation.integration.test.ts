import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { sourceBoundHarness } from "../../../support/fixtures/integration/source-bound-fixtures.js";
import { failedSourceReadDescriptor, sourceBoundReadStores } from "../../../support/fixtures/source-bound-read-fixtures.js";
import { originalCheckpoint, readRunCheckpoint, captureRunContinuation, validateRunContinuation, RunContinuationRefusedError } from "../../../../src/backend/storage/sqlite/run-continuation.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { randomUUID } from "node:crypto";
import { mappedReadDescriptor } from "../../../support/fixtures/rerun-values-fixtures.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { descriptorRuntimeNodes } from "../../../../src/workflow-kit/workflow.js";
import { PositiveIntSchema, RunIdSchema } from "../../../../src/rules/identity/ids.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

function recover(h: Awaited<ReturnType<typeof sourceBoundHarness>>, source: ReturnType<typeof h.fresh>) {
  const result = h.kernel.execute({ commandId: h.ids.uuid(), family: "run", type: "recover-run", source: "dashboard",
    requestedBy: "local-operator", requestedAt: h.clock.now().toISOString(), target: { runId: source.envelope.runId, expectedVersion: source.version } });
  assert.ok(result.state === "applied");
  const target = result.affectedTargets[0]; assert.ok(target?.family === "run");
  const next = h.database.authority.runs.get(target.runId); assert.ok(next); return next;
}

it("continues a paused and resumed run through ordinary gate resolution without reexecuting its completed read", async () => {
  const h = await sourceBoundHarness(mappedReadDescriptor(undefined, { gate: true }), sourceBoundReadStores); cleanups.push(h.dispose);
  let run = h.start(h.proposal());
  run = requireLifecycleApplied(h.lifecycle.pause({ commandId: h.ids.uuid(), runId: run.envelope.runId, expectedVersion: run.version }));
  run = requireLifecycleApplied(h.lifecycle.resumePaused({ commandId: h.ids.uuid(), runId: run.envelope.runId, expectedVersion: run.version }));
  assert.equal(run.envelope.startAt, undefined);
  assert.equal((await h.execute(run)).state, "parked-gate");
  run = h.fresh(run);
  assert.equal(run.lifecycle.state, "parked-gate");
  const gate = descriptorRuntimeNodes(h.descriptor).find(node => node.id === "approval"); assert.ok(gate?.kind === "gate");
  const resolved = h.kernel.execute({ commandId: h.ids.uuid(), family: "gate", type: "resolve-gate", requestedBy: "local-operator",
    source: "dashboard", requestedAt: h.clock.now().toISOString(),
    target: { runId: run.envelope.runId, gateId: "approval", expectedVersion: run.version },
    payload: { result: { schemaHash: deriveSchemaHash(gate.result, "output"), value: { approved: true } } } });
  assert.equal(resolved.state, "applied", JSON.stringify(resolved));
  run = h.fresh(run);
  assert.equal(run.envelope.startAt, "approval");
  assert.equal((await h.execute(run)).state, "done");
  assert.deepEqual(h.world.events, ["read:absent"]);
});

it("reuses a completed always-rerun task after downstream failure and does not invoke it again", async () => {
  const h = await sourceBoundHarness(failedSourceReadDescriptor, world => sourceBoundReadStores(world, 2)); cleanups.push(h.dispose);
  const source = h.start(h.proposal());
  assert.equal((await h.execute(source)).state, "failed");
  const failed = h.fresh(source);
  assert.deepEqual(h.world.events, ["read:absent"]);
  const next = recover(h, failed);
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
  const next = recover(h, failed);
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
  const next = recover(h, failed);
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

it("binds original checkpoints to the consumer claim and leaves a fresh run without a row empty", async () => {
  const h = await sourceBoundHarness(failedSourceReadDescriptor, world => sourceBoundReadStores(world, 2)); cleanups.push(h.dispose);
  const source = h.start(h.proposal()), authority = h.database.authority;
  assert.equal(originalCheckpoint(authority, source, "read", 1), undefined);
  assert.equal((await h.execute(source)).state, "failed");
  const failed = h.fresh(source), first = readRunCheckpoint(authority, failed.envelope, "read", true); assert.ok(first);
  const second = RunCheckpointRecordSchema.parse({ ...first, claimGeneration: first.claimGeneration + 1,
    output: { ...first.output, value: { eid: "10899999" } } });
  authority.runCheckpoints.insert(second);
  assert.deepEqual(originalCheckpoint(authority, failed, "read", first.claimGeneration), first);
  assert.deepEqual(originalCheckpoint(authority, failed, "read", second.claimGeneration), second);
});

it("binds an inherited original to creation issuance after Resume replaced its reference and authenticates its digest", async () => {
  const h = await sourceBoundHarness(failedSourceReadDescriptor, world => sourceBoundReadStores(world, 2)); cleanups.push(h.dispose);
  const source = h.start(h.proposal()); assert.equal((await h.execute(source)).state, "failed");
  const authority = h.database.authority, failed = h.fresh(source);
  const first = readRunCheckpoint(authority, failed.envelope, "read", true); assert.ok(first);
  let next = recover(h, failed);
  const created = authority.lifecycleJournal.findContinuationIssue(next.envelope.runId, 1);
  assert.equal(created?.request.operation, "recover");
  assert.ok(created?.result.kind === "run");
  assert.equal(created.result.continuation?.checkpoints.find(row => row.nodeId === "read")?.runId, source.envelope.runId);
  authority.runCheckpoints.insert(RunCheckpointRecordSchema.parse({ ...first, runId: next.envelope.runId,
    attempt: next.envelope.attempt, claimGeneration: 2, output: { ...first.output, value: { eid: "10899999" } } }));
  for (let index = 0; index < 2; index += 1) {
    next = requireLifecycleApplied(h.lifecycle.pause({ commandId: h.ids.uuid(), runId: next.envelope.runId, expectedVersion: next.version }));
    next = requireLifecycleApplied(h.lifecycle.resumePaused({ commandId: h.ids.uuid(), runId: next.envelope.runId, expectedVersion: next.version }));
    assert.equal(next.envelope.continuation?.checkpoints.find(row => row.nodeId === "read")?.runId, next.envelope.runId);
    assert.deepEqual(originalCheckpoint(authority, next, "read", 1), first);
  }
  assert.throws(() => originalCheckpoint({ runCheckpoints: authority.runCheckpoints }, next, "read", 1),
    /run-continuation-authority-unavailable/u);
  for (const changed of [undefined, RunCheckpointRecordSchema.parse({ ...first, output: { ...first.output, value: { eid: "10899999" } } })]) {
    assert.throws(() => originalCheckpoint({ ...authority, runCheckpoints: { ...authority.runCheckpoints, get: () => changed } }, next, "read", 1),
      /run-continuation-checkpoint-unavailable/u);
  }
});

it("gives a fresh Start no row of a cancelled run but keeps other runs' latest row, a Retry's and a transaction read's", async () => {
  const h = await sourceBoundHarness(failedSourceReadDescriptor, world => sourceBoundReadStores(world, 2)); cleanups.push(h.dispose);
  const source = h.start(h.proposal()), authority = h.database.authority;
  assert.equal((await h.execute(source)).state, "failed");
  const failed = h.fresh(source), read = readRunCheckpoint(authority, failed.envelope, "read", true); assert.ok(read);
  const fresh = { ...failed.envelope, runId: RunIdSchema.parse(randomUUID()), attempt: PositiveIntSchema.parse(failed.envelope.attempt + 1) };
  assert.deepEqual(readRunCheckpoint(authority, fresh, "read", true), read, "a failed run's row stays a valid ancestor");
  const { completion: _completion, ...unfinished } = failed;
  const cancelled = { ...authority, runs: { get: (runId: string) => runId === failed.envelope.runId
    ? RunRecordSchema.parse({ ...unfinished, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: "2026-07-31T17:00:00.000Z" } }) : authority.runs.get(runId) } };
  assert.equal(readRunCheckpoint(cancelled, fresh, "read", true), undefined);
  assert.deepEqual(readRunCheckpoint(cancelled, fresh, "read"), read);
  assert.deepEqual(readRunCheckpoint(cancelled, { ...fresh, retryOf: failed.envelope.runId }, "read", true), read);
});
