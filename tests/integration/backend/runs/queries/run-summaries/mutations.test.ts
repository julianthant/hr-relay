import assert from "node:assert/strict";
import { it } from "vitest";
import { foundationFixture,terminalizeFixtureFailure,failure,id,NOW } from "../../../../../support/helpers/database-foundation/fixtures.js";

it("reads current heartbeats and publishes creation and presentation atomically",()=>{
  const f=foundationFixture();try {
    const before=f.db.readRunSummaries();
    if(f.run.lifecycle.state!=="running")throw new Error("fixture-state");
    const renewed=f.db.authority.runs.renewClaim({runId:f.run.envelope.runId,claim:{workerId:f.run.lifecycle.workerId,claimGeneration:f.run.claimGeneration},now:"2026-09-09T12:00:01.000Z"});
    assert.equal(renewed.state,"renewed");assert.deepEqual(f.db.readRunSummaries(),before.map(row=>({...row,
      sourceGeneration:row.sourceGeneration+1,updatedAt:"2026-09-09T12:00:01.000Z",
      lifecycle:{...row.lifecycle,heartbeatAt:"2026-09-09T12:00:01.000Z"}})));
    f.db.withAuthorityTransaction(()=>{
      assert.throws(()=>f.db.withAuthorityTransaction(()=>{f.createRun(id(2001));throw new Error("nested");}),/nested/);
      f.createRun(id(2002));
    });
    assert.equal(f.db.readRunSummaries().length,2);
    assert.equal(f.db.authority.runs.get(id(2001)),undefined);
    const current=f.db.authority.runs.get(f.run.envelope.runId);assert.ok(current);
    const changed=f.db.authority.runs.updatePresentation({runId:current.envelope.runId,expectedVersion:current.version,displayName:"Synthetic renamed",now:NOW});
    assert.equal(changed.state,"applied");assert.equal(f.db.readRunSummaries().find(row=>row.runId===current.envelope.runId)?.title,"Synthetic renamed");
    const stable=f.db.readRunSummaries();
    assert.throws(()=>f.db.withAuthorityTransaction(()=>{f.db.authority.runs.updatePresentation({runId:current.envelope.runId,expectedVersion:current.version+1,displayName:"Rolled back",now:NOW});throw new Error("outer");}),/outer/);
    assert.deepEqual(f.db.readRunSummaries(),stable);
  }finally{f.dispose();}
});

import { RunRecordSchema } from "../../../../../../src/models/run/record.js";
import { queryQueueSummaries,queryActivitySummaries } from "../../../../../../src/backend/runs/queries/run-summaries.js";
import { RUN_SESSION } from "../../../../../support/fixtures/phase1f-run-fixtures.js";
it("maintains parent rollups and dependencies while batch grouping stays a bounded current relation",()=>{
  const f=foundationFixture();try{
    const batch={...RUN_SESSION,sessionId:id(5000),workflow:"person-lookup"};
    f.db.authority.runSessions.insert(batch);
    const parent=RunRecordSchema.parse({...f.run,envelope:{...f.run.envelope,runId:id(5001),itemId:id(5001),shape:"operation",enqueuedAt:NOW},sessionId:batch.sessionId,lifecycle:{state:"queued"},version:1,claimGeneration:0,createdAt:NOW,updatedAt:NOW});
    f.db.authority.runs.enqueue(parent);
    const child=RunRecordSchema.parse({...parent,envelope:{...parent.envelope,runId:id(5002),itemId:id(5002),shape:"operation-member",parent:{runId:parent.envelope.runId,tracePrefix:parent.envelope.traceId,edgeId:"member"}}});
    f.db.authority.runs.enqueue(child);
    const row=()=>f.db.readRunSummaries().find(row=>row.runId===parent.envelope.runId);
    assert.deepEqual(row()?.children,[{runId:child.envelope.runId,state:"queued",outcome:null}]);
    const policy={onChildFailed:"fail-parent",cascadeCancel:"cascade",afterChildRetry:"resume-parent",visibility:"inline"};
    f.db.withAuthorityTransaction(()=>{
      f.db.authority.delegationManifests.insert({manifestId:id(5003),parentRunId:parent.envelope.runId,edgeId:"member",inputSchemaHash:"a".repeat(64),resultSchemaHash:"a".repeat(64),cardinality:"one",join:"one",policy,children:[{dependencyId:id(5004),childRunId:child.envelope.runId,childItemId:child.envelope.itemId,canonicalInputFingerprint:"a".repeat(64)}],createdAt:NOW,manifestFingerprint:"a".repeat(64)});
      f.db.authority.dependencies.insert({dependencyId:id(5004),manifestId:id(5003),edgeId:"member",parentRunId:parent.envelope.runId,childRunId:child.envelope.runId,childItemId:child.envelope.itemId,policy,state:"active",version:1,createdAt:NOW,updatedAt:NOW});
    });
    assert.deepEqual(row()?.dependencyRunIds,[child.envelope.runId]);
    f.db.authority.runs.transition({runId:child.envelope.runId,expectedVersion:1,lifecycle:{state:"terminal",outcome:"cancelled",endedAt:NOW},now:NOW});
    assert.deepEqual(row()?.children,[{runId:child.envelope.runId,state:"terminal",outcome:"cancelled"}]);
    const query=()=>queryQueueSummaries(f.db,{limit:10,sessionId:batch.sessionId,topLevel:true});
    assert.equal(query().items.length,1);assert.equal(query().items[0].session?.groupInQueue,false);
    f.db.authority.runSessions.setGrouping(batch.sessionId,1,true);
    assert.equal(query().items[0].session?.groupInQueue,true);
    const report=queryActivitySummaries(f.db,{from:"2026-09-09",to:"2026-09-09",generatedAt:NOW},{descriptors:{resolve:()=>undefined},ledger:{foldActivityRange:()=>({systems:[]})}});
    assert.equal(report.totalRuns,1);assert.equal(report.terminalRuns,0);
  }finally{f.dispose();}
});

