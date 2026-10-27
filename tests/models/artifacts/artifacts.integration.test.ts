import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe,it } from "vitest";
import { ArtifactRefSchema } from "../../../src/models/artifacts/artifacts.js";
import { foundationFixture,HASH,id,NOW,update } from "../../support/helpers/database-foundation/fixtures.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";
describe("F shared transactional storage contracts",()=>{
 it("orders distinct updates, fences stale heads across connections, retains later enqueues and rolls back partial acknowledgement",async ()=>{
  const f=await foundationFixture();const second=AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"second-connection"});try{
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
  }finally{second.close();await f.dispose();}
 });
});
