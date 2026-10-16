import { createSubjectTitleTestWorld } from "../../../support/helpers/backend/subject-title-world.js";
import { testAdmittedWorker } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { fenceWriteFixture } from "../../../support/helpers/write-fence-fixture.js";
import { default as assert } from 'node:assert/strict';
import { join as join_m0 } from "node:path";
import { it } from "vitest";
import { createOperatorProjection, createOperatorRunDetail } from '../../../../src/backend/app/composition/dashboard/operator.js';
import { RunRecordService } from '../../../../src/backend/runs/lifecycle/run-record-service.js';
import { buildRunDetail } from '../../../../src/backend/runs/queries/run-detail.js';
import { queryActivitySummaries, queryQueueSummaries } from '../../../../src/backend/runs/queries/run-summaries.js';
import { createTimelineEmitter } from '../../../../src/backend/storage/events/timeline-emitter.js';
import { createTransactionHistory } from '../../../../src/backend/storage/sqlite/transaction-history.js';
import { admitDirectWorker } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { RunRecordSchema } from '../../../../src/models/run/record.js';
import { SearchPersonOrgOutputSchema } from '../../../../src/models/systems/ucpath/search-person-org.js';
import { deriveSchemaHash } from '../../../../src/models/validation/schema-bound-value.js';
import { RunCheckpointRecordSchema } from '../../../../src/models/workflow/checkpoint.js';
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { workflowProjections } from "../../../../src/workflow-kit/workflow.js";
import { foundationFixture, HASH, id, NOW } from '../../../support/helpers/database-foundation/fixtures.js';
import { personLookupDescriptor } from '../../../support/helpers/registered-workflows.js';

import { activityReportCsv } from "../../../../src/backend/runs/queries/activity-export.js";

import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { summaryFixture } from "../../../support/helpers/backend/served-database-surfaces-fixtures.js";

import readXlsxFile from "read-excel-file/node";

import { composeOperatorXlsxWorkbook } from "../../../../src/backend/runs/exports/operator-xlsx-workbook.js";

import { ledgerCommitFixture } from "../../../support/fixtures/ledger-projection-fixtures.js";
import { failure as failure_m3, terminalizeFixtureFailure } from "../../../support/helpers/database-foundation/fixtures.js";

import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";
import { atomicWriteCheckpoint } from "../../../support/helpers/timeline-write-fixture.js";

import { RUN_SESSION } from "../../../support/fixtures/phase1f-run-fixtures.js";

import { DatabaseSync } from "node:sqlite";
import { describe } from "vitest";
import { queryRunSummarySource } from "../../../../src/backend/runs/queries/run-summaries.js";
import { activityDatePartAtInstant } from "../../../../src/models/dashboard/activity-volume.js";

import { runtimeTimeZone } from "../../../../src/rules/time/clock.js";
import { makeWorld, receiptWithWarningsOf } from "../../../support/helpers/backend/dashboard-harness.js";