it("consumes relevant timeline cursors transactionally and exact replay does not rewrite",()=>{
  const f=foundationFixture();try{
    const run=f.run,envelope=run.envelope;
    const event={schemaVersion:1,eventId:id(5100),workflow:envelope.workflow,scope:{kind:"run",runId:envelope.runId},occurredAt:envelope.enqueuedAt,recordedAt:NOW,retentionDate:"2026-09-09",source:{kind:"native"},payload:{kind:"span",event:{t:"run.queued",kind:"run",pid:1,ts:envelope.enqueuedAt,workflow:envelope.workflow,runId:envelope.runId,attempt:envelope.attempt,traceId:envelope.traceId,spanPath:envelope.traceId,itemId:envelope.itemId,shape:envelope.shape,priority:envelope.priority,dryRun:envelope.dryRun,actorId:"local-operator",title:"Timeline title",descriptorVersion:envelope.descriptorVersion,contractFingerprint:envelope.contractFingerprint,resolvedInstance:envelope.resolvedInstance,configFingerprint:envelope.configFingerprint,configSnapshotId:envelope.configSnapshotId}}};
    f.db.authority.timelineEvents.append(event);
    const before=f.db.readRunSummaries();assert.equal(before[0].title,"Timeline title");assert.ok(before[0].sourceCursor>0);
    f.db.authority.timelineEvents.append(event);assert.deepEqual(f.db.readRunSummaries(),before);
    const claimed={t:"run.claimed",pid:1,ts:envelope.enqueuedAt,workflow:envelope.workflow,runId:envelope.runId,attempt:envelope.attempt,traceId:envelope.traceId,spanPath:envelope.traceId,workerId:run.lifecycle.state==="running"?run.lifecycle.workerId:"invalid"};
    assert.throws(()=>f.db.withAuthorityTransaction(()=>{f.db.authority.timelineEvents.append({...event,eventId:id(5101),payload:{kind:"span",event:claimed}});throw new Error("timeline-rollback");}),/timeline-rollback/);
    assert.deepEqual(f.db.readRunSummaries(),before);
  }finally{f.dispose();}
});

import { receiptWithWarningsOf } from "../../../../../support/helpers/backend/dashboard-harness.js";
it("updates receipt facts exactly once and cancellation filtering uses the same current snapshot",()=>{
  const f=foundationFixture();try{
    const run=f.run;
    const failed = failure();
    assert.equal(terminalizeFixtureFailure(f,run,failed).state,"applied");
    const receipt={...receiptWithWarningsOf({seed:640,summaries:["Synthetic warning"]}),runId:run.envelope.runId,traceId:run.envelope.traceId,attempt:run.envelope.attempt,workflowId:run.envelope.workflow,descriptorFingerprint:run.envelope.contractFingerprint,configFingerprint:run.envelope.configFingerprint,result:"failed",failure:{state:"present",value:failed.failureId}};
    f.db.authority.evidenceReceipts.insert(receipt);
    assert.equal(f.db.readRunSummaries()[0].warningCount,1);
    const before=f.db.readRunSummaries();f.db.authority.evidenceReceipts.insert(receipt);assert.deepEqual(f.db.readRunSummaries(),before);
    const active=f.createRun(id(641));
    const changed=f.db.authority.runs.requestCancellation({runId:active.envelope.runId,expectedVersion:active.version,now:NOW});assert.equal(changed.state,"applied");
    assert.equal(queryQueueSummaries(f.db,{limit:10,status:"running"}).items.length,0);
    const cancelling=queryQueueSummaries(f.db,{limit:10,status:"cancelling"});assert.equal(cancelling.items.length,1);assert.equal(cancelling.items[0].status,"cancelling");
  }finally{f.dispose();}
});
