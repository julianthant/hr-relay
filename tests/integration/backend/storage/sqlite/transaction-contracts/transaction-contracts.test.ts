import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe,it } from "vitest";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { ArtifactRefSchema } from "../../../../../../src/models/artifacts/artifacts.js";
import { CommandResultSchema } from "../../../../../../src/rules/commands/commands.js";
import { foundationFixture,failure,terminalizeFixtureFailure,update,NOW,HASH,id } from "../../../../../support/helpers/database-foundation/fixtures.js";
describe("F shared transactional storage contracts",()=>{
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
   const raw=new DatabaseSync(f.path);try{assert.throws(()=>raw.exec("UPDATE artifacts SET version=version+1,payload_json=json_set(payload_json,'$.version',version+1,'$.updates[0].record.payload.value','rewritten')"),/generated-artifact-evidence-immutable/u);assert.throws(()=>raw.exec("DELETE FROM artifacts WHERE kind='generated'"),/artifact-evidence-retained/u);}finally{raw.close();}
  }finally{second.close();f.dispose();}
 });
 it("rolls annotation and generation back on audit failure, fences competing writes and retains immutable UNKNOWN evidence",()=>{
  const f=foundationFixture();const raw=new DatabaseSync(f.path);
  try{
   const record=failure();terminalizeFixtureFailure(f,f.run,record);
   const original=raw.prepare("SELECT payload_json FROM run_failures WHERE id=?").get(record.failureId)?.payload_json;
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
   assert.equal(raw.prepare("SELECT payload_json FROM run_failures WHERE id=?").get(record.failureId)?.payload_json,original);
   assert.equal(f.db.authority.failures.get(record.failureId)?.writeState,"unknown");
   assert.throws(()=>raw.prepare("UPDATE run_failures SET payload_json='{}',resolution_version=resolution_version+1,resolution_json=json_set(resolution_json,'$.version',resolution_version+1) WHERE id=?").run(record.failureId),/immutable/u);
   assert.throws(()=>f.db.authority.failureResolution.update({...request,runId:id(99)}),/version-conflict/u);
  }finally{raw.close();f.dispose();}
 });
 it("freezes S's ordinary no-restart result arm while protecting target and journal identity",()=>{
  const input={state:"applied",commandId:id(1),affectedTargets:[{family:"settings",revision:2}],restartRequired:false,settingsRevision:2,settingsFingerprint:HASH};assert.deepEqual(CommandResultSchema.parse(input),input);assert.equal(CommandResultSchema.safeParse({...input,settingsRevision:3}).success,false);assert.equal(CommandResultSchema.safeParse({...input,entries:[]}).success,false);
 });
});
