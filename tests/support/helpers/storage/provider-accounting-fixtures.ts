import { DatabaseSync } from "node:sqlite";
import { mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { foundationFixture, NOW, HASH, id } from "../database-foundation/fixtures.js";
import { GenericProviderRequestSchema, GenericProviderUsageSchema, LegacyProviderRequestSchema } from "../../../../src/rules/providers/provider-accounting.js";
import { ProviderAdmissionRecordSchema, ProviderBudgetCounterSchema } from "../../../../src/rules/providers/provider-admission.js";
import { writeProviderRequest, writeProviderUsage } from "../../../../src/backend/storage/sqlite/provider-storage.js";
import { AUTHORITY_APPLICATION_ID, SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
export { foundationFixture, NOW, HASH, id };
export function generic(f: ReturnType<typeof foundationFixture>) {
 const scope = {id:"synthetic.shared",kind:"shared-quota"};
 const request = GenericProviderRequestSchema.parse({format:1,kind:"generic",requestId:id(41),execution:{runId:f.run.envelope.runId,attempt:1,nodeId:"searching",taskId:"ocr/extract-page"},capability:"geocode.census",configSnapshotId:f.snapshot.configSnapshotId,configFingerprint:f.snapshot.fingerprint,requestFingerprint:HASH,attribution:{kind:"attributed",provider:"synthetic-alpha",credential:{kind:"generation",reference:"synthetic-generation/1"},model:"model-a"},allocations:[{scopeId:scope.id,meter:"requests",windowId:"day",windowStartedAt:NOW,windowEndsAt:null,upperBound:1,trackingOrigin:"tracked"}],state:"reserved",usage:[],leaseExpiresAt:"2026-09-09T12:01:00.000Z",deadlineAt:"2026-09-09T12:00:30.000Z",reason:null,version:1,createdAt:NOW,updatedAt:NOW});
 const usage = GenericProviderUsageSchema.parse({format:1,kind:"generic",usageId:"synthetic-usage",scope,meter:"requests",tracking:{startedAt:NOW,coverage:"complete-since-start",evidence:"caller-supplied"},cumulative:{kind:"measured",value:0},windows:[{id:"day",startsAt:NOW,endsAt:null,settled:{kind:"measured",value:0},retainedUnknown:0,reserved:1,limit:{kind:"configured",value:10,provenance:"synthetic-policy"}}],version:1,createdAt:NOW,updatedAt:NOW});
 return {request,usage};
}
export function legacyRequest(f:ReturnType<typeof foundationFixture>, n=60, capability="geocode.census") {
 return {admissionId:id(n),execution:{runId:f.run.envelope.runId,attempt:1,nodeId:"searching",taskId:"ocr/extract-page"},capability,configSnapshotId:f.snapshot.configSnapshotId,configFingerprint:f.snapshot.fingerprint,requestFingerprint:HASH,estimate:{maximumCostUsdMicros:0},leaseExpiresAt:"2026-09-09T12:01:00.000Z",deadlineAt:"2026-09-09T12:00:30.000Z",now:NOW};
}
export function historicalFixture(version:42|43) {
 const f=foundationFixture();
 const request=legacyRequest(f,60,"ocr.extract");
 const record=ProviderAdmissionRecordSchema.parse({admissionId:request.admissionId,execution:request.execution,capability:request.capability,configSnapshotId:request.configSnapshotId,configFingerprint:request.configFingerprint,requestFingerprint:request.requestFingerprint,
  budget:{timeoutMs:120_000,concurrency:4,requestsPerMinute:10,dailyRequestLimit:250,costLimitUsdMicros:0},estimate:request.estimate,reservation:{requestCount:1,maximumCostUsdMicros:0},
  lifecycle:{state:"reserved",reservedAt:NOW,leaseExpiresAt:request.leaseExpiresAt,deadlineAt:request.deadlineAt},version:1,createdAt:NOW,updatedAt:NOW});
 const counter=ProviderBudgetCounterSchema.parse({capability:"ocr.extract",minuteWindowStartedAt:NOW,minuteRequests:1,dayWindowStartedAt:"2026-09-09T00:00:00.000Z",dayRequests:1,dayReservedCostUsdMicros:0,activeReservations:1,version:2,createdAt:NOW,updatedAt:NOW});
 const tracking=LegacyProviderRequestSchema.shape.tracking.parse({startedAt:NOW,coverage:"complete-since-start",evidence:"legacy-reported"});
 const historicalSeed=new DatabaseSync(f.path);
 try {
  writeProviderRequest(historicalSeed,{format:1,kind:"legacy-capability",record,origin:"tracked",attribution:{kind:"legacy-capability",capability:"ocr.extract"},tracking},null);
  writeProviderUsage(historicalSeed,{format:1,kind:"legacy-capability",record:counter,tracking,cumulative:{requests:1,chargedUsdMicros:0}},null);
 } finally { historicalSeed.close(); }
 const path=join(f.root,"historical","state.db");mkdirSync(join(f.root,"historical"));
 for(const file of ["package.json","package-lock.json"])copyFileSync(join(process.cwd(),file),join(f.root,file));
 let raw=new DatabaseSync(path); const seed=new DatabaseSync(f.path,{readOnly:true});
 for(const migration of SQLITE_MIGRATIONS.filter(m=>m.version<=version))for(const sql of migration.statements)raw.exec(sql);
 for(const table of ["settings_snapshots","workflow_runs","workflow_workers"]){
  for(const row of seed.prepare(`SELECT * FROM ${table}`).all()){
   const columns=raw.prepare(`PRAGMA table_info(${table})`).all().map(c=>String(c.name)).filter(c=>Object.hasOwn(row,c));
   raw.prepare(`INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(()=>"?").join(",")})`).run(...columns.map(c=>row[c]));
  }
 }
 for(const [old,current] of [["provider_admissions","provider_requests"],["provider_budget_counters","provider_usage"]]){
  for(const row of seed.prepare(`SELECT * FROM ${current}`).all()){
   const stored=JSON.parse(String(row.record_json)) as {record:unknown};
   const values={...row,record_json:version===42?JSON.stringify(stored.record):row.record_json};
   raw.prepare(`INSERT INTO ${version===42?old:current}(${Object.keys(values).join(",")}) VALUES(${Object.keys(values).map(()=>"?").join(",")})`).run(...Object.values(values));
  }
 }
 raw.prepare("INSERT INTO database_state(singleton_id,schema_version,authority_generation,updated_at) VALUES(1,?,7,?)").run(version,NOW);
 raw.exec(`PRAGMA application_id=${AUTHORITY_APPLICATION_ID};PRAGMA user_version=${version}`);seed.close();
 return {...f,historicalPath:path,get raw(){return raw;},reopenRaw:()=>{raw=new DatabaseSync(path);},input:{stateRoot:join(f.root,"historical"),processLockRoot:join(f.root,"historical","locks"),environmentFile:join(f.root,"historical",".env"),plan:false},dispose:()=>{raw.close();f.dispose();}};
}
export function admission(f:ReturnType<typeof foundationFixture>, n=100) {
 const {request}=generic(f);
 return {requestId:id(n),execution:request.execution,capability:request.capability,configSnapshotId:request.configSnapshotId,
  configFingerprint:request.configFingerprint,requestFingerprint:HASH,attribution:request.attribution,now:NOW,
  leaseExpiresAt:"2026-09-11T12:00:00.000Z",deadlineAt:"2026-09-11T11:59:30.000Z",
  budgets:[{scope:{id:"synthetic.shared",kind:"shared-quota"},meter:"requests",upperBound:1,
   windows:[{id:"day-9",startsAt:"2026-09-09T00:00:00.000Z",endsAt:"2026-09-10T00:00:00.000Z",limit:{kind:"configured",value:3,provenance:"synthetic-policy"}}]}]};
}
