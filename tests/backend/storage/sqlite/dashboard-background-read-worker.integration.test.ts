import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";
import { createDashboardBackgroundReader } from "../../../../src/backend/storage/sqlite/dashboard-background-read-worker.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { openBoundDatabaseFixture } from "../../../support/helpers/admission-fixture.js";

it("returns ordered bounded pages and observes peer commits without advancing authority", async () => {
  const fixture = await openBoundDatabaseFixture("background-read");
  try {
    const reader = createDashboardBackgroundReader(fixture.profile.admission);
    try {
      const peer = fixture.database;
      const start = peer.authority.timelineEvents.highWaterMark();
      const request = { after: start, limit: 2, nowMs: systemClock.nowMs() };
      const before = await reader.read(request);
      assert.deepEqual(before.records, []);
      assert.equal(before.cursor, start);
      const writer = createDebugEventWriter({ repository: peer.authority.timelineEvents, clock: systemClock, build: "test" });
      const concurrent = reader.read(request);
      const records = peer.withAuthorityTransaction(repositories => {
        const workflow = "person-lookup";
        const current = repositories.workerPools.get(workflow);
        const plan = repositories.workerPools.plan({ workflow, desiredWorkers: (current?.desiredWorkers ?? 0) + 1,
          expectedVersion: current?.version ?? 0, requestedBy: "local-operator", now: systemClock.now().toISOString() });
        assert.equal(plan.state, "applied");
        return ["first", "second", "third"].map(correlationId =>
          writer.emit({ category: "http", phase: "failed", correlationId }).record);
      });
      const raced = await concurrent;
      const key = peer.changeKey();
      const page = await reader.read(request);
      assert.deepEqual(page.records, records.slice(0, 2));
      assert.equal(page.cursor, records[1].cursor);
      assert.equal(page.through, records[2].cursor);
      assert.notEqual(page.workers.fingerprint, before.workers.fingerprint);
      assert.deepEqual(peer.changeKey(), key);
      assert.deepEqual(raced, raced.through === start ? before : page);
      writer.emit({ category: "http", phase: "failed", correlationId: "beyond-bound" });
      const last = await reader.read({ ...request, after: page.cursor, through: page.through });
      assert.deepEqual(last.records, records.slice(2));
      assert.equal(last.cursor, page.through);
      const empty = await reader.read({ ...request, after: last.cursor, through: page.through });
      assert.deepEqual(empty.records, []);
      assert.deepEqual(empty.workers, page.workers);
      assert.deepEqual((await reader.read({ ...request, spanTypes: ["run.claimed"] })).records, []);
      await assert.rejects(reader.read({ ...request, limit: 1001 }));
      await assert.rejects(reader.read({ ...request, after: last.cursor + 2 }), /timeline-cursor-reset-required/u);
    } finally { await reader.close(); }
  } finally { await fixture.close(); }
});

it("bounds worker facts and refuses to combine pages across a worker change", async () => {
  const fixture = await openBoundDatabaseFixture("background-read");
  try {
    const { database } = fixture, authority = database.authority;
    const now = systemClock.now();
    const workflows = ["person-lookup", "onboarding"];
    const slots = workflows.map(workflow => {
      const pool = authority.workerPools.get(workflow);
      assert.equal(authority.workerPools.plan({ workflow, desiredWorkers: 1, expectedVersion: pool?.version ?? 0,
        requestedBy: "local-operator", now: now.toISOString() }).state, "applied");
      return authority.workerSlots.allocate({ workflow, poolIndex: 1, now: now.toISOString() });
    });
    const lease = authority.duoCeremonyLeases.acquire({ credentialKey: "a".repeat(64), workerId: slots[0].workerId,
      system: "ucpath", now: now.toISOString(), ttlMs: 5000 });
    assert.equal(lease.state, "acquired");
    const reader = createDashboardBackgroundReader(fixture.profile.admission);
    try {
      const request = { after: authority.timelineEvents.highWaterMark(), limit: 1, nowMs: now.getTime() };
      const { workers } = await reader.read(request);
      assert.deepEqual(workers.slotWorkflows, workflows.slice(0, 1));
      assert.deepEqual(workers.heldDuoLeases, [{ workerId: slots[0].workerId, system: "ucpath", since: now.toISOString(),
        expiresAt: new Date(now.getTime() + 5000).toISOString() }]);
      assert.ok(workers.next);
      const next = await reader.read({ ...request, workerCursor: workers.next });
      assert.deepEqual(next.workers.slotWorkflows, workflows.slice(1));
      assert.equal(next.workers.next, null);
      const expired = await reader.read({ ...request, nowMs: now.getTime() + 5000 });
      assert.deepEqual(expired.workers.heldDuoLeases, []);
      authority.workerSlots.setPaused({ workerId: slots[1].workerId, paused: true, now: now.toISOString() });
      await assert.rejects(reader.read({ ...request, workerCursor: workers.next }), /worker-cursor-stale/u);
    } finally {
      await reader.close();
      if (lease.state === "acquired") authority.duoCeremonyLeases.release({ token: lease.token, now: now.toISOString() });
    }
  } finally { await fixture.close(); }
});

it("refuses a machine admission and a mismatched binding on the worker connection", async () => {
  const fixture = await openBoundDatabaseFixture("background-read");
  try {
    assert.throws(() => createDashboardBackgroundReader(fixture.profile.machine), /profile-bound-authority-required/u);
    const reader = createDashboardBackgroundReader(fixture.profile.admission);
    const request = { after: fixture.database.authority.timelineEvents.highWaterMark(), limit: 1, nowMs: systemClock.nowMs() };
    const peer = new DatabaseSync(fixture.path);
    const original = fixture.profile.admission.profileBinding.profileId;
    try {
      await reader.read(request);
      const trigger = peer.prepare("SELECT sql FROM sqlite_schema WHERE name='database_states_binding_immutable'").get()?.sql;
      if (typeof trigger !== "string") throw new Error("missing fixture binding trigger");
      peer.exec("DROP TRIGGER database_states_binding_immutable");
      try {
        peer.prepare("UPDATE database_states SET profile_id=? WHERE id=1").run(randomUUID());
        await assert.rejects(reader.read(request), /binding-mismatch/u);
      } finally {
        peer.prepare("UPDATE database_states SET profile_id=? WHERE id=1").run(original);
        peer.exec(trigger);
      }
    } finally {
      peer.close();
      await reader.close();
    }
  } finally { await fixture.close(); }
});

it("drains a pending read before shutdown and refuses later requests", async () => {
  const fixture = await openBoundDatabaseFixture("background-read");
  try {
    const reader = createDashboardBackgroundReader(fixture.profile.admission);
    const request = { after: fixture.database.authority.timelineEvents.highWaterMark(), limit: 1, nowMs: systemClock.nowMs() };
    try {
      const pending = reader.read(request);
      await assert.rejects(reader.read(request), /read-pending/u);
      const closed = reader.close();
      await assert.rejects(reader.read(request), /reader-closed/u);
      const [page] = await Promise.all([pending, closed]);
      assert.deepEqual(page.records, []);
      assert.equal(page.cursor, request.after);
    } finally { await reader.close(); }
  } finally { await fixture.close(); }
});
