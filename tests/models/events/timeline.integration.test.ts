import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { randomUUID as randomUUID_m0,randomUUID as randomUUID_m1 } from "node:crypto";
import { existsSync as existsSync_m1,mkdirSync as mkdirSync_m1,mkdtempSync as mkdtempSync_m0,mkdtempSync as mkdtempSync_m1,readFileSync as readFileSync_m0,readFileSync as readFileSync_m1,realpathSync as realpathSync_m0,realpathSync as realpathSync_m1,rmSync as rmSync_m0,rmSync as rmSync_m1 } from "node:fs";
import { tmpdir as tmpdir_m0,tmpdir as tmpdir_m1 } from "node:os";
import { join as join_m0,join as join_m1 } from "node:path";
import { DatabaseSync as DatabaseSync_m0,DatabaseSync as DatabaseSync_m1 } from "node:sqlite";
import { afterEach as afterEach_m1,describe as describe_m0,describe as describe_m1,it as it_m0,it as it_m1 } from "vitest";
import { z as z_m0 } from "zod";
import { TimelineAppendSchema as TimelineAppendSchema_m0,TimelineAppendSchema as TimelineAppendSchema_m1 } from "../../../src/models/events/timeline.js";
import { manualClock as manualClock_m0,manualClock as manualClock_m1 } from "../../../src/rules/time/clock.js";
import { insertMeasuredSearchRun as insertMeasuredSearchRun_m0 } from "../../support/helpers/backend/cross-date-search-harness.js";
import { foundationFixture as foundationFixture_m1 } from "../../support/helpers/database-foundation/fixtures.js";
import { storageTree as storageTree_m1 } from "../../support/helpers/integration/storage-recovery-fixture.js";
import { AuthorityDatabase as AuthorityDatabase_m0,AuthorityDatabase as AuthorityDatabase_m1,upgradeStorage as upgradeStorage_m1 } from "../../support/helpers/synthetic-storage-admission.js";


