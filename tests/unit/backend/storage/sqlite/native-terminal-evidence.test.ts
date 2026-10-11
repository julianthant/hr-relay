import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import { foundationFixture as baseFoundationFixture, failure, terminalizeFixtureFailure, NOW, id } from "../../../../support/helpers/database-foundation/fixtures.js";
import { AuthorityDatabase } from "../../../../support/helpers/synthetic-storage-admission.js";
import { sqliteRunReader } from "../../../../support/helpers/canonical-run-reader.js";
import { personLookupDescriptor } from "../../../../support/helpers/registered-workflows.js";
import { sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { RunRecordService } from "../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createReceiptService } from "../../../../../src/backend/runs/trust/receipt-service.js";
import { terminalEvidenceResult, deriveTerminalFailureDigest, RunResultRecordSchema, deriveRunResultDigest } from "../../../../../src/models/run/result.js";
import { canonicalJsonStringify } from "../../../../../src/rules/validation/canonical-json.js";

import { PersonLookupCanonicalInput } from "../../../../../src/workflows/person-lookup/workflow.js";
import { deriveSchemaHash } from "../../../../../src/models/validation/schema-bound-value.js";
import { RunRecordSchema } from "../../../../../src/models/run/record.js";
import { QUEUED_RUN } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { SearchPersonOrg } from "../../../../../src/models/systems/ucpath/search-person-org.js";
import { resolveOperationSource } from "../../../../../src/backend/runs/queries/operation-source.js";
import { resolutionFixture, resolutionReadDeps } from "../../../../support/helpers/failure-resolution/fixtures.js";
function foundationFixture(){return baseFoundationFixture({input:RunRecordSchema.shape.input.parse({...QUEUED_RUN.input,parsed:{
  schemaHash:deriveSchemaHash(PersonLookupCanonicalInput,"output"),value:{emplId:"10873698",keepNonHdh:false,includeCrmDates:false},
  protectedBindings:[{kind:"test-data-local",inputPath:"emplId",name:"personLookupCanaryEid",sourceId:id(89)}],
}})});}

function cancellation(f: ReturnType<typeof foundationFixture>) {
  const service = new RunRecordService({ database: f.db, clock: f.clock, ids: sequentialIdFactory(), publishQueued: () => {} });
  assert.equal(service.transition({commandId:id(180),runId:f.run.envelope.runId,expectedVersion:f.run.version,
    lifecycle:{state:"terminal",outcome:"cancelled",endedAt:NOW}}).state,"applied");
  const run=f.db.authority.runs.get(f.run.envelope.runId);assert.ok(run);assert.ok(run.cancelRequested);
  if(run.lifecycle.state!=="running")throw new Error("cancellation did not retain the held claim");
  const request={kind:"cancelled",commandId:id(181),runId:run.envelope.runId,expectedVersion:run.version,
    claim:{workerId:run.lifecycle.workerId,claimGeneration:run.claimGeneration},endedAt:NOW};
  return {service,request};
}
function rawState(path:string) {
  const db=new DatabaseSync(path,{readOnly:true});try{return canonicalJsonStringify(["runs","run_failures","run_results","run_receipts","commands","command_audits","timeline_events"].map(table=>db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()));}finally{db.close();}
}
function trust(db:AuthorityDatabase,f:ReturnType<typeof foundationFixture>){return createReceiptService({database:db,
  runReader:sqliteRunReader(db,f.clock),descriptors:[personLookupDescriptor]});}

describe("same-attempt native recovery",()=>{
  it("releases the genuine primitive owner atomically without changing its immutable attempt",()=>{
    const f=foundationFixture();try{
      assert.ok(f.run.lifecycle.state==="running");
      const claim={workerId:f.run.lifecycle.workerId,claimGeneration:f.run.claimGeneration};
      const request={runId:f.run.envelope.runId,expectedVersion:f.run.version,claim,cause:"recovery",now:NOW};
      const before=rawState(f.path);
      assert.throws(()=>f.db.withAuthorityTransaction(()=>{assert.equal(f.db.authority.runs.requeue(request).state,"applied");throw new Error("primitive-release-fault");}),/primitive-release-fault/u);
      assert.equal(rawState(f.path),before);
      const release=f.db.authority.runs.requeue(request);assert.equal(release.state,"applied");
      if(release.state!=="applied")throw new Error("primitive release refused");
      assert.deepEqual(release.run.envelope,f.run.envelope);assert.deepEqual(release.run.input,f.run.input);
      assert.equal(release.run.version,f.run.version+1);assert.equal(release.run.claimGeneration,f.run.claimGeneration);
      assert.equal(release.run.lifecycle.state,"queued");
      const next=f.db.authority.runs.claimNext({workflow:f.run.envelope.workflow,workerId:claim.workerId,now:NOW});assert.equal(next.state,"claimed");
      if(next.state!=="claimed")throw new Error("primitive release not claimable");
      assert.deepEqual(next.run.envelope,f.run.envelope);assert.equal(next.run.claimGeneration,claim.claimGeneration+1);
      const claimedBytes=rawState(f.path);
      assert.deepEqual(f.db.authority.runs.requeue({...request,expectedVersion:next.run.version}),{state:"conflict",currentVersion:next.run.version,currentState:next.run.lifecycle.state,message:`run ${request.runId} is no longer claimed by ${claim.workerId} at generation ${String(claim.claimGeneration)}`});
      assert.equal(rawState(f.path),claimedBytes);
    }finally{f.dispose();}
  });

  it("rolls release back, preserves immutable identity, reopens exact replay and fences the prior claim",()=>{
    const f=foundationFixture();try{
      assert.ok(f.run.lifecycle.state==="running");
      const claim={workerId:f.run.lifecycle.workerId,claimGeneration:f.run.claimGeneration};
      const request={commandId:id(190),runId:f.run.envelope.runId,expectedVersion:f.run.version,claim,cause:"recovery"};
      const service=new RunRecordService({database:f.db,clock:f.clock,ids:sequentialIdFactory(),publishQueued:()=>{}});
      const before=rawState(f.path);
      assert.throws(()=>f.db.withAuthorityTransaction(()=>{assert.equal(service.requeue(request).state,"applied");throw new Error("release-fault");}),/release-fault/u);
      assert.equal(rawState(f.path),before);
      assert.equal(service.requeue(request).state,"applied");
      const released=f.db.authority.runs.get(request.runId);assert.ok(released);
      assert.deepEqual(released.envelope,f.run.envelope);assert.deepEqual(released.input,f.run.input);
      assert.equal(released.claimGeneration,f.run.claimGeneration);assert.equal(released.lifecycle.state,"queued");
      const settled=rawState(f.path);assert.equal(service.requeue(request).state,"applied-already");assert.equal(rawState(f.path),settled);
      f.db.close();const reopened=AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"same-attempt-reopen"},f.clock);
      try{
        const replay=new RunRecordService({database:reopened,clock:f.clock,ids:sequentialIdFactory(),publishQueued:()=>{throw new Error("replayed queue publication");}});
        assert.equal(replay.requeue(request).state,"applied-already");assert.equal(rawState(f.path),settled);
        const claimed=reopened.authority.runs.claimNext({workflow:f.run.envelope.workflow,workerId:claim.workerId,now:NOW});assert.equal(claimed.state,"claimed");
        if(claimed.state!=="claimed")throw new Error("not reclaimed");
        assert.deepEqual(claimed.run.envelope,f.run.envelope);assert.equal(claimed.run.claimGeneration,claim.claimGeneration+1);
        const fenced=reopened.authority.runs.requeue({runId:request.runId,expectedVersion:claimed.run.version,claim,cause:"recovery",now:NOW});assert.deepEqual(fenced,{state:"conflict",currentVersion:claimed.run.version,currentState:claimed.run.lifecycle.state,message:`run ${request.runId} is no longer claimed by ${claim.workerId} at generation ${String(claim.claimGeneration)}`});
        assert.deepEqual(reopened.authority.runs.get(request.runId),claimed.run);
      }finally{reopened.close();}
    }finally{f.dispose();}
  });
});

