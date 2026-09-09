import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";
import { manualClock } from "../../../src/domain/clock.js";
import { ConfigSchema } from "../../../src/domain/config/schema.js";
import { defaultRuntimePaths } from "../../../src/domain/config/runtime-paths.js";
import { ConfigSnapshotRecordSchema } from "../../../src/domain/config/snapshot.js";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import { sha256Hex } from "../../../src/domain/sha256.js";
import { FailureRecordSchema } from "../../../src/domain/trust/failure.js";
import { ArtifactOutboxStorageRecordSchema } from "../../../src/domain/generated-artifact.js";
import { QUEUED_RUN, RUN_ID, WORKER_ID } from "../../fixtures/phase1f-run-fixtures.js";
export const NOW="2026-09-09T12:00:00.000Z";
export const HASH="a".repeat(64);
export const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export function foundationFixture(){
 const root=mkdtempSync(join(tmpdir(),"foundation-baseline-"));const path=join(root,"state.db");const clock=manualClock(new Date(NOW));
 const db=AuthorityDatabase.open({path,busyTimeoutMs:250,migrationOwner:"foundation-proof"},clock);
 const config=ConfigSchema.parse({paths:defaultRuntimePaths()});
 const snapshot=ConfigSnapshotRecordSchema.parse({configSnapshotId:id(90),revision:1,fingerprint:sha256Hex(canonicalJsonStringify(config)),capturedAt:NOW,capturedBy:"local-operator",config,provenance:{}});
 db.authority.configSnapshots.insert(snapshot);
 db.authority.runs.enqueue({...QUEUED_RUN,envelope:{...QUEUED_RUN.envelope,configFingerprint:snapshot.fingerprint,configSnapshotId:snapshot.configSnapshotId}});
 const claim=db.authority.runs.claimNext({workflow:"person-lookup",workerId:WORKER_ID,now:NOW});assert.equal(claim.state,"claimed");if(claim.state!=="claimed")throw new Error("fixture claim failed");
 const validating=db.authority.runs.transition({runId:RUN_ID,expectedVersion:claim.run.version,claim:{workerId:WORKER_ID,claimGeneration:1},lifecycle:{state:"validating",workerId:WORKER_ID,claimedAt:NOW,heartbeatAt:NOW},now:NOW});assert.equal(validating.state,"applied");if(validating.state!=="applied")throw new Error("fixture validation failed");
 const running=db.authority.runs.transition({runId:RUN_ID,expectedVersion:validating.run.version,claim:{workerId:WORKER_ID,claimGeneration:1},lifecycle:{state:"running",workerId:WORKER_ID,claimedAt:NOW,heartbeatAt:NOW,currentNodeId:"searching"},now:NOW});assert.equal(running.state,"applied");if(running.state!=="applied")throw new Error("fixture run failed");
 return {root,path,clock,db,snapshot,run:running.run,dispose:()=>{db.close();rmSync(root,{recursive:true,force:true});}};
}
export function failure(){return FailureRecordSchema.parse({failureId:id(80),fingerprint:HASH,runId:RUN_ID,traceId:QUEUED_RUN.envelope.traceId,attempt:1,workflowId:"person-lookup",code:"FIXTURE_FAILURE",summary:"Synthetic failure",transient:false,writeState:"unknown",action:{operation:"commit"},causeChain:[{code:"FIXTURE_FAILURE",summary:"Synthetic failure",role:"primary",transient:false}],remediation:[{kind:"no-safe-action",message:"Do not retry an unknown submit"}],occurredAt:NOW});}
export function update(n=1){return ArtifactOutboxStorageRecordSchema.parse({outboxId:id(n),artifactId:id(70),projectionId:"retention-row",stableKeyFingerprint:HASH,keyValues:[{field:"subject",value:"synthetic"}],sinkId:"xlsx-retention",sourceRunId:RUN_ID,sourceNodeId:"searching",state:"pending",payload:{schemaHash:HASH,value:`retained-${n}`},createdAt:NOW});}