{


describe_m0("cross-date search authority read", () => {

  it_m0("authenticates complete retained actor sources and keeps frozen actors through genuine ordinary pruning", () => {
    const root = mkdtempSync_m0(join_m0(realpathSync_m0(tmpdir_m0()), "hrauto-search-actor-"));
    const path=join_m0(root,"authority.db"),clock=manualClock_m0(new Date("2026-11-01T16:00:00.000Z"));
    const database=AuthorityDatabase_m0.open({path,busyTimeoutMs:1000,migrationOwner:"search-actor-test"},clock);
    const raw=new DatabaseSync_m0(path);
    try {
      const run=insertMeasuredSearchRun_m0(database,{seed:983,enqueuedAt:"2026-08-01T16:00:00.000Z",authorityPath:path});
      const unrelated=insertMeasuredSearchRun_m0(database,{seed:984,enqueuedAt:"2026-08-01T16:00:00.000Z",authorityPath:path});
      const e=run.envelope;
      const event=TimelineAppendSchema_m0.parse({schemaVersion:1,eventId:randomUUID_m0(),workflow:e.workflow,
        scope:{kind:"run",runId:e.runId},occurredAt:e.enqueuedAt,recordedAt:e.enqueuedAt,retentionDate:"2026-08-01",source:{kind:"native"},
        payload:{kind:"span",event:{t:"run.queued",kind:"run",pid:4242,ts:e.enqueuedAt,workflow:e.workflow,runId:e.runId,
          attempt:e.attempt,traceId:e.traceId,spanPath:e.traceId,itemId:e.itemId,shape:e.shape,priority:e.priority,dryRun:e.dryRun,
          actorId:"local-operator",title:"Synthetic actor source",descriptorVersion:e.descriptorVersion,contractFingerprint:e.contractFingerprint,
          resolvedInstance:e.resolvedInstance,configFingerprint:e.configFingerprint,configSnapshotId:e.configSnapshotId}}});
      database.authority.timelineEvents.append(event);
      const saved=z_m0.object({actor_source_json:z_m0.string(),metadata_json:z_m0.string(),actor_id:z_m0.string()}).parse(raw.prepare("SELECT actor_source_json,metadata_json,actor_id FROM run_search WHERE run_id=?").get(e.runId));
      for(const fault of ["erase","forge"] as const) {
        if(fault === "erase")raw.prepare("UPDATE run_search SET actor_source_json=NULL,actor_id=NULL,metadata_json=json_set(metadata_json,'$.metadata.actor',json(?)) WHERE run_id=?")
          .run('{"state":"unavailable","reason":"not-recorded"}',e.runId);
        else raw.prepare("UPDATE run_search SET actor_source_json=json_set(actor_source_json,'$[0].event.payload.event.actorId','forged-actor'),actor_id='forged-actor',metadata_json=json_set(metadata_json,'$.metadata.actor.value','forged-actor') WHERE run_id=?").run(e.runId);
        const generation=database.getMeta().authorityGeneration;
        assert_m0.throws(()=>database.authority.runs.search({q:"NONMATCH",scope:"run",facets:{},limit:1}),/run-search-index-rebuild-required/u);
        assert_m0.equal(database.getMeta().authorityGeneration,generation);
        raw.prepare("UPDATE run_search SET actor_source_json=?,actor_id=?,metadata_json=? WHERE run_id=?").run(saved.actor_source_json,saved.actor_id,saved.metadata_json,e.runId);
      }
      const before=database.authority.runs.search({q:e.runId,scope:"run",facets:{},limit:1});
      assert_m0.equal(before.rows[0]?.metadata.actor.state,"available");
      const validBytes=[readFileSync_m0(path),readFileSync_m0(`${path}-wal`)];
      const validGeneration=database.getMeta().authorityGeneration;
      assert_m0.equal(AuthorityDatabase_m0.inspectExistingReadOnly(path).authorityGeneration,validGeneration);
      const readOnly=AuthorityDatabase_m0.open({path,busyTimeoutMs:1000,openMode:"storage-doctor-read-only-no-migrate",migrationOwner:"search-readonly"},clock);
      try { assert_m0.deepEqual(readOnly.authority.runs.search({q:e.runId,scope:"run",facets:{},limit:1}),before); }
      finally { readOnly.close(); }
      assert_m0.deepEqual([readFileSync_m0(path),readFileSync_m0(`${path}-wal`)],validBytes);
      assert_m0.equal(database.getMeta().authorityGeneration,validGeneration);
      const pinned=database.authority.timelineEvents.get(event.eventId);assert_m0.ok(pinned);
      const debug=TimelineAppendSchema_m0.parse({schemaVersion:1,eventId:randomUUID_m0(),scope:{kind:"transport",connectionId:"synthetic-completed-request"},occurredAt:e.enqueuedAt,recordedAt:e.enqueuedAt,retentionDate:"2026-08-01",source:{kind:"native"},payload:{kind:"debug",event:{category:"http",phase:"settled",correlationId:"synthetic-completed-request",method:"GET",route:"/api/v1/health",status:200,build:"test",pid:4242}}});
      database.authority.timelineEvents.append(debug);
      assert_m0.equal(database.authority.timelineEvents.pruneBefore("2026-10-01"),1);
      assert_m0.equal(database.authority.timelineEvents.get(debug.eventId),undefined);
      assert_m0.deepEqual(database.authority.timelineEvents.get(event.eventId),pinned);
      assert_m0.deepEqual(database.authority.runs.search({q:e.runId,scope:"run",facets:{},limit:1}),before);
      for(const fault of ["erase","forge"] as const) {
        if(fault === "erase")raw.prepare("UPDATE run_search SET actor_source_json=NULL,actor_id=NULL,metadata_json=json_set(metadata_json,'$.metadata.actor',json(?)) WHERE run_id=?")
          .run('{"state":"unavailable","reason":"not-recorded"}',e.runId);
        else raw.prepare("UPDATE run_search SET actor_source_json=json_set(actor_source_json,'$[0].event.payload.event.actorId','forged-actor'),actor_id='forged-actor',metadata_json=json_set(metadata_json,'$.metadata.actor.value','forged-actor') WHERE run_id=?").run(e.runId);
        const generation=database.getMeta().authorityGeneration;
        const unrelatedBefore=database.authority.runs.get(unrelated.envelope.runId);assert_m0.ok(unrelatedBefore);
        const sourceBefore=raw.prepare("SELECT * FROM timeline_events ORDER BY cursor").all();
        assert_m0.throws(()=>database.authority.runs.search({q:"NONMATCH",scope:"run",facets:{actor:"nonmatching-actor"},limit:1}),/run-search-index-rebuild-required/u);
        assert_m0.throws(()=>database.authority.runs.updatePresentation({runId:unrelated.envelope.runId,expectedVersion:unrelated.version,displayName:"Must not mutate",now:clock.now().toISOString()}),/run-search-retained-actor-source-mismatch/u);
        assert_m0.deepEqual(database.authority.runs.get(unrelated.envelope.runId),unrelatedBefore);
        assert_m0.equal(database.getMeta().authorityGeneration,generation);
        assert_m0.deepEqual(raw.prepare("SELECT * FROM timeline_events ORDER BY cursor").all(),sourceBefore);
        assert_m0.throws(()=>{
          const unexpected=AuthorityDatabase_m0.open({path,busyTimeoutMs:1000,migrationOwner:"search-post-prune-corrupt-reopen"},clock);
          unexpected.close();
        },/run-search-retained-actor-source-mismatch/u);
        const corruptBytes=[readFileSync_m0(path),readFileSync_m0(`${path}-wal`)];
        assert_m0.throws(()=>AuthorityDatabase_m0.inspectExistingReadOnly(path),/run-search-retained-actor-source-mismatch/u);
        assert_m0.throws(()=>{
          const unexpected=AuthorityDatabase_m0.open({path,busyTimeoutMs:1000,openMode:"storage-doctor-read-only-no-migrate",migrationOwner:"search-corrupt-readonly"},clock);
          unexpected.close();
        },/run-search-retained-actor-source-mismatch/u);
        assert_m0.deepEqual([readFileSync_m0(path),readFileSync_m0(`${path}-wal`)],corruptBytes);
        assert_m0.equal(database.getMeta().authorityGeneration,generation);
        raw.prepare("UPDATE run_search SET actor_source_json=?,actor_id=?,metadata_json=? WHERE run_id=?").run(saved.actor_source_json,saved.actor_id,saved.metadata_json,e.runId);
      }
      const reopened=AuthorityDatabase_m0.open({path,busyTimeoutMs:1000,migrationOwner:"search-post-prune-genuine-reopen"},clock);
      try { assert_m0.deepEqual(reopened.authority.runs.search({q:e.runId,scope:"run",facets:{},limit:1}),before); }
      finally { reopened.close(); }
    } finally { raw.close();database.close();rmSync_m0(root,{recursive:true,force:true}); }
  });
});
}

