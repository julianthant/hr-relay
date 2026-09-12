import { createRunLifecycleStorage } from "../helpers/lifecycle-storage.js";
import { storageTree } from "../helpers/storage-recovery-fixture.js";
import { AUTHORITY_APPLICATION_ID, SQLITE_MIGRATIONS } from "../../../src/infra/sqlite/migrations.js";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe,it } from "vitest";
import { inspectHistoricalAuthorityInvariants } from "../../../src/infra/sqlite/authority-database.js";
import { inspectAuthorityBackupReadOnly } from "../../../src/infra/compat/backup-inspection.js";
import { foundationFixture,generic,legacyRequest,historicalFixture,id,NOW } from "./fixtures.js";

describe("P provider accounting integrity",()=>{
 for(const active of [0,1])it(`accepts mixed kinds with ${active} legacy reservations; rejects genuine legacy corruption`,()=>{
  const f=foundationFixture();const raw=new DatabaseSync(f.path);try{
   const r=f.db.authority.providerAdmissions.reserve(legacyRequest(f));assert.equal(r.state,"reserved");
   if(active===0)f.db.authority.providerAdmissions.interrupt({admissionId:id(60),expectedVersion:1,code:"aborted",message:"synthetic",now:NOW});
   const g=generic(f);f.db.authority.providerAccounting.transaction(s=>{s.writeRequest(g.request,null);s.writeUsage(g.usage,null);});
   assert.doesNotThrow(()=>inspectHistoricalAuthorityInvariants(raw,49));
   raw.exec("UPDATE provider_usage SET active_reservations=active_reservations+1,record_json=json_set(record_json,'$.record.activeReservations',active_reservations+1) WHERE capability='ocr.extract'");
   assert.throws(()=>inspectHistoricalAuthorityInvariants(raw,49),/provider-active-reservations-match/u);
  }finally{raw.close();f.dispose();}
 });
 for(const version of [42,43] as const)it(`validates populated schema${version} backup and rejects a corrupt reservation count`,()=>{
  const f=historicalFixture(version);try{
   assert.doesNotThrow(()=>inspectHistoricalAuthorityInvariants(f.raw,version));
   assert.equal(inspectAuthorityBackupReadOnly(f.historicalPath).schemaVersion,version);
   const table=version===42?"provider_budget_counters":"provider_usage";const path=version===42?"$.activeReservations":"$.record.activeReservations";
   f.raw.exec(`UPDATE ${table} SET active_reservations=0,record_json=json_set(record_json,'${path}',0)`);
   assert.throws(()=>inspectHistoricalAuthorityInvariants(f.raw,version),/provider-active-reservations-match/u);
   assert.throws(()=>inspectAuthorityBackupReadOnly(f.historicalPath),/provider-active-reservations-match/u);
  }finally{f.dispose();}
 });
});