{

it("keeps the resolved subject and operator label distinct in the derived summary day", () => {
const f = foundationFixture();
const { descriptor: subjectDescriptor } = createSubjectTitleTestWorld();
try {
  const runId = id(720);
  f.db.authority.runs.enqueue(RunRecordSchema.parse({ ...f.run,
    envelope: { ...f.run.envelope, runId, itemId: runId, enqueuedAt: NOW,
      descriptorVersion: subjectDescriptor.version, contractFingerprint: subjectDescriptor.contractFingerprint },
    input: { ...f.run.input, raw: { emplId: '10000000' },
      parsed: { ...f.run.input.parsed, value: { emplId: '10000000', keepNonHdh: false, includeCrmDates: false }, protectedBindings: [] } },
    lifecycle: { state: 'queued' }, claimGeneration: 0, version: 1, createdAt: NOW, updatedAt: NOW,
  }));
  const workerId=f.db.withAuthorityTransaction(repositories=>{
    const pool=repositories.workerPools.get("person-lookup");assert.ok(pool);
    const slot=admitDirectWorker(repositories,{commandId:id(717),workflow:"person-lookup",poolIndex:2,
      expectedPoolVersion:pool.version,processId:process.pid,processAcquisitionId:id(718),authorityPath:f.path,
      processLockRoot:join_m0(f.root,"locks"),now:NOW},id(719));
    assert.equal(repositories.workerLeases.start({workerId:slot.workerId,workflow:"person-lookup",
      browserSystems:workflowProjections(personLookupDescriptor).systems,processId:process.pid,requestedBy:"local-operator",now:NOW}).state,"started");
    return slot.workerId;
  });
  const claim = f.db.authority.runs.claimNext({ workflow: 'person-lookup', workerId, now: NOW });
  assert.equal(claim.state, 'claimed');
  if (claim.state !== 'claimed') throw new Error('fixture-not-claimed');
  assert.equal(claim.run.envelope.runId, runId);
  const validating = f.db.authority.runs.transition({ runId, expectedVersion: claim.run.version,
    claim: { workerId, claimGeneration: 1 },
    lifecycle: { state: 'validating', workerId, claimedAt: NOW, heartbeatAt: NOW }, now: NOW });
  assert.equal(validating.state, 'applied');
  if (validating.state !== 'applied') throw new Error('fixture-not-validating');
  const running = f.db.authority.runs.transition({ runId, expectedVersion: validating.run.version,
    claim: { workerId, claimGeneration: 1 },
    lifecycle: { state: 'running', workerId, claimedAt: NOW, heartbeatAt: NOW, currentNodeId: 'searching' }, now: NOW });
  assert.equal(running.state, 'applied');
  if (running.state !== 'applied') throw new Error('fixture-not-running');
  const e = running.run.envelope;
  createTimelineEmitter({ repository: f.db.authority.timelineEvents, clock: f.clock, pid: 4242, uuid: () => id(722) }).emit({
    t: 'run.queued', kind: 'run', ts: NOW, workflow: e.workflow, runId, attempt: e.attempt,
    traceId: e.traceId, spanPath: e.traceId, itemId: e.itemId, shape: e.shape, priority: e.priority,
    dryRun: e.dryRun, actorId: 'local-operator', title: 'Synthetic ingress title',
    descriptorVersion: e.descriptorVersion, contractFingerprint: e.contractFingerprint,
    resolvedInstance: e.resolvedInstance, configFingerprint: e.configFingerprint, configSnapshotId: e.configSnapshotId,
  });
  const reader = new RunRecordService({ database: f.db, clock: f.clock, ids: { uuid: () => id(723) }, publishQueued: () => {} });
  const ledger = createTransactionHistory(f.db.authority);
  const descriptors = { resolve: (workflow: string) => workflow === 'person-lookup' ? subjectDescriptor : undefined };
  const servedReader: Parameters<typeof createOperatorProjection>[0]["reader"] = { read: reader.read.bind(reader), list: reader.list.bind(reader),
    summaries: { withSnapshot: work => f.db.withAuthorityReadSnapshot(work),
      queue: query => queryQueueSummaries(f.db, query),
      activity: (from, to) => queryActivitySummaries(f.db, { from, to, generatedAt: NOW }, { ledger, descriptors }) },
  };
  const projection = createOperatorProjection({ database: f.db, stateRoot: f.root, clock: f.clock,
    appVersion: '0.1.0', descriptorSetHash: FingerprintSchema.parse(HASH), ledger, descriptors, reader: servedReader });
  projection.rebuildFromTimeline();
  assert.equal(projection.health().state, 'live');

  const detailDeps = { ...createOperatorRunDetail({ database: f.db, stateRoot: f.root, projection, runReader: reader }), descriptors };
  const observe = (stage: string) => {
    const canonical = projection.queueSurface(runId);
    servedReader.list = () => { throw new Error('whole-history-read-forbidden'); };
    const served = projection.buildDashboardDayWire('2026-09-09').queueSurfaces.find(r => r.runId === runId);
    servedReader.list = reader.list.bind(reader);
    const detail = buildRunDetail(detailDeps, runId);
    assert.ok(canonical && served);
    return { stage, canonicalTitle: canonical.title, servedTitle: served.title,
      detailTitle: detail.header.title, canonicalDisplayName: canonical.displayName, servedDisplayName: served.displayName };
  };
  const before = observe('before-checkpoint');
  assert.equal(before.canonicalTitle, 'Synthetic ingress title');
  assert.equal(before.servedTitle, before.canonicalTitle);
  assert.equal(before.detailTitle, before.canonicalTitle);
  const selected = { emplId: '10000000', name: 'Synthetic Resolved Subject', department: 'Synthetic Department', jobTitle: 'Synthetic Role', employeeStatus: 'active', hrStatus: 'Active', startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "",
hdh: true };
  const value = SearchPersonOrgOutputSchema.parse({ results: [selected], selection: { status: 'resolved', selected, candidateEids: [selected.emplId] } });
  const checkpoint = RunCheckpointRecordSchema.parse({ workflowId: e.workflow, itemId: e.itemId, runId,
    nodeId: 'searching', attempt: e.attempt, claimGeneration: running.run.claimGeneration,
    output: { schemaHash: deriveSchemaHash(SearchPersonOrgOutputSchema, 'output'), value },
    descriptorVersion: subjectDescriptor.version, contractFingerprint: subjectDescriptor.contractFingerprint,
    implFingerprint: HASH, provenance: [], writtenAt: NOW });
  f.db.authority.runCheckpoints.insert(checkpoint);
  const resolved = observe('after-checkpoint');
  assert.equal(resolved.canonicalTitle, selected.name);
  assert.equal(resolved.servedTitle, selected.name);
  assert.equal(resolved.detailTitle, selected.name);
  const renamed = f.db.authority.runs.updatePresentation({ runId, expectedVersion: running.run.version, displayName: 'Synthetic Operator Rename', now: NOW });
  assert.equal(renamed.state, 'applied');
  const afterRename = observe('after-rename');
  assert.equal(afterRename.canonicalTitle, selected.name);
  assert.equal(afterRename.servedTitle, selected.name);
  assert.equal(afterRename.detailTitle, 'Synthetic Operator Rename');
  assert.deepEqual(afterRename.canonicalDisplayName, { state: 'present', value: 'Synthetic Operator Rename' });
  assert.deepEqual(afterRename.servedDisplayName, afterRename.canonicalDisplayName);
} finally { f.dispose(); }
});
}

