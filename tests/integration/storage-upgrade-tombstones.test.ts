import { z } from "zod";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { DeletedRunRecordSchema } from "../../src/domain/run/deleted-run.js";
import { AuthorityDatabase } from "../helpers/synthetic-storage-admission.js";
import { AUTHORITY_APPLICATION_ID, SQLITE_MIGRATIONS } from "../../src/backend/storage/sqlite/migrations.js";
import { doctorAuthorityStorage } from "../helpers/synthetic-storage-admission.js";
import { backupStoppedAuthority, upgradeStorage } from "../helpers/synthetic-storage-admission.js";
import { QUEUED_RUN } from "../fixtures/phase1f-run-fixtures.js";

const now = "2026-09-06T12:00:00.000Z";
const clock = manualClock(new Date(now));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(kind: "root" | "reconstructed" | "missing" | "duplicate" | "mismatch") {
  const root = mkdtempSync(join(tmpdir(), "upgrade-tombstones-")); roots.push(root);
  const path = join(root, "state.db");
  const e = QUEUED_RUN.envelope;
  const deleted = { runId: e.runId, workflow: e.workflow, traceId: e.traceId, origin: "queue", commandId: randomUUID(), deletedAt: now, removed: [{ table: "tasks", rows: 1 }] };
  const raw = new DatabaseSync(path);
  try {
    for (const migration of SQLITE_MIGRATIONS.filter(({ version }) => version <= 29)) for (const sql of migration.statements) raw.exec(sql);
    raw.prepare("INSERT INTO authority_meta(singleton_id,schema_version,authority_generation,updated_at) VALUES (1,29,7,?)").run(now);
    raw.exec(`PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}; PRAGMA user_version=29`);
    const trigger = String(raw.prepare("SELECT sql FROM sqlite_master WHERE name='deleted_runs_require_live_run_insert'").get()?.sql);
    raw.exec("DROP TRIGGER deleted_runs_require_live_run_insert");
    raw.prepare("INSERT INTO deleted_runs VALUES (?,?,?,?,?,?,?,?)").run(e.runId, e.workflow, e.traceId, "queue", deleted.commandId, now, JSON.stringify(deleted), now);
    raw.exec(trigger);
  } finally { raw.close(); }
  const event = { pid: 4242, t: "run.queued", kind: "run", ts: now, workflow: e.workflow, runId: e.runId,
    attempt: 7, traceId: e.traceId, spanPath: e.traceId, itemId: e.itemId, shape: e.shape,
    priority: e.priority, dryRun: true, actorId: "local-operator", title: "Synthetic migration fixture",
    descriptorVersion: e.descriptorVersion, contractFingerprint: e.contractFingerprint,
    resolvedInstance: e.resolvedInstance, configFingerprint: e.configFingerprint, configSnapshotId: e.configSnapshotId,
    ...(kind === "reconstructed" ? { repair: { kind: "authority-reconstruction", repairedAt: now,
      sourceAuthorityGeneration: 7, sourceAuthorityFingerprint: "a".repeat(64), priorStreamBytes: 0, priorStreamSha256: "b".repeat(64) } } : {}) };
  const span = join(root, "spans", `${e.workflow}-2026-09-06.jsonl`);
  if (kind !== "missing") {
    mkdirSync(join(root, "spans"));
    const body = JSON.stringify(kind === "mismatch" ? { ...event, traceId: "pl-120000-9999", spanPath: "pl-120000-9999" } : event) + "\n";
    writeFileSync(span, body + (kind === "duplicate" ? body : ""));
  }
  const input = { stateRoot: root, processLockRoot: join(root, "locks"), environmentFile: join(root, ".env"), plan: false };
  return { root, path, span, deleted, input };
}

const preserved = z.object({cases:z.array(z.object({sourceKind:z.enum(["root","reconstructed","missing"]),tombstone:DeletedRunRecordSchema}))})
  .parse(JSON.parse(readFileSync(new URL("./fixtures/migration/migrated-tombstones.json",import.meta.url),"utf8")));