import { createGenericProviderAccounting,inspectGenericProviderAccounting } from "../../../src/infra/sqlite/provider-accounting.js";
import { admission } from "./fixtures.js";
import { failure,terminalizeFixtureFailure } from "../database-foundation/fixtures.js";
const done=(n=100)=>({requestId:id(n),expectedVersion:1,now:NOW,state:"settled",usage:[{meter:"requests",quantity:{kind:"measured",value:1}}],reason:null});
describe("P generic provider policy",()=>{
 it("round-trips two vendors/credentials, keyless and unknown attribution, model/shared/application scopes and distinct meters",()=>{
  const f=foundationFixture();try{
   const p=createGenericProviderAccounting(f.db.authority.providerAccounting);
   const attributions=[{kind:"attributed",provider:"synthetic-alpha",credential:{kind:"generation",reference:"synthetic-generation/1"},model:"model-a"},{kind:"attributed",provider:"synthetic-beta",credential:{kind:"generation",reference:"synthetic-generation/2"},model:"model-b"},{kind:"attributed",provider:"synthetic-keyless",credential:{kind:"keyless"}},{kind:"unattributed",reason:"not-supplied"}];
   for(const [i,attribution] of attributions.entries()){
    const input=admission(f,100+i);const window=input.budgets[0].windows[0];
    const budgets=[...input.budgets.map(b=>({...b,windows:[{...window,limit:{kind:"configured",value:10,provenance:"synthetic-policy"}}]})),
      ...["input-tokens","output-tokens","usd-micros"].map(meter=>({scope:{id:`synthetic-meter-${i}`,kind:"provider-model"},meter,upperBound:10,windows:[{...window,limit:{kind:"unknown"}}]})),
      {scope:{id:`synthetic-credential-${i}`,kind:"credential"},meter:"requests",upperBound:1,windows:[window]},
      {scope:{id:"synthetic-app",kind:"application-budget"},meter:"requests",upperBound:1,windows:[{...window,limit:{kind:"unknown"}}]}];
    const r=p.reserve({...input,attribution,budgets});assert.equal(r.state,"reserved");assert.deepEqual(r.request.attribution,attribution);
    p.finish({...done(100+i),usage:[{meter:"requests",quantity:{kind:"measured",value:1}},{meter:"input-tokens",quantity:{kind:"measured",value:4}},{meter:"output-tokens",quantity:{kind:"estimated",value:3}},{meter:"usd-micros",quantity:{kind:"unknown",retainedUpperBound:null}}]});
   }
   const values=p.read();assert.equal(values.find(u=>u.scope.id==="synthetic.shared")?.cumulative.kind,"measured");assert.deepEqual(values.find(u=>u.scope.id==="synthetic.shared")?.cumulative,{kind:"measured",value:4});
   assert.deepEqual(values.find(u=>u.meter==="usd-micros")?.cumulative,{kind:"unknown",retainedUpperBound:10});
   assert.equal(values.find(u=>u.meter==="output-tokens")?.windows[0]?.remaining.kind,"unknown");
   const raw=new DatabaseSync(f.path);try{inspectGenericProviderAccounting(raw);}finally{raw.close();}
  }finally{f.dispose();}
 });
 it("binds all budgets/attribution on exact replay and denies without effects; validates execution before allocating",()=>{
  const f=foundationFixture();try{
   const p=createGenericProviderAccounting(f.db.authority.providerAccounting);const input=admission(f);const reserved=p.reserve(input);assert.equal(reserved.state,"reserved");
   const generation=f.db.getMeta().authorityGeneration;const before=p.read();assert.equal(p.reserve(input).state,"existing");assert.deepEqual(p.read(),before);assert.equal(f.db.getMeta().authorityGeneration,generation);
   for(const changed of [{...input,attribution:{kind:"unattributed",reason:"not-supplied"}},{...input,budgets:input.budgets.map(b=>({...b,upperBound:2}))}])assert.throws(()=>p.reserve(changed),/replay-conflict/u);
   assert.throws(()=>p.reserve({...input,requestId:id(101),execution:{...input.execution,attempt:2}}),/execution-config-mismatch/u);
   assert.throws(()=>p.reserve({...input,requestId:id(101),execution:{...input.execution,nodeId:"other"}}),/execution-node-mismatch/u);
   assert.deepEqual(p.read(),before);assert.equal(f.db.authority.providerAccounting.getRequest(id(101)),undefined);
   const denied={...admission(f,102),budgets:input.budgets.map(b=>({...b,upperBound:4}))};assert.equal(p.reserve(denied).state,"denied");assert.deepEqual(p.read(),before);assert.equal(p.reserve(denied).state,"existing");assert.throws(()=>p.reserve({...denied,budgets:input.budgets}),/replay-conflict/u);
   assert.equal(p.reserve({...admission(f,103),budgets:input.budgets.map(b=>({...b,upperBound:null}))}).request.reason,"upper-bound-required");
   p.finish(done());const final=p.read();const gen=f.db.getMeta().authorityGeneration;p.finish(done());assert.deepEqual(p.read(),final);assert.equal(f.db.getMeta().authorityGeneration,gen);
   assert.throws(()=>p.finish({...done(),usage:[{meter:"requests",quantity:{kind:"measured",value:2}}]}),/replay-conflict/u);
   assert.throws(()=>p.finish({...done(),expectedVersion:2}),/replay-conflict/u);assert.deepEqual(p.read(),final);
  }finally{f.dispose();}
 });
 it("keeps overlapping minute/day windows and late settlement on original windows without duplicating cumulative usage",()=>{
  const f=foundationFixture();try{
   const p=createGenericProviderAccounting(f.db.authority.providerAccounting);const input=admission(f);const day=input.budgets[0].windows[0];
   const prior={...input,now:"2026-09-09T23:59:59.000Z",budgets:input.budgets.map(b=>({...b,windows:[day,{...day,id:"minute-old",startsAt:"2026-09-09T23:59:00.000Z",endsAt:"2026-09-10T00:00:00.000Z"}]}))};assert.equal(p.reserve(prior).state,"reserved");
   const later={...admission(f,101),now:"2026-09-10T00:00:01.000Z",budgets:input.budgets.map(b=>({...b,windows:[{...day,id:"day-10",startsAt:"2026-09-10T00:00:00.000Z",endsAt:"2026-09-11T00:00:00.000Z"}]}))};p.reserve(later);
   p.finish({...done(),now:later.now,usage:[{meter:"requests",quantity:{kind:"measured",value:5}}]});
   const u=p.read()[0];assert.deepEqual(u.cumulative,{kind:"measured",value:5});assert.equal(u.windows.find(w=>w.id==="day-10")?.reserved,1);assert.deepEqual(u.windows.find(w=>w.id==="day-9")?.remaining,{kind:"known",value:-2});assert.equal(u.windows.find(w=>w.id==="minute-old")?.reserved,0);
   assert.throws(()=>p.finish({...done(101),state:"lease-expired",usage:[],now:later.now}),/lease-not-expired/u);
   p.finish({...done(101),state:"lease-expired",usage:[],now:"2026-09-11T12:00:00.000Z"});const expired=p.read()[0];assert.deepEqual(expired.cumulative,{kind:"unknown",retainedUpperBound:6});assert.equal(expired.windows.find(w=>w.id==="day-10")?.reserved,0);assert.equal(expired.windows.find(w=>w.id==="day-10")?.retainedUnknown,1);
   assert.throws(()=>p.finish({...done(101),now:"2026-09-11T12:00:00.000Z"}),/replay-conflict/u);
  }finally{f.dispose();}
 });
 for(const table of ["provider_requests","provider_usage"])it(`rolls back request, all scopes and generation after ${table} write faults`,()=>{
  const f=foundationFixture();const raw=new DatabaseSync(f.path);try{
   const p=createGenericProviderAccounting(f.db.authority.providerAccounting);const generation=f.db.getMeta().authorityGeneration;
   raw.exec(`CREATE TRIGGER injected BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic-write-fault'); END`);
   assert.throws(()=>p.reserve(admission(f)),/synthetic-write-fault/u);assert.deepEqual(p.read(),[]);assert.equal(f.db.authority.providerAccounting.getRequest(id(100)),undefined);assert.equal(f.db.getMeta().authorityGeneration,generation);
   raw.exec("DROP TRIGGER injected");p.reserve(admission(f));const before=p.read();const gen=f.db.getMeta().authorityGeneration;
   raw.exec(`CREATE TRIGGER injected BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic-write-fault'); END`);
   assert.throws(()=>p.finish(done()),/synthetic-write-fault/u);assert.deepEqual(p.read(),before);assert.equal(f.db.authority.providerAccounting.getRequest(id(100))?.kind,"generic");assert.equal(f.db.getMeta().authorityGeneration,gen);
   raw.exec("DROP TRIGGER injected");p.finish(done());inspectGenericProviderAccounting(raw);
  }finally{raw.close();f.dispose();}
 });
 it("separately detects corrupt generic reservations without blaming unrelated legacy capabilities",()=>{
  const f=foundationFixture();const raw=new DatabaseSync(f.path);try{
   const p=createGenericProviderAccounting(f.db.authority.providerAccounting);p.reserve(admission(f));f.db.authority.providerAdmissions.reserve(legacyRequest(f,60,"geocode.census"));inspectGenericProviderAccounting(raw);inspectHistoricalAuthorityInvariants(raw,49);
   raw.exec("UPDATE provider_usage SET record_json=json_set(record_json,'$.windows[0].reserved',2) WHERE json_extract(record_json,'$.kind')='generic'");
   assert.throws(()=>inspectGenericProviderAccounting(raw),/generic-reservation-mismatch/u);assert.throws(()=>inspectHistoricalAuthorityInvariants(raw,49),/generic-reservation-mismatch/u);
  }finally{raw.close();f.dispose();}
 });
 it("finalizes deletion conservatively, rolls both halves back on faults, and refuses late callbacks after tombstone",()=>{
  const f=foundationFixture();const raw=new DatabaseSync(f.path);try{
   const p=createGenericProviderAccounting(f.db.authority.providerAccounting);p.reserve(admission(f));p.reserve(admission(f,101));p.finish(done());
   terminalizeFixtureFailure(f,f.run,failure());
   const before=p.read();const generation=f.db.getMeta().authorityGeneration;
   const deletion={runId:f.run.envelope.runId,origin:"queue",commandId:id(200),now:NOW};
   raw.exec("CREATE TRIGGER injected BEFORE DELETE ON provider_requests BEGIN SELECT RAISE(ABORT,'synthetic-delete-fault'); END");
   assert.throws(()=>f.db.authority.runs.delete(deletion),/synthetic-delete-fault/u);assert.deepEqual(p.read(),before);assert.equal(raw.prepare("SELECT count(*) n FROM provider_requests").get()?.n,2);assert.equal(raw.prepare("SELECT count(*) n FROM deleted_runs").get()?.n,0);assert.equal(f.db.getMeta().authorityGeneration,generation);
   raw.exec("DROP TRIGGER injected");f.db.authority.runs.delete(deletion);
   const u=p.read()[0];assert.deepEqual(u.cumulative,{kind:"unknown",retainedUpperBound:2});assert.equal(u.windows[0]?.reserved,0);assert.equal(u.windows[0]?.retainedUnknown,1);assert.deepEqual(u.tracking,before[0]?.tracking);
   assert.equal(raw.prepare("SELECT count(*) n FROM provider_requests").get()?.n,0);assert.equal(raw.prepare("SELECT count(*) n FROM deleted_runs").get()?.n,1);
   assert.throws(()=>p.finish(done(101)),/request-missing/u);assert.throws(()=>p.reserve(admission(f,102)),/execution-missing/u);assert.deepEqual(p.read()[0],u);inspectGenericProviderAccounting(raw);inspectHistoricalAuthorityInvariants(raw,49);
  }finally{raw.close();f.dispose();}
 });
});

