import { storageTree } from "../helpers/storage-recovery-fixture.js";
import { createRunLifecycleStorage, LifecycleSourceSnapshotSchema } from "../../../src/core/run-lifecycle-storage.js";
import { ProviderRequestStorageSchema } from "../../../src/domain/provider-accounting.js";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe,it } from "vitest";
import { z } from "zod";
import { SQLITE_MIGRATIONS,AUTHORITY_APPLICATION_ID } from "../../../src/infra/sqlite/migrations.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";
import { backupStoppedAuthority,upgradeStorage } from "../../../src/server/storage/upgrade.js";
import { inspectAuthorityBackupReadOnly } from "../../../src/infra/compat/backup-inspection.js";
import { GeneratedSourceManifestSchema } from "../../../src/infra/sqlite/generated-conversion.js";
import { manualClock } from "../../../src/domain/clock.js";
import { ConfigSchema } from "../../../src/domain/config/schema.js";
import { defaultRuntimePaths } from "../../../src/domain/config/runtime-paths.js";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import { sha256Hex } from "../../../src/domain/sha256.js";
import { ProviderAdmissionRecordSchema,ProviderBudgetCounterSchema } from "../../../src/domain/provider-admission.js";
import { admitOcrExtraction } from "../../../src/domain/ocr/extraction.js";
import { KnowledgeRecordSchema,FixRecordSchema } from "../../../src/domain/trust/knowledge.js";
import { OperatorXlsxExportEvidenceSchema,OPERATOR_XLSX_MEDIA_TYPE } from "../../../src/domain/dashboard/xlsx-export.js";
import { session,manifest } from "./import-fixtures.js";
import { NOW,HASH,id,update } from "./fixtures.js";
const clock=manualClock(new Date(NOW));
const RowsSchema=z.object({rows:z.record(z.string(),z.array(z.record(z.string(),z.union([z.string(),z.number(),z.null()]))))});
function fixture(){
 const root=mkdtempSync(join(tmpdir(),"foundation-mixed-"));const stateRoot=join(root,".tracker");mkdirSync(stateRoot);for(const file of ["package.json","package-lock.json"])copyFileSync(join(process.cwd(),file),join(root,file));
 const saved=RowsSchema.parse(JSON.parse(readFileSync(new URL("../run-completion-fixtures/schema40-failure.json",import.meta.url),"utf8")));
 const path=join(stateRoot,"state.db");const db=new DatabaseSync(path);db.exec("PRAGMA foreign_keys=OFF");
 for(const migration of SQLITE_MIGRATIONS.filter(m=>m.version<=40))for(const sql of migration.statements)db.exec(sql);
 for(const [table,rows] of Object.entries(saved.rows))for(const original of rows){const row={...original};
  if(table==="version_plans") { const record=z.object({createdAt:z.string()}).passthrough().parse(JSON.parse(String(row.record_json))); row.record_json=JSON.stringify({...record,state:"applied",version:2,appliedAt:record.createdAt}); }
  const keys=Object.keys(row);db.prepare(`INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map(()=>"?").join(",")})`).run(...Object.values(row));}
 const config=ConfigSchema.parse({paths:defaultRuntimePaths()});const fingerprint=sha256Hex(canonicalJsonStringify(config));const snapshot={configSnapshotId:id(90),revision:1,fingerprint,capturedAt:NOW,capturedBy:"local-operator",config,provenance:{}};
 db.prepare("INSERT INTO settings_snapshots VALUES(?,?,?)").run(id(90),JSON.stringify(snapshot),NOW);
 const active={generation:1,settingsRevision:1,settingsFingerprint:sha256Hex(canonicalJsonStringify({})),configSnapshotId:id(90),configFingerprint:fingerprint,activatedAt:NOW};
 db.prepare("INSERT INTO runtime_config VALUES(?,?,?,?,?,?,?,?)").run("active",1,1,active.settingsFingerprint,id(90),fingerprint,JSON.stringify(active),NOW);
 const prep={...session(),state:"enqueued",intakeManifestId:id(11)};const submitted=manifest();const prepJson=JSON.stringify(prep,null,2);const submittedJson=JSON.stringify(submitted,null,2);
 db.prepare("INSERT INTO intake_sessions VALUES(?,?,?,?,?,?,?)").run(id(1),"person-lookup",HASH,"enqueued",prepJson,NOW,NOW);db.prepare("INSERT INTO intake_manifests VALUES(?,?,?,?,?,?)").run(id(11),"person-lookup",HASH,HASH,submittedJson,NOW);
 const extraction=admitOcrExtraction({formType:"oath",source:{kind:"operator",actorId:"local-operator"},readAt:NOW,sourceSha256:HASH,sourcePage:1,pageKind:"oath",record:{answers:{printedName:{state:"absent",reason:"blank"},employeeId:{state:"absent",reason:"blank"},signatureDate:{state:"absent",reason:"blank"},employeeSigned:{state:"absent",reason:"blank"},officerSigned:{state:"absent",reason:"blank"}}}});assert.equal(extraction.admitted,true);if(!extraction.admitted)throw new Error("synthetic OCR refusal");const e=extraction.extraction;
 db.prepare("INSERT INTO ocr_extractions VALUES(?,?,?,?,?,?,?,?,?)").run(`${HASH}#1#oath`,e.formType,HASH,1,e.pageKind,e.pageFingerprint,e.source.kind,JSON.stringify(e),NOW);
 const request=ProviderAdmissionRecordSchema.parse({admissionId:id(60),execution:{runId:update().sourceRunId,attempt:1,nodeId:"searching",taskId:"ocr/extract-page"},capability:"ocr.extract",configSnapshotId:id(90),configFingerprint:fingerprint,requestFingerprint:HASH,budget:config.providers.ocrExtract,estimate:{maximumCostUsdMicros:10},reservation:{requestCount:1,maximumCostUsdMicros:10},lifecycle:{state:"settled",settledAt:NOW,adapterDisposition:"produced",actualUsage:{requestCount:1,costUsdMicros:7},evidence:{summary:"synthetic historical usage",capturedAt:NOW}},version:2,createdAt:NOW,updatedAt:NOW});
 db.prepare("INSERT INTO provider_admissions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(request.admissionId,request.execution.runId,request.capability,id(90),fingerprint,HASH,"settled",10,7,null,null,2,JSON.stringify(request),NOW);
 const counter=ProviderBudgetCounterSchema.parse({capability:"ocr.extract",minuteWindowStartedAt:NOW,minuteRequests:1,dayWindowStartedAt:"2026-09-09T00:00:00.000Z",dayRequests:1,dayReservedCostUsdMicros:7,activeReservations:0,version:2,createdAt:NOW,updatedAt:NOW});db.prepare("INSERT INTO provider_budget_counters VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(counter.capability,counter.capability,NOW,1,counter.dayWindowStartedAt,1,7,0,null,2,JSON.stringify(counter),NOW);
 const bytes=Buffer.from("exact retained synthetic workbook bytes");const digest=createHash("sha256").update(bytes).digest("hex");const selected=join(root,"generated-source");mkdirSync(selected);writeFileSync(join(selected,"retention.xlsx"),bytes);writeFileSync(join(selected,"generated-sinks.json"),JSON.stringify({format:1,sinks:[{sinkId:"xlsx-retention",filename:"retention.xlsx"}]}));
 const done={...update(30),state:"projected",projectedAt:NOW};const pending=update(31);for(const row of [done,pending])db.prepare("INSERT INTO artifact_outbox VALUES(?,?,?)").run(row.outboxId,JSON.stringify(row),NOW);
 const head={sinkId:"xlsx-retention",contentSha256:digest,generation:2,lastOutboxId:id(30),projectedAt:NOW};db.prepare("INSERT INTO artifact_sink_heads VALUES(?,?,?)").run(head.sinkId,JSON.stringify(head),NOW);
 const filename="hr-run-search-2026-09-09-g1.xlsx";const evidence=OperatorXlsxExportEvidenceSchema.parse({exportId:id(50),workbookVersion:1,createdAt:NOW,selection:{kind:"search",query:{q:"synthetic",scope:"workflow",facets:{},limit:20},snapshot:{generatedAt:NOW,sourceIdentity:HASH,authorityGeneration:1,order:"match-strength/enqueued-desc/run-id-asc:v1",totalMatches:0}},workbook:{sheetNames:["Read Me","Runs"],rowCount:0},artifact:{id:id(51),sha256:digest,bytes:bytes.length,mediaType:OPERATOR_XLSX_MEDIA_TYPE},download:{filename,mediaType:OPERATOR_XLSX_MEDIA_TYPE,contentDisposition:`attachment; filename="${filename}"`,byteLength:bytes.length,sha256:digest}});
 mkdirSync(join(stateRoot,"artifacts"));writeFileSync(join(stateRoot,"artifacts",`${digest}.artifact`),JSON.stringify({ref:evidence.artifact,payloadBase64:bytes.toString("base64")}));const evidenceJson=JSON.stringify(evidence,null,2);db.prepare("INSERT INTO operator_xlsx_exports(record_key,selection_kind,artifact_id,digest,byte_length,media_type,filename,record_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(evidence.exportId,"search",id(51),digest,bytes.length,OPERATOR_XLSX_MEDIA_TYPE,filename,evidenceJson,NOW);
 const knowledge=KnowledgeRecordSchema.parse({id:id(70),status:"active",scope:{system:"ucpath",element:"ucpath.smart-hr.save-submit"},title:"Historical rule",symptom:"Synthetic symptom",trigger:"Synthetic trigger",rootCause:"Synthetic cause",invariant:"Preserve evidence",fix:"Retain source",regressionScenarios:["ucpath/submit-before-ready"],evidence:[`artifact:${id(51)}`],verifiedAt:NOW});db.prepare("INSERT INTO knowledge_records VALUES(?,?,?,?)").run(knowledge.id,knowledge.status,JSON.stringify(knowledge),NOW);
 const fix=FixRecordSchema.parse({id:id(71),failureFingerprint:HASH,status:"verified",requestedBy:"claude",summary:"Historical fix",affected:["ucpath.smart-hr.save-submit"],files:["src/stores/ucpath/driver/smart-hr.ts"],scenarios:["ucpath/submit-before-ready"],verification:[`artifact:${id(51)}`],commit:"a".repeat(40),createdAt:NOW});db.prepare("INSERT INTO fix_records VALUES(?,?,?,?,?)").run(fix.id,fix.status,fix.failureFingerprint ?? null,JSON.stringify(fix),NOW);
 db.exec(`PRAGMA application_id=${AUTHORITY_APPLICATION_ID};PRAGMA user_version=40`);db.close();
 const input={stateRoot,processLockRoot:join(stateRoot,"locks"),environmentFile:join(stateRoot,".env"),plan:false,generatedSourceDirectory:selected};
 return {root,path,stateRoot,selected,input,request,counter,prepJson,submittedJson,evidenceJson,evidence,bytes,digest,extraction:e,snapshot,dispose:()=>rmSync(root,{recursive:true,force:true})};
}
function supportedFixture(unavailable=false) {
 const f=fixture();
 const retained=RowsSchema.extend({generated:GeneratedSourceManifestSchema}).parse(JSON.parse(readFileSync(new URL(`../fixtures/migrated-mixed-${unavailable?"unavailable":"available"}.json`,import.meta.url),"utf8")));
 copyFileSync(f.path,join(f.stateRoot,"retired-source.sqlite"));rmSync(f.path);
 const raw=new DatabaseSync(f.path);raw.exec("PRAGMA foreign_keys=OFF");
 try{
  for(const migration of SQLITE_MIGRATIONS.filter(m=>m.version<=46))for(const sql of migration.statements)raw.exec(sql);
  for(const [table,rows]of Object.entries(retained.rows))for(const row of rows){const names=Object.keys(row);raw.prepare(`INSERT INTO ${table}(${names.join(",")}) VALUES(${names.map(()=>"?").join(",")})`).run(...Object.values(row));}
  raw.exec(`PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)};PRAGMA user_version=46`);
  assert.deepEqual(raw.prepare("PRAGMA foreign_key_check").all(),[]);
 }finally{raw.close();}
 // These are the preserved artifact envelopes, never a new import of selected source files.
 if(unavailable)rmSync(join(f.stateRoot,"artifacts",`${f.digest}.artifact`));
 for(const file of retained.generated.files)writeFileSync(join(f.stateRoot,"artifacts",`${file.ref.sha256}.artifact`),JSON.stringify(file));
 const {generatedSourceDirectory:_expired,...input}=f.input;
 return {...f,input};
}
describe("F populated mixed-domain stopped conversion",()=>{
 it("preserves imports, OCR, provider history, settings, outputs and protected retired history across faults and exact restore",async()=>{
  const f=supportedFixture();try{
   const source=readFileSync(f.path);assert.equal(inspectAuthorityBackupReadOnly(f.path).schemaVersion,46);
   await assert.rejects(upgradeStorage(f.input,clock),/backup-required/u);assert.deepEqual(readFileSync(f.path),source);
   const backup=await backupStoppedAuthority(f.stateRoot,clock);const manifest=backup.manifests[0];assert.ok(manifest);const backupPath=join(f.stateRoot,"backups","authority",manifest.backupFileName);const backupBytes=readFileSync(backupPath);assert.equal(inspectAuthorityBackupReadOnly(backupPath).authorityContentFingerprint,inspectAuthorityBackupReadOnly(f.path).authorityContentFingerprint);
   await assert.rejects(upgradeStorage({...f.input,hooks:{beforeCommit:()=>{throw new Error("mixed-before-commit");}}},clock),/mixed-before-commit/u);assert.deepEqual(readFileSync(f.path),source);
   await assert.rejects(upgradeStorage({...f.input,hooks:{afterCommit:()=>{throw new Error("mixed-after-commit");}}},clock),/mixed-after-commit/u);
   assert.equal((await upgradeStorage(f.input,clock)).state,"converted");const settled=readFileSync(f.path);assert.equal((await upgradeStorage(f.input,clock)).state,"already-upgraded");assert.deepEqual(readFileSync(f.path),settled);
   const db=AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"mixed-proof"});try{
    const archived = createRunLifecycleStorage(db).readReport(f.request.execution.runId); assert.ok(archived);
    const source = archived.content.sources.find(row => row.kind === "authority-snapshot"); assert.ok(source);
    const snapshot = LifecycleSourceSnapshotSchema.parse(JSON.parse(source.json));
    const requestRow = snapshot.records.find(group => group.table === "provider_requests")?.rows.find(row => row.key === id(60)); assert.ok(requestRow);
    const retained = ProviderRequestStorageSchema.parse(JSON.parse(requestRow.json)); assert.equal(retained.kind, "legacy-capability");
    if (retained.kind !== "legacy-capability") throw new Error("wrong retained provider kind"); assert.deepEqual(retained.record,f.request);
    assert.equal(db.authority.providerAdmissions.get(id(60)), undefined);const usage=db.authority.providerAccounting.getUsage("ocr.extract");assert.equal(usage?.kind,"legacy-capability");if(usage?.kind!=="legacy-capability")throw new Error("missing history");assert.deepEqual(usage.record,f.counter);assert.deepEqual(usage.cumulative,{requests:0,chargedUsdMicros:0});assert.equal(usage.tracking.coverage,"historical-gaps");
    assert.deepEqual(db.authority.intakeManifests.get(id(11)),JSON.parse(f.submittedJson));assert.deepEqual(db.authority.operatorXlsxExports.get(id(50)),f.evidence);assert.equal(db.authority.generatedArtifacts.get("sink:xlsx-retention")?.historyCoverage,"historical-gaps");assert.deepEqual(db.authority.artifactOutbox.listPending().map(r=>r.outboxId),[id(31)]);assert.equal(db.authority.configSnapshots.get(id(90))?.fingerprint,f.snapshot.fingerprint);
    const raw=new DatabaseSync(f.path,{readOnly:true});try{const imported=z.object({record_json:z.string()}).parse(raw.prepare("SELECT record_json FROM imported_artifacts WHERE session_id=?").get(id(1)));assert.equal(z.object({preparationJson:z.string()}).parse(JSON.parse(imported.record_json)).preparationJson,f.prepJson);assert.equal(z.object({submittedJson:z.string()}).parse(JSON.parse(imported.record_json)).submittedJson,f.submittedJson);assert.equal(raw.prepare("SELECT count(*) n FROM extracted_artifacts").get()?.n,1);assert.equal(raw.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name IN ('spans','gates','notes','ocr_approvals','knowledge_records','fix_records','intake_sessions','intake_manifests','artifact_outbox','artifact_sink_heads','operator_xlsx_exports','provider_admissions','provider_budget_counters','settings_current','runtime_config')").get()?.n,0);}finally{raw.close();}
   }finally{db.close();}
   assert.deepEqual(readFileSync(backupPath),backupBytes);const historical=new DatabaseSync(backupPath,{readOnly:true});try{assert.equal(historical.prepare("SELECT count(*) n FROM knowledge_records").get()?.n,1);assert.equal(historical.prepare("SELECT count(*) n FROM fix_records").get()?.n,1);assert.equal(historical.prepare("SELECT count(*) n FROM generated_artifacts").get()?.n,2);}finally{historical.close();}
   const observedSettled=readFileSync(f.path);
   const retainedFiles=storageTree(join(f.stateRoot,"artifacts"));
   writeFileSync(join(f.selected,"retention.xlsx"),"changed obsolete source");
   assert.equal((await upgradeStorage(f.input,clock)).state,"already-upgraded");assert.deepEqual(readFileSync(f.path),observedSettled);
   await assert.rejects(upgradeStorage({...f.input,generatedSourceDirectory:f.selected},clock),/generated-source-import-retired/u);
   assert.deepEqual(readFileSync(f.path),observedSettled);
   copyFileSync(backupPath,f.path);rmSync(join(f.stateRoot,"archive.sqlite"));rmSync(join(f.stateRoot,"archive-files"),{recursive:true,force:true});
   assert.equal((await upgradeStorage(f.input,clock)).state,"converted");
   assert.deepEqual(storageTree(join(f.stateRoot,"artifacts")),retainedFiles);
   assert.ok(readFileSync(join(f.stateRoot,"artifacts",`${f.digest}.artifact`)).length>0);
  }finally{f.dispose();}
 });
 it("retains unavailable historical export bytes explicitly and repeats without adopting its own new sink copy",async()=>{
  const f=supportedFixture(true);try{
   await backupStoppedAuthority(f.stateRoot,clock);
   assert.equal((await upgradeStorage(f.input,clock)).state,"converted");const settled=readFileSync(f.path);
   assert.equal((await upgradeStorage(f.input,clock)).state,"already-upgraded");assert.deepEqual(readFileSync(f.path),settled);
   const db=AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"missing-bytes-proof"});try{assert.equal(db.authority.generatedArtifacts.get(`export:${id(50)}`)?.state,"unavailable");assert.deepEqual(db.authority.operatorXlsxExports.get(id(50)),f.evidence);}finally{db.close();}
  }finally{f.dispose();}
 });
 it("refuses expired generated-source recovery before precommit work, preserving backup and source bytes",async()=>{
  const f=fixture();try{
   const backup=await backupStoppedAuthority(f.stateRoot,clock);const manifest=backup.manifests[0];assert.ok(manifest);const path=join(f.stateRoot,"backups","authority",manifest.backupFileName);const retained=readFileSync(path);const source=readFileSync(f.path);
   await assert.rejects(upgradeStorage({...f.input,hooks:{beforeCommit:()=>writeFileSync(join(f.selected,"retention.xlsx"),"changed during conversion")}},clock),/authority-below-floor.*original compatible release/u);
   assert.deepEqual(readFileSync(f.path),source);assert.deepEqual(readFileSync(path),retained);
   writeFileSync(join(f.selected,"retention.xlsx"),f.bytes);await assert.rejects(upgradeStorage(f.input,clock),/authority-below-floor.*original compatible release/u);
  }finally{f.dispose();}
 });
 for(const fault of ["head-bytes","missing-head","unclassified"] as const)it(`refuses ${fault} before mutation with the populated positive input`,async()=>{
  const f=fixture();try{
   if(fault==="unclassified"){const raw=new DatabaseSync(f.path);try{raw.prepare("INSERT INTO spans VALUES(?,?,?)").run(id(89),"{}",NOW);}finally{raw.close();}}
   await backupStoppedAuthority(f.stateRoot,clock);const before=readFileSync(f.path);
   if(fault==="head-bytes")writeFileSync(join(f.selected,"retention.xlsx"),"wrong");if(fault==="missing-head")rmSync(join(f.selected,"retention.xlsx"));
   await assert.rejects(upgradeStorage(f.input,clock),/authority-below-floor.*original compatible release/u);assert.deepEqual(readFileSync(f.path),before);
  }finally{f.dispose();}
 });
});
