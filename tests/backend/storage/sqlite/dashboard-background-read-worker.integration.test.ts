import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { createDashboardSnapshotQuery } from "../../../../src/backend/storage/sqlite/authority-dashboard-snapshot.js";
import { createDashboardBackgroundReader } from "../../../../src/backend/storage/sqlite/dashboard-background-read-worker.js";
import { createDashboardReadHost } from "../../../../src/backend/storage/sqlite/dashboard-read-host.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { traceSqliteStatements } from "../../../perf/sqlite-statement-counter.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { openBoundDatabaseFixture } from "../../../support/helpers/admission-fixture.js";
import { runRecordOf } from "../../../support/helpers/backend/dashboard-harness.js";

function navigationLane(fixture: Awaited<ReturnType<typeof openBoundDatabaseFixture>>) {
  const lanes = createDashboardReadHost({ admission: fixture.profile.admission, database: fixture.database, clock: systemClock, lanes: ["navigation"] });
  return { lanes, reader: createDashboardBackgroundReader(lanes) };
}

function companions(path: string) {
  return ["-wal", "-shm"].filter(suffix => existsSync(path + suffix));
}

it("returns ordered bounded pages and observes peer commits without advancing authority", async () => {
  const fixture = await openBoundDatabaseFixture("background-read");
  try {
    const { lanes, reader } = navigationLane(fixture);
    try {
      const peer = fixture.database;
      const start = peer.authority.timelineEvents.highWaterMark();
      const request = { after: start, limit: 2, nowMs: systemClock.nowMs() };
      const before = await reader.read(request);
      assert.deepEqual(before.records, []);
      assert.equal(before.cursor, start);
      const timeline = peer.authority.timelineEvents;
      const workflow = "person-lookup";
      const debug = createDebugEventWriter({ repository: timeline, clock: systemClock, build: "test" });
      const notes = createNoteTimelineWriter({ repository: timeline, clock: systemClock });
      const note = (message: string) => notes.emitNote({ workflow, address: { workerId: "worker-1", spanPath: "worker-1" },
        level: "step", message });
      const concurrent = reader.read(request);
      const records = peer.withAuthorityTransaction(repositories => {
        const current = repositories.workerPools.get(workflow);
        const plan = repositories.workerPools.plan({ workflow, desiredWorkers: (current?.desiredWorkers ?? 0) + 1,
          expectedVersion: current?.version ?? 0, requestedBy: "local-operator", now: systemClock.now().toISOString() });
        assert.equal(plan.state, "applied");
        for (const message of ["first", "second", "third"]) note(message);
        debug.emit({ category: "http", phase: "failed", correlationId: "outside-timeline" });
        return timeline.page({ after: start, limit: 4 });
      });
      assert.equal(records.length, 3);
      assert.ok(records.every(record => record.payload.kind === "note"));
      const raced = await concurrent;
      const key = peer.changeKey();
      const page = await reader.read(request);
      assert.deepEqual(page.records, records.slice(0, 2));
      assert.equal(page.cursor, records[1].cursor);
      assert.equal(page.through, records[2].cursor);
      assert.notEqual(page.workers.fingerprint, before.workers.fingerprint);
      assert.deepEqual(peer.changeKey(), key);
      assert.deepEqual(raced, raced.through === start ? before : page);
      note("beyond-bound");
      const last = await reader.read({ ...request, after: page.cursor, through: page.through });
      assert.deepEqual(last.records, records.slice(2));
      assert.equal(last.cursor, page.through);
      const empty = await reader.read({ ...request, after: last.cursor, through: page.through });
      assert.deepEqual(empty.records, []);
      assert.deepEqual(empty.workers, page.workers);
      assert.deepEqual((await reader.read({ ...request, spanTypes: ["run.claimed"] })).records, []);
      await assert.rejects(reader.read({ ...request, limit: 1001 }));
      await assert.rejects(reader.read({ ...request, after: last.cursor + 2 }), /timeline-cursor-reset-required/u);
    } finally { await lanes.close(); }
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
    const { lanes, reader } = navigationLane(fixture);
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
      await lanes.close();
      if (lease.state === "acquired") authority.duoCeremonyLeases.release({ token: lease.token, now: now.toISOString() });
    }
  } finally { await fixture.close(); }
});

it("refuses a machine admission and a mismatched binding on the worker connection", async () => {
  const fixture = await openBoundDatabaseFixture("background-read");
  try {
    assert.throws(() => createDashboardReadHost({ admission: fixture.profile.machine, database: fixture.database, clock: systemClock }), /profile-bound-authority-required/u);
    const { lanes, reader } = navigationLane(fixture);
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
      await lanes.close();
    }
    fixture.database.close();
    assert.deepEqual(companions(fixture.path), []);
  } finally { await fixture.close(); }
});