{

it("serializes only safe Queue facts and aggregate Activity values",()=>{
  const f=foundationFixture();try{

    const queue=queryQueueSummaries(f.db,{limit:10});
    const report=queryActivitySummaries(f.db,{from:"2026-09-09",to:"2026-09-09",generatedAt:f.run.createdAt},{descriptors:{resolve:()=>undefined},ledger:{foldActivityRange:()=>({systems:[]})}});
    const serialized=JSON.stringify({queue,report});
    for(const forbidden of ['"person":','"identity":','"sourceDigest":','"configFingerprint":'])assert.ok(!serialized.includes(forbidden));
    assert.deepEqual(report.people,{state:"present",distinct:0,evidenceRows:0});
  }finally{f.dispose();}
});
}

{

it("keeps JSON, CSV and XLSX write evidence through restart and terminal run deletion", async () => {
  const f = foundationFixture();
  let database = f.db;
  try {
    const run = f.run;
    const commit = ledgerCommitFixture(78, { runId: run.envelope.runId, workflowId: run.envelope.workflow,
      itemId: run.envelope.itemId, traceId: run.envelope.traceId, configFingerprint: run.envelope.configFingerprint, confirmedAt: NOW });
    assert.equal(fenceWriteFixture(database, { intent: commit.intent, attempt: commit.attempt }).state, "fenced");
    database.commitWriteAttempt(commit.commit, { ...atomicWriteCheckpoint(commit.commit),
      descriptorVersion: run.envelope.descriptorVersion, contractFingerprint: run.envelope.contractFingerprint });
    const read = () => {
      const db = database;
      const reader = new RunRecordService({ database: db, clock: f.clock, ids: { uuid: () => id(8850) }, publishQueued: () => {} });
      const ledger = createTransactionHistory(db.authority);
      const descriptors = { resolve: () => undefined };
      return createOperatorProjection({ database: db, stateRoot: f.root, clock: f.clock, appVersion: "0.1.0",
        descriptorSetHash: FingerprintSchema.parse("a".repeat(64)), ledger, descriptors,
        reader: { read: reader.read.bind(reader), list: reader.list.bind(reader),
          summaries: { withSnapshot: work => db.withAuthorityReadSnapshot(work), queue: query => queryQueueSummaries(db, query),
            activity: (from, to) => queryActivitySummaries(db, { from, to, generatedAt: NOW }, { ledger, descriptors }) } },
      }).buildActivityReportWire("2026-01-01", "2026-09-30");
    };

    const reader = new RunRecordService({ database, clock: f.clock, ids: { uuid: () => id(8850) }, publishQueued: () => {} });
    for (const terminal of [run]) {
      const cancelled = reader.transition({ commandId: id(8851), runId: terminal.envelope.runId,
        expectedVersion: terminal.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
      assert.equal(cancelled.state, "applied");
      if (cancelled.state !== "applied" || cancelled.run.lifecycle.state !== "running") throw new Error("cancellation fixture did not retain its worker claim");
      assert.equal(reader.terminalize({ commandId: id(8856), kind: "cancelled",
        runId: terminal.envelope.runId, expectedVersion: cancelled.run.version,
        claim: { workerId: cancelled.run.lifecycle.workerId, claimGeneration: cancelled.run.claimGeneration },
        endedAt: NOW }, personLookupDescriptor).state, "applied");
    }
    const before = read();
    const beforeGeneration = database.getMeta().authorityGeneration;
    assert.equal(before.totalRuns, 1);
    assert.equal(before.volume?.coveredRuns, before.totalRuns);
    assert.equal(before.volume?.buckets.reduce((total, bucket) => total + bucket.runs, 0), before.totalRuns);
    assert.equal(before.ledger.systems[0]?.entries, 1);
    database.close();
    database = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "summary-export-reopen" }, f.clock);
    const reopenedReader = new RunRecordService({ database, clock: f.clock, ids: { uuid: () => id(8852) }, publishQueued: () => {} });
    const retained = database.authority.runs.get(run.envelope.runId);
    assert.ok(retained);
    assert.equal(read().totalRuns, 1);
    assert.equal(reopenedReader.delete({ commandId: id(8853), runId: retained.envelope.runId,
      expectedVersion: retained.version }).state, "deleted");
    const after = read();
    const afterGeneration = database.getMeta().authorityGeneration;
    assert.equal(after.totalRuns, 0);
    assert.equal(after.volume?.coveredRuns, after.totalRuns);
    assert.equal(after.volume?.buckets.reduce((total, bucket) => total + bucket.runs, 0), after.totalRuns);
    assert.deepEqual(after.ledger, before.ledger);
    for (const { report, authorityGeneration } of [
      { report: before, authorityGeneration: beforeGeneration },
      { report: after, authorityGeneration: afterGeneration },
    ]) {
      const csv = activityReportCsv(report);
      const workbook = await composeOperatorXlsxWorkbook({ selection: { kind: "activity", snapshot: {
        from: report.from, to: report.to, generatedAt: report.generatedAt,
        sourceIdentity: database.getSourceDatabaseIdentity(), totalRuns: report.totalRuns,
        authorityGeneration, reportDigest: sha256Hex(canonicalJsonStringify(report)),
      } }, report });
      const sheets = await readXlsxFile(workbook.bytes);
      assert.deepEqual(sheets.find(sheet => sheet.sheet === "Ledger")?.data.slice(1), [["ucpath", 1, 1, 0]]);
      assert.match(csv, /ucpath,1,1,0/);
      const text = JSON.stringify({ report, csv, cells: sheets });
      for (const secret of [String(commit.intent.idempotencyKey), String(commit.intent.idempotencyKeyDigest)]) assert.equal(text.includes(secret), false);
    }
    assert.deepEqual(read().ledger, before.ledger);
    database.close();
    database = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "summary-delete-reopen" }, f.clock);
    assert.equal(read().totalRuns, 0);
    assert.deepEqual(read().ledger, before.ledger);
  } finally { database.close(); f.dispose(); }
});

