import { NORMAL_AUTHORITY_SCHEMA_VERSION } from "../../../src/backend/storage/sqlite/migrations.js";
import { ArchiveDatabase } from "../../helpers/synthetic-storage-admission.js";
import { QUEUED_RUN } from "../../fixtures/phase1f-run-fixtures.js";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { historicalFixture, withHistoricalAuthority } from "./helpers/historical-fixtures.js";
import { NOW, id } from "../../helpers/database-foundation/fixtures.js";
import { backupStoppedAuthority, upgradeStorage } from "../../helpers/synthetic-storage-admission.js";
import { AuthorityDatabase } from "../../helpers/synthetic-storage-admission.js";
import { createRunLifecycleStorage } from "../../../src/backend/storage/run-lifecycle-storage.js";
import { HistoricalVersionChangeSchema } from "../../../src/backend/storage/sqlite/storage-records.js";
import { ARCHIVE_RELAUNCH } from "../../fixtures/archive-fixtures.js";
import { projectArchiveReport } from "../../../src/backend/runs/dashboard/queries/archive-reports.js";

for(const step of ["captured","verified","cleaned","published","retired","committed"] as const) it(`stopped populated retirement resumes after ${step} without transfer deletion`,async()=>{
  const f=historicalFixture();
  try {
    const original=withHistoricalAuthority(f,db=>createRunLifecycleStorage(db).historicalArchiveSource());
    await backupStoppedAuthority(f.root,f.clock);
    const input={stateRoot:f.root,processLockRoot:join(f.root,"locks"),environmentFile:join(f.root,".env"),plan:false};
    const before=readFileSync(f.path),names=readdirSync(f.root).sort();
    assert.equal((await upgradeStorage({...input,plan:true},f.clock)).state,"planned");
    assert.deepEqual(readFileSync(f.path),before);assert.deepEqual(readdirSync(f.root).sort(),names);
    await assert.rejects(upgradeStorage({...input,hooks:{archiveStep(at){if(at===step)throw new Error("retirement-interrupted");},afterCommit(){if(step==="committed")throw new Error("retirement-interrupted");}}},f.clock),/retirement-interrupted/u);
    assert.ok(existsSync(join(f.root,".archive-conversion.json")));
    assert.throws(()=>AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"runtime"},f.clock),/archive-conversion-incomplete/u);
    f.clock.advanceWall(1000);
    assert.equal((await upgradeStorage(input,f.clock)).state,"converted");
    assert.equal(existsSync(join(f.root,".archive-conversion.json")),false);
    const raw=new DatabaseSync(f.path);
    try {
      assert.throws(()=>raw.exec("UPDATE version_changes SET record_json=record_json"),/historical version change is immutable/u);
      assert.throws(()=>raw.exec("INSERT OR REPLACE INTO version_changes SELECT * FROM version_changes"),/historical version change is immutable/u);
      assert.throws(()=>raw.exec("DELETE FROM version_changes"),/historical version change is retained/u);
      for(const table of ["archive_relaunches","archived_runs","version_plans","version_bump_applications"])assert.equal(raw.prepare("SELECT name FROM sqlite_master WHERE name=?").get(table),undefined);}
    finally{raw.close();}
    const db=AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"readback"},f.clock);
    try {
      const storage=createRunLifecycleStorage(db),report=storage.readReport(f.run.envelope.runId);assert.ok(report);
      assert.equal(projectArchiveReport(report).state,"available");
      assert.deepEqual(storage.readFile(f.run.envelope.runId,f.file.file.digest).bytes,f.file.bytes);
      assert.equal(db.authority.runs.get(f.run.envelope.runId),undefined);
      assert.equal(db.authority.deletedRuns.get(f.run.envelope.runId),undefined);
      assert.ok(db.authority.runs.get(ARCHIVE_RELAUNCH.runId));
      assert.equal("archiveRelaunches" in db.authority,false);
      const history=db.historicalVersionChanges().map(row=>HistoricalVersionChangeSchema.parse(row));
      assert.deepEqual(history.map(row=>row.plan),original.source.plans);
      assert.deepEqual(history.map(row=>row.application),original.source.applications);
      assert.equal(history[0].sourceDigest,original.digest);
      assert.ok(report.content.sources[0].json.includes("archive_transactions"));
      assert.equal(db.authority.runs.listCurrentByWorkflow("person-lookup").length,1);
      assert.equal(db.readRunSummaries().length,1);
      const freshId=id(9901);
      db.authority.runs.enqueue({...QUEUED_RUN,runNumber:db.authority.runs.nextWorkflowRunNumber("person-lookup"),
        envelope:{...f.run.envelope,runId:freshId,itemId:freshId}});
      const claim=db.authority.runs.claimNext({workflow:"person-lookup",workerId:"free-worker",now:NOW});
      assert.equal(claim.state,"claimed");if(claim.state!=="claimed")throw new Error("post-retirement claim missing");
      assert.equal(claim.run.envelope.runId,freshId);
      db.authority.runs.transition({runId:freshId,expectedVersion:claim.run.version,lifecycle:{state:"terminal",outcome:"cancelled",endedAt:NOW},now:NOW});
      assert.equal(db.authority.runs.delete({runId:freshId,origin:"queue",commandId:id(9902),now:NOW}).origin,"queue");
      assert.equal(db.readRunSummaries().length,1);
      const deletion=db.authority.runs.delete({runId:f.run.envelope.runId,origin:"archive",commandId:"00000000-0000-4000-8000-000000009999",now:NOW});
      assert.equal(deletion.origin,"archive");assert.equal(storage.readReport(f.run.envelope.runId),undefined);
    }finally{db.close();}
  } finally {f.dispose();}
});

