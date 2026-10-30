import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { createTimelineRepository } from "../../../../src/backend/storage/sqlite/timeline-repository.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { testRunService, testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { failure,foundationFixture,terminalizeFixtureFailure } from "../../../support/helpers/database-foundation/fixtures.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

function fixture(path?: string) {
  const database = new DatabaseSync(path ?? ":memory:");
  if (path === undefined) for (const migration of SQLITE_MIGRATIONS) for (const statement of migration.statements) database.exec(statement);
  const repository = createTimelineRepository({ database, assertOwner: () => {}, read: work => work(),
    mutate: work => { database.exec("BEGIN IMMEDIATE"); try { const result = work(); database.exec("COMMIT"); return result.result; }
      catch (error) { database.exec("ROLLBACK"); throw error; } } });
  const clock = manualClock(new Date("2026-01-01T12:00:00.000Z"));
  return { database, repository, clock };
}

it.each(["done", "failed", "interrupted", "open"] as const)("prunes ordinary successful pairs while preserving %s evidence", outcome => {
  const f = fixture();
  try {
    const writer = createTimelineEmitter({ repository: f.repository, clock: f.clock, pid: 123 });
    const common = { ts: f.clock.now().toISOString(), workflow: "person-lookup", kind: "worker" as const,
      workerId: "worker-1", spanPath: "worker-1" };
    writer.emit({ ...common, t: "span.started", name: "Worker" });
    if (outcome !== "open") writer.emit({ ...common, t: "span.ended", outcome });
    const before = f.repository.page({});
    assert.equal(f.repository.pruneBefore("2026-03-01"), outcome === "done" ? 2 : 0);
    assert.deepEqual(f.repository.page({}), outcome === "done" ? [] : before);
  } finally { f.database.close(); }
});

it.each(["pid", "worker", "workflow", "kind"] as const)("does not pair a reused path with another %s owner", field => {
  const f = fixture();
  try {
    const start = { ts: f.clock.now().toISOString(), workflow: "person-lookup", pid: 123,
      kind: "browser", workerId: "worker-1", spanPath: "worker-1", system: "ucpath" };
    const append = (event: unknown) => f.repository.append({ schemaVersion: 1, eventId: randomUUID(), workflow: field === "workflow" ? "separations" : "person-lookup",
      scope: { kind: "worker", workerId: field === "worker" ? "worker-2" : "worker-1" },
      occurredAt: f.clock.now().toISOString(), recordedAt: f.clock.now().toISOString(), retentionDate: "2026-01-01",
      source: { kind: "native" }, payload: { kind: "span", event } });
    const writer = createTimelineEmitter({ repository: f.repository, clock: f.clock, pid: start.pid });
    writer.emit({ ...start, t: "span.started", name: "Browser" });
    const { system: _system, ...endIdentity } = start;
    const ended = { ...endIdentity, t: "span.ended", outcome: "done",
      ...(field === "pid" ? { pid: 124 } : {}), ...(field === "worker" ? { workerId: "worker-2" } : {}),
      ...(field === "workflow" ? { workflow: "separations" } : {}),
      ...(field === "kind" ? { kind: "worker" } : {}) };
    append(ended);
    const before = f.repository.page({});
    assert.equal(f.repository.pruneBefore("2026-03-01"), 1);
    assert.deepEqual(f.repository.page({}), [before[0]]);
  } finally { f.database.close(); }
});

 it.each(["done", "failed", "interrupted", "open"] as const)("pairs actual run.claimed with its %s run completion", async outcome => {
  const native = await foundationFixture();
  terminalizeFixtureFailure(native, native.run, failure());
  const f = fixture(native.path);
  try {
    const writer = createTimelineEmitter({ repository: f.repository, clock: f.clock, pid: 123 });
    const common = { ts: f.clock.now().toISOString(), workflow: native.run.envelope.workflow, runId: native.run.envelope.runId,
      traceId: native.run.envelope.traceId, attempt: native.run.envelope.attempt, workerId: "worker-1", claimGeneration: 2, spanPath: "run" };
    writer.emit({ ...common, t: "run.claimed" });
    if (outcome !== "open") writer.emit({ ...common, t: "span.ended", kind: "run", outcome });
    const before = f.repository.page({});
    assert.equal(f.repository.pruneBefore("2026-03-01"), outcome === "done" ? 2 : 0);
    assert.deepEqual(f.repository.page({}), outcome === "done" ? [] : before);
  } finally { f.database.close(); await native.dispose(); }
});