it("keeps deterministic cursor ties, day/status/workflow/system membership and canonical stale-action refusal", () => {
  const f = summaryFixture();
  try {
    const ids = [id(8860), id(8861), id(8862), id(8863)];
    f.db.withAuthorityTransaction(() => ids.forEach((runId, n) => f.db.authority.runs.enqueue(RunRecordSchema.parse({ ...f.run,
      envelope: { ...f.run.envelope, runId, itemId: runId, enqueuedAt: n === 3 ? "2026-09-08T12:00:00.000Z" : NOW },
      lifecycle: { state: "queued" }, version: 1, claimGeneration: 0, createdAt: n === 3 ? "2026-09-08T12:00:00.000Z" : NOW, updatedAt: NOW }))));
    f.servedReader.list = () => { throw new Error("selected-page-read-history"); };
    const selected = f.projection.buildDashboardDayWire("2026-09-09");
    assert.deepEqual(selected.queueSurfaces.map(row => row.runId), ids.slice(0, 3));
    assert.equal(selected.monthCounts.find(day => day.day === "2026-09-08")?.count, 1);
    assert.equal(selected.workflowCounts.find(row => row.workflowId === "person-lookup")?.count, 3);
    assert.equal(selected.queueSurfaces.filter(row => row.status === "queued" && row.workflowId === "person-lookup"
      && row.resolvedInstances.some(instance => instance.system === "ucpath")).length, 3);
    assert.equal(selected.queueSurfaces.filter(row => row.resolvedInstances.some(instance => String(instance.system) === "unknown-system")).length, 0);
    let after: { localDay: string; runId: string } | undefined;
    const seen: string[] = [];
    do {
      const page = queryQueueSummaries(f.db, { workflow: "person-lookup", fromDay: "2026-09-09", toDay: "2026-09-09", status: "queued", limit: 1, ...(after === undefined ? {} : { after }) });
      seen.push(...page.items.map(row => row.runId)); after = page.next ?? undefined;
    } while (after !== undefined);
    assert.deepEqual(seen, ids.slice(0, 3));
    assert.deepEqual(queryQueueSummaries(f.db, { workflow: "other-workflow", limit: 1 }).items, []);
    const row = selected.queueSurfaces[0];
    assert.equal(f.reader.transition({ commandId: id(8865), runId: row.runId, expectedVersion: row.rowRevision,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } }).state, "applied");
    const generation = f.db.getMeta().authorityGeneration;
    assert.deepEqual(f.reader.transition({ commandId: id(8866), runId: row.runId, expectedVersion: row.rowRevision,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } }), { state: "refused", refusal: { reason: "conflict", currentVersion: row.rowRevision + 1 } });
    assert.equal(f.db.getMeta().authorityGeneration, generation);
    const refreshed = f.projection.buildDashboardDayWire("2026-09-09");
    assert.equal(refreshed.queueSurfaces.find(item => item.runId === row.runId)?.status, "cancelled");
    assert.equal(refreshed.statusCounts.find(item => item.status === "queued")?.count, 2);
  } finally { f.dispose(); }
});
}

