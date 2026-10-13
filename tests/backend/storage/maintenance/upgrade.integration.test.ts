import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync,readFileSync,realpathSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,it } from "vitest";
import type { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { backupStoppedAuthority,upgradeStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { SQLITE_MIGRATIONS, CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { createSettingsActivationRepositories } from "../../../../src/backend/storage/sqlite/settings-activation.js";
import { createTimelineRepository } from "../../../../src/backend/storage/sqlite/timeline-repository.js";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { AuthorityDatabase, AuthoritySchemaVersionError } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityUpgradeInspectionSchema } from "../../../../src/backend/storage/sqlite/recovery-contracts.js";
import { AuthorityHealthPreflightRunner } from "../../../../src/backend/storage/sqlite/authority-health-runner.js";
import { buildStorageDoctor } from "../../../../src/backend/runs/queries/storage.js";
import { StorageDoctorWireSchema } from "../../../../src/models/dashboard/storage.js";
import { verifyBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { acquireRuntimeProcessLock, acquireRuntimeRestoreAdmission } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";

const clock = manualClock(new Date("2026-10-01T12:00:00Z"));
const owners: {workspace:string;admission:RuntimeAdmission}[] = [];
afterEach(() => {for(const owner of owners.splice(0).reverse()){owner.admission.release();rmSync(owner.workspace,{recursive:true,force:true});}});
function fixture(){
 const workspace=mkdtempSync(join(realpathSync(tmpdir()),"native-upgrade-admission-"));
 const admission=acquireEntrypointAdmission(workspace,"exclusive");owners.push({workspace,admission});
 const root=admission.stateRoot,path=join(root,"state.db"),input={stateRoot:root,processLockRoot:join(root,"locks"),plan:false};
 return {admission,root,path,input,run:(plan=false)=>upgradeStorage(admission,{...input,plan},clock)};
}
function initialize(f:ReturnType<typeof fixture>){const database=AuthorityDatabase.open(f.admission,{path:f.path,busyTimeoutMs:250,migrationOwner:"admission-fixture"},clock);database.close();}

describe("stopped native upgrade admission",()=>{
 function baselineFixture(){
  const f=fixture();rmSync(f.path);
  const raw=new DatabaseSync(f.path,{enableForeignKeyConstraints:true});
  try {
   for(const statement of SQLITE_MIGRATIONS[0].statements)raw.exec(statement);
   raw.exec("PRAGMA application_id=1217249861; PRAGMA user_version=1");
   raw.prepare("INSERT INTO database_states VALUES(1,1,0,?,0,'ready')").run(clock.now().toISOString());
   const baseline={recordKey:randomUUID(),upgradeId:"fresh",phase:"baseline",fromSchemaVersion:0,toSchemaVersion:1,by:"local-operator",recordedAt:clock.now().toISOString()};
   raw.prepare("INSERT INTO database_upgrades VALUES(?,'fresh','baseline',NULL,?,?)").run(baseline.recordKey,JSON.stringify(baseline),baseline.recordedAt);
   const mutate=<T,>(work:()=>Readonly<{result:T;changes:number}>)=>work().result;
   const settings=createSettingsActivationRepositories({database:raw,mutate,
    readRecord:()=>undefined});
   settings.runtimeConfig.initialize(CONFIG_SNAPSHOT);
   const repository=createTimelineRepository({database:raw,mutate,read:work=>work(),assertOwner:()=>{}});
   createDebugEventWriter({repository,clock,build:"test"}).emit({category:"http",phase:"failed",correlationId:"retained-history"});
  } finally {raw.close();}
  return f;
 }
 it("forward upgrades a stopped baseline while preserving its settings and history",async()=>{
  const f=baselineFixture();
  const raw=new DatabaseSync(f.path,{readOnly:true});
  const retained: Record<string,unknown>={};
  try {for(const table of ["settings","settings_snapshots","commands","command_audits","timeline_events","database_upgrades"]) {
   retained[table]=raw.prepare(`SELECT * FROM ${table}`).all();assert.ok((retained[table] as unknown[]).length>0);
  }}finally{raw.close();}
  assert.throws(()=>AuthorityDatabase.open(f.admission,{path:f.path,busyTimeoutMs:250,migrationOwner:"ordinary-open"},clock),/schema/u);
  const before=storageTree(f.root);
  assert.deepEqual(await f.run(true),{state:"planned",fromSchemaVersion:1,toSchemaVersion:2,credentials:"unchanged"});
  assert.deepEqual(storageTree(f.root),before);
  assert.equal((await f.run()).state,"upgraded");
  const current=AuthorityDatabase.open(f.admission,{path:f.path,busyTimeoutMs:250,migrationOwner:"upgrade-test"},clock);
  try {assert.equal(current.getMeta().schemaVersion,2);assert.ok(current.authority.runtimeConfig.get());
   const inspection=AuthorityUpgradeInspectionSchema.parse(current.readUpgradePhases());
   assert.equal(inspection.state,"available");
   if(inspection.state==="available")assert.deepEqual(inspection.phases.map(({phase})=>phase),["baseline","settled"]);
  }finally{current.close();}
  const stored=new DatabaseSync(f.path,{readOnly:true});
  try {
   for(const [table,rows] of Object.entries(retained))assert.deepEqual(stored.prepare(`SELECT * FROM ${table}${table==="database_upgrades"?" WHERE phase='baseline'":""}`).all(),rows);
   assert.ok(stored.prepare("SELECT name FROM sqlite_schema WHERE name='timeline_confirmed_action_head_idx'").get());
  }finally{stored.close();}
  assert.equal((await f.run()).state,"already-upgraded");
 });
 it.each(["dashboard","preflight"] as const)("observes a migrated authority as settled through %s",async surface=>{
  const f=baselineFixture();
  assert.equal((await f.run()).state,"upgraded");
  const doctorOptions={stateRootTrustAnchor:f.root,stateRoot:f.root,authorityPath:f.path,
   backupDirectory:join(f.root,"backups","authority"),busyTimeoutMs:250};
  if(surface==="dashboard"){
   const wire=StorageDoctorWireSchema.parse(await buildStorageDoctor({admission:f.admission,doctorOptions,clock,
    serviceState:()=>({state:"never-run",reason:"Explicit backups only"})}));
   assert.equal(wire.authority.state,"healthy");
   assert.equal(wire.authorityUpgrades.state,"available");
   if(wire.authorityUpgrades.state==="available")assert.equal(wire.authorityUpgrades.phases.at(-1)?.phase,"settled");
  }else{
   const observation=await new AuthorityHealthPreflightRunner(f.admission,doctorOptions,clock).run({
    signal:new AbortController().signal,timeoutMs:10_000,deadlineMonotonicMs:10_000,redaction:"presence-only"});
   assert.equal(observation.state,"healthy");
   assert.match(observation.summary,/authority upgrade phase settled/u);
  }
 });
 it("reacquires stopped installation admission for a retained baseline",async()=>{
  const f=baselineFixture();
  const owner=owners.find(row=>row.admission===f.admission);assert.ok(owner);
  f.admission.release();
  const admission=acquireEntrypointAdmission(owner.workspace,"exclusive");owner.admission=admission;
  assert.throws(()=>AuthorityDatabase.open(admission,{path:f.path,busyTimeoutMs:250,migrationOwner:"ordinary-open"},clock),/schema/u);
  assert.equal((await upgradeStorage(admission,f.input,clock)).state,"upgraded");
 });
 it("refuses baseline metadata disagreement without effects",async()=>{
  const f=baselineFixture(),raw=new DatabaseSync(f.path);
  try {raw.exec("UPDATE database_states SET schema_version=2");}finally{raw.close();}
  const before=storageTree(f.root);
  for(const plan of [true,false])await assert.rejects(f.run(plan),/metadata/u);
  assert.deepEqual(storageTree(f.root),before);
 });
 it("rolls back migration DDL and metadata when strict settings validation fails",async()=>{
  const f=baselineFixture(),raw=new DatabaseSync(f.path);
  try {raw.exec("DELETE FROM settings");}finally{raw.close();}
  const before=storageTree(f.root);
  for(const plan of [true,false])await assert.rejects(f.run(plan),/settings/u);
  assert.deepEqual(storageTree(f.root),before);
 });
 it("rechecks the source after restore admission before converting it",async()=>{
  const f=baselineFixture();
  await assert.rejects(upgradeStorage(f.admission,f.input,clock,input=>{
   const raw=new DatabaseSync(f.path);try{raw.prepare("UPDATE database_states SET updated_at=?").run("2026-10-01T12:01:00.000Z");}finally{raw.close();}
   return acquireRuntimeRestoreAdmission(input,clock);
  }),/source-changed/u);
  const raw=new DatabaseSync(f.path,{readOnly:true});try{
   assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version,1);
   assert.equal(raw.prepare("SELECT name FROM sqlite_schema WHERE name='timeline_confirmed_action_head_idx'").get(),undefined);
  }finally{raw.close();}
 });
 it("atomically rolls back the real migration when current validation rejects",()=>{
  const f=baselineFixture(),corrupt=new DatabaseSync(f.path,{enableForeignKeyConstraints:true});
  try {corrupt.exec("DELETE FROM settings");}finally{corrupt.close();}
  assert.throws(()=>AuthorityDatabase.upgradeStopped(f.admission,f.path,f.input.processLockRoot,clock),/settings/u);
  const raw=new DatabaseSync(f.path,{readOnly:true});
  try {
   assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version,1);
   assert.equal(raw.prepare("SELECT schema_version FROM database_states").get()?.schema_version,1);
   assert.equal(raw.prepare("SELECT name FROM sqlite_schema WHERE name='timeline_confirmed_action_head_idx'").get(),undefined);
   assert.equal(raw.prepare("SELECT count(*) AS count FROM database_upgrades").get()?.count,1);
  }finally{raw.close();}
 });
 it("refuses schema-valid journal column corruption during read-only preflight without effects",async()=>{
  const f=fixture();const database=AuthorityDatabase.open(f.admission,{path:f.path,busyTimeoutMs:250,migrationOwner:"journal-corruption-fixture"},clock);
  const commandId=randomUUID();
  try{database.authority.commands.insert({commandId,family:"worker-browser",type:"refresh-browser",target:{workerId:"person-lookup-worker-1",browserSessionId:randomUUID(),expectedVersion:1,controlBasis:{leaseGeneration:1,controlRevision:1}},source:"dashboard",requestedBy:"local-operator",requestedAt:clock.now().toISOString()});}finally{database.close();}
  const raw=new DatabaseSync(f.path);
  try{
   const triggers=raw.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='commands'").all();
   for(const trigger of triggers)raw.exec(`DROP TRIGGER "${String(trigger.name)}"`);
   try{assert.equal(raw.prepare("UPDATE commands SET family='settings' WHERE id=?").run(commandId).changes,1);}finally{for(const trigger of triggers)raw.exec(String(trigger.sql));}
  }finally{raw.close();}
  const bytes=readFileSync(f.path);
  await assert.rejects(backupStoppedAuthority(f.admission,f.root,clock,f.input.processLockRoot),/command-row-identity-mismatch/u);
  assert.deepEqual(readFileSync(f.path),bytes);
  const before=storageTree(f.root);
  for(const plan of [true,false])await assert.rejects(f.run(plan),/command-row-identity-mismatch/u);
  assert.deepEqual(storageTree(f.root),before);
 });
 it("plans the bootstrapped native authority without writes and verifies unchanged current authority",async()=>{
  const f=fixture(),before=storageTree(f.root);
  assert.deepEqual(await f.run(true),{state:"planned",fromSchemaVersion:CURRENT_AUTHORITY_SCHEMA_VERSION,toSchemaVersion:CURRENT_AUTHORITY_SCHEMA_VERSION,credentials:"unchanged"});assert.deepEqual(storageTree(f.root),before);
  assert.equal((await f.run()).state,"already-upgraded");const current=readFileSync(f.path);
  assert.equal((await f.run(true)).state,"planned");assert.equal((await f.run()).state,"already-upgraded");assert.deepEqual(readFileSync(f.path),current);
 });
 it.each([3,19,46,999])("refuses unsupported schema %s without conversion or repair",async version=>{
  const f=fixture();initialize(f);const raw=new DatabaseSync(f.path);
  try{raw.exec(`UPDATE database_states SET schema_version=${String(version)}; PRAGMA user_version=${String(version)}`);}finally{raw.close();}
  const before=storageTree(f.root);for(const plan of [true,false])await assert.rejects(f.run(plan),error=>error instanceof AuthoritySchemaVersionError && error.code==="authority-schema-mismatch");assert.deepEqual(storageTree(f.root),before);
 });
 it("refuses a divergent native schema without effects",async()=>{
  const f=fixture();initialize(f);const raw=new DatabaseSync(f.path);try{raw.exec("CREATE TABLE divergent_authority(id TEXT PRIMARY KEY) STRICT");}finally{raw.close();}
  const before=storageTree(f.root);for(const plan of [true,false])await assert.rejects(f.run(plan),/schema/u);assert.deepEqual(storageTree(f.root),before);
 });
 it("refuses an active runtime lock before backup or upgrade effects",async()=>{
  const f=fixture();initialize(f);const server=acquireRuntimeProcessLock({processLockRoot:f.input.processLockRoot,name:"server",pid:process.pid},clock);
  try{const before=storageTree(f.root);for(const plan of [true,false])await assert.rejects(f.run(plan),/runtime-active/u);
   assert.throws(()=>AuthorityDatabase.inspectStoppedUpgrade(f.admission,f.path,f.input.processLockRoot,clock),/runtime-active/u);
   assert.throws(()=>AuthorityDatabase.upgradeStopped(f.admission,f.path,f.input.processLockRoot,clock),/runtime-active/u);
   await assert.rejects(backupStoppedAuthority(f.admission,f.root,clock,f.input.processLockRoot),/runtime-active/u);assert.deepEqual(storageTree(f.root),before);
  }finally{server.release();}
 });
 it("verifies an explicit native backup without changing authority or credentials",async()=>{
  const f=fixture();initialize(f);const bytes=readFileSync(f.path);
  const report=await backupStoppedAuthority(f.admission,f.root,clock,f.input.processLockRoot);assert.equal(report.state,"verified");assert.equal(report.manifests.length,1);
  const manifest=report.manifests[0];assert.ok(manifest);
  const verified=await verifyBackupManifestAtPath(f.admission,join(f.root,"backups","authority",manifest.backupFileName+".manifest.json"),AuthorityDatabase.sourceDatabaseIdentity(f.path));
  assert.equal(verified.manifest.schemaVersion,CURRENT_AUTHORITY_SCHEMA_VERSION);assert.deepEqual(readFileSync(f.path),bytes);
  const before=storageTree(f.root);assert.equal((await f.run(true)).state,"planned");assert.deepEqual(storageTree(f.root),before);assert.equal((await f.run()).state,"already-upgraded");assert.deepEqual(readFileSync(f.path),bytes);
 });
 it("leaves current authority untouched after failed restore admission and admits exact retry",async()=>{
  const f=fixture(),before=storageTree(f.root);
  await assert.rejects(upgradeStorage(f.admission,f.input,clock,()=>{throw new Error("injected-admission-failure");}),/injected-admission-failure/u);
  assert.deepEqual(storageTree(f.root),before);assert.equal((await f.run()).state,"already-upgraded");
 });
});
