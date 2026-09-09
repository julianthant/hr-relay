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
import { readLatestSettingsUpgrade } from "../../../src/infra/compat/settings-database-upgrade.js";
import { verifyBackupManifestAtPath } from "../../../src/infra/sqlite/backup-service.js";
import { readPreservedGeneratedSources } from "../../../src/infra/sqlite/generated-conversion.js";
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
 for(const [table,rows] of Object.entries(saved.rows))for(const row of rows){const keys=Object.keys(row);db.prepare(`INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map(()=>"?").join(",")})`).run(...Object.values(row));}
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
 const fix=FixRecordSchema.parse({id:id(71),failureFingerprint:HASH,status:"verified",requestedBy:"claude",summary:"Historical fix",affected:["ucpath.smart-hr.save-submit"],files:["src/stores/ucpath/driver/smart-hr.ts"],scenarios:["ucpath/submit-before-ready"],verification:[`artifact:${id(51)}`],commit:"a".repeat(40),createdAt:NOW});db.prepare("INSERT INTO fix_records VALUES(?,?,?,?,?)").run(fix.id,fix.status,fix.failureFingerprint,JSON.stringify(fix),NOW);
 db.exec(`PRAGMA application_id=${AUTHORITY_APPLICATION_ID};PRAGMA user_version=40`);db.close();
 const input={stateRoot,processLockRoot:join(stateRoot,"locks"),environmentFile:join(stateRoot,".env"),plan:false,generatedSourceDirectory:selected};
 return {root,path,stateRoot,selected,input,request,counter,prepJson,submittedJson,evidenceJson,evidence,bytes,digest,extraction:e,snapshot,dispose:()=>rmSync(root,{recursive:true,force:true})};
}
describe("F populated mixed-domain stopped conversion",()=>{
 it("preserves imports, OCR, provider history, settings, outputs and protected retired history across faults and exact restore",async()=>{
  const f=fixture();try{
   const source=readFileSync(f.path);assert.equal(inspectAuthorityBackupReadOnly(f.path).schemaVersion,40);
   await assert.rejects(upgradeStorage(f.input,clock),/backup-required/u);assert.deepEqual(readFileSync(f.path),source);
   const backup=await backupStoppedAuthority(f.stateRoot,clock);const manifest=backup.manifests[0];assert.ok(manifest);const backupPath=join(f.stateRoot,"backups","authority",manifest.backupFileName);const backupBytes=readFileSync(backupPath);assert.equal(inspectAuthorityBackupReadOnly(backupPath).authorityContentFingerprint,inspectAuthorityBackupReadOnly(f.path).authorityContentFingerprint);
   await assert.rejects(upgradeStorage({...f.input,hooks:{beforeCommit:()=>{throw new Error("mixed-before-commit");}}},clock),/mixed-before-commit/u);assert.deepEqual(readFileSync(f.path),source);
   await assert.rejects(upgradeStorage({...f.input,hooks:{afterCommit:()=>{throw new Error("mixed-after-commit");}}},clock),/mixed-after-commit/u);
   assert.equal((await upgradeStorage(f.input,clock)).state,"converted");const settled=readFileSync(f.path);assert.equal((await upgradeStorage(f.input,clock)).state,"already-upgraded");assert.deepEqual(readFileSync(f.path),settled);
   const db=AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"mixed-proof"});try{
    assert.deepEqual(db.authority.providerAdmissions.get(id(60)),f.request);const usage=db.authority.providerAccounting.getUsage("ocr.extract");assert.equal(usage?.kind,"legacy-capability");if(usage?.kind!=="legacy-capability")throw new Error("missing history");assert.deepEqual(usage.record,f.counter);assert.deepEqual(usage.cumulative,{requests:0,chargedUsdMicros:0});assert.equal(usage.tracking.coverage,"historical-gaps");
    assert.deepEqual(db.authority.intakeManifests.get(id(11)),JSON.parse(f.submittedJson));assert.deepEqual(db.authority.operatorXlsxExports.get(id(50)),f.evidence);assert.equal(db.authority.generatedArtifacts.get("sink:xlsx-retention")?.historyCoverage,"historical-gaps");assert.deepEqual(db.authority.artifactOutbox.listPending().map(r=>r.outboxId),[id(31)]);assert.equal(db.authority.configSnapshots.get(id(90))?.fingerprint,f.snapshot.fingerprint);
    const raw=new DatabaseSync(f.path,{readOnly:true});try{const imported=z.object({record_json:z.string()}).parse(raw.prepare("SELECT record_json FROM imported_artifacts WHERE session_id=?").get(id(1)));assert.equal(z.object({preparationJson:z.string()}).parse(JSON.parse(imported.record_json)).preparationJson,f.prepJson);assert.equal(z.object({submittedJson:z.string()}).parse(JSON.parse(imported.record_json)).submittedJson,f.submittedJson);assert.equal(raw.prepare("SELECT count(*) n FROM extracted_artifacts").get()?.n,1);assert.equal(raw.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name IN ('spans','gates','notes','ocr_approvals','knowledge_records','fix_records','intake_sessions','intake_manifests','artifact_outbox','artifact_sink_heads','operator_xlsx_exports','provider_admissions','provider_budget_counters','settings_current','runtime_config')").get()?.n,0);}finally{raw.close();}
   }finally{db.close();}
   assert.deepEqual(readFileSync(backupPath),backupBytes);const historical=new DatabaseSync(backupPath,{readOnly:true});try{assert.equal(historical.prepare("SELECT count(*) n FROM knowledge_records").get()?.n,1);assert.equal(historical.prepare("SELECT count(*) n FROM fix_records").get()?.n,1);assert.equal(historical.prepare("SELECT record_json FROM operator_xlsx_exports").get()?.record_json,f.evidenceJson);}finally{historical.close();}
   const pending=readLatestSettingsUpgrade(f.path);assert.ok(pending&&"format" in pending&&pending.generatedImport);const verified=await verifyBackupManifestAtPath(pending.backupManifest,AuthorityDatabase.sourceDatabaseIdentity(f.path));const preserved=readPreservedGeneratedSources(pending.generatedImport.copyDirectory,pending.generatedImport.manifestDigest,verified);assert.equal(preserved.files[0]?.payloadBase64,f.bytes.toString("base64"));
   writeFileSync(join(f.selected,"retention.xlsx"),"changed source");await assert.rejects(upgradeStorage(f.input,clock),/generated-source-head-bytes-conflict/u);assert.deepEqual(readFileSync(f.path),settled);
   copyFileSync(backupPath,f.path);rmSync(join(f.stateRoot,"artifacts"),{recursive:true});assert.equal((await upgradeStorage({...f.input,generatedSourceDirectory:pending.generatedImport.copyDirectory},clock)).state,"converted");assert.ok(readFileSync(join(f.stateRoot,"artifacts",`${f.digest}.artifact`)).length>0);
  }finally{f.dispose();}
 });
 it("retains unavailable historical export bytes explicitly and repeats without adopting its own new sink copy",async()=>{
  const f=fixture();try{
   rmSync(join(f.stateRoot,"artifacts",`${f.digest}.artifact`));await backupStoppedAuthority(f.stateRoot,clock);
   assert.equal((await upgradeStorage(f.input,clock)).state,"converted");const settled=readFileSync(f.path);
   assert.equal((await upgradeStorage(f.input,clock)).state,"already-upgraded");assert.deepEqual(readFileSync(f.path),settled);
   const db=AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"missing-bytes-proof"});try{assert.equal(db.authority.generatedArtifacts.get(`export:${id(50)}`)?.state,"unavailable");assert.deepEqual(db.authority.operatorXlsxExports.get(id(50)),f.evidence);}finally{db.close();}
  }finally{f.dispose();}
 });
 it("rechecks generated source bytes after precommit work and keeps the backup and database exact on refusal",async()=>{
  const f=fixture();try{
   const backup=await backupStoppedAuthority(f.stateRoot,clock);const manifest=backup.manifests[0];assert.ok(manifest);const path=join(f.stateRoot,"backups","authority",manifest.backupFileName);const retained=readFileSync(path);const source=readFileSync(f.path);
   await assert.rejects(upgradeStorage({...f.input,hooks:{beforeCommit:()=>writeFileSync(join(f.selected,"retention.xlsx"),"changed during conversion")}},clock),/generated-source-head-bytes-conflict/u);
   assert.deepEqual(readFileSync(f.path),source);assert.deepEqual(readFileSync(path),retained);
   writeFileSync(join(f.selected,"retention.xlsx"),f.bytes);assert.equal((await upgradeStorage(f.input,clock)).state,"converted");
  }finally{f.dispose();}
 });
 for(const fault of ["head-bytes","missing-head","unclassified"] as const)it(`refuses ${fault} before mutation with the populated positive input`,async()=>{
  const f=fixture();try{
   if(fault==="unclassified"){const raw=new DatabaseSync(f.path);try{raw.prepare("INSERT INTO spans VALUES(?,?,?)").run(id(89),"{}",NOW);}finally{raw.close();}}
   await backupStoppedAuthority(f.stateRoot,clock);const before=readFileSync(f.path);
   if(fault==="head-bytes")writeFileSync(join(f.selected,"retention.xlsx"),"wrong");if(fault==="missing-head")rmSync(join(f.selected,"retention.xlsx"));
   await assert.rejects(upgradeStorage(f.input,clock),fault==="unclassified"?/foundation-retirement-unclassified/u:fault==="head-bytes"?/generated-source-head-bytes-conflict/u:/ENOENT/u);assert.deepEqual(readFileSync(f.path),before);
  }finally{f.dispose();}
 });
});