{

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
it("updates receipt facts exactly once and cancellation filtering uses the same current snapshot",()=>{
  const f=foundationFixture();try{
    const run=f.run;
    const failed = failure_m3();
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
}

{

it("pages stable ties over real summary partitions, without whole-source reads",()=>{
  const f=foundationFixture();try {
    f.db.withAuthorityTransaction(()=>{for(let n=0;n<12;n++)f.db.authority.runs.enqueue(RunRecordSchema.parse({...f.run,
      envelope:{...f.run.envelope,runId:id(3000+n),itemId:id(3000+n)},lifecycle:{state:"queued"},version:1,claimGeneration:0}));});
    f.db.readRunSummaries=()=>{throw new Error("whole-reader-forbidden");};
    const seen:string[]=[];let after:{localDay:string;runId:string}|undefined;
    do{const page=queryQueueSummaries(f.db,{limit:3,...(after===undefined?{}:{after})});seen.push(...page.items.map(row=>row.runId));after=page.next??undefined;}while(after!==undefined);
    assert.equal(seen.length,13);assert.equal(new Set(seen).size,13);assert.deepEqual(seen,[...seen].sort());
    assert.throws(()=>queryQueueSummaries(f.db,{limit:3,fromDay:"2026-09-10",toDay:"2026-09-09"}),/range-invalid/);
    const raw=new DatabaseSync(f.path,{readOnly:true});try{
      const plan=raw.prepare("EXPLAIN QUERY PLAN SELECT * FROM runs INDEXED BY runs_day_idx WHERE workflow=? AND local_day>=? AND local_day<=? AND state=? ORDER BY local_day,id LIMIT ?").all("person-lookup","2026-09-09","2026-09-09","queued",4);
      assert.match(JSON.stringify(plan),/USING INDEX/);
      assert.doesNotMatch(JSON.stringify(plan),/SCAN runs/);
      assert.deepEqual(plan.map(row=>row.detail),[
        "SEARCH runs USING INDEX runs_day_idx (local_day>? AND local_day<?)",
        "USE TEMP B-TREE FOR LAST TERM OF ORDER BY",
      ]);
    }finally{raw.close();}
  }finally{f.dispose();}
});

it("agrees with independent expected totals and the retained Activity projector on identical live authority",()=>{
  const f=foundationFixture(),world=makeWorld();try{
    for(let n=0;n<4;n++)f.db.authority.runs.enqueue(RunRecordSchema.parse({...f.run,
      envelope:{...f.run.envelope,runId:id(3100+n),itemId:id(3100+n),enqueuedAt:n===3?"2025-01-01T12:00:00.000Z":NOW},
      lifecycle:{state:"queued"},version:1,claimGeneration:0,createdAt:n===3?"2025-01-01T12:00:00.000Z":NOW}));
    const terminal=f.db.authority.runs.get(id(3100));assert.ok(terminal);
    f.db.authority.runs.transition({runId:terminal.envelope.runId,expectedVersion:terminal.version,lifecycle:{state:"terminal",outcome:"cancelled",endedAt:"2026-09-09T12:00:05.000Z"},now:"2026-09-09T12:00:05.000Z"});

    for(const row of f.db.readRunSummaries()) {const run=f.db.authority.runs.get(row.runId);assert.ok(run);world.authority.put(run);}
    const expected=world.projection.buildActivityReportWire("2026-09-09","2026-09-09");
    const actual=queryActivitySummaries(f.db,{from:"2026-09-09",to:"2026-09-09",generatedAt:expected.generatedAt},{descriptors:{resolve:()=>undefined},ledger:{foldActivityRange:()=>expected.ledger},timeZone:runtimeTimeZone()});
    assert.equal(actual.totalRuns,3);assert.equal(actual.terminalRuns,1);assert.equal(actual.durations.totalMs,5000);
    const {volume,...reportWithoutVolume}=actual;
    assert.deepEqual(reportWithoutVolume,expected);
    assert.ok(volume);
    assert.equal(volume.state,"complete");assert.equal(volume.coveredRuns,3);
    assert.equal(volume.buckets.reduce((sum,bucket)=>sum+bucket.runs,0),actual.totalRuns);
  }finally{world.dispose();f.dispose();}
});

it("bins the enqueue instant and refuses a timezone mismatch before an indexed day bound can hide a run",()=>{
  const f=foundationFixture();try{
    const enqueuedAt="2026-09-09T07:20:00.000Z";
    const queued=RunRecordSchema.parse({...f.run,
      envelope:{...f.run.envelope,runId:id(3200),itemId:id(3200),enqueuedAt},
      lifecycle:{state:"queued"},version:1,claimGeneration:0,createdAt:enqueuedAt,updatedAt:enqueuedAt});
    f.db.authority.runs.enqueue(queued);
    const claimTime="2026-09-09T08:20:00.000Z";
    const {workerId,workerLifetime}=testAdmittedWorker(f.db,f.clock,{path:f.path,workflow:"person-lookup",poolIndex:2,browserSystems:["ucpath","crm"]});
    const claim=f.db.authority.runs.claimNext({workflow:"person-lookup",workerId,workerLifetime,now:claimTime});
    assert.equal(claim.state,"claimed");

    const timeZone=runtimeTimeZone(),day=activityDatePartAtInstant(enqueuedAt,timeZone);
    const report=queryActivitySummaries(f.db,{from:day,to:day,generatedAt:NOW},{descriptors:{resolve:()=>undefined},ledger:{foldActivityRange:()=>({systems:[]})},timeZone});
    const enqueueBucket=report.volume?.buckets.find(bucket=>Date.parse(bucket.start)<=Date.parse(enqueuedAt)&&Date.parse(enqueuedAt)<Date.parse(bucket.endExclusive));
    assert.equal(enqueueBucket?.runs,1);
    const claimBucket=report.volume?.buckets.find(bucket=>Date.parse(bucket.start)<=Date.parse(claimTime)&&Date.parse(claimTime)<Date.parse(bucket.endExclusive));
    assert.equal(claimBucket?.runs,0);
    assert.equal(report.volume?.coveredRuns,report.totalRuns);
    const mismatchTimeZone=activityDatePartAtInstant(enqueuedAt,"Etc/GMT+12")!==day?"Etc/GMT+12":"Pacific/Kiritimati";
    const mismatchDay=activityDatePartAtInstant(enqueuedAt,mismatchTimeZone);
    assert.notEqual(mismatchDay,day);
    assert.throws(()=>queryActivitySummaries(f.db,{from:mismatchDay,to:mismatchDay,generatedAt:NOW},
      {descriptors:{resolve:()=>undefined},ledger:{foldActivityRange:()=>({systems:[]})},timeZone:mismatchTimeZone}),
    /activity-summary-local-day-time-zone-mismatch/u);
  }finally{f.dispose();}
});

it("folds real summary rows into inclusive DST-day boundaries, distinct repeated hours, and known-zero days",()=>{
  const f=foundationFixture();try{
    const zone="America/Los_Angeles";
    const enqueuedAt=[
      "2026-03-08T07:59:59.000Z",
      "2026-03-08T08:00:00.000Z",
      "2026-03-08T08:30:00.000Z",
      "2026-03-08T09:30:00.000Z",
      "2026-03-08T10:30:00.000Z",
      "2026-03-09T07:00:00.000Z",
      "2026-11-01T07:00:00.000Z",
      "2026-11-01T08:30:00.000Z",
      "2026-11-01T09:30:00.000Z",
      "2026-11-01T10:30:00.000Z",
      "2026-11-02T08:00:00.000Z",
    ];
    for(const [index,at] of enqueuedAt.entries()) {
      const queued=RunRecordSchema.parse({...f.run,
        envelope:{...f.run.envelope,runId:id(3300+index),itemId:id(3300+index),enqueuedAt:at},
        lifecycle:{state:"queued"},version:1,claimGeneration:0,createdAt:at,updatedAt:at});
      f.db.authority.runs.enqueue(queued);
    }

    const read=(day:string)=>queryActivitySummaries(f.db,{from:day,to:day,generatedAt:NOW},
      {descriptors:{resolve:()=>undefined},ledger:{foldActivityRange:()=>({systems:[]})},timeZone:zone});

    const spring=read("2026-03-08");
    assert.equal(spring.totalRuns,4);
    assert.equal(spring.volume?.granularity,"hourly");
    assert.equal(spring.volume?.buckets.length,23);
    assert.equal(spring.volume?.coveredRuns,spring.totalRuns);
    assert.equal(spring.volume?.buckets.find(bucket=>bucket.start==="2026-03-08T00:00:00.000-08:00")?.runs,2);
    assert.equal(spring.volume?.buckets.find(bucket=>bucket.start==="2026-03-08T01:00:00.000-08:00")?.runs,1);
    assert.equal(spring.volume?.buckets.find(bucket=>bucket.start==="2026-03-08T03:00:00.000-07:00")?.runs,1);
    assert.ok(!spring.volume?.buckets.some(bucket=>bucket.start.startsWith("2026-03-08T02:")));

    const fall=read("2026-11-01");
    const repeated=fall.volume?.buckets.filter(bucket=>bucket.start.startsWith("2026-11-01T01:00:00"))??[];
    assert.equal(fall.totalRuns,4);
    assert.equal(fall.volume?.buckets.length,25);
    assert.equal(fall.volume?.coveredRuns,fall.totalRuns);
    assert.deepEqual(repeated.map(bucket=>[bucket.start,bucket.runs]),[
      ["2026-11-01T01:00:00.000-07:00",1],
      ["2026-11-01T01:00:00.000-08:00",1],
    ]);

    const nextDay=read("2026-03-09");
    assert.equal(nextDay.totalRuns,1);
    assert.equal(nextDay.volume?.buckets.find(bucket=>bucket.start==="2026-03-09T00:00:00.000-07:00")?.runs,1);

    const knownZero=read("2026-03-10");
    assert.equal(knownZero.totalRuns,0);
    assert.equal(knownZero.volume?.state,"complete");
    assert.equal(knownZero.volume?.coveredRuns,0);
    assert.ok(knownZero.volume?.buckets.every(bucket=>bucket.runs===0));
  }finally{f.dispose();}
});

it("keeps the minimum supported date inside its indexed candidate range",()=>{
  const f=foundationFixture();try{
    const report=queryActivitySummaries(f.db,{from:"0000-02-29",to:"0000-02-29",generatedAt:NOW},
      {descriptors:{resolve:()=>undefined},ledger:{foldActivityRange:()=>({systems:[]})},timeZone:"UTC"});
    assert.equal(report.totalRuns,0);
    assert.equal(report.volume?.interval.start,"0000-02-29T00:00:00.000+00:00");
    assert.equal(report.volume?.interval.endExclusive,"0000-03-01T00:00:00.000+00:00");
  }finally{f.dispose();}
});
}

{

const semanticRows=(rows:ReturnType<AuthorityDatabase["readRunSummaries"]>)=>rows.map(({sourceGeneration,...row})=>{void sourceGeneration;return row;});

describe("native summary snapshots and transaction hooks", () => {
  it("derives new runs atomically and rolls failed mutations back", () => {
    const fixture = foundationFixture();
    try {
      assert.equal(fixture.db.readRunSummaries().length,1);
      const before = fixture.db.readRunSummaries();
      const generation=fixture.db.getMeta().authorityGeneration;
      assert.throws(() => fixture.db.withAuthorityTransaction(() => {
        fixture.createRun(id(601));
        throw new Error("injected-lifecycle-rollback");
      }), /injected-lifecycle-rollback/u);
      assert.deepEqual(fixture.db.readRunSummaries(), before);
      assert.equal(fixture.db.getMeta().authorityGeneration,generation);
      fixture.createRun(id(602));
      const after = fixture.db.readRunSummaries();
      assert.equal(after.length, 2);
      assert.deepEqual(semanticRows(after.filter(row=>row.runId===before[0].runId)),semanticRows(before));
      assert.ok(after.every(row=>row.sourceGeneration===fixture.db.getMeta().authorityGeneration));
      assert.ok(after.every(row=>row.person.state==="unavailable"));
      assert.equal(fixture.db.authority.workerSlots.list("person-lookup").length,2);
    } finally { fixture.dispose(); }
  });

  it("notices resolution annotations without replacing immutable UNKNOWN failure evidence", () => {
    const f = foundationFixture();
    try {
      const record = failure_m3();terminalizeFixtureFailure(f,f.run,record);
      const before=f.db.authority.failures.get(record.failureId);
      assert.ok(before);
      const beforeSummary=f.db.readRunSummaries()[0];assert.ok(beforeSummary);
      f.db.authority.failureResolution.update({ runId:record.runId,failureId:record.failureId,expectedVersion:1,
        resolution:{status:"resolved",version:2,by:"local-operator",at:NOW} });
      const afterSummary=f.db.readRunSummaries()[0];assert.ok(afterSummary);
      assert.equal(afterSummary.resolution?.status,"resolved");
      assert.notEqual(afterSummary.sourceDigest,beforeSummary.sourceDigest);
      assert.deepEqual(f.db.authority.failures.get(record.failureId),before);
      assert.equal(before.writeState,"unknown");
    } finally { f.dispose(); }
  });
});

it("reads a consistent admitted snapshot across an independent writer and refuses corrupt run mirrors after restart",()=>{
  const f=foundationFixture();let peer:AuthorityDatabase|undefined;
  try{
    peer=AuthorityDatabase.open({path:f.path,busyTimeoutMs:500,migrationOwner:"summary-peer"},f.clock);
    const before=f.db.readRunSummaries();
    f.db.withAuthorityReadSnapshot(()=>{
      assert.deepEqual(f.db.readRunSummaries(),before);
      peer?.authority.runs.updatePresentation({runId:f.run.envelope.runId,expectedVersion:f.run.version,displayName:"Concurrent title",now:NOW});
      assert.deepEqual(f.db.readRunSummaries(),before);
    });
    assert.equal(f.db.readRunSummaries()[0].title,"Concurrent title");
    assert.ok(f.db.readRunSummaries()[0].sourceGeneration>before[0].sourceGeneration);
    peer.close();peer=undefined;
    const raw=new DatabaseSync(f.path);try{raw.prepare("UPDATE runs SET version=version+1 WHERE id=?").run(f.run.envelope.runId);}finally{raw.close();}
    assert.throws(()=>AuthorityDatabase.open({path:f.path,busyTimeoutMs:500,migrationOwner:"summary-restart"},f.clock),/run row version does not match its whole-record JSON/u);
  }finally{peer?.close();f.dispose();}
});

it("keeps unrelated source facts unchanged, rolls nested mutations back and pages through the real query port",()=>{
  const f=foundationFixture();
  try {
    const before=f.db.readRunSummaries(),pool=f.db.authority.workerPools.get("person-lookup");assert.ok(pool);
    const beforeGeneration=f.db.getMeta().authorityGeneration;
    const planned=f.db.authority.workerPools.plan({workflow:"person-lookup",expectedVersion:pool.version,desiredWorkers:pool.desiredWorkers,requestedBy:"local-operator",now:NOW});
    assert.equal(planned.state,"applied");
    const afterPlan=f.db.readRunSummaries(),afterGeneration=f.db.getMeta().authorityGeneration;
    assert.ok(afterGeneration>beforeGeneration);
    assert.ok(afterPlan.every(row=>row.sourceGeneration===afterGeneration));
    assert.deepEqual(semanticRows(afterPlan),semanticRows(before));
    f.db.withAuthorityTransaction(()=>{
      assert.throws(()=>f.db.withAuthorityTransaction(()=>{f.createRun(id(810));throw new Error("savepoint-rollback");}),/savepoint-rollback/u);
      f.createRun(id(811));
    });
    assert.equal(f.db.authority.runs.get(id(810)),undefined);
    assert.deepEqual(semanticRows(f.db.readRunSummaries().filter(row=>row.runId===before[0].runId)),semanticRows(before));
    const read=f.db.readRunSummaries.bind(f.db);f.db.readRunSummaries=()=>{throw new Error("whole-reader-forbidden");};
    try {
      const first=queryRunSummarySource(f.db,{workflow:"person-lookup",limit:1});
      assert.equal(first.items.length,1);assert.ok(first.next);
      const second=queryRunSummarySource(f.db,{workflow:"person-lookup",limit:1,after:first.next});
      assert.equal(second.items.length,1);assert.equal(second.next,null);
      assert.notEqual(first.items[0].runId,second.items[0].runId);
      assert.deepEqual(f.db.summaryWorkflows(),["person-lookup"]);
    }finally{f.db.readRunSummaries=read;}
  }finally{f.dispose();}
});
}
