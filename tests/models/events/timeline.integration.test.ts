import { AUTHORITY_TABLE_REGISTRY } from "../../../src/models/config/authority.js";
import { default as assert } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { readFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach } from "vitest";
import { describe } from "vitest";
import { it } from "vitest";
import { z } from "zod";
import { TimelineAppendSchema } from "../../../src/models/events/timeline.js";
import { AuthoritySchemaVersionError } from "../../../src/backend/storage/sqlite/authority-database.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../src/backend/storage/sqlite/migrations.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { insertMeasuredSearchRun } from "../../support/helpers/backend/cross-date-search-harness.js";
import { foundationFixture } from "../../support/helpers/database-foundation/fixtures.js";
import { storageTree } from "../../support/helpers/integration/storage-recovery-fixture.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";
import { upgradeStorage } from "../../support/helpers/synthetic-storage-admission.js";

{

describe("cross-date search authority read", () => {

  it("authenticates complete retained actor sources and keeps frozen actors through genuine ordinary pruning", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-search-actor-"));
    const path=join(root,"authority.db"),clock=manualClock(new Date("2026-11-01T16:00:00.000Z"));
    const database=AuthorityDatabase.open({path,busyTimeoutMs:1000,migrationOwner:"search-actor-test"},clock);
    const raw=new DatabaseSync(path);
    try {
      const run=insertMeasuredSearchRun(database,{seed:983,enqueuedAt:"2026-08-01T16:00:00.000Z",authorityPath:path});
      const unrelated=insertMeasuredSearchRun(database,{seed:984,enqueuedAt:"2026-08-01T16:00:00.000Z",authorityPath:path});
      const e=run.envelope;
      const event=TimelineAppendSchema.parse({schemaVersion:1,eventId:randomUUID(),workflow:e.workflow,
        scope:{kind:"run",runId:e.runId},occurredAt:e.enqueuedAt,recordedAt:e.enqueuedAt,retentionDate:"2026-08-01",source:{kind:"native"},
        payload:{kind:"span",event:{t:"run.queued",kind:"run",pid:4242,ts:e.enqueuedAt,workflow:e.workflow,runId:e.runId,
          attempt:e.attempt,traceId:e.traceId,spanPath:e.traceId,itemId:e.itemId,shape:e.shape,priority:e.priority,dryRun:e.dryRun,
          actorId:"local-operator",title:"Synthetic actor source",descriptorVersion:e.descriptorVersion,contractFingerprint:e.contractFingerprint,
          resolvedInstance:e.resolvedInstance,configFingerprint:e.configFingerprint,configSnapshotId:e.configSnapshotId}}});
      database.authority.timelineEvents.append(event);
      const saved=z.object({actor_source_json:z.string(),metadata_json:z.string(),actor_id:z.string()}).parse(raw.prepare("SELECT actor_source_json,metadata_json,actor_id FROM run_search WHERE run_id=?").get(e.runId));
      for(const fault of ["erase","forge"] as const) {
        if(fault === "erase")raw.prepare("UPDATE run_search SET actor_source_json=NULL,actor_id=NULL,metadata_json=json_set(metadata_json,'$.metadata.actor',json(?)) WHERE run_id=?")
          .run('{"state":"unavailable","reason":"not-recorded"}',e.runId);
        else raw.prepare("UPDATE run_search SET actor_source_json=json_set(actor_source_json,'$[0].event.payload.event.actorId','forged-actor'),actor_id='forged-actor',metadata_json=json_set(metadata_json,'$.metadata.actor.value','forged-actor') WHERE run_id=?").run(e.runId);
        const generation=database.getMeta().authorityGeneration;
        assert.throws(()=>database.authority.runs.search({q:"NONMATCH",scope:"run",facets:{},limit:1}),/run-search-index-rebuild-required/u);
        assert.equal(database.getMeta().authorityGeneration,generation);
        raw.prepare("UPDATE run_search SET actor_source_json=?,actor_id=?,metadata_json=? WHERE run_id=?").run(saved.actor_source_json,saved.actor_id,saved.metadata_json,e.runId);
      }
      const before=database.authority.runs.search({q:e.runId,scope:"run",facets:{},limit:1});
      assert.equal(before.rows[0]?.metadata.actor.state,"available");
      const validBytes=[readFileSync(path),readFileSync(`${path}-wal`)];
      const validGeneration=database.getMeta().authorityGeneration;
      assert.equal(AuthorityDatabase.inspectExistingReadOnly(path).authorityGeneration,validGeneration);
      const readOnly=AuthorityDatabase.open({path,busyTimeoutMs:1000,openMode:"storage-doctor-read-only-no-migrate",migrationOwner:"search-readonly"},clock);
      try { assert.deepEqual(readOnly.authority.runs.search({q:e.runId,scope:"run",facets:{},limit:1}),before); }
      finally { readOnly.close(); }
      assert.deepEqual([readFileSync(path),readFileSync(`${path}-wal`)],validBytes);
      assert.equal(database.getMeta().authorityGeneration,validGeneration);
      const pinned=database.authority.timelineEvents.get(event.eventId);assert.ok(pinned);
      const debug=TimelineAppendSchema.parse({schemaVersion:1,eventId:randomUUID(),scope:{kind:"transport",connectionId:"synthetic-completed-request"},occurredAt:e.enqueuedAt,recordedAt:e.enqueuedAt,retentionDate:"2026-08-01",source:{kind:"native"},payload:{kind:"debug",event:{category:"http",phase:"settled",correlationId:"synthetic-completed-request",method:"GET",route:"/api/v1/health",status:200,build:"test",pid:4242}}});
      database.authority.timelineEvents.append(debug);
      assert.equal(database.authority.timelineEvents.pruneBefore("2026-10-01"),1);
      assert.equal(database.authority.timelineEvents.get(debug.eventId),undefined);
      assert.deepEqual(database.authority.timelineEvents.get(event.eventId),pinned);
      assert.deepEqual(database.authority.runs.search({q:e.runId,scope:"run",facets:{},limit:1}),before);
      for(const fault of ["erase","forge"] as const) {
        if(fault === "erase")raw.prepare("UPDATE run_search SET actor_source_json=NULL,actor_id=NULL,metadata_json=json_set(metadata_json,'$.metadata.actor',json(?)) WHERE run_id=?")
          .run('{"state":"unavailable","reason":"not-recorded"}',e.runId);
        else raw.prepare("UPDATE run_search SET actor_source_json=json_set(actor_source_json,'$[0].event.payload.event.actorId','forged-actor'),actor_id='forged-actor',metadata_json=json_set(metadata_json,'$.metadata.actor.value','forged-actor') WHERE run_id=?").run(e.runId);
        const generation=database.getMeta().authorityGeneration;
        const unrelatedBefore=database.authority.runs.get(unrelated.envelope.runId);assert.ok(unrelatedBefore);
        const sourceBefore=raw.prepare("SELECT * FROM timeline_events ORDER BY cursor").all();
        assert.throws(()=>database.authority.runs.search({q:"NONMATCH",scope:"run",facets:{actor:"nonmatching-actor"},limit:1}),/run-search-index-rebuild-required/u);
        assert.throws(()=>database.authority.runs.updatePresentation({runId:unrelated.envelope.runId,expectedVersion:unrelated.version,displayName:"Must not mutate",now:clock.now().toISOString()}),/run-search-retained-actor-source-mismatch/u);
        assert.deepEqual(database.authority.runs.get(unrelated.envelope.runId),unrelatedBefore);
        assert.equal(database.getMeta().authorityGeneration,generation);
        assert.deepEqual(raw.prepare("SELECT * FROM timeline_events ORDER BY cursor").all(),sourceBefore);
        assert.throws(()=>{
          const unexpected=AuthorityDatabase.open({path,busyTimeoutMs:1000,migrationOwner:"search-post-prune-corrupt-reopen"},clock);
          unexpected.close();
        },/run-search-retained-actor-source-mismatch/u);
        const corruptBytes=[readFileSync(path),readFileSync(`${path}-wal`)];
        assert.throws(()=>AuthorityDatabase.inspectExistingReadOnly(path),/run-search-retained-actor-source-mismatch/u);
        assert.throws(()=>{
          const unexpected=AuthorityDatabase.open({path,busyTimeoutMs:1000,openMode:"storage-doctor-read-only-no-migrate",migrationOwner:"search-corrupt-readonly"},clock);
          unexpected.close();
        },/run-search-retained-actor-source-mismatch/u);
        assert.deepEqual([readFileSync(path),readFileSync(`${path}-wal`)],corruptBytes);
        assert.equal(database.getMeta().authorityGeneration,generation);
        raw.prepare("UPDATE run_search SET actor_source_json=?,actor_id=?,metadata_json=? WHERE run_id=?").run(saved.actor_source_json,saved.actor_id,saved.metadata_json,e.runId);
      }
      const reopened=AuthorityDatabase.open({path,busyTimeoutMs:1000,migrationOwner:"search-post-prune-genuine-reopen"},clock);
      try { assert.deepEqual(reopened.authority.runs.search({q:e.runId,scope:"run",facets:{},limit:1}),before); }
      finally { reopened.close(); }
    } finally { raw.close();database.close();rmSync(root,{recursive:true,force:true}); }
  });
});
}