it("holds the store open while its lane runs, settles waiters at close and refuses later requests", async () => {
  const fixture = await openBoundDatabaseFixture("background-read");
  try {
    const { lanes, reader } = navigationLane(fixture);
    const request = { after: fixture.database.authority.timelineEvents.highWaterMark(), limit: 1, nowMs: systemClock.nowMs() };
    try {
      await lanes.ready;
      const page = await reader.read(request);
      assert.deepEqual(page.records, []);
      assert.equal(page.cursor, request.after);
      const pending = reader.read(request);
      assert.throws(() => fixture.database.close(), /dashboard-background-reader-open/u);
      const closed = lanes.close();
      await assert.rejects(reader.read(request), /read-lane-closed/u);
      await Promise.allSettled([pending]);
      await closed;
      const aborted = new AbortController();
      aborted.abort(new Error("caller-gone"));
      await assert.rejects(reader.read(request, aborted.signal), /read-lane-closed/u);
    } finally { await lanes.close(); }
  } finally { await fixture.close(); }
});

it("refuses a closed source without creating WAL companions on the checkpointed profile", async () => {
  const fixture = await openBoundDatabaseFixture("background-source");
  try {
    assert.deepEqual(companions(fixture.path), ["-wal", "-shm"]);
    const { lanes, reader } = navigationLane(fixture);
    try { await reader.read({ after: 0, limit: 1, nowMs: systemClock.nowMs() }); }
    finally { await lanes.close(); }
    fixture.database.close();
    assert.deepEqual(companions(fixture.path), []);
    assert.throws(() => navigationLane(fixture), /authority database is closed/u);
    assert.deepEqual(companions(fixture.path), []);
  } finally { await fixture.close(); }
});

it("reads only changed run facts after its first snapshot", async () => {
  const fixture = await openBoundDatabaseFixture("background-change-log");
  const native = new DatabaseSync(fixture.path, { readOnly: true });
  try {
    fixture.database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    const first = runRecordOf({ seed: 1 });
    fixture.database.authority.runs.enqueue(first);
    native.exec("PRAGMA query_only=ON");
    const query = createDashboardSnapshotQuery(native, fixture.profile.admission.profileBinding);
    const request = { after: 0, limit: 1, nowMs: systemClock.nowMs() };
    const fullRunRead = (sql: string) => /\bFROM runs(?: ORDER BY|$)/iu.test(sql);
    const initial = traceSqliteStatements(() => query(request));
    assert.ok(initial.statements.some(({ sql }) => fullRunRead(sql)));
    const before = initial.value;
    const unchanged = traceSqliteStatements(() => query(request));
    assert.deepEqual(unchanged.value, before);
    assert.equal(unchanged.statements.some(({ sql }) => fullRunRead(sql)), false);
    fixture.database.authority.runs.enqueue(runRecordOf({ seed: 2 }));
    const changed = traceSqliteStatements(() => query(request));
    assert.notEqual(changed.value.workers.fingerprint, before.workers.fingerprint);
    assert.equal(changed.statements.some(({ sql }) => fullRunRead(sql)), false);
    assert.deepEqual(changed.value, createDashboardSnapshotQuery(native, fixture.profile.admission.profileBinding)(request));
    const renamed = fixture.database.authority.runs.updatePresentation({ runId: first.envelope.runId, expectedVersion: first.version,
      displayName: "Revised", now: systemClock.now().toISOString() });
    assert.equal(renamed.state, "applied");
    const updated = traceSqliteStatements(() => query(request));
    assert.notEqual(updated.value.workers.fingerprint, changed.value.workers.fingerprint);
    assert.equal(updated.statements.some(({ sql }) => fullRunRead(sql)), false);
    assert.deepEqual(updated.value, createDashboardSnapshotQuery(native, fixture.profile.admission.profileBinding)(request));

    fixture.database.authority.runs.enqueue(runRecordOf({ seed: 3 }));
    const peer = new DatabaseSync(fixture.path);
    try { peer.exec("DELETE FROM authority_changes WHERE seq=(SELECT max(seq) FROM authority_changes)"); }
    finally { peer.close(); }
    const rebuilt = query(request);
    assert.notEqual(rebuilt.workers.fingerprint, updated.value.workers.fingerprint);
    assert.deepEqual(rebuilt, createDashboardSnapshotQuery(native, fixture.profile.admission.profileBinding)(request));
    assert.equal(traceSqliteStatements(() => query(request)).statements.some(({ sql }) => fullRunRead(sql)), false);
  } finally { native.close(); await fixture.close(); }
});

it("reports the store position of the transaction its page and worker facts were read in", async () => {
  const fixture = await openBoundDatabaseFixture("background-snapshot-position");
  const native = new DatabaseSync(fixture.path, { readOnly: true });
  try {
    fixture.database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    fixture.database.authority.runs.enqueue(runRecordOf({ seed: 1 }));
    native.exec("PRAGMA query_only=ON");
    const positions: unknown[] = [];
    createDashboardSnapshotQuery(native, fixture.profile.admission.profileBinding)({ after: 0, limit: 1, nowMs: systemClock.nowMs() },
      position => { positions.push(position); });
    const meta = fixture.database.getMeta();
    const seq = native.prepare("SELECT seq FROM sqlite_sequence WHERE name='authority_changes'").get()?.seq;
    assert.deepEqual(positions, [{ schemaVersion: meta.schemaVersion, schemaCookie: native.prepare("PRAGMA schema_version").get()?.schema_version,
      authorityGeneration: meta.authorityGeneration, changeLogSeq: seq }]);
  } finally { native.close(); await fixture.close(); }
});
