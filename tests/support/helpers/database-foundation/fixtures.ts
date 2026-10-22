import { createBoundProfileFixture } from "../admission-fixture.js";
import { z } from "zod";
import assert from "node:assert/strict";
import { join } from "node:path";
import { AuthorityDatabase } from "../synthetic-database-admission.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { ConfigSnapshotRecordSchema } from "../../../../src/models/config/snapshot.js";
import { FailureRecordSchema } from "../../../../src/models/trust/failure.js";
import { ArtifactOutboxStorageRecordSchema } from "../../../../src/models/artifacts/generated-artifact.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { QUEUED_RUN, RUN_ID } from "../../fixtures/phase1f-run-fixtures.js";
import { personLookupDescriptor } from "../registered-workflows.js";
export const NOW="2026-09-09T12:00:00.000Z";
export const HASH="a".repeat(64);
export const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { initialSettingsFileRecord } from "../../../../src/models/config/settings.js";
import { admitDirectWorker } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { workflowProjections } from "../../../../src/workflow-kit/workflow.js";
export function foundationFixture(options:{input?:RunRecord["input"]}={}){
 const profile=createBoundProfileFixture();
 const root=profile.stateRoot,path=profile.path;const clock=manualClock(new Date(NOW));
 const db=AuthorityDatabase.open({path,busyTimeoutMs:250,migrationOwner:"foundation-proof"},clock);
 const resolved=resolveConfigWithProvenance(initialSettingsFileRecord().settings,hostConfigFacts({}),clock,
  {stateRoot:root,artifactRoot:join(root,"artifacts")});
 const snapshot=ConfigSnapshotRecordSchema.parse({configSnapshotId:id(90),revision:1,fingerprint:resolved.fingerprint,capturedAt:NOW,capturedBy:"local-operator",config:resolved.config,provenance:resolved.provenance});
 db.authority.runtimeConfig.initialize(snapshot);
 let admissionIdentity=10000;
 const createRun=(runId:string)=>{
 const workerId=db.withAuthorityTransaction(repositories=>{
  const slots=repositories.workerSlots.list("person-lookup").filter(slot=>slot.retiredAt===null);
  const free=slots.find(slot=>!repositories.runs.listByWorker(slot.workerId).some(run=>["claimed","validating","running"].includes(run.lifecycle.state)));
  const poolIndex=free?.poolIndex??[1,2,3].find(index=>!slots.some(slot=>slot.poolIndex===index));
  assert.ok(poolIndex!==undefined,"fixture exceeds genuine worker pool capacity");
  const slot=admitDirectWorker(repositories,{commandId:id(admissionIdentity++),workflow:"person-lookup",poolIndex,
   expectedPoolVersion:repositories.workerPools.get("person-lookup")?.version??0,processId:process.pid,
   processAcquisitionId:id(admissionIdentity++),authorityPath:path,processLockRoot:join(root,"locks"),now:NOW},id(admissionIdentity++));
  if(repositories.workerLeases.get(slot.workerId)===undefined){
   const lease=repositories.workerLeases.start({workerId:slot.workerId,workflow:"person-lookup",browserSystems:workflowProjections(personLookupDescriptor).systems,
    processId:process.pid,requestedBy:"local-operator",now:NOW});assert.equal(lease.state,"started");
  }
  return slot.workerId;
 });
 db.authority.runs.enqueue({...QUEUED_RUN,...(options.input===undefined?{}:{input:options.input}),envelope:{...QUEUED_RUN.envelope,runId, itemId:runId, descriptorVersion:personLookupDescriptor.version, contractFingerprint:personLookupDescriptor.contractFingerprint,configFingerprint:snapshot.fingerprint,configSnapshotId:snapshot.configSnapshotId}});
 const claim=db.authority.runs.claimNext({workflow:"person-lookup",workerId,now:NOW});assert.equal(claim.state,"claimed");if(claim.state!=="claimed")throw new Error("fixture claim failed");
 const validating=db.authority.runs.transition({runId,expectedVersion:claim.run.version,claim:{workerId,claimGeneration:1},lifecycle:{state:"validating",workerId,claimedAt:NOW,heartbeatAt:NOW},now:NOW});assert.equal(validating.state,"applied");if(validating.state!=="applied")throw new Error("fixture validation failed");
 const running=db.authority.runs.transition({runId,expectedVersion:validating.run.version,claim:{workerId,claimGeneration:1},lifecycle:{state:"running",workerId,claimedAt:NOW,heartbeatAt:NOW,currentNodeId:"searching"},now:NOW});assert.equal(running.state,"applied");if(running.state!=="applied")throw new Error("fixture run failed");
 return running.run;
 };
 const run=createRun(RUN_ID);
 return {root,path,clock,db,snapshot,run,createRun,dispose:()=>{db.close();profile.close();}};
}
export function failure(){return FailureRecordSchema.parse({failureId:id(80),fingerprint:HASH,runId:RUN_ID,traceId:QUEUED_RUN.envelope.traceId,attempt:1,workflowId:"person-lookup",code:"FIXTURE_FAILURE",summary:"Synthetic failure",transient:false,writeState:"unknown",action:{operation:"commit"},causeChain:[{code:"FIXTURE_FAILURE",summary:"Synthetic failure",role:"primary",transient:false}],remediation:[{kind:"no-safe-action",message:"Do not retry an unknown submit"}],occurredAt:NOW});}
export function update(n=1){return ArtifactOutboxStorageRecordSchema.parse({outboxId:id(n),artifactId:id(70),projectionId:"retention-row",stableKeyFingerprint:HASH,keyValues:[{field:"subject",value:"synthetic"}],sinkId:"xlsx-retention",sourceRunId:RUN_ID,sourceNodeId:"searching",state:"pending",payload:{schemaHash:HASH,value:`retained-${n}`},createdAt:NOW});}

export function terminalizeFixtureFailure(f:ReturnType<typeof foundationFixture>,run:ReturnType<typeof foundationFixture>["run"],recordInput:z.input<typeof FailureRecordSchema>){
 const record=FailureRecordSchema.parse(recordInput);
 if(run.lifecycle.state!=="running")throw new Error("fixture is not running");
 return f.db.terminalizeFailure(personLookupDescriptor,{failure:record,authorization:{kind:"failed",runId:run.envelope.runId,workflowId:run.envelope.workflow,attempt:run.envelope.attempt,descriptorVersion:run.envelope.descriptorVersion,contractFingerprint:run.envelope.contractFingerprint,expectedVersion:run.version,claim:{workerId:run.lifecycle.workerId,claimGeneration:run.claimGeneration},authorizedAt:NOW,failureId:record.failureId}});
}