{

const roots: string[] = [];
const clock = manualClock(new Date("2026-10-01T12:00:00.000Z"));
const _afterEachFixture0 = () => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); };
function fresh() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "storage-upgrade-"));
  roots.push(root);
  mkdirSync(join(root, "artifacts"), { mode: 0o700 });
  const path = join(root, "state.db");
  const input = { stateRoot: root, processLockRoot: join(root, "locks"), plan: false };
  return { root, path, input, run: (plan = false) => upgradeStorage({ ...input, plan }, clock) };
}
function rows(path: string) {
  const raw = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = raw.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    assert.equal(tables.length, 36);
    assert.deepEqual(tables.map(row => row.name), AUTHORITY_TABLE_REGISTRY.map(({ name }) => name).sort());
    return Object.fromEntries(tables.map(row => {
      assert.equal(typeof row.name, "string");
      return [String(row.name), raw.prepare(`SELECT * FROM "${String(row.name)}" ORDER BY rowid`).all()];
    }));
  } finally { raw.close(); }
}

describe("stopped native SQLite initialization", () => {
afterEach(_afterEachFixture0);

  it("leaves a fresh root untouched when exclusive restore admission fails and permits exact rerun", async () => {
    const f = fresh(); const before = storageTree(f.root);
    await assert.rejects(upgradeStorage(f.input, clock, () => { throw new Error("injected-admission-failure"); }),
      /injected-admission-failure/u);
    assert.equal(existsSync(f.path), false);
    assert.deepEqual(storageTree(f.root), before);
    assert.equal((await f.run()).state, "initialized");
  });
  it("preserves complete populated current authority and stale claimed lifecycle bytes without recovery", async () => {
    const f = foundationFixture();
    try {
      const run = f.db.authority.runs.get(f.run.envelope.runId);
      assert.ok(run); assert.equal(run.lifecycle.state, "running");
      const generation = f.db.getMeta().authorityGeneration;
      f.db.close();
      const before = rows(f.path); const bytes = readFileSync(f.path);
      const input = { stateRoot: f.root, processLockRoot: join(f.root, "locks"), plan: true };
      assert.equal((await upgradeStorage(input, clock)).state, "planned");
      assert.deepEqual(readFileSync(f.path), bytes);
      assert.equal((await upgradeStorage({ ...input, plan: false }, clock)).state, "already-upgraded");
      assert.deepEqual(rows(f.path), before); assert.deepEqual(readFileSync(f.path), bytes);
      const reopened = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "stale-current-readback" }, clock);
      try { assert.deepEqual(reopened.authority.runs.get(run.envelope.runId), run);
        assert.equal(reopened.getMeta().authorityGeneration, generation); }
      finally { reopened.close(); }
    } finally { f.dispose(); }
  });
  it.each([CURRENT_AUTHORITY_SCHEMA_VERSION + 1, 29, 46, 999])("refuses schema %s without conversion or source I/O repair", async version => {
    const f = fresh(); await f.run();
    const raw = new DatabaseSync(f.path);
    try { raw.exec(`UPDATE database_states SET schema_version=${String(version)}; PRAGMA user_version=${String(version)}`); }
    finally { raw.close(); }
    const before = storageTree(f.root);
    for (const plan of [true, false]) await assert.rejects(f.run(plan), error =>
      error instanceof AuthoritySchemaVersionError && error.code === "authority-schema-mismatch" && error.schemaVersion === version);
    assert.deepEqual(storageTree(f.root), before);
  });
  it("refuses a missing selected snapshot before healthy open or upgrade with all bytes unchanged", async () => {
    const f = foundationFixture();
    try {
      const snapshotId = f.snapshot.configSnapshotId; f.db.close();
      const raw = new DatabaseSync(f.path);
      try {
        raw.exec("PRAGMA foreign_keys=OFF");
        const triggers = raw.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='settings_snapshots'").all();
        assert.ok(triggers.length > 0);
        for (const trigger of triggers) raw.exec(`DROP TRIGGER "${String(trigger.name)}"`);
        try { assert.equal(raw.prepare("DELETE FROM settings_snapshots WHERE id=?").run(snapshotId).changes, 1); }
        finally { for (const trigger of triggers) raw.exec(String(trigger.sql)); }
      } finally { raw.close(); }
      const before = storageTree(f.root);
      assert.throws(() => AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "missing-snapshot-boot" }, clock));
      for (const plan of [true, false]) await assert.rejects(upgradeStorage({
        stateRoot: f.root, processLockRoot: join(f.root, "locks"), plan }, clock));
      assert.deepEqual(storageTree(f.root), before);
    } finally { f.dispose(); }
  });
  it("preserves exact native multi-day events and immutable replay through stopped no-op upgrade", async () => {
    const f = foundationFixture();
    try {
      const inputs = ["2026-07-31", "2026-07-31", "2026-07-31", "2026-08-01"].map((day, i) =>
        TimelineAppendSchema.parse({ schemaVersion: 1, eventId: randomUUID(), scope: { kind: "client", clientId: "upgrade-fixture" },
          occurredAt: `${day}T12:00:00.000Z`, recordedAt: `${day}T12:00:00.000Z`, retentionDate: day,
          payload: { kind: "debug", event: { category: "client", phase: "settled", correlationId: `native-${String(i)}`,
            build: "fixture", pid: process.pid } }, source: { kind: "native" } }));
      const retained = inputs.map(input => f.db.authority.timelineEvents.append(input).record);
      assert.equal(retained.length, 4); assert.equal(new Set(retained.map(event => event.eventId)).size, 4);
      assert.deepEqual(retained.map(event => event.retentionDate), ["2026-07-31", "2026-07-31", "2026-07-31", "2026-08-01"]);
      f.db.close(); const before = rows(f.path);
      assert.equal((await upgradeStorage({ stateRoot: f.root, processLockRoot: join(f.root, "locks"), plan: false }, clock)).state, "already-upgraded");
      assert.deepEqual(rows(f.path), before);
      const db = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "native-timeline-replay" }, clock);
      try {
        assert.deepEqual(db.authority.timelineEvents.page({}), retained);
        const generation = db.getMeta().authorityGeneration;
        for (const [i, input] of inputs.entries()) {
          assert.deepEqual(db.authority.timelineEvents.append(input), { state: "existing", record: retained[i] });
          assert.throws(() => db.authority.timelineEvents.append({ ...input, recordedAt: "2026-10-01T12:00:00.000Z" }), /timeline-event-identity-conflict/u);
        }
        assert.equal(db.getMeta().authorityGeneration, generation);
      } finally { db.close(); }
    } finally { f.dispose(); }
  });
});
}