import { restoreHistoricalStorage } from "../../helpers/synthetic-storage-admission.js";
import { RecoveryStopProofStore } from "../../../src/backend/storage/sqlite/recovery-stop-proof.js";
import { observeRuntimeLockSnapshot } from "../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { mkdirSync } from "node:fs";
for(const interruption of ["restored","quarantined","converted"] as const)it(`restores a populated schema 48 backup through conversion after ${interruption}`,async()=>{
  const f=historicalFixture();
  try {
    const backup=await backupStoppedAuthority(f.root,f.clock),manifest=backup.manifests.at(-1);assert.ok(manifest);
    const manifestPath=join(f.root,"backups","authority",`${manifest.backupFileName}.manifest.json`);
    const processLockRoot=join(f.root,"locks");mkdirSync(processLockRoot,{recursive:true});
    await upgradeStorage({stateRoot:f.root,processLockRoot,environmentFile:join(f.root,".env"),plan:false},f.clock);
    const options={authorityPath:f.path,suspectDirectory:join(f.root,"suspects"),busyTimeoutMs:500,processLockRoot,stoppedProofMaxAgeMs:60000};
    const proof=()=>{
      const store=new RecoveryStopProofStore({processLockRoot,maxProofAgeMs:60000},f.clock),sourceDatabaseIdentity=AuthorityDatabase.sourceDatabaseIdentity(f.path);
      store.recordRuntimeState(observeRuntimeLockSnapshot({processLockRoot,sourceDatabaseIdentity},f.clock));
      return store.issue({observedBy:"local-operator",sourceDatabaseIdentity});
    };
    await assert.rejects(restoreHistoricalStorage(options,{manifestPath,stoppedSystemProof:proof()},join(f.root,".env"),f.clock,step=>{if(step===interruption)throw new Error("restore-interrupted");}),/historical-restore-incomplete/u);
    assert.throws(()=>AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"runtime"},f.clock),/archive-conversion-incomplete/u);
    const result=await restoreHistoricalStorage(options,{manifestPath,stoppedSystemProof:proof()},join(f.root,".env"),f.clock);
    assert.equal(result.upgrade.state,"converted");assert.equal(result.upgrade.toSchemaVersion,NORMAL_AUTHORITY_SCHEMA_VERSION);
    const db=AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"restore-readback"},f.clock);
    try{
      const storage=createRunLifecycleStorage(db);assert.ok(storage.readReport(f.run.envelope.runId));
      assert.deepEqual(storage.readFile(f.run.envelope.runId,f.file.file.digest).bytes,f.file.bytes);
      assert.equal(db.authority.deletedRuns.get(f.run.envelope.runId),undefined);
      assert.equal(db.historicalVersionChanges().length,1);
      assert.ok(db.authority.runs.get(ARCHIVE_RELAUNCH.runId));
      assert.equal("archiveRelaunches" in db.authority,false);
    }finally{db.close();}
    assert.ok(readdirSync(options.suspectDirectory).some(name=>name.startsWith("archive.sqlite.")));
  }finally{f.dispose();}
});

import { renameSync } from "node:fs";
import { SQLITE_MIGRATIONS, AUTHORITY_APPLICATION_ID } from "../../../src/backend/storage/sqlite/migrations.js";
import { z } from "zod";