import { fork } from "node:child_process";
import { z } from "zod";
import { readFileSync,copyFileSync,rmSync } from "node:fs";
import { join } from "node:path";
import { backupStoppedAuthority,upgradeStorage } from "../../../src/server/storage/upgrade.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";
import { ProviderAdmissionRecordSchema,ProviderBudgetCounterSchema } from "../../../src/domain/provider-admission.js";
import { readProviderRequest,readProviderUsage } from "../../../src/infra/sqlite/provider-storage.js";
const RaceResult=z.strictObject({state:z.literal("result"),outcome:z.enum(["reserved","denied","existing"]),pid:z.number(),attemptedAt:z.number(),finishedAt:z.number()});
describe("P concurrency and historical conversion",()=>{
 it("races real independent processes/connections for the final shared allowance",async()=>{
  const f=foundationFixture();const children:ReturnType<typeof fork>[]=[];
  try{
   const cases=[100,101].map(n=>({...admission(f,n),budgets:admission(f,n).budgets.map(b=>({...b,windows:b.windows.map(w=>({...w,limit:{...w.limit,value:1}}))}))}));
   const ready:Promise<void>[]=[];const results:Promise<z.infer<typeof RaceResult>>[]=[];const exits:Promise<void>[]=[];
   for(const request of cases){
    const child=fork(new URL("./race-process.ts",import.meta.url),[],{execArgv:["--import","tsx"],stdio:["ignore","ignore","pipe","ipc"]});children.push(child);
    let stderr="";child.stderr?.on("data",(chunk:Buffer)=>{stderr+=chunk.toString();});
    ready.push(new Promise((resolve,reject)=>{child.on("message",(m:unknown)=>{if(z.object({state:z.literal("ready")}).safeParse(m).success)resolve();});child.on("error",reject);child.on("exit",code=>{if(code!==0)reject(new Error(`race child failed ${code}: ${stderr}`));});}));
    results.push(new Promise((resolve,reject)=>{child.on("message",(m:unknown)=>{const result=RaceResult.safeParse(m);if(result.success)resolve(result.data);});child.on("error",reject);child.on("exit",code=>{if(code!==0)reject(new Error(`race child failed ${code}: ${stderr}`));});}));
    exits.push(new Promise((resolve,reject)=>child.on("exit",code=>{if(code===0)resolve();else reject(new Error(`race child failed ${code}: ${stderr}`));})));
    child.send({path:f.path,request});
   }
   await Promise.all(ready);for(const child of children)child.send({go:true});
   const outcomes=await Promise.all(results);await Promise.all(exits);
   assert.deepEqual(outcomes.map(r=>r.outcome).sort(),["denied","reserved"]);assert.equal(new Set(outcomes.map(r=>r.pid)).size,2);
   assert.ok(Math.max(...outcomes.map(r=>r.attemptedAt))<Math.min(...outcomes.map(r=>r.finishedAt)),"both independent connections attempted before the first transaction committed");
   const p=createGenericProviderAccounting(f.db.authority.providerAccounting);assert.equal(p.read()[0]?.windows[0]?.reserved,1);
   const raw=new DatabaseSync(f.path);try{inspectGenericProviderAccounting(raw);assert.equal(raw.prepare("SELECT count(*) n FROM provider_requests").get()?.n,2);}finally{raw.close();}
  }finally{for(const child of children)if(child.exitCode===null){child.kill();await new Promise<void>(resolve=>child.once("exit",()=>resolve()));}f.dispose();}
 });
 it("preserves populated lifecycle history, blocked/active budgets, midnight origins and exact backup/recovery",async()=>{
  const f=historicalFixture(42);try{
   const original=ProviderAdmissionRecordSchema.parse(JSON.parse(String(f.raw.prepare("SELECT record_json FROM provider_admissions").get()?.record_json)));
   const boundary="2026-09-08T23:59:59.000Z";const midnight="2026-09-09T00:00:00.000Z";
   const states=[{state:"denied",deniedAt:boundary,reason:{code:"daily-request-exhausted",message:"synthetic historic limit",retryAt:midnight}},
    {state:"settled",settledAt:midnight,adapterDisposition:"produced",actualUsage:{requestCount:1,costUsdMicros:0},evidence:{summary:"synthetic historical evidence",capturedAt:midnight}},
    {state:"interrupted",interruptedAt:midnight,code:"cost-estimate-breach",message:"synthetic unknown",accounting:"full-reservation-retained"},
    {state:"lease-expired",expiredAt:midnight,accounting:"full-reservation-retained"}];
   for(const [i,lifecycle] of states.entries()){
    const r=ProviderAdmissionRecordSchema.parse({...original,admissionId:id(61+i),lifecycle,version:2,createdAt:boundary,updatedAt:midnight});
    f.raw.prepare("INSERT INTO provider_admissions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(r.admissionId,r.execution.runId,r.capability,r.configSnapshotId,r.configFingerprint,r.requestFingerprint,r.lifecycle.state,0,r.lifecycle.state==="settled"?0:null,null,null,r.version,JSON.stringify(r),r.createdAt);
   }
   const counter=ProviderBudgetCounterSchema.parse(JSON.parse(String(f.raw.prepare("SELECT record_json FROM provider_budget_counters").get()?.record_json)));
   const blocked={...counter,blockedByAdmissionId:id(63),minuteWindowStartedAt:midnight,dayWindowStartedAt:midnight,minuteRequests:4,dayRequests:4};
   f.raw.prepare("UPDATE provider_budget_counters SET blocked_by_admission_id=?,minute_window_started_at=?,day_window_started_at=?,minute_requests=4,day_requests=4,record_json=?").run(id(63),midnight,midnight,JSON.stringify(blocked));
   const retained=f.raw.prepare("SELECT record_key,record_json FROM provider_admissions ORDER BY record_key").all();assert.equal(retained.length,5);
   assert.equal(inspectAuthorityBackupReadOnly(f.historicalPath).schemaVersion,42);
   await backupStoppedAuthority(f.input.stateRoot,f.clock);
   const expired=storageTree(f.input.stateRoot);
   for(const plan of [true,false])await assert.rejects(upgradeStorage({...f.input,plan},f.clock),/authority-below-floor.*original compatible release/u);
   assert.deepEqual(storageTree(f.input.stateRoot),expired);
   const pinned=z.object({rows:z.record(z.string().regex(/^[a-z_]+$/u),z.array(z.record(z.string(),z.union([z.string(),z.number(),z.null()]))))}).parse(JSON.parse(readFileSync(new URL("../fixtures/migrated-provider.json",import.meta.url),"utf8")));
   f.raw.close();copyFileSync(f.historicalPath,join(f.input.stateRoot,"retired-source.sqlite"));rmSync(f.historicalPath);f.reopenRaw();
   for(const migration of SQLITE_MIGRATIONS.filter(m=>m.version<=46))for(const sql of migration.statements)f.raw.exec(sql);
   for(const [table,rows]of Object.entries(pinned.rows))for(const row of rows){const columns=Object.keys(row);f.raw.prepare(`INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(()=>"?").join(",")})`).run(...Object.values(row));}
   f.raw.prepare("INSERT INTO database_state(singleton_id,schema_version,authority_generation,updated_at) VALUES(1,46,7,?)").run(NOW);
   f.raw.exec(`PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)};PRAGMA user_version=46`);
   assert.equal(inspectAuthorityBackupReadOnly(f.historicalPath).schemaVersion,46);
   const source=readFileSync(f.historicalPath);const backup=await backupStoppedAuthority(f.input.stateRoot,f.clock);const manifest=backup.manifests[0];assert.ok(manifest);const path=join(f.input.stateRoot,"backups","authority",manifest.backupFileName);const backupBytes=readFileSync(path);
   await assert.rejects(upgradeStorage({...f.input,hooks:{beforeCommit:()=>{throw new Error("provider-before-commit");}}},f.clock),/provider-before-commit/u);assert.deepEqual(readFileSync(f.historicalPath),source);
   await assert.rejects(upgradeStorage({...f.input,hooks:{afterCommit:()=>{throw new Error("provider-after-commit");}}},f.clock),/provider-after-commit/u);
   assert.equal((await upgradeStorage(f.input,f.clock)).state,"converted");const committed=readFileSync(f.historicalPath);assert.equal((await upgradeStorage(f.input,f.clock)).state,"already-upgraded");assert.deepEqual(readFileSync(f.historicalPath),committed);
   const db=AuthorityDatabase.open({path:f.historicalPath,busyTimeoutMs:250,migrationOwner:"provider-history"},f.clock);
   try{
    for(const row of retained){const r=readProviderRequest(f.raw,String(row.record_key));assert.equal(r?.kind,"legacy-capability");if(r?.kind!=="legacy-capability")throw new Error("history absent");assert.deepEqual(r.record,JSON.parse(String(row.record_json)));assert.equal(r.origin,"pre-tracking");assert.deepEqual(r.attribution,{kind:"legacy-capability",capability:"ocr.extract"});}
    const u=readProviderUsage(f.raw,"ocr.extract");assert.equal(u?.kind,"legacy-capability");if(u?.kind!=="legacy-capability")throw new Error("history absent");assert.deepEqual(u.cumulative,{requests:0,chargedUsdMicros:0});assert.equal(u.tracking.coverage,"historical-gaps");assert.deepEqual(u.record,blocked);
    assert.equal(db.authority.providerAdmissions.reserve(legacyRequest(f)).state,"existing");
    db.authority.providerAdmissions.settle({admissionId:id(60),expectedVersion:1,actualUsage:{requestCount:1,costUsdMicros:0},adapterDisposition:"produced",evidence:{summary:"late pre-tracking result",capturedAt:NOW},now:NOW});
    const after=readProviderUsage(f.raw,"ocr.extract");assert.equal(after?.kind,"legacy-capability");if(after?.kind!=="legacy-capability")throw new Error("history absent");assert.deepEqual(after.cumulative,{requests:0,chargedUsdMicros:0});assert.equal(after.record.activeReservations,0);
   }finally{db.close();}
   assert.deepEqual(readFileSync(path),backupBytes);assert.equal(inspectAuthorityBackupReadOnly(path).schemaVersion,46);
   f.raw.close();copyFileSync(path,f.historicalPath);rmSync(join(f.input.stateRoot,"archive.sqlite"),{force:true});rmSync(join(f.input.stateRoot,"archive-files"),{recursive:true,force:true});f.reopenRaw();assert.equal((await upgradeStorage(f.input,f.clock)).state,"converted");
   for(const row of retained){const r=readProviderRequest(f.raw,String(row.record_key));assert.equal(r?.kind,"legacy-capability");if(r?.kind!=="legacy-capability")throw new Error("restored history absent");assert.deepEqual(r.record,JSON.parse(String(row.record_json)));}
  }finally{f.dispose();}
 });
});

import { LifecycleSourceSnapshotSchema } from "../../../src/core/run-lifecycle-storage.js";
import { captureArchiveReport } from "../../../src/services/archive/report-capture.js";
import { transferArchiveReport } from "../../../src/services/archive/archive-transfer.js";
it("captures an archive without adding usage; archive deletion accounts pending uncertainty exactly once",()=>{
 const f=foundationFixture();const raw=new DatabaseSync(f.path);try{
  const p=createGenericProviderAccounting(f.db.authority.providerAccounting);p.reserve(admission(f));p.finish(done());p.reserve(admission(f,101));
  const terminal=f.db.authority.runs.transition({runId:f.run.envelope.runId,expectedVersion:f.run.version,claim:{workerId:"worker-1",claimGeneration:1},lifecycle:{state:"terminal",outcome:"cancelled",endedAt:NOW},now:NOW});assert.equal(terminal.state,"applied");if(terminal.state!=="applied")throw new Error("terminal fixture refused");
  const before=p.read();const captured=f.db.authority.providerAccounting.getRequest(id(100));assert.ok(captured);assert.deepEqual(p.read(),before);
  const storage = createRunLifecycleStorage(f.db), snapshot = storage.capture(f.run.envelope.runId);
  const report = captureArchiveReport({snapshot,transferId:id(200),capturedAt:NOW,files:[],sections:[]});
  assert.deepEqual(p.read(),before);
  const source=report.content.sources.find(value=>value.kind==="authority-snapshot");assert.ok(source);
  const retained=LifecycleSourceSnapshotSchema.parse(JSON.parse(source.json)).records.find(group=>group.table==="provider_requests");
  assert.deepEqual(retained?.rows.map(row=>readProviderRequest(raw,row.key)),[captured,f.db.authority.providerAccounting.getRequest(id(101))]);
  transferArchiveReport(storage,report,terminal.run.version);
  const afterTransfer=p.read();
  assert.equal(storage.deleteArchive({runId:f.run.envelope.runId,commandId:id(201),archiveFingerprint:report.digest}).state,"deleted");
  assert.deepEqual(p.read(),afterTransfer);
  assert.deepEqual(p.read()[0].cumulative,{kind:"unknown",retainedUpperBound:2});assert.equal(raw.prepare("SELECT count(*) n FROM provider_requests").get()?.n,0);
  assert.throws(()=>p.finish(done(101)),/request-missing/u);inspectGenericProviderAccounting(raw);inspectHistoricalAuthorityInvariants(raw,49);
 }finally{raw.close();f.dispose();}
});

it("pairs malformed admission/refusal boundaries with valid reserve/finalize controls",()=>{
 const f=foundationFixture();try{
  const p=createGenericProviderAccounting(f.db.authority.providerAccounting);const input=admission(f);const b=input.budgets[0];const w=b.windows[0];
  for(const [patch,error] of [
   [{budgets:[b,b]},/duplicate-scope-meter/u],
   [{budgets:[{...b,windows:[w,w]}]},/duplicate-window/u],
   [{budgets:[b,{...b,scope:{id:"different",kind:"shared-quota"},upperBound:2}]},/meter-bound-conflict/u],
   [{attribution:{kind:"legacy-capability",capability:"ocr.extract"}},/generic-legacy-scope/u],
   [{deadlineAt:NOW},/deadline-invalid/u],
   [{budgets:[{...b,windows:[{...w,endsAt:NOW}]}]},/window-not-current/u],
  ] as const){assert.throws(()=>p.reserve({...input,...patch}),error);assert.equal(f.db.authority.providerAccounting.getRequest(input.requestId),undefined);assert.deepEqual(p.read(),[]);}
  p.reserve(input);const before=p.read();
  assert.throws(()=>p.reserve({...admission(f,101),budgets:[{...b,windows:[{...w,limit:{...w.limit,value:20}}]}]}),/window-policy-conflict/u);
  assert.throws(()=>p.finish({...done(),expectedVersion:2}),/version-conflict/u);
  assert.throws(()=>p.finish({...done(),state:"interrupted"}),/uncertain-outcome-has-usage/u);
  assert.throws(()=>p.finish({...done(),usage:[{meter:"usd-micros",quantity:{kind:"measured",value:1}}]}),/unreserved-meter/u);
  assert.throws(()=>p.finish({...done(),now:"2026-09-12T00:00:00.000Z"}),/lease-expired/u);
  assert.deepEqual(p.read(),before);p.finish({...done(),state:"interrupted",usage:[],reason:"synthetic timeout"});
  const uncertain=p.read();p.finish({...done(),state:"interrupted",usage:[],reason:"synthetic timeout"});assert.deepEqual(p.read(),uncertain);
  assert.deepEqual(uncertain[0].cumulative,{kind:"unknown",retainedUpperBound:1});assert.equal(uncertain[0].windows[0].reserved,0);
 }finally{f.dispose();}
});
it("rolls back an earlier scope when a later shared scope write fails",()=>{
 const f=foundationFixture();const raw=new DatabaseSync(f.path);try{
  const p=createGenericProviderAccounting(f.db.authority.providerAccounting);const input=admission(f);const budgets=[input.budgets[0],{...input.budgets[0],scope:{id:"second-scope",kind:"credential"}}];
  raw.exec("CREATE TRIGGER injected BEFORE INSERT ON provider_usage WHEN json_extract(NEW.record_json,'$.scope.id')='second-scope' BEGIN SELECT RAISE(ABORT,'second-scope-fault'); END");
  const generation=f.db.getMeta().authorityGeneration;assert.throws(()=>p.reserve({...input,budgets}),/second-scope-fault/u);assert.deepEqual(p.read(),[]);assert.equal(f.db.authority.providerAccounting.getRequest(input.requestId),undefined);assert.equal(f.db.getMeta().authorityGeneration,generation);
  raw.exec("DROP TRIGGER injected");p.reserve({...input,budgets});p.finish(done());assert.equal(p.read().length,2);for(const usage of p.read())assert.deepEqual(usage.cumulative,{kind:"measured",value:1});inspectGenericProviderAccounting(raw);
 }finally{raw.close();f.dispose();}
});
