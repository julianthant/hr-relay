import { createWorkbookLibraryRepository } from "../../../../src/backend/storage/sqlite/workbook-library-repository.js";
import { createWorkbookLibraryService } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { START_PLAN } from "../../../support/fixtures/phase1f-run-fixtures.js";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,it,vi } from "vitest";
import { backupStoppedAuthority,upgradeStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { verifyStoppedBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { SQLITE_MIGRATIONS, CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { createWorkerSlotRepository } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { createWorkerControlRepository } from "../../../../src/backend/storage/sqlite/worker-control.js";
import { WorkerBrowserCommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { commandFromRow, insertNativeCommand } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { WorkerLeaseRecordSchema } from "../../../../src/models/run/worker.js";
import { WorkerPoolRecordSchema } from "../../../../src/models/run/worker-pool.js";
import { createSettingsActivationRepositories } from "../../../../src/backend/storage/sqlite/settings-activation.js";
import { createTimelineRepository } from "../../../../src/backend/storage/sqlite/timeline-repository.js";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { AuthorityDatabase, AuthoritySchemaVersionError } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityUpgradeRecordSchema } from "../../../../src/models/config/authority.js";
import { AuthorityHealthPreflightRunner } from "../../../../src/backend/storage/sqlite/authority-health-runner.js";
import { buildStorageDoctor } from "../../../../src/backend/runs/queries/storage.js";
import { StorageDoctorWireSchema } from "../../../../src/models/dashboard/storage.js";
import { parseBackupManifestFile, verifyBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { acquireRuntimeProcessLock, acquireRuntimeRestoreAdmission } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { OfflineAuthorityRestoreService } from "../../../../src/backend/storage/sqlite/offline-restore.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";

const clock = manualClock(new Date("2026-10-01T12:00:00Z"));
const closers: Array<() => void> = [];
afterEach(() => { vi.restoreAllMocks(); for (const close of closers.splice(0).reverse()) close(); });
function fixture(){
 const profile=createBoundProfileFixture({ pending: true }); closers.push(() => profile.close());
 const root=profile.stateRoot,path=profile.path,input={stateRoot:root,processLockRoot:join(profile.workspace,rebuildRuntimeIsolation.processLockRoot),plan:false};
 return {get admission(){return profile.admission;},profileId:profile.admission.profileBinding.profileId,machine:profile.machine,root,path,input,run:(plan=false)=>upgradeStorage(profile.admission,{...input,plan},clock)};
}
function liveFixture(){
 const profile=createBoundProfileFixture();closers.push(()=>profile.close());
 const root=profile.stateRoot,path=profile.path,input={stateRoot:root,processLockRoot:join(profile.workspace,rebuildRuntimeIsolation.processLockRoot),plan:false};
 return {get admission(){return profile.admission;},root,path,input,run:(plan=false)=>upgradeStorage(profile.admission,{...input,plan},clock)};
}
function initialize(f:ReturnType<typeof liveFixture>){const database=AuthorityDatabase.open(f.admission,{path:f.path,busyTimeoutMs:250,migrationOwner:"admission-fixture"},clock);database.close();}

describe("stopped native upgrade admission",()=>{
 function baselineFixture(version=1){
  const f=fixture();rmSync(f.path,{force:true});
  const raw=new DatabaseSync(f.path,{enableForeignKeyConstraints:true});
  try {
   for(const migration of SQLITE_MIGRATIONS.filter(migration=>migration.version<=version))for(const statement of migration.statements)raw.exec(statement);
   raw.exec(`PRAGMA application_id=1217249861; PRAGMA user_version=${version}`);
   raw.prepare("INSERT INTO database_states VALUES(1,?,0,?,0,'ready')").run(version,clock.now().toISOString());
   const baseline={recordKey:randomUUID(),upgradeId:"fresh",phase:"baseline",fromSchemaVersion:0,toSchemaVersion:version,by:"local-operator",recordedAt:clock.now().toISOString()};
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
 it("upgrades schema 5 retained plans by removing only workers through stopped backup admission",async()=>{
  const f=baselineFixture(5),raw=new DatabaseSync(f.path);
  const plan={...START_PLAN,workers:8};
  try {raw.prepare("INSERT INTO run_requests VALUES(?,?,?,NULL,?,?,?,?)").run(plan.startPlanId,plan.workflowId,plan.plannedBy,
   plan.expiresAt,plan.version,canonicalJsonStringify(plan),plan.createdAt);}finally{raw.close();}
  const before=readFileSync(f.path);
  assert.throws(()=>AuthorityDatabase.open(f.admission,{path:f.path,busyTimeoutMs:250,migrationOwner:"ordinary-start"},clock),/profile-bound-authority-required/u);
  assert.deepEqual(readFileSync(f.path),before);
  assert.deepEqual(await f.run(true),{state:"planned",fromSchemaVersion:5,toSchemaVersion:CURRENT_AUTHORITY_SCHEMA_VERSION,credentials:"unchanged"});
  assert.deepEqual(readFileSync(f.path),before);
  assert.equal((await f.run()).state,"upgraded");
  const {workers:_removed,...expected}=plan;
  const current=new DatabaseSync(f.path,{readOnly:true});
  try {
   assert.equal(current.prepare("PRAGMA user_version").get()?.user_version,CURRENT_AUTHORITY_SCHEMA_VERSION);
   const row=current.prepare("SELECT payload_json FROM run_requests WHERE id=?").get(plan.startPlanId);assert.ok(row);
   assert.deepEqual(JSON.parse(String(row.payload_json)),expected);
  }finally{current.close();}
  const directory=join(f.root,"backups","authority"),names=readdirSync(directory).filter(name=>name.endsWith(".manifest.json"));
  assert.equal(names.length,1);
  const backup=await verifyBackupManifestAtPath(f.admission,join(directory,names[0]),AuthorityDatabase.sourceDatabaseIdentity(f.path));
  assert.equal(backup.manifest.schemaVersion,5);
  const prior=new DatabaseSync(backup.backupPath,{readOnly:true});
  try {const row=prior.prepare("SELECT payload_json FROM run_requests WHERE id=?").get(plan.startPlanId);assert.ok(row);assert.deepEqual(JSON.parse(String(row.payload_json)),plan);}finally{prior.close();}
  const upgraded=readFileSync(f.path);assert.equal((await f.run()).state,"already-upgraded");assert.deepEqual(readFileSync(f.path),upgraded);
 });
 it("rolls back schema 5 field removal when migration fails",async()=>{
  const f=baselineFixture(5),raw=new DatabaseSync(f.path),plan={...START_PLAN,workers:"auto"};
  try {raw.prepare("INSERT INTO run_requests VALUES(?,?,?,NULL,?,?,?,?)").run(plan.startPlanId,plan.workflowId,plan.plannedBy,
   plan.expiresAt,plan.version,canonicalJsonStringify(plan),plan.createdAt);}finally{raw.close();}
  const before=readFileSync(f.path),exec:unknown=Reflect.get(DatabaseSync.prototype,"exec");assert.ok(typeof exec==="function");
  vi.spyOn(DatabaseSync.prototype,"exec").mockImplementation(function(this:DatabaseSync,sql:string){
   Reflect.apply(exec,this,[sql]);
   if(sql==="UPDATE run_requests SET payload_json=json_remove(payload_json, '$.workers')")throw new Error("injected-worker-removal-failure");
  });
  await assert.rejects(f.run(),/injected-worker-removal-failure/u);assert.deepEqual(readFileSync(f.path),before);
 });
 it.each([undefined,0,9,1.5,"1",null])("refuses malformed schema 5 workers %j before upgrade effects",async workers=>{
  const f=baselineFixture(5),raw=new DatabaseSync(f.path);
  const plan={...START_PLAN,...(workers===undefined?{}:{workers})};
  try {raw.prepare("INSERT INTO run_requests VALUES(?,?,?,NULL,?,?,?,?)").run(plan.startPlanId,plan.workflowId,plan.plannedBy,
   plan.expiresAt,plan.version,canonicalJsonStringify(plan),plan.createdAt);}finally{raw.close();}
  const before=readFileSync(f.path);await assert.rejects(f.run(true),/run_requests/u);assert.deepEqual(readFileSync(f.path),before);
 });
 function retainedPlan(version: 3 | 4, patch: Record<string, unknown> = {}) {
  const f=baselineFixture(version), raw=new DatabaseSync(f.path);
  const prior=START_PLAN;
  const plan={...prior,...patch};
  let workbookRows: Record<string, unknown[]> = {};
  try {raw.prepare("INSERT INTO run_requests VALUES(?,?,?,NULL,?,?,?,?)").run(plan.startPlanId,plan.workflowId,plan.plannedBy,
   plan.expiresAt,plan.version,canonicalJsonStringify(plan),plan.createdAt);
   if(version===4){
    const library=createWorkbookLibraryService({repository:createWorkbookLibraryRepository({database:raw,mutate:work=>work().result,read:work=>work()}),clock});
    const first=library.create({name:"Retained.xlsx",themes:[],hasFormulas:false,sheets:[{id:"sheet",name:"People",width:1,hidden:[],rows:[{id:"row",cells:[{value:"retained"}]}]}]});
    library.save(first.libraryId,first.version,{...first.workbook,name:"Saved.xlsx"});
    workbookRows=Object.fromEntries(["workbook_library","workbook_library_history"].map(table=>[table,raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
   }
  }finally{raw.close();}
  return {...f,plan,workbookRows};
 }
 it.each([3,4] as const)("upgrades retained schema %s plans without workers while preserving fields and workbook history",async version=>{
  const f=retainedPlan(version);
  const source=AuthorityDatabase.inspectStoppedUpgrade(f.admission,f.path,f.input.processLockRoot,clock);
  assert.throws(()=>AuthorityDatabase.open(f.admission,{path:f.path,busyTimeoutMs:250,migrationOwner:"ordinary-start"},clock),/profile-bound-authority-required/u);
  const before=readFileSync(f.path);
  assert.deepEqual(await f.run(true),{state:"planned",fromSchemaVersion:version,toSchemaVersion:CURRENT_AUTHORITY_SCHEMA_VERSION,credentials:"unchanged"});
  assert.deepEqual(readFileSync(f.path),before);
  assert.equal((await f.run()).state,"upgraded");
  const current=new DatabaseSync(f.path,{readOnly:true});
  try {assert.equal(current.prepare("PRAGMA user_version").get()?.user_version,CURRENT_AUTHORITY_SCHEMA_VERSION);
   const row=current.prepare("SELECT payload_json FROM run_requests WHERE id=?").get(f.plan.startPlanId);assert.ok(row);
   assert.deepEqual(JSON.parse(String(row.payload_json)),f.plan);
   assert.equal(current.prepare("SELECT COUNT(*) AS count FROM workbook_library").get()?.count,version===4?1:0);
  }finally{current.close();}
  const stored=new DatabaseSync(f.path,{readOnly:true});
  try {
   for(const [table,rows] of Object.entries(f.workbookRows))assert.deepEqual(stored.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),rows);
   const row=stored.prepare("SELECT payload_json FROM database_upgrades WHERE phase='settled'").get();assert.ok(row);
   const record=AuthorityUpgradeRecordSchema.parse(JSON.parse(String(row.payload_json)));assert.ok(record.phase==="settled");
   const migrations=SQLITE_MIGRATIONS.filter(migration=>migration.version>version);
   assert.deepEqual(migrations.map(migration=>migration.version),SQLITE_MIGRATIONS.filter(migration=>migration.version>version).map(migration=>migration.version));
   assert.equal(record.planDigest,createHash("sha256").update(canonicalJsonStringify({fromSchemaVersion:version,toSchemaVersion:CURRENT_AUTHORITY_SCHEMA_VERSION,
    sourceContentFingerprint:source.authorityContentFingerprint,statements:migrations.flatMap(migration=>migration.statements)})).digest("hex"));
  }finally{stored.close();}
  const directory=join(f.root,"backups","authority"),name=readdirSync(directory).find(name=>name.endsWith(".manifest.json"));assert.ok(name);
  const verified=await verifyBackupManifestAtPath(f.admission,join(directory,name),AuthorityDatabase.sourceDatabaseIdentity(f.path));
  assert.equal(verified.manifest.schemaVersion,version);
  assert.equal(verified.manifest.authorityContentFingerprint,source.authorityContentFingerprint);
  const prior=new DatabaseSync(verified.backupPath,{readOnly:true});
  try {assert.deepEqual(JSON.parse(String(prior.prepare("SELECT payload_json FROM run_requests").get()?.payload_json)),f.plan);}finally{prior.close();}
 });
 for(const version of [3,4] as const) it.each([{workers:"auto"},{workers:2},{priority:"corrupt"},{plannedBy:""}])(`refuses malformed schema ${version} plan %j without writes`,async patch=>{
  const f=retainedPlan(version,patch),before=readFileSync(f.path);
  await assert.rejects(f.run(true),/run_requests/u);
  assert.deepEqual(readFileSync(f.path),before);
 });
 it.each([3,4] as const)("rolls back schema %s worker backfill and preceding migrations on failure",async version=>{
  const f=retainedPlan(version),before=readFileSync(f.path),exec:unknown=Reflect.get(DatabaseSync.prototype,"exec");
  assert.ok(typeof exec==="function");
  vi.spyOn(DatabaseSync.prototype,"exec").mockImplementation(function(this:DatabaseSync,sql:string){
   Reflect.apply(exec,this,[sql]);
   if(sql==="UPDATE run_requests SET payload_json=json_set(payload_json, '$.workers', 'auto')")throw new Error("injected-worker-backfill-failure");
  });
  await assert.rejects(f.run(),/injected-worker-backfill-failure/u);
  assert.deepEqual(readFileSync(f.path),before);
 });
 it("refuses current retained plans carrying removed workers",()=>{
  const f=liveFixture();initialize(f);
  const raw=new DatabaseSync(f.path);const plan={...START_PLAN,workers:"auto"};
  try {raw.prepare("INSERT INTO run_requests VALUES(?,?,?,NULL,?,?,?,?)").run(plan.startPlanId,plan.workflowId,plan.plannedBy,
   plan.expiresAt,plan.version,canonicalJsonStringify(plan),plan.createdAt);}finally{raw.close();}
  assert.throws(()=>AuthorityDatabase.open(f.admission,{path:f.path,busyTimeoutMs:250,migrationOwner:"ordinary-start"},clock),/run_requests/u);
 });
 function populatedV2(){
  const f=baselineFixture(2), raw=new DatabaseSync(f.path,{enableForeignKeyConstraints:true});
  const now=clock.now().toISOString(), commandId=randomUUID();
  try {
   const pool=WorkerPoolRecordSchema.parse({workflow:"person-lookup",desiredWorkers:1,version:4,plannedBy:"local-operator",plannedAt:now,createdAt:now,updatedAt:now});
   raw.prepare("INSERT INTO worker_pools VALUES(?,?,?,?,?,?)").run(pool.workflow,pool.desiredWorkers,pool.version,canonicalJsonStringify(pool),now,now);
   insertNativeCommand(raw,{commandId,requestedAt:now,requestedBy:"local-operator",source:"dashboard",family:"worker-browser",type:"plan-worker-count",target:{workflowId:"person-lookup",expectedVersion:3},payload:{desiredWorkers:1}});
   const slots=createWorkerSlotRepository({database:raw,admission:f.admission,mutate:work=>work().result});
   const retired=slots.allocate({workflow:"person-lookup",poolIndex:1,commandId,now});
   const lease=WorkerLeaseRecordSchema.parse({workerId:retired.workerId,workflow:"person-lookup",browserSystems:[],processId:4100,leaseGeneration:1,controlRevision:2,version:3,control:{directive:"stop",requestedAt:now,requestedBy:"local-operator"},lifecycle:{state:"stopped",startedAt:now,stoppedAt:now,reason:"operator"},createdAt:now,updatedAt:now});
   raw.prepare("INSERT INTO worker_leases VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(lease.workerId,lease.workerId,lease.workflow,1,2,"stopped","stop",null,3,canonicalJsonStringify(lease),now,now);
   slots.retire({workerId:retired.workerId,commandId,expectedRevision:1,now});
   const active=slots.allocate({workflow:"person-lookup",poolIndex:1,commandId,now});
   const request=WorkerBrowserCommandRequestSchema.parse(commandFromRow(raw.prepare("SELECT * FROM commands WHERE id=?").get(commandId)));
   createWorkerControlRepository({database:raw,mutate:(_table,work)=>work().result}).admit({commandId,request,scope:"worker-pool:person-lookup",executorId:randomUUID(),admittedAt:now,expiresAt:now,basisVersion:3,phase:{state:"admitted"},roster:{selected:[active],excess:[],beforeVersion:3,admittedVersion:4,afterVersion:4}});
   return { ...f, retained:Object.fromEntries(["worker_pools","worker_slots","worker_leases","worker_controls","commands"].map(table=>[table,raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])) };
  }finally{raw.close();}
 }
 it("upgrades schema 3 only after verifying its exact backup and retains every source table",async()=>{
  const f=baselineFixture(3),before=readFileSync(f.path);
  const source=AuthorityDatabase.inspectStoppedUpgrade(f.admission,f.path,f.input.processLockRoot,clock);
  const raw=new DatabaseSync(f.path,{readOnly:true});
  let retained:Record<string,unknown[]>;
  try {retained=Object.fromEntries(source.tables.filter(table=>table.name!=="database_states"&&table.name!=="database_upgrades")
   .map(table=>[table.name,raw.prepare(`SELECT * FROM ${table.name} ORDER BY rowid`).all()]));}finally{raw.close();}
  assert.throws(()=>AuthorityDatabase.open(f.admission,{path:f.path,busyTimeoutMs:250,migrationOwner:"ordinary-start"},clock),/profile-bound-authority-required/u);
  assert.deepEqual(readFileSync(f.path),before);
  assert.deepEqual(await f.run(true),{state:"planned",fromSchemaVersion:3,toSchemaVersion:CURRENT_AUTHORITY_SCHEMA_VERSION,credentials:"unchanged"});
  assert.deepEqual(readFileSync(f.path),before);
  assert.equal(existsSync(join(f.root,"backups")),false);
  const migrate=AuthorityDatabase.upgradeStopped.bind(AuthorityDatabase);
  vi.spyOn(AuthorityDatabase,"upgradeStopped").mockImplementation((...args)=>{
   assert.deepEqual(readFileSync(f.path),before);
   assert.ok(args[5]);
   assert.equal(args[5].manifest.schemaVersion,3);
   assert.equal(args[5].manifest.authorityContentFingerprint,source.authorityContentFingerprint);
   return migrate(...args);
  });
  assert.equal((await f.run()).state,"upgraded");
  const current=new DatabaseSync(f.path,{readOnly:true});
  try {assert.equal(current.prepare("PRAGMA user_version").get()?.user_version,CURRENT_AUTHORITY_SCHEMA_VERSION);
   assert.equal(current.prepare("SELECT COUNT(*) AS count FROM workbook_library").get()?.count,0);
  }finally{current.close();}
  const upgraded=new DatabaseSync(f.path,{readOnly:true});
  try {for(const [table,rows] of Object.entries(retained))assert.deepEqual(upgraded.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),rows);
   assert.deepEqual(upgraded.prepare("PRAGMA foreign_key_check").all(),[]);
  }finally{upgraded.close();}
 });
 it.each([3,4] as const)("refuses a schema %s backup mismatch before migration effects",async version=>{
  const f=baselineFixture(version),before=readFileSync(f.path),migrate=AuthorityDatabase.upgradeStopped.bind(AuthorityDatabase);
  vi.spyOn(AuthorityDatabase,"upgradeStopped").mockImplementation((...args)=>{
   const backup=args[5];assert.ok(backup);
   return migrate(args[0],args[1],args[2],args[3],args[4],
    {...backup,manifest:{...backup.manifest,authorityGeneration:backup.manifest.authorityGeneration+1}},args[6]);
  });
  await assert.rejects(f.run(),/source-changed: upgrade backup differs/u);
  assert.deepEqual(readFileSync(f.path),before);
 });
 it("rolls back schema 3 workbook DDL and metadata when migration fails",async()=>{
  const f=baselineFixture(3),before=readFileSync(f.path),exec:unknown=Reflect.get(DatabaseSync.prototype,"exec");
  assert.ok(typeof exec==="function");
  vi.spyOn(DatabaseSync.prototype,"exec").mockImplementation(function(this:DatabaseSync,sql:string){
   Reflect.apply(exec,this,[sql]);
   if(sql.startsWith("CREATE TRIGGER workbook_library_history_no_replace"))throw new Error("injected-workbook-migration-failure");
  });
  await assert.rejects(f.run(),/injected-workbook-migration-failure/u);
  assert.deepEqual(readFileSync(f.path),before);
 });
 it("upgrades populated schema 2 with an exact verified backup and retained roster history",async()=>{
  const f=populatedV2();
  assert.throws(()=>AuthorityDatabase.open(f.admission,{path:f.path,busyTimeoutMs:250,migrationOwner:"ordinary-start"},clock),/profile-bound-authority-required/u);
  assert.deepEqual(await f.run(true),{state:"planned",fromSchemaVersion:2,toSchemaVersion:CURRENT_AUTHORITY_SCHEMA_VERSION,credentials:"unchanged"});
  assert.equal((await f.run()).state,"upgraded");
  const raw=new DatabaseSync(f.path,{enableForeignKeyConstraints:true});
  try {
   for(const [table,rows] of Object.entries(f.retained))assert.deepEqual(raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),rows);
   assert.deepEqual(raw.prepare("PRAGMA foreign_key_check").all(),[]);
   assert.equal(raw.prepare("PRAGMA foreign_keys").get()?.foreign_keys,1);
   assert.throws(()=>raw.exec("DELETE FROM worker_pools"),/worker-pools-retained/u);
   assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version,CURRENT_AUTHORITY_SCHEMA_VERSION);
  }finally{raw.close();}
  const directory=join(f.root,"backups","authority"),names=readdirSync(directory).filter(name=>name.endsWith(".manifest.json"));
  assert.equal(names.length,1);
  const backup=await verifyBackupManifestAtPath(f.admission,join(directory,names[0]),AuthorityDatabase.sourceDatabaseIdentity(f.path));
  assert.equal(backup.manifest.schemaVersion,2);
 });
 it("rolls back the schema 2 rebuild when the rebuilt pool leaves orphaned slots",async()=>{
  const f=populatedV2(),before=readFileSync(f.path);
  const exec:unknown=Reflect.get(DatabaseSync.prototype,"exec");
  assert.ok(typeof exec==="function");
  let injected=false;
  vi.spyOn(DatabaseSync.prototype,"exec").mockImplementation(function(this:DatabaseSync,sql:string){
   Reflect.apply(exec,this,[sql]);
   if(sql.includes("CREATE TABLE worker_pools_unbounded")){
    injected=true;
    assert.equal(this.prepare("PRAGMA foreign_keys").get()?.foreign_keys,1);
    Reflect.apply(exec,this,["PRAGMA defer_foreign_keys=ON; DROP TRIGGER worker_pools_retained; DELETE FROM worker_pools; CREATE TRIGGER worker_pools_retained BEFORE DELETE ON worker_pools BEGIN SELECT RAISE(ABORT,'worker-pools-retained'); END; PRAGMA defer_foreign_keys=OFF;"]);
   }
  });
  await assert.rejects(f.run(),/foreign-key validation failed/u);
  assert.equal(injected,true);
  vi.restoreAllMocks();
  assert.deepEqual(readFileSync(f.path),before);
  const raw=new DatabaseSync(f.path,{enableForeignKeyConstraints:true});
  try {
   assert.equal(raw.prepare("PRAGMA foreign_keys").get()?.foreign_keys,1);
   assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version,2);
   assert.deepEqual(raw.prepare("PRAGMA foreign_key_check").all(),[]);
   for(const [table,rows] of Object.entries(f.retained))assert.deepEqual(raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),rows);
  }finally{raw.close();}
 });
 it("verifies a schema 1 backup before converting the source",async()=>{
  const f=baselineFixture(),bytes=readFileSync(f.path);
  const directory=join(f.root,"backups","authority");
  const migrate=AuthorityDatabase.upgradeStopped.bind(AuthorityDatabase);
  let observedManifestPath:string|undefined;
  vi.spyOn(AuthorityDatabase,"upgradeStopped").mockImplementation((...args)=>{
   assert.deepEqual(readFileSync(f.path),bytes);
   assert.ok(existsSync(directory),"verified backup directory exists before conversion");
   const manifests=readdirSync(directory).filter(name=>name.endsWith(".manifest.json"));
   assert.equal(manifests.length,1,"one verified backup precedes conversion");
   observedManifestPath=join(directory,manifests[0]);
   const manifest=parseBackupManifestFile(observedManifestPath);
   const backupBytes=readFileSync(join(directory,manifest.backupFileName));
   assert.equal(manifest.schemaVersion,1);
   assert.equal(manifest.verification.state,"verified");
   assert.equal(manifest.verification.schemaVersion,1);
   assert.equal(manifest.byteSize,backupBytes.length);
   assert.equal(manifest.sha256,createHash("sha256").update(backupBytes).digest("hex"));
   const backup=new DatabaseSync(join(directory,manifest.backupFileName),{readOnly:true});
   try {
    assert.equal(backup.prepare("PRAGMA user_version").get()?.user_version,1);
    assert.equal(backup.prepare("SELECT schema_version FROM database_states").get()?.schema_version,1);
    assert.equal(backup.prepare("SELECT name FROM sqlite_schema WHERE name='timeline_confirmed_action_head_idx'").get(),undefined);
   }finally{backup.close();}
   return migrate(...args);
  });
  assert.equal((await f.run()).state,"upgraded");
  assert.ok(observedManifestPath);
  const verified=await verifyBackupManifestAtPath(f.admission,observedManifestPath,AuthorityDatabase.sourceDatabaseIdentity(f.path));
  assert.equal(verified.manifest.schemaVersion,1);
 });
 it("keeps schema 1 bytes unchanged when the backup destination refuses",async()=>{
  const f=baselineFixture();
  mkdirSync(join(f.root,"backups"),{recursive:true});
  writeFileSync(join(f.root,"backups","authority"),"backup destination blocked");
  const bytes=readFileSync(f.path);
  await assert.rejects(f.run(),/EEXIST|ENOTDIR/u);
  assert.deepEqual(readFileSync(f.path),bytes);
  const raw=new DatabaseSync(f.path,{readOnly:true});
  try {
   assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version,1);
   assert.equal(raw.prepare("SELECT count(*) AS count FROM database_upgrades").get()?.count,1);
  }finally{raw.close();}
 });
 it("settles the forward record with the exact verified backup manifest",async()=>{
  const f=baselineFixture();
  const source=AuthorityDatabase.inspectStoppedUpgrade(f.admission,f.path,f.input.processLockRoot,clock);
  assert.equal((await f.run()).state,"upgraded");
  const raw=new DatabaseSync(f.path,{readOnly:true});
  let record:ReturnType<typeof AuthorityUpgradeRecordSchema.parse>;
  try {
   const row=raw.prepare("SELECT * FROM database_upgrades WHERE phase='settled'").get();assert.ok(row);
   record=AuthorityUpgradeRecordSchema.parse(JSON.parse(String(row.payload_json)));
   assert.ok("backup" in record,"settled record carries forward-upgrade backup evidence");
   assert.equal(row.backup_digest,record.backup.sha256);
  }finally{raw.close();}
  assert.ok("backup" in record);
  assert.equal(record.phase,"settled");
  assert.equal(record.fromSchemaVersion,1);
  assert.equal(record.toSchemaVersion,CURRENT_AUTHORITY_SCHEMA_VERSION);
  assert.match(record.planDigest,/^[a-f0-9]{64}$/u);
  assert.notEqual(record.planDigest,source.authorityContentFingerprint);
  assert.equal(record.planDigest,createHash("sha256").update(canonicalJsonStringify({fromSchemaVersion:1,toSchemaVersion:CURRENT_AUTHORITY_SCHEMA_VERSION,
   sourceContentFingerprint:source.authorityContentFingerprint,statements:SQLITE_MIGRATIONS.filter(migration=>migration.version>1).flatMap(migration=>migration.statements)})).digest("hex"));
  const verified=await verifyBackupManifestAtPath(f.admission,record.backup.manifestPath,AuthorityDatabase.sourceDatabaseIdentity(f.path));
  assert.equal(verified.manifest.schemaVersion,1);
  assert.equal(verified.manifest.authorityContentFingerprint,source.authorityContentFingerprint);
  assert.deepEqual(record.backup,{manifestPath:verified.manifestPath,sha256:verified.manifest.sha256,authorityGeneration:source.authorityGeneration});
 });
 it("plans the schema 1 upgrade without backup or source effects",async()=>{
  const f=baselineFixture(),before=storageTree(f.root),bytes=readFileSync(f.path);
  assert.deepEqual(await f.run(true),{state:"planned",fromSchemaVersion:1,toSchemaVersion:CURRENT_AUTHORITY_SCHEMA_VERSION,credentials:"unchanged"});
  assert.deepEqual(storageTree(f.root),before);
  assert.deepEqual(readFileSync(f.path),bytes);
  assert.equal(existsSync(join(f.root,"backups")),false);
 });
 it("forward upgrades a stopped baseline while preserving its settings and history",async()=>{
  const f=baselineFixture();
  const raw=new DatabaseSync(f.path,{readOnly:true});
  const retained: Record<string,unknown>={};
  try {for(const table of ["settings","settings_snapshots","commands","command_audits","timeline_events","database_upgrades"]) {
   retained[table]=raw.prepare(`SELECT * FROM ${table}`).all();assert.ok((retained[table] as unknown[]).length>0);
  }}finally{raw.close();}
  assert.throws(()=>AuthorityDatabase.open(f.admission,{path:f.path,busyTimeoutMs:250,migrationOwner:"ordinary-open"},clock),/profile-bound-authority-required/u);
  const before=storageTree(f.root);
  assert.deepEqual(await f.run(true),{state:"planned",fromSchemaVersion:1,toSchemaVersion:CURRENT_AUTHORITY_SCHEMA_VERSION,credentials:"unchanged"});
  assert.deepEqual(storageTree(f.root),before);
  assert.equal((await f.run()).state,"upgraded");
  const current=new DatabaseSync(f.path,{readOnly:true});
  try {assert.equal(current.prepare("PRAGMA user_version").get()?.user_version,CURRENT_AUTHORITY_SCHEMA_VERSION);
   assert.ok(current.prepare("SELECT 1 FROM settings").get());
   assert.deepEqual(current.prepare("SELECT phase FROM database_upgrades ORDER BY rowid").all().map(row=>row.phase),["baseline","settled"]);
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
   assert.equal(observation.state,"unhealthy");
   assert.match(observation.summary,/credentials/u);
   assert.match(observation.summary,/authority upgrade phase settled/u);
  }
 });
 it("reacquires stopped profile admission for a retained baseline",async()=>{
  const f=baselineFixture();
  f.admission.release();
  const { createProfileRegistry } = await import("../../../../src/backend/profiles/registry.js");
  const admission=f.machine.admitProfile(createProfileRegistry(f.machine).storageClaim(f.profileId));
  closers.push(()=>admission.release());
  assert.throws(()=>AuthorityDatabase.open(admission,{path:f.path,busyTimeoutMs:250,migrationOwner:"ordinary-open"},clock),/profile-bound-authority-required/u);
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
 it("refuses a source change after the verified backup and before migration",async()=>{
  const f=baselineFixture(),migrate=AuthorityDatabase.upgradeStopped.bind(AuthorityDatabase);
  let changedBytes:Buffer|undefined;
  vi.spyOn(AuthorityDatabase,"upgradeStopped").mockImplementation((...args)=>{
   assert.ok(args[5],"verified backup evidence reaches migration");
   const raw=new DatabaseSync(f.path);
   try{raw.prepare("UPDATE database_states SET updated_at=?").run("2026-10-01T12:01:00.000Z");}finally{raw.close();}
   changedBytes=readFileSync(f.path);
   return migrate(...args);
  });
  await assert.rejects(f.run(),/source-changed/u);
  assert.ok(changedBytes);
  assert.deepEqual(readFileSync(f.path),changedBytes);
  const raw=new DatabaseSync(f.path,{readOnly:true});
  try {
   assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version,1);
   assert.equal(raw.prepare("SELECT name FROM sqlite_schema WHERE name='timeline_confirmed_action_head_idx'").get(),undefined);
   assert.equal(raw.prepare("SELECT count(*) AS count FROM database_upgrades").get()?.count,1);
  }finally{raw.close();}
 });
 it("atomically rolls back the real migration when current validation rejects",async()=>{
  const f=baselineFixture();
  const stopped=f.admission.forStoppedProfileUpgrade();
  closers.push(()=>stopped.release());
  const source=AuthorityDatabase.inspectStoppedUpgrade(stopped,f.path,f.input.processLockRoot,clock);
  const report=await backupStoppedAuthority(stopped,f.root,clock,f.input.processLockRoot);
  const manifest=report.manifests[0];assert.ok(manifest);
  const backup=await verifyBackupManifestAtPath(f.admission,join(f.root,"backups","authority",`${manifest.backupFileName}.manifest.json`));
  const exec:unknown=Reflect.get(DatabaseSync.prototype,"exec");
  assert.ok(typeof exec==="function");
  let reachedCurrentSchema=false;
  vi.spyOn(DatabaseSync.prototype,"exec").mockImplementation(function(this:DatabaseSync,sql:string){
   Reflect.apply(exec,this,[sql]);
   if(sql===`PRAGMA user_version=${CURRENT_AUTHORITY_SCHEMA_VERSION}`){
    reachedCurrentSchema=true;
    assert.ok(this.prepare("SELECT name FROM sqlite_schema WHERE name='timeline_confirmed_action_head_idx'").get());
    Reflect.apply(exec,this,["DELETE FROM settings"]);
   }
  });
  assert.throws(()=>AuthorityDatabase.upgradeStopped(stopped,f.path,f.input.processLockRoot,clock,source.authorityContentFingerprint,backup,verifyStoppedBackupManifestAtPath),/settings/u);
  assert.equal(reachedCurrentSchema,true);
  const raw=new DatabaseSync(f.path,{readOnly:true});
  try {
   assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version,1);
   assert.equal(raw.prepare("SELECT schema_version FROM database_states").get()?.schema_version,1);
   assert.equal(raw.prepare("SELECT name FROM sqlite_schema WHERE name='timeline_confirmed_action_head_idx'").get(),undefined);
   assert.equal(raw.prepare("SELECT count(*) AS count FROM database_upgrades").get()?.count,1);
   assert.equal(raw.prepare("SELECT count(*) AS count FROM settings").get()?.count,1);
  }finally{raw.close();}
 });
 it("refuses restoration of a verified schema 1 backup without changing current authority",async()=>{
  const f=baselineFixture();
  const stopped=f.admission.forStoppedProfileUpgrade();
  const report=await backupStoppedAuthority(stopped,f.root,clock,f.input.processLockRoot);
  stopped.release();
  const manifest=report.manifests[0];assert.ok(manifest);
  const manifestPath=join(f.root,"backups","authority",`${manifest.backupFileName}.manifest.json`);
  assert.equal((await verifyBackupManifestAtPath(f.admission,manifestPath)).manifest.schemaVersion,1);
  assert.throws(()=>AuthorityDatabase.open(f.admission,{path:f.path,busyTimeoutMs:250,migrationOwner:"ordinary-open"},clock),/profile-bound-authority-required/u);
  await f.run();
  const before=storageTree(f.root);
  assert.throws(()=>new OfflineAuthorityRestoreService(f.admission,{authorityPath:f.path,suspectDirectory:join(f.root,"backups","suspects"),
   busyTimeoutMs:250,processLockRoot:f.input.processLockRoot,stoppedProofMaxAgeMs:60_000},async()=>{throw new Error("unexpected projection rebuild");},clock),/profile-bound-authority-required/u);
  assert.deepEqual(storageTree(f.root),before);
 });
 it("refuses schema-valid journal column corruption during read-only preflight without effects",async()=>{
  const f=liveFixture();const database=AuthorityDatabase.open(f.admission,{path:f.path,busyTimeoutMs:250,migrationOwner:"journal-corruption-fixture"},clock,undefined,undefined,undefined,boundProfileCredentials(f.admission));
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
 it("plans a missing profile database without writes and initializes it",async()=>{
  const f=fixture(),before=storageTree(f.root);
  assert.deepEqual(await f.run(true),{state:"planned",fromSchemaVersion:0,toSchemaVersion:CURRENT_AUTHORITY_SCHEMA_VERSION,credentials:"unchanged"});assert.deepEqual(storageTree(f.root),before);
  assert.equal((await f.run()).state,"initialized");const current=readFileSync(f.path);
  assert.deepEqual(await f.run(true),{state:"planned",fromSchemaVersion:CURRENT_AUTHORITY_SCHEMA_VERSION,toSchemaVersion:CURRENT_AUTHORITY_SCHEMA_VERSION,credentials:"unchanged"});
  assert.equal((await f.run()).state,"already-upgraded");assert.deepEqual(readFileSync(f.path),current);
 });
 it.each([10,19,46,999])("refuses unsupported schema %s without conversion or repair",async version=>{
  const f=liveFixture();initialize(f);const raw=new DatabaseSync(f.path);
  try{raw.exec(`UPDATE database_states SET schema_version=${String(version)}; PRAGMA user_version=${String(version)}`);}finally{raw.close();}
  const before=storageTree(f.root);for(const plan of [true,false])await assert.rejects(f.run(plan),error=>error instanceof AuthoritySchemaVersionError && error.code==="authority-schema-mismatch");assert.deepEqual(storageTree(f.root),before);
 });
 it("refuses a divergent native schema without effects",async()=>{
  const f=liveFixture();initialize(f);const raw=new DatabaseSync(f.path);try{raw.exec("CREATE TABLE divergent_authority(id TEXT PRIMARY KEY) STRICT");}finally{raw.close();}
  const before=storageTree(f.root);for(const plan of [true,false])await assert.rejects(f.run(plan),/schema/u);assert.deepEqual(storageTree(f.root),before);
 });
 it("refuses an active runtime lock before backup or upgrade effects",async()=>{
  const f=liveFixture();initialize(f);const server=acquireRuntimeProcessLock({processLockRoot:f.input.processLockRoot,name:"server",pid:process.pid},clock);
  try{const before=storageTree(f.root);for(const plan of [true,false])await assert.rejects(f.run(plan),/runtime-active/u);
   assert.throws(()=>AuthorityDatabase.inspectStoppedUpgrade(f.admission,f.path,f.input.processLockRoot,clock),/runtime-active/u);
   assert.throws(()=>AuthorityDatabase.upgradeStopped(f.admission,f.path,f.input.processLockRoot,clock),/runtime-active/u);
   await assert.rejects(backupStoppedAuthority(f.admission,f.root,clock,f.input.processLockRoot),/runtime-active/u);assert.deepEqual(storageTree(f.root),before);
  }finally{server.release();}
 });
 it("verifies an explicit native backup without changing authority or credentials",async()=>{
  const f=liveFixture();initialize(f);const bytes=readFileSync(f.path);
  const report=await backupStoppedAuthority(f.admission,f.root,clock,f.input.processLockRoot);assert.equal(report.state,"verified");assert.equal(report.manifests.length,1);
  const manifest=report.manifests[0];assert.ok(manifest);
  const verified=await verifyBackupManifestAtPath(f.admission,join(f.root,"backups","authority",manifest.backupFileName+".manifest.json"),AuthorityDatabase.sourceDatabaseIdentity(f.path));
  assert.equal(verified.manifest.schemaVersion,CURRENT_AUTHORITY_SCHEMA_VERSION);assert.deepEqual(readFileSync(f.path),bytes);
  const before=storageTree(f.root);assert.equal((await f.run(true)).state,"planned");assert.deepEqual(storageTree(f.root),before);assert.equal((await f.run()).state,"already-upgraded");assert.deepEqual(readFileSync(f.path),bytes);
 });
 it("leaves current authority untouched after failed restore admission and admits exact retry",async()=>{
  const f=fixture(),before=storageTree(f.root);
  await assert.rejects(upgradeStorage(f.admission,f.input,clock,()=>{throw new Error("injected-admission-failure");}),/injected-admission-failure/u);
  assert.deepEqual(storageTree(f.root),before);assert.equal((await f.run()).state,"initialized");
 });
});