/** A released schema-49 image with an already published report and a live descendant. */
async function populated49Fixture() {
  const f=historicalFixture();
  await backupStoppedAuthority(f.root,f.clock);
  await upgradeStorage({stateRoot:f.root,processLockRoot:join(f.root,"locks"),environmentFile:join(f.root,".env"),plan:false},f.clock);
  const schema=new DatabaseSync(":memory:"),source=new DatabaseSync(f.path,{readOnly:true}),target=new DatabaseSync(`${f.path}.v49`);
  try {
    for(const migration of SQLITE_MIGRATIONS.filter(row=>row.version<=49))for(const sql of migration.statements)schema.exec(sql);
    const objects=schema.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all()
      .map(row=>z.object({type:z.string(),name:z.string(),sql:z.string()}).parse(row));
    for(const object of objects.filter(row=>row.type==="table")) {
      target.exec(object.sql);
      if(object.name==="database_upgrades" || object.name==="archive_relaunches")continue;
      for(const row of source.prepare(`SELECT * FROM ${object.name}`).all()) {
        const keys=Object.keys(row);
        target.prepare(`INSERT INTO ${object.name} (${keys.join(",")}) VALUES (${keys.map(()=>"?").join(",")})`).run(...Object.values(row));
      }
    }
    target.exec("UPDATE database_state SET schema_version=49");
    target.prepare("INSERT INTO archive_relaunches(record_key,archived_run_id,record_json,created_at) VALUES (?,?,?,?)")
      .run(ARCHIVE_RELAUNCH.runId,ARCHIVE_RELAUNCH.archivedRunId,JSON.stringify(ARCHIVE_RELAUNCH),NOW);
    for(const object of objects.filter(row=>row.type!=="table"))target.exec(object.sql);
    target.exec(`PRAGMA user_version=49; PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}`);
    assert.deepEqual(target.prepare("PRAGMA foreign_key_check").all(),[]);
  }finally{schema.close();source.close();target.close();}
  renameSync(`${f.path}.v49`,f.path);
  return f;
}
for(const interruption of ["beforeCommit","afterCommit"] as const)it(`retires populated schema 49 after ${interruption} with unchanged saved evidence`,async()=>{
  const f=await populated49Fixture();
  try {
    const archivePath=join(f.root,"archive.sqlite"),beforeArchive=readFileSync(archivePath);
    const raw=new DatabaseSync(f.path,{readOnly:true});
    const descendant=raw.prepare("SELECT record_json FROM workflow_runs WHERE record_key=?").get(ARCHIVE_RELAUNCH.runId);
    assert.ok(raw.prepare("SELECT * FROM archive_relaunches").get());raw.close();
    await backupStoppedAuthority(f.root,f.clock);
    const input={stateRoot:f.root,processLockRoot:join(f.root,"locks"),environmentFile:join(f.root,".env"),plan:false};
    await assert.rejects(upgradeStorage({...input,hooks:{[interruption](){throw new Error("schema49-interrupted");}}},f.clock),/schema49-interrupted/u);
    await upgradeStorage(input,f.clock);
    assert.deepEqual(readFileSync(archivePath),beforeArchive,"table retirement never rewrites a saved report database");
    const db=AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"schema49-readback"},f.clock);
    try {
      assert.equal(db.getMeta().schemaVersion,NORMAL_AUTHORITY_SCHEMA_VERSION);
      const storage=createRunLifecycleStorage(db),report=storage.readReport(f.run.envelope.runId);assert.ok(report);
      assert.deepEqual(storage.readFile(f.run.envelope.runId,f.file.file.digest).bytes,f.file.bytes);
      assert.equal(db.authority.deletedRuns.get(f.run.envelope.runId),undefined);
      assert.ok(db.authority.runs.get(ARCHIVE_RELAUNCH.runId));
      const current=new DatabaseSync(f.path,{readOnly:true});try {
        assert.deepEqual(current.prepare("SELECT record_json FROM workflow_runs WHERE record_key=?").get(ARCHIVE_RELAUNCH.runId),descendant);
        assert.equal(current.prepare("SELECT name FROM sqlite_master WHERE name='archive_relaunches'").get(),undefined);
      }finally{current.close();}
    }finally{db.close();}
  }finally{f.dispose();}
});