describe("truthful immutable final evidence",()=>{
  it("binds failed evidence to the exact failure and genuine authorization, reopens and replays without effects",()=>{
    const f=foundationFixture();try{
      const report=terminalizeFixtureFailure(f,f.run,failure());
      const result=f.db.authority.runResults.get(f.run.envelope.runId);assert.ok(result);
      assert.deepEqual(terminalEvidenceResult(result),{kind:"failed-evidence",authorization:report.authorization,failureDigest:deriveTerminalFailureDigest(failure())});
      assert.deepEqual(result.dependencies,[]);assert.equal(result.operationSources,undefined);
      const receipt=trust(f.db,f).ensureReceipt(result.runId);assert.deepEqual(receipt.output,[]);
      const before=rawState(f.path);assert.equal(terminalizeFixtureFailure(f,f.run,failure()).state,"replayed");assert.equal(rawState(f.path),before);
      f.db.close();const reopened=AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"terminal-reopen"},f.clock);
      try{assert.deepEqual(reopened.authority.runResults.get(result.runId),result);assert.deepEqual(trust(reopened,f).ensureReceipt(result.runId),receipt);assert.equal(rawState(f.path),before);}finally{reopened.close();}
    }finally{f.dispose();}
  });
  it("rolls failure, evidence and run back together after result creation",()=>{
    const f=foundationFixture();try{const before=rawState(f.path);
      assert.throws(()=>f.db.withAuthorityTransaction(()=>{terminalizeFixtureFailure(f,f.run,failure());assert.ok(f.db.authority.runResults.get(f.run.envelope.runId));throw new Error("after-terminal-result");}),/after-terminal-result/u);
      assert.equal(rawState(f.path),before);assert.equal(f.db.authority.runResults.get(f.run.envelope.runId),undefined);
    }finally{f.dispose();}
  });
  it("owns genuine cancellation evidence with its command/audit, rollback and exact reopen replay",()=>{
    const f=foundationFixture();try{const {service,request}=cancellation(f);const before=rawState(f.path);
      assert.throws(()=>f.db.withAuthorityTransaction(()=>{assert.equal(service.terminalize(request,personLookupDescriptor).state,"applied");throw new Error("cancel-result-fault");}),/cancel-result-fault/u);assert.equal(rawState(f.path),before);
      assert.equal(service.terminalize(request,personLookupDescriptor).state,"applied");
      const result=f.db.authority.runResults.get(f.run.envelope.runId);assert.ok(result);
      const evidence=terminalEvidenceResult(result);assert.equal(evidence?.kind,"lifecycle-evidence");
      if(evidence?.kind!=="lifecycle-evidence")throw new Error("wrong cancellation owner");assert.equal(evidence.commandId,request.commandId);assert.equal(evidence.auditId,request.commandId);
      const receipt=trust(f.db,f).ensureReceipt(result.runId);assert.deepEqual(receipt.output,[]);
      const settled=rawState(f.path);assert.equal(service.terminalize(request,personLookupDescriptor).state,"applied-already");assert.equal(rawState(f.path),settled);
      f.db.close();const reopened=AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"terminal-reopen"},f.clock);
      try{const replay=new RunRecordService({database:reopened,clock:f.clock,ids:sequentialIdFactory(),publishQueued:()=>{throw new Error("unexpected publication");}});
        assert.equal(replay.terminalize(request,personLookupDescriptor).state,"applied-already");assert.deepEqual(trust(reopened,f).ensureReceipt(result.runId),receipt);assert.equal(rawState(f.path),settled);
      }finally{reopened.close();}
    }finally{f.dispose();}
  });
  it.each(["cancelled","discarded","superseded"] as const)("owns final unclaimed %s evidence without worker success authorization",outcome=>{
    const f=foundationFixture();try{
      const queued={...QUEUED_RUN,input:f.run.input,envelope:{...QUEUED_RUN.envelope,
        configSnapshotId:f.run.envelope.configSnapshotId,configFingerprint:f.run.envelope.configFingerprint,
        contractFingerprint:f.run.envelope.contractFingerprint,runId:id(220),itemId:id(220)}};
      f.db.authority.runs.enqueue(queued);
      const service=new RunRecordService({database:f.db,clock:f.clock,ids:sequentialIdFactory(),publishQueued:()=>{}});
      const request={commandId:id(221),runId:queued.envelope.runId,expectedVersion:queued.version,lifecycle:{state:"terminal",outcome,endedAt:NOW}};
      assert.equal(service.transition(request).state,"applied");
      const result=f.db.authority.runResults.get(queued.envelope.runId);assert.ok(result);
      assert.equal(terminalEvidenceResult(result)?.kind,"lifecycle-evidence");
      assert.equal(f.db.authority.runs.get(result.runId)?.completion,undefined);
      const receipt=trust(f.db,f).ensureReceipt(result.runId);assert.deepEqual(receipt.output,[]);
      const before=rawState(f.path);assert.equal(service.transition(request).state,"applied-already");assert.equal(rawState(f.path),before);
    }finally{f.dispose();}
  });
  it("settles admitted cancellation through recovery with the genuine requeue audit",()=>{
    const f=foundationFixture();try{const {service,request}=cancellation(f);
      const recovery={commandId:id(182),runId:request.runId,expectedVersion:request.expectedVersion,claim:request.claim,cause:"recovery"};
      assert.equal(service.requeue(recovery).state,"applied");
      const result=f.db.authority.runResults.get(request.runId);assert.ok(result);assert.equal(terminalEvidenceResult(result)?.kind,"lifecycle-evidence");
      assert.deepEqual(trust(f.db,f).ensureReceipt(request.runId).output,[]);
      const before=rawState(f.path);assert.equal(service.requeue(recovery).state,"applied-already");assert.equal(rawState(f.path),before);
    }finally{f.dispose();}
  });
  it("journals each actual cascade member and root with immutable cancellation evidence",()=>{
    const f=foundationFixture();try{
      const parent=RunRecordSchema.parse({...QUEUED_RUN,input:f.run.input,envelope:{...QUEUED_RUN.envelope,
        configSnapshotId:f.run.envelope.configSnapshotId,configFingerprint:f.run.envelope.configFingerprint,
        contractFingerprint:f.run.envelope.contractFingerprint,runId:id(230),itemId:id(230),shape:"operation"}});
      const child=RunRecordSchema.parse({...parent,envelope:{...parent.envelope,runId:id(231),itemId:id(231),shape:"operation-member",
        parent:{runId:parent.envelope.runId,tracePrefix:parent.envelope.traceId,edgeId:"synthetic-child"}}});
      f.db.authority.runs.enqueue(parent);f.db.authority.runs.enqueue(child);
      const service=new RunRecordService({database:f.db,clock:f.clock,ids:sequentialIdFactory(),publishQueued:()=>{}});
      const request={commandId:id(232),runId:parent.envelope.runId,expectedVersion:parent.version,lifecycle:{state:"terminal",outcome:"cancelled",endedAt:NOW}};
      assert.equal(service.transition(request).state,"applied");
      const owners=[parent,child].map(run=>{const record=f.db.authority.runResults.get(run.envelope.runId);assert.ok(record);
        const evidence=terminalEvidenceResult(record);assert.equal(evidence?.kind,"lifecycle-evidence");
        if(evidence?.kind!=="lifecycle-evidence")throw new Error("missing member owner");
        assert.ok(f.db.authority.lifecycleJournal.getCommand(evidence.commandId));assert.ok(f.db.authority.lifecycleJournal.findAuditByCommand(evidence.commandId));
        return evidence.commandId;});
      assert.notEqual(owners[0],owners[1]);
      const before=rawState(f.path);assert.equal(service.transition(request).state,"applied-already");assert.equal(rawState(f.path),before);
    }finally{f.dispose();}
  });
  it("keeps failed owner action-source reads truthful without inventing successful result lineage",()=>{
    const f=resolutionFixture();try{
      const deps=resolutionReadDeps(f);assert.ok(deps.runReader);
      const run=f.db.authority.runs.get(f.record.runId);assert.ok(run);assert.ok(f.db.authority.runResults.get(f.record.runId));
      const canonical={reader:deps.runReader,database:f.db,descriptors:{resolve:()=>personLookupDescriptor}};
      const identity={runId:run.envelope.runId,definitionFingerprint:run.envelope.contractFingerprint,nodeId:"searching",taskId:SearchPersonOrg.id,
        attempt:run.envelope.attempt,claimGeneration:run.claimGeneration,taskAttempt:1,invocationId:"synthetic-read",
        occurrencePath:["synthetic-read"],logicalActionId:"read-result",occurrence:1,logicalSessionId:"synthetic-session",state:"failed"};
      const before=rawState(f.path);
      assert.deepEqual(resolveOperationSource({...deps,canonical,stateRoot:f.root},run.envelope.runId,{identity}),
        {state:"unavailable",reason:"exact-occurrence-not-retained"});
      assert.throws(()=>resolveOperationSource({...deps,canonical,stateRoot:f.root},run.envelope.runId,{identity:{...identity,runId:id(999)}}),/operation-source-run-unavailable/u);
      assert.equal(rawState(f.path),before);
    }finally{f.dispose();}
  });
  it("refuses a partial audited failed settlement without repairing or repeating it",()=>{
    const f=foundationFixture();try{
      if(f.run.lifecycle.state!=="running")throw new Error("missing admitted claim");
      const service=new RunRecordService({database:f.db,clock:f.clock,ids:sequentialIdFactory(),publishQueued:()=>{}});
      const request={kind:"failure",commandId:id(240),terminal:{failure:failure(),authorization:{kind:"failed",runId:f.run.envelope.runId,
        workflowId:f.run.envelope.workflow,attempt:f.run.envelope.attempt,descriptorVersion:f.run.envelope.descriptorVersion,
        contractFingerprint:f.run.envelope.contractFingerprint,expectedVersion:f.run.version,
        claim:{workerId:f.run.lifecycle.workerId,claimGeneration:f.run.claimGeneration},authorizedAt:NOW,failureId:failure().failureId}}};
      assert.equal(service.terminalize(request,personLookupDescriptor).state,"applied");
      const settled=rawState(f.path);assert.equal(service.terminalize(request,personLookupDescriptor).state,"applied-already");assert.equal(rawState(f.path),settled);
      assert.equal(service.terminalize({...request,terminal:{...request.terminal,failure:{...failure(),summary:"divergent synthetic failure"}}},personLookupDescriptor).state,"refused");assert.equal(rawState(f.path),settled);
      const db=new DatabaseSync(f.path);try{const triggers=db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='run_results'").all();
        for(const row of triggers)db.exec(`DROP TRIGGER "${String(row.name).replaceAll('"','""')}"`);
        db.prepare("DELETE FROM run_results WHERE run_id=?").run(f.run.envelope.runId);for(const row of triggers)db.exec(String(row.sql));
      }finally{db.close();}
      const partial=rawState(f.path);assert.throws(()=>service.terminalize(request,personLookupDescriptor),/composite authority/u);assert.equal(rawState(f.path),partial);
      f.db.close();assert.throws(()=>AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"partial-terminal"},f.clock),/run-completion-consequences|final-runs-bind-result-owner/u);
    }finally{f.dispose();}
  });
  it("keeps interrupted recovery without immutable final evidence or receipt",()=>{
    const f=foundationFixture();try{
      if(f.run.lifecycle.state!=="running")throw new Error("missing held claim");
      assert.equal(f.db.authority.runs.transition({runId:f.run.envelope.runId,expectedVersion:f.run.version,
        claim:{workerId:f.run.lifecycle.workerId,claimGeneration:f.run.claimGeneration},
        lifecycle:{state:"terminal",outcome:"interrupted",endedAt:NOW},now:NOW}).state,"applied");
      assert.equal(f.db.authority.runResults.get(f.run.envelope.runId),undefined);
      assert.throws(()=>trust(f.db,f).ensureReceipt(f.run.envelope.runId),/ended interrupted/u);
      assert.equal(f.db.authority.evidenceReceipts.findByRun(f.run.envelope.runId),undefined);
    }finally{f.dispose();}
  });
  it("refuses corrupt result payload without exposing the stored private bytes",()=>{
    const f=foundationFixture();try{terminalizeFixtureFailure(f,f.run,failure());
      const db=new DatabaseSync(f.path);try{const triggers=db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='run_results'").all();
        for(const row of triggers)db.exec(`DROP TRIGGER "${String(row.name).replaceAll('"','""')}"`);
        db.prepare("UPDATE run_results SET payload_json=? WHERE run_id=?").run(canonicalJsonStringify({privateNote:"SYNTHETIC_PRIVATE_RESULT_INVALID_PAYLOAD"}),f.run.envelope.runId);
        for(const row of triggers)db.exec(String(row.sql));
      }finally{db.close();}
      assert.throws(()=>f.db.authority.runResults.get(f.run.envelope.runId),error=>error instanceof Error && error.message==="run-result-payload-invalid");
      f.db.close();assert.throws(()=>AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"private-result-refusal"},f.clock),error=>
        error instanceof Error && error.message.includes("run-result-payload-invalid") && !error.message.includes("SYNTHETIC_PRIVATE_RESULT"));
    }finally{f.dispose();}
  });
  it.each(["failure-digest","failure-identity","cancel-command"] as const)("refuses altered %s proof on read and reopen",kind=>{
    const f=foundationFixture();try{
      if(kind==="cancel-command"){const {service,request}=cancellation(f);service.terminalize(request,personLookupDescriptor);}else terminalizeFixtureFailure(f,f.run,failure());
      const result=f.db.authority.runResults.get(f.run.envelope.runId);assert.ok(result);const evidence=terminalEvidenceResult(result);assert.ok(evidence);
      const altered=kind==="cancel-command"?{...evidence,commandId:id(999)}:kind==="failure-digest"?{...evidence,failureDigest:"f".repeat(64)}:{...evidence,authorization:{...("authorization" in evidence?evidence.authorization:{}),failureId:id(999)}};
      const changed=RunResultRecordSchema.parse({...result,result:{...result.result,value:altered},resultDigest:deriveRunResultDigest({...result.result,value:altered})});
      const db=new DatabaseSync(f.path);try{const triggers=db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='run_results'").all();
        for(const row of triggers)db.exec(`DROP TRIGGER "${String(row.name).replaceAll('"','""')}"`);
        db.prepare("UPDATE run_results SET payload_json=?,result_digest=? WHERE run_id=?").run(canonicalJsonStringify(changed),changed.resultDigest,changed.runId);
        for(const row of triggers)db.exec(String(row.sql));
      }finally{db.close();}
      assert.throws(()=>f.db.authority.runResults.get(result.runId),/terminal-(?:failure-result|evidence-command-audit)/u);
      f.db.close();assert.throws(()=>AuthorityDatabase.open({path:f.path,busyTimeoutMs:250,migrationOwner:"terminal-refusal"},f.clock),/terminal-(?:failure-result|evidence-command-audit)/u);
    }finally{f.dispose();}
  });
});
