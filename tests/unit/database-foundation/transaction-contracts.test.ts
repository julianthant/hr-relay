import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe,it } from "vitest";
import { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";
import { GenericProviderRequestSchema,GenericProviderUsageSchema } from "../../../src/domain/provider-accounting.js";
import { ArtifactRefSchema } from "../../../src/domain/artifacts.js";
import { CommandResultSchema } from "../../../src/domain/commands.js";
import { foundationFixture,failure,terminalizeFixtureFailure,update,NOW,HASH,id } from "./fixtures.js";
function generic(f:ReturnType<typeof foundationFixture>){
 const scope={id:"synthetic-provider/model",kind:"provider-model"};
 const tracking={startedAt:NOW,coverage:"complete-since-start",evidence:"caller-supplied"};
 const request=GenericProviderRequestSchema.parse({format:1,kind:"generic",requestId:id(41),execution:{runId:f.run.envelope.runId,attempt:1,nodeId:"searching",taskId:"ocr/extract-page"},capability:"ocr.extract",configSnapshotId:f.snapshot.configSnapshotId,configFingerprint:f.snapshot.fingerprint,requestFingerprint:HASH,attribution:{kind:"attributed",provider:"synthetic",credential:{kind:"generation",reference:"synthetic-generation/1"},model:"model"},allocations:[{scopeId:scope.id,meter:"requests",windowId:"day",windowStartedAt:NOW,windowEndsAt:null,upperBound:1,trackingOrigin:"tracked"}],state:"reserved",usage:[],leaseExpiresAt:"2026-09-09T12:01:00.000Z",deadlineAt:"2026-09-09T12:00:30.000Z",reason:null,version:1,createdAt:NOW,updatedAt:NOW});
 const usage=GenericProviderUsageSchema.parse({format:1,kind:"generic",usageId:"synthetic-usage",scope,meter:"requests",tracking,cumulative:{kind:"unknown",retainedUpperBound:null},windows:[{id:"day",startsAt:NOW,endsAt:null,settled:{kind:"measured",value:0},retainedUnknown:0,reserved:1,limit:{kind:"configured",value:10,provenance:"synthetic-policy"}}],version:1,createdAt:NOW,updatedAt:NOW});
 return {request,usage};
}
describe("F shared transactional storage contracts",()=>{
 it("round-trips honest synthetic attribution and rolls request + scopes + generation back together",()=>{
  const f=foundationFixture();try{
   const accounting=f.db.authority.providerAccounting;const {request,usage}=generic(f);const generation=f.db.getMeta().authorityGeneration;
   assert.throws(()=>accounting.transaction(a=>{a.writeRequest(request,null);a.writeUsage(usage,null);throw new Error("scope-write-fault");}),/scope-write-fault/u);
   assert.equal(accounting.getRequest(request.requestId),undefined);assert.equal(accounting.getUsage(usage.usageId),undefined);assert.equal(f.db.getMeta().authorityGeneration,generation);
   accounting.transaction(a=>{a.writeRequest(request,null);a.writeUsage(usage,null);});assert.deepEqual(accounting.getRequest(request.requestId),request);assert.deepEqual(accounting.getUsage(usage.usageId),usage);
   const other=AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"second-connection"});try{assert.deepEqual(other.authority.providerAccounting.getRequest(request.requestId),request);assert.throws(()=>other.authority.providerAccounting.writeRequest({...request,version:2,attribution:{kind:"unattributed",reason:"not-supplied"}},1),/identity is immutable/u);}finally{other.close();}
   const settled=GenericProviderRequestSchema.parse({...request,state:"interrupted",leaseExpiresAt:null,deadlineAt:null,usage:[{meter:"requests",quantity:{kind:"unknown",retainedUpperBound:1}}],reason:"transport outcome unknown",version:2});accounting.writeRequest(settled,1);assert.throws(()=>accounting.writeRequest(settled,1),/version-conflict/u);assert.deepEqual(accounting.getRequest(request.requestId),settled);
   const raw=new DatabaseSync(f.path);try{assert.throws(()=>raw.exec("INSERT OR REPLACE INTO provider_requests SELECT * FROM provider_requests"),/insert conflicts/u);assert.throws(()=>raw.exec("INSERT OR REPLACE INTO provider_usage SELECT * FROM provider_usage"),/insert conflicts/u);assert.throws(()=>raw.prepare("DELETE FROM provider_usage WHERE record_key=?").run(usage.usageId),/never deleted/u);assert.throws(()=>raw.prepare("UPDATE provider_requests SET run_id=? WHERE record_key=?").run(id(99),request.requestId),/immutable/u);}finally{raw.close();}
  }finally{f.dispose();}
 });
 it("orders distinct updates, fences stale heads across connections, retains later enqueues and rolls back partial acknowledgement",()=>{
  const f=foundationFixture();const second=AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"second-connection"});try{
   const a=f.db.authority;const ref=ArtifactRefSchema.parse({id:id(42),sha256:HASH,bytes:100,mediaType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
   a.artifactOutbox.insert(update(1));second.authority.artifactOutbox.insert(update(2));const head={sinkId:"xlsx-retention",contentSha256:HASH,lastOutboxId:id(1),projectedAt:NOW,expectedGeneration:0,artifact:ref};const generation=f.db.getMeta().authorityGeneration;
   assert.throws(()=>f.db.withAuthorityTransaction(r=>{r.artifactSinkHeads.record(head);r.artifactOutbox.markProjected({outboxId:id(1),projectedAt:NOW});throw new Error("checkpoint-fault");}),/checkpoint-fault/u);
   assert.equal(a.artifactSinkHeads.get("xlsx-retention"),undefined);assert.equal(a.artifactOutbox.listPending().length,2);assert.equal(f.db.getMeta().authorityGeneration,generation);
   assert.throws(()=>a.artifactSinkHeads.record({...head,lastOutboxId:id(2)}),/out-of-order/u);
   f.db.withAuthorityTransaction(r=>{r.artifactSinkHeads.record(head);r.artifactOutbox.markProjected({outboxId:id(1),projectedAt:NOW});});
   assert.throws(()=>second.authority.artifactSinkHeads.record({...head,lastOutboxId:id(2)}),/generation-conflict/u);
   assert.deepEqual(second.authority.artifactOutbox.listPending().map(r=>r.outboxId),[id(2)]);
   assert.equal(a.generatedArtifacts.get("sink:xlsx-retention")?.state,"pending");
   const raw=new DatabaseSync(f.path);try{assert.throws(()=>raw.exec("UPDATE generated_artifacts SET version=version+1,record_json=json_set(record_json,'$.version',version+1,'$.updates[0].record.payload.value','rewritten')"),/evidence is immutable/u);assert.throws(()=>raw.exec("DELETE FROM generated_artifacts"),/evidence is retained/u);}finally{raw.close();}
  }finally{second.close();f.dispose();}
 });
 it("rolls annotation and generation back on audit failure, fences competing writes and retains immutable UNKNOWN evidence",()=>{
  const f=foundationFixture();const raw=new DatabaseSync(f.path);
  try{
   const record=failure();terminalizeFixtureFailure(f,f.run,record);
   const original=raw.prepare("SELECT record_json FROM run_failures WHERE record_key=?").get(record.failureId)?.record_json;
   const request={runId:record.runId,failureId:record.failureId,expectedVersion:1,resolution:{status:"resolved",version:2,by:"local-operator",at:NOW,note:"synthetic annotation"}};
   const generation=f.db.getMeta().authorityGeneration;
   assert.throws(()=>f.db.withAuthorityTransaction(a=>{a.failureResolution.update(request);throw new Error("audit-write-fault");}),/audit-write-fault/u);
   assert.deepEqual(f.db.authority.failureResolution.read(record.runId,record.failureId)?.resolution,{status:"unresolved",version:1});
   assert.equal(f.db.getMeta().authorityGeneration,generation);
   f.db.authority.failureResolution.update(request);
   const second=AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"annotation-second-connection"});
   try{
    assert.deepEqual(second.authority.failureResolution.read(record.runId,record.failureId)?.resolution,request.resolution);
    assert.throws(()=>second.authority.failureResolution.update(request),/version-conflict/u);
    second.authority.failureResolution.update({...request,expectedVersion:2,resolution:{status:"unresolved",version:3}});
   }finally{second.close();}
   assert.deepEqual(f.db.authority.failureResolution.read(record.runId,record.failureId)?.resolution,{status:"unresolved",version:3});
   assert.equal(raw.prepare("SELECT record_json FROM run_failures WHERE record_key=?").get(record.failureId)?.record_json,original);
   assert.equal(f.db.authority.failures.get(record.failureId)?.writeState,"unknown");
   assert.throws(()=>raw.prepare("UPDATE run_failures SET record_json='{}',resolution_version=resolution_version+1,resolution_json=json_set(resolution_json,'$.version',resolution_version+1) WHERE record_key=?").run(record.failureId),/immutable/u);
   assert.throws(()=>f.db.authority.failureResolution.update({...request,runId:id(99)}),/version-conflict/u);
  }finally{raw.close();f.dispose();}
 });
 it("freezes S's ordinary no-restart result arm while protecting target and journal identity",()=>{
  const input={state:"applied",commandId:id(1),affectedTargets:[{family:"settings",revision:2}],restartRequired:false,settingsRevision:2,settingsFingerprint:HASH};assert.deepEqual(CommandResultSchema.parse(input),input);assert.equal(CommandResultSchema.safeParse({...input,settingsRevision:3}).success,false);assert.equal(CommandResultSchema.safeParse({...input,entries:[]}).success,false);
 });
});