{


const roots: string[] = [];
const clock = manualClock_m1(new Date("2026-10-01T12:00:00.000Z"));
const _afterEachFixture0 = () => { for (const root of roots.splice(0)) rmSync_m1(root, { recursive: true, force: true }); };
function fresh() {
  const root = mkdtempSync_m1(join_m1(realpathSync_m1(tmpdir_m1()), "storage-upgrade-"));
  roots.push(root);
  mkdirSync_m1(join_m1(root, "artifacts"), { mode: 0o700 });
  const path = join_m1(root, "state.db");
  const input = { stateRoot: root, processLockRoot: join_m1(root, "locks"), plan: false };
  return { root, path, input, run: (plan = false) => upgradeStorage_m1({ ...input, plan }, clock) };
}
function rows(path: string) {
  const raw = new DatabaseSync_m1(path, { readOnly: true });
  try {
    const tables = raw.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    assert_m1.equal(tables.length, 34);
    return Object.fromEntries(tables.map(row => {
      assert_m1.equal(typeof row.name, "string");
      return [String(row.name), raw.prepare(`SELECT * FROM "${String(row.name)}" ORDER BY rowid`).all()];
    }));
  } finally { raw.close(); }
}

describe_m1("stopped native SQLite initialization", () => {
afterEach_m1(_afterEachFixture0);

  it_m1("leaves a fresh root untouched when exclusive restore admission fails and permits exact rerun", async () => {
    const f = fresh(); const before = storageTree_m1(f.root);
    await assert_m1.rejects(upgradeStorage_m1(f.input, clock, () => { throw new Error("injected-admission-failure"); }),
      /injected-admission-failure/u);
    assert_m1.equal(existsSync_m1(f.path), false);
    assert_m1.deepEqual(storageTree_m1(f.root), before);
    assert_m1.equal((await f.run()).state, "initialized");
  });
  it_m1("preserves complete populated current authority and stale claimed lifecycle bytes without recovery", async () => {
    const f = foundationFixture_m1();
    try {
      const run = f.db.authority.runs.get(f.run.envelope.runId);
      assert_m1.ok(run); assert_m1.equal(run.lifecycle.state, "running");
      const generation = f.db.getMeta().authorityGeneration;
      f.db.close();
      const before = rows(f.path); const bytes = readFileSync_m1(f.path);
      const input = { stateRoot: f.root, processLockRoot: join_m1(f.root, "locks"), plan: true };
      assert_m1.equal((await upgradeStorage_m1(input, clock)).state, "planned");
      assert_m1.deepEqual(readFileSync_m1(f.path), bytes);
      assert_m1.equal((await upgradeStorage_m1({ ...input, plan: false }, clock)).state, "already-upgraded");
      assert_m1.deepEqual(rows(f.path), before); assert_m1.deepEqual(readFileSync_m1(f.path), bytes);
      const reopened = AuthorityDatabase_m1.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "stale-current-readback" }, clock);
      try { assert_m1.deepEqual(reopened.authority.runs.get(run.envelope.runId), run);
        assert_m1.equal(reopened.getMeta().authorityGeneration, generation); }
      finally { reopened.close(); }
    } finally { f.dispose(); }
  });
  it_m1.each([2, 29, 46, 999])("refuses schema %s without conversion or source I/O repair", async version => {
    const f = fresh(); await f.run();
    const raw = new DatabaseSync_m1(f.path);
    try { raw.exec(`UPDATE database_states SET schema_version=${String(version)}; PRAGMA user_version=${String(version)}`); }
    finally { raw.close(); }
    const before = storageTree_m1(f.root);
    for (const plan of [true, false]) await assert_m1.rejects(f.run(plan), /authority-schema-mismatch/u);
    assert_m1.deepEqual(storageTree_m1(f.root), before);
  });
  it_m1("refuses a missing selected snapshot before healthy open or upgrade with all bytes unchanged", async () => {
    const f = foundationFixture_m1();
    try {
      const snapshotId = f.snapshot.configSnapshotId; f.db.close();
      const raw = new DatabaseSync_m1(f.path);
      try {
        raw.exec("PRAGMA foreign_keys=OFF");
        const triggers = raw.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='settings_snapshots'").all();
        assert_m1.ok(triggers.length > 0);
        for (const trigger of triggers) raw.exec(`DROP TRIGGER "${String(trigger.name)}"`);
        try { assert_m1.equal(raw.prepare("DELETE FROM settings_snapshots WHERE id=?").run(snapshotId).changes, 1); }
        finally { for (const trigger of triggers) raw.exec(String(trigger.sql)); }
      } finally { raw.close(); }
      const before = storageTree_m1(f.root);
      assert_m1.throws(() => AuthorityDatabase_m1.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "missing-snapshot-boot" }, clock));
      for (const plan of [true, false]) await assert_m1.rejects(upgradeStorage_m1({
        stateRoot: f.root, processLockRoot: join_m1(f.root, "locks"), plan }, clock));
      assert_m1.deepEqual(storageTree_m1(f.root), before);
    } finally { f.dispose(); }
  });
  it_m1("preserves exact native multi-day events and immutable replay through stopped no-op upgrade", async () => {
    const f = foundationFixture_m1();
    try {
      const inputs = ["2026-07-31", "2026-07-31", "2026-07-31", "2026-08-01"].map((day, i) =>
        TimelineAppendSchema_m1.parse({ schemaVersion: 1, eventId: randomUUID_m1(), scope: { kind: "client", clientId: "upgrade-fixture" },
          occurredAt: `${day}T12:00:00.000Z`, recordedAt: `${day}T12:00:00.000Z`, retentionDate: day,
          payload: { kind: "debug", event: { category: "client", phase: "settled", correlationId: `native-${String(i)}`,
            build: "fixture", pid: process.pid } }, source: { kind: "native" } }));
      const retained = inputs.map(input => f.db.authority.timelineEvents.append(input).record);
      assert_m1.equal(retained.length, 4); assert_m1.equal(new Set(retained.map(event => event.eventId)).size, 4);
      assert_m1.deepEqual(retained.map(event => event.retentionDate), ["2026-07-31", "2026-07-31", "2026-07-31", "2026-08-01"]);
      f.db.close(); const before = rows(f.path);
      assert_m1.equal((await upgradeStorage_m1({ stateRoot: f.root, processLockRoot: join_m1(f.root, "locks"), plan: false }, clock)).state, "already-upgraded");
      assert_m1.deepEqual(rows(f.path), before);
      const db = AuthorityDatabase_m1.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "native-timeline-replay" }, clock);
      try {
        assert_m1.deepEqual(db.authority.timelineEvents.page({}), retained);
        const generation = db.getMeta().authorityGeneration;
        for (const [i, input] of inputs.entries()) {
          assert_m1.deepEqual(db.authority.timelineEvents.append(input), { state: "existing", record: retained[i] });
          assert_m1.throws(() => db.authority.timelineEvents.append({ ...input, recordedAt: "2026-10-01T12:00:00.000Z" }), /timeline-event-identity-conflict/u);
        }
        assert_m1.equal(db.getMeta().authorityGeneration, generation);
      } finally { db.close(); }
    } finally { f.dispose(); }
  });
});
}