it("preserves the actual lifecycle command's claimed and failed completion pair after settlement", async () => {
  const f = await foundationFixture();
  try {
    assert.ok(f.run.lifecycle.state === "running");
    const workerId = f.run.lifecycle.workerId;
    assert.equal(f.db.authority.runs.requeue({ runId: f.run.envelope.runId, expectedVersion: f.run.version,
      claim: { workerId, claimGeneration: f.run.claimGeneration }, cause: "recovery", now: f.clock.now().toISOString() }).state, "applied");
    const service = testRunService(f.db, f.clock);
    const runtime = f.db.authority.runtimeConfig.get(); assert.ok(runtime);
    const slot = f.db.authority.workerSlots.get(workerId); assert.ok(slot);
    assert.equal(service.claimNext({ commandId: randomUUID(), workflow: f.run.envelope.workflow, workerId,
      workerLifetime: testWorkerLifetime(f.db, f.run.envelope.workflow, slot.poolIndex).workerLifetime,
      runtimeConfig: { generation: runtime.generation, settingsRevision: runtime.settingsRevision,
        settingsFingerprint: runtime.settingsFingerprint, configFingerprint: runtime.configFingerprint } }).state, "applied");
    let current = f.db.authority.runs.get(f.run.envelope.runId); assert.ok(current);
    assert.ok(current.lifecycle.state === "claimed");
    const claim = { workerId, claimGeneration: current.claimGeneration }, now = f.clock.now().toISOString();
    const workerLifetime = current.lifecycle.workerLifetime;
    const validating = f.db.authority.runs.transition({ runId: current.envelope.runId, expectedVersion: current.version,
      claim, lifecycle: { state: "validating", workerId, workerLifetime, claimedAt: now, heartbeatAt: now }, now });
    assert.equal(validating.state, "applied"); if (validating.state !== "applied") throw new Error("validation refused");
    const running = f.db.authority.runs.transition({ runId: current.envelope.runId, expectedVersion: validating.run.version,
      claim, lifecycle: { state: "running", workerId, workerLifetime, claimedAt: now, heartbeatAt: now, currentNodeId: "searching" }, now });
    assert.equal(running.state, "applied"); if (running.state !== "applied") throw new Error("running refused");
    current = running.run;
    const record = failure();
    assert.equal(service.terminalize({ kind: "failure", commandId: randomUUID(), terminal: { failure: record,
      authorization: { kind: "failed", runId: current.envelope.runId, workflowId: current.envelope.workflow,
        attempt: current.envelope.attempt, descriptorVersion: current.envelope.descriptorVersion,
        contractFingerprint: current.envelope.contractFingerprint, expectedVersion: current.version,
        claim, authorizedAt: now, failureId: record.failureId } } }, personLookupDescriptor).state, "applied");
    const before = f.db.authority.timelineEvents.page({ runId: current.envelope.runId });
    assert.deepEqual(before.filter(row => row.payload.kind === "span").map(row => row.payload.kind === "span" ? row.payload.event.t : null), ["run.claimed", "span.ended"]);
    assert.equal(f.db.authority.timelineEvents.pruneBefore("2027-01-01"), 0);
    assert.deepEqual(f.db.authority.timelineEvents.page({ runId: current.envelope.runId }), before);
  } finally { await f.dispose(); }
});