import { restoreLifecyclePair } from "../../helpers/synthetic-storage-admission.js";
for(const interruption of ["live","archive","files"] as const)it(`restores the explicit populated schema 49 pair after ${interruption}`,async()=>{
  const f=await populated49Fixture();
  try {
    const backup=await backupStoppedAuthority(f.root,f.clock);
    if (!("pairedManifestPath" in backup)) throw new Error("paired backup missing");
    const manifest=backup.manifests.at(-1);assert.ok(manifest);
    const manifestPath=join(f.root,"backups","authority",`${manifest.backupFileName}.manifest.json`);
    const processLockRoot=join(f.root,"locks");
    const options={authorityPath:f.path,suspectDirectory:join(f.root,"suspects"),busyTimeoutMs:500,processLockRoot,stoppedProofMaxAgeMs:60000};
    const proof=()=>{
      const store=new RecoveryStopProofStore({processLockRoot,maxProofAgeMs:60000},f.clock),sourceDatabaseIdentity=AuthorityDatabase.sourceDatabaseIdentity(f.path);
      store.recordRuntimeState(observeRuntimeLockSnapshot({processLockRoot,sourceDatabaseIdentity},f.clock));
      return store.issue({observedBy:"local-operator",sourceDatabaseIdentity});
    };
    const before=readFileSync(f.path),archiveBefore=readFileSync(join(f.root,"archive.sqlite"));
    const savedArchive=new ArchiveDatabase(join(f.root,"archive.sqlite"),{readOnly:true});
    const savedReport=savedArchive.readPublished(f.run.envelope.runId);savedArchive.close();
    await assert.rejects(restoreHistoricalStorage(options,{manifestPath,stoppedSystemProof:proof()},join(f.root,".env"),f.clock),/paired-lifecycle-backup-required/u);
    assert.deepEqual(readFileSync(f.path),before);
    assert.deepEqual(readFileSync(join(f.root,"archive.sqlite")),archiveBefore);
    assert.equal(existsSync(join(f.root,".archive-restore.json")),false);
    await assert.rejects(restoreLifecyclePair(options,{manifestPath:backup.pairedManifestPath,stoppedSystemProof:proof()},async()=>{},f.clock,
      step=>{if(step===interruption)throw new Error("pair-interrupted");}),/lifecycle-restore-incomplete/u);
    assert.throws(()=>AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"runtime"},f.clock),/lifecycle-restore-incomplete/u);
    await restoreLifecyclePair(options,{manifestPath:backup.pairedManifestPath,stoppedSystemProof:proof()},async()=>{},f.clock);
    assert.throws(()=>AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"runtime"},f.clock),/upgrade-required/u);
    await upgradeStorage({stateRoot:f.root,processLockRoot,environmentFile:join(f.root,".env"),plan:false,backupManifest:manifestPath},f.clock);
    const db=AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"readback"},f.clock);
    try {
      const storage=createRunLifecycleStorage(db);assert.ok(storage.readReport(f.run.envelope.runId));
      assert.deepEqual(storage.readFile(f.run.envelope.runId,f.file.file.digest).bytes,f.file.bytes);
      assert.ok(db.authority.runs.get(ARCHIVE_RELAUNCH.runId));
      assert.equal(db.authority.deletedRuns.get(f.run.envelope.runId),undefined);
      assert.deepEqual(storage.readReport(f.run.envelope.runId),savedReport,"restore preserves immutable report bytes, independent of SQLite backup page headers");
    }finally{db.close();}
  }finally{f.dispose();}
});

for (const missing of ["archive.sqlite", "archive-files"] as const) it(`refuses schema-49 backup and upgrade with missing ${missing} custody`, async () => {
  const f = await populated49Fixture();
  try {
    await backupStoppedAuthority(f.root, f.clock);
    renameSync(join(f.root, missing), join(f.root, `${missing}.quarantined`));
    const before = readFileSync(f.path);
    const input = { stateRoot: f.root, processLockRoot: join(f.root, "locks"), environmentFile: join(f.root, ".env"), plan: true };
    const refusal = missing === "archive.sqlite" ? /archive-database-missing/u : /archive-file-unavailable/u;
    await assert.rejects(backupStoppedAuthority(f.root, f.clock), refusal);
    await assert.rejects(upgradeStorage(input, f.clock), refusal);
    await assert.rejects(upgradeStorage({ ...input, plan: false }, f.clock), refusal);
    assert.deepEqual(readFileSync(f.path), before);
  } finally { f.dispose(); }
});

import { AuthorityBackupService } from "../../helpers/synthetic-storage-admission.js";
import { openAuthorityBackupSourceReadOnly } from "../../helpers/synthetic-storage-admission.js";
it("selects a published pair rather than a later standalone live manifest", async () => {
  const f = await populated49Fixture();
  try {
    await backupStoppedAuthority(f.root, f.clock);
    f.clock.advanceWall(1000);
    const source = openAuthorityBackupSourceReadOnly(f.path);
    const directory = join(f.root, "backups", "authority");
    let standalone;
    try { standalone = await new AuthorityBackupService(source, { directory }, f.clock).request({ trigger: "operator", requiredGeneration: source.getMeta().authorityGeneration }); }
    finally { source.close(); }
    const manifest = standalone.manifests.at(-1); assert.ok(manifest);
    const backupManifest = join(directory, `${manifest.backupFileName}.manifest.json`);
    assert.equal(existsSync(`${backupManifest}.lifecycle.json`), false);
    const input = { stateRoot: f.root, processLockRoot: join(f.root, "locks"), environmentFile: join(f.root, ".env"), plan: true };
    await assert.rejects(upgradeStorage({ ...input, backupManifest }, f.clock), /paired-lifecycle-backup-required/u);
    assert.equal((await upgradeStorage(input, f.clock)).state, "planned");
    assert.equal((await upgradeStorage({ ...input, plan: false }, f.clock)).state, "converted");
  } finally { f.dispose(); }
});
