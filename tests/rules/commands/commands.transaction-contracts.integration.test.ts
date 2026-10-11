import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe,it } from "vitest";
import { CommandResultSchema } from "../../../src/rules/commands/commands.js";
import { failure,foundationFixture,HASH,id,NOW,terminalizeFixtureFailure } from "../../support/helpers/database-foundation/fixtures.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";
describe("F shared transactional storage contracts",()=>{
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