describe("D332 retained tombstone evidence after importer retirement", () => {
  it.each(["root", "reconstructed", "missing"] as const)("preserves migrated %s ordinals, trigger protections and doctor evidence", async kind => {
    const f=fixture(kind), source=readFileSync(f.path), span=kind==="missing"?undefined:readFileSync(f.span);
    for(const plan of [true,false])await assert.rejects(upgradeStorage({...f.input,plan},clock),/authority-below-floor/u);
    assert.deepEqual(readFileSync(f.path),source);
    const retained=preserved.cases.find(row=>row.sourceKind===kind);assert.ok(retained);
    renameSync(f.path,join(f.root,"retired-source.sqlite"));
    AuthorityDatabase.open({path:f.path,busyTimeoutMs:500,migrationOwner:"retained-tombstone-fixture"},clock).close();
    const seed=new DatabaseSync(f.path);
    try {
      const trigger=z.object({sql:z.string()}).parse(seed.prepare("SELECT sql FROM sqlite_master WHERE name='deleted_runs_require_live_run_insert'").get()).sql;
      seed.exec("BEGIN; DROP TRIGGER deleted_runs_require_live_run_insert");
      const t=retained.tombstone;
      seed.prepare("INSERT INTO deleted_runs(record_key,workflow,trace_id,origin,command_id,deleted_at,record_json,created_at,item_id,attempt,run_number,ordinal_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(t.runId,t.workflow,t.traceId,t.origin,t.commandId,t.deletedAt,JSON.stringify(t),t.deletedAt,t.itemId,t.attempt,t.runNumber,t.ordinalSource);
      seed.exec(trigger);seed.exec("COMMIT");
    } finally {seed.close();}
    const database=AuthorityDatabase.open({path:f.path,busyTimeoutMs:500,migrationOwner:"retained-tombstone-proof"},clock);
    try {
      const tombstone=DeletedRunRecordSchema.parse(database.authority.deletedRuns.get(f.deleted.runId));
      assert.deepEqual(tombstone,retained.tombstone);assert.deepEqual(tombstone.removed,f.deleted.removed);
      assert.equal(tombstone.tallyVersion,1);assert.equal(tombstone.runNumber,null);
      assert.equal(tombstone.attempt,kind==="missing"?null:7);assert.equal(tombstone.itemId,kind==="missing"?null:QUEUED_RUN.envelope.itemId);
      assert.equal(tombstone.ordinalSource,kind==="missing"?"unknown":"span-root-backfill");
      assert.equal(database.authority.runs.nextItemAttempt({workflow:f.deleted.workflow,itemId:QUEUED_RUN.envelope.itemId}),kind==="missing"?1:8);
      assert.equal(database.authority.runs.nextWorkflowRunNumber(f.deleted.workflow),1);
    } finally {database.close();}
    const raw=new DatabaseSync(f.path);
    try {for(const assignment of ["item_id='changed'","attempt=8","run_number=99","ordinal_source='tombstone'","workflow='changed'"])
      assert.throws(()=>raw.exec(`UPDATE deleted_runs SET ${assignment}`),/immutable/u);
    }finally{raw.close();}
    if(span!==undefined)assert.deepEqual(readFileSync(f.span),span);
    const doctor=await doctorAuthorityStorage({stateRootTrustAnchor:f.root,stateRoot:f.root,authorityPath:f.path,backupDirectory:join(f.root,"backups","authority"),busyTimeoutMs:500},clock);
    assert.deepEqual(doctor.tombstoneOrdinals,{state:"available",findings:[{code:"tombstone-ordinal-unknown",runId:f.deleted.runId,missingFields:kind==="missing"?["itemId","attempt","runNumber"]:["runNumber"]}]});
    const settled=readFileSync(f.path);assert.equal((await upgradeStorage(f.input,clock)).state,"already-upgraded");assert.deepEqual(readFileSync(f.path),settled);
    assert.deepEqual(readFileSync(join(f.root,"retired-source.sqlite")),source);
  });
  it.each(["duplicate","mismatch"] as const)("refuses expired %s evidence before parsing or mutating it",async kind=>{
    const f=fixture(kind);await backupStoppedAuthority(f.root,clock);const before=readFileSync(f.path),span=readFileSync(f.span);
    for(const plan of [true,false])await assert.rejects(upgradeStorage({...f.input,plan},clock),/authority-below-floor/u);
    assert.deepEqual(readFileSync(f.path),before);assert.deepEqual(readFileSync(f.span),span);
  });
  it("never invokes retired backfill hooks below the floor",async()=>{
    const f=fixture("root");await backupStoppedAuthority(f.root,clock);const before=readFileSync(f.path);let invoked=false;
    await assert.rejects(upgradeStorage({...f.input,hooks:{beforeCommit:()=>{invoked=true;throw new Error("expired hook reached");}}},clock),/authority-below-floor/u);
    assert.equal(invoked,false);assert.deepEqual(readFileSync(f.path),before);
  });
});
