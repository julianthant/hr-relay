import { default as assert_m0,default as assert_m1 } from 'node:assert/strict';
import { join as join_m0 } from "node:path";
import { it as it_m0,it as it_m1 } from "vitest";
import { createOperatorProjection as createOperatorProjection_m0,createOperatorRunDetail as createOperatorRunDetail_m0 } from '../../../../src/backend/app/composition/dashboard/operator.js';
import { RunRecordService as RunRecordService_m0 } from '../../../../src/backend/runs/lifecycle/run-record-service.js';
import { buildRunDetail as buildRunDetail_m0 } from '../../../../src/backend/runs/queries/run-detail.js';
import { queryActivitySummaries as queryActivitySummaries_m0,queryActivitySummaries as queryActivitySummaries_m1,queryQueueSummaries as queryQueueSummaries_m0,queryQueueSummaries as queryQueueSummaries_m1 } from '../../../../src/backend/runs/queries/run-summaries.js';
import { createTimelineEmitter as createTimelineEmitter_m0 } from '../../../../src/backend/storage/events/timeline-emitter.js';
import { createTransactionHistory as createTransactionHistory_m0 } from '../../../../src/backend/storage/sqlite/transaction-history.js';
import { admitDirectWorker as admitDirectWorker_m0 } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { RunRecordSchema as RunRecordSchema_m0 } from '../../../../src/models/run/record.js';
import { SearchPersonOrgOutputSchema as SearchPersonOrgOutputSchema_m0 } from '../../../../src/models/systems/ucpath/search-person-org.js';
import { deriveSchemaHash as deriveSchemaHash_m0 } from '../../../../src/models/validation/schema-bound-value.js';
import { RunCheckpointRecordSchema as RunCheckpointRecordSchema_m0 } from '../../../../src/models/workflow/checkpoint.js';
import { FingerprintSchema as FingerprintSchema_m0 } from "../../../../src/rules/identity/ids.js";
import { workflowProjections as workflowProjections_m0 } from "../../../../src/workflow-kit/workflow.js";
import { foundationFixture as foundationFixture_m0,foundationFixture as foundationFixture_m1,HASH as HASH_m0,id as id_m0,NOW as NOW_m0 } from '../../../support/helpers/database-foundation/fixtures.js';
import { personLookupDescriptor as personLookupDescriptor_m0 } from '../../../support/helpers/registered-workflows.js';

import assert_m2 from "node:assert/strict";
import { it as it_m2 } from "vitest";
import { activityReportCsv as activityReportCsv_m2 } from "../../../../src/backend/runs/queries/activity-export.js";
import { RunRecordSchema as RunRecordSchema_m2 } from "../../../../src/models/run/record.js";
import { FingerprintSchema as FingerprintSchema_m2 } from "../../../../src/rules/identity/ids.js";
import { canonicalJsonStringify as canonicalJsonStringify_m2 } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex as sha256Hex_m2 } from "../../../../src/rules/validation/sha256.js";
import { summaryFixture as summaryFixture_m2 } from "../../../support/helpers/backend/served-database-surfaces-fixtures.js";
import { id as id_m2,NOW as NOW_m2 } from "../../../support/helpers/database-foundation/fixtures.js";

import assert_m3 from "node:assert/strict";
import readXlsxFile_m2 from "read-excel-file/node";
import { it as it_m3 } from "vitest";
import { createOperatorProjection as createOperatorProjection_m2 } from "../../../../src/backend/app/composition/dashboard/operator.js";
import { composeOperatorXlsxWorkbook as composeOperatorXlsxWorkbook_m2 } from "../../../../src/backend/runs/exports/operator-xlsx-workbook.js";
import { RunRecordService as RunRecordService_m2 } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { queryActivitySummaries as queryActivitySummaries_m2,queryQueueSummaries as queryQueueSummaries_m2 } from "../../../../src/backend/runs/queries/run-summaries.js";
import { createTransactionHistory as createTransactionHistory_m2 } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { ledgerCommitFixture as ledgerCommitFixture_m2 } from "../../../support/fixtures/ledger-projection-fixtures.js";
import { failure as failure_m3,foundationFixture as foundationFixture_m2,foundationFixture as foundationFixture_m3,id as id_m3,NOW as NOW_m3,terminalizeFixtureFailure as terminalizeFixtureFailure_m3 } from "../../../support/helpers/database-foundation/fixtures.js";
import { personLookupDescriptor as personLookupDescriptor_m2 } from "../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase as AuthorityDatabase_m2 } from "../../../support/helpers/synthetic-storage-admission.js";
import { atomicWriteCheckpoint as atomicWriteCheckpoint_m2 } from "../../../support/helpers/timeline-write-fixture.js";

import { queryActivitySummaries as queryActivitySummaries_m3,queryQueueSummaries as queryQueueSummaries_m3 } from "../../../../src/backend/runs/queries/run-summaries.js";
import { RunRecordSchema as RunRecordSchema_m3 } from "../../../../src/models/run/record.js";
import { RUN_SESSION as RUN_SESSION_m3 } from "../../../support/fixtures/phase1f-run-fixtures.js";

import { default as assert_m4,default as assert_m5 } from "node:assert/strict";
import { DatabaseSync as DatabaseSync_m4,DatabaseSync as DatabaseSync_m5 } from "node:sqlite";
import { describe as describe_m5,it as it_m4,it as it_m5 } from "vitest";
import { queryActivitySummaries as queryActivitySummaries_m4,queryQueueSummaries as queryQueueSummaries_m4,queryRunSummarySource as queryRunSummarySource_m5 } from "../../../../src/backend/runs/queries/run-summaries.js";
import { activityDatePartAtInstant as activityDatePartAtInstant_m4 } from "../../../../src/models/dashboard/activity-volume.js";
import { RunRecordSchema as RunRecordSchema_m4 } from "../../../../src/models/run/record.js";
import { runtimeTimeZone as runtimeTimeZone_m4 } from "../../../../src/rules/time/clock.js";
import { makeWorld as makeWorld_m4,receiptWithWarningsOf as receiptWithWarningsOf_m3 } from "../../../support/helpers/backend/dashboard-harness.js";
import { failure as failure_m5,foundationFixture as foundationFixture_m4,foundationFixture as foundationFixture_m5,id as id_m4,id as id_m5,NOW as NOW_m4,NOW as NOW_m5,terminalizeFixtureFailure as terminalizeFixtureFailure_m5 } from "../../../support/helpers/database-foundation/fixtures.js";
import { AuthorityDatabase as AuthorityDatabase_m5 } from "../../../support/helpers/synthetic-storage-admission.js";


{


it_m0("keeps the resolved subject and operator label distinct in the derived summary day", () => {
const f = foundationFixture_m0();
try {
  const runId = id_m0(720);
  f.db.authority.runs.enqueue(RunRecordSchema_m0.parse({ ...f.run,
    envelope: { ...f.run.envelope, runId, itemId: runId, enqueuedAt: NOW_m0 },
    input: { ...f.run.input, raw: { emplId: '10000000' },
      parsed: { ...f.run.input.parsed, value: { emplId: '10000000', keepNonHdh: false, includeCrmDates: false }, protectedBindings: [] } },
    lifecycle: { state: 'queued' }, claimGeneration: 0, version: 1, createdAt: NOW_m0, updatedAt: NOW_m0,
  }));
  const workerId=f.db.withAuthorityTransaction(repositories=>{
    const pool=repositories.workerPools.get("person-lookup");assert_m0.ok(pool);
    const slot=admitDirectWorker_m0(repositories,{commandId:id_m0(717),workflow:"person-lookup",poolIndex:2,
      expectedPoolVersion:pool.version,processId:process.pid,processAcquisitionId:id_m0(718),authorityPath:f.path,
      processLockRoot:join_m0(f.root,"locks"),now:NOW_m0},id_m0(719));
    assert_m0.equal(repositories.workerLeases.start({workerId:slot.workerId,workflow:"person-lookup",
      browserSystems:workflowProjections_m0(personLookupDescriptor_m0).systems,processId:process.pid,requestedBy:"local-operator",now:NOW_m0}).state,"started");
    return slot.workerId;
  });
  const claim = f.db.authority.runs.claimNext({ workflow: 'person-lookup', workerId, now: NOW_m0 });
  assert_m0.equal(claim.state, 'claimed');
  if (claim.state !== 'claimed') throw new Error('fixture-not-claimed');
  assert_m0.equal(claim.run.envelope.runId, runId);
  const validating = f.db.authority.runs.transition({ runId, expectedVersion: claim.run.version,
    claim: { workerId, claimGeneration: 1 },
    lifecycle: { state: 'validating', workerId, claimedAt: NOW_m0, heartbeatAt: NOW_m0 }, now: NOW_m0 });
  assert_m0.equal(validating.state, 'applied');
  if (validating.state !== 'applied') throw new Error('fixture-not-validating');
  const running = f.db.authority.runs.transition({ runId, expectedVersion: validating.run.version,
    claim: { workerId, claimGeneration: 1 },
    lifecycle: { state: 'running', workerId, claimedAt: NOW_m0, heartbeatAt: NOW_m0, currentNodeId: 'searching' }, now: NOW_m0 });
  assert_m0.equal(running.state, 'applied');
  if (running.state !== 'applied') throw new Error('fixture-not-running');
  const e = running.run.envelope;
  createTimelineEmitter_m0({ repository: f.db.authority.timelineEvents, clock: f.clock, pid: 4242, uuid: () => id_m0(722) }).emit({
    t: 'run.queued', kind: 'run', ts: NOW_m0, workflow: e.workflow, runId, attempt: e.attempt,
    traceId: e.traceId, spanPath: e.traceId, itemId: e.itemId, shape: e.shape, priority: e.priority,
    dryRun: e.dryRun, actorId: 'local-operator', title: 'Synthetic ingress title',
    descriptorVersion: e.descriptorVersion, contractFingerprint: e.contractFingerprint,
    resolvedInstance: e.resolvedInstance, configFingerprint: e.configFingerprint, configSnapshotId: e.configSnapshotId,
  });
  const reader = new RunRecordService_m0({ database: f.db, clock: f.clock, ids: { uuid: () => id_m0(723) }, publishQueued: () => {} });
  const ledger = createTransactionHistory_m0(f.db.authority);
  const descriptors = { resolve: (workflow: string) => workflow === 'person-lookup' ? personLookupDescriptor_m0 : undefined };
  const servedReader: Parameters<typeof createOperatorProjection_m0>[0]["reader"] = { read: reader.read.bind(reader), list: reader.list.bind(reader),
    summaries: { withSnapshot: work => f.db.withAuthorityReadSnapshot(work),
      queue: query => queryQueueSummaries_m0(f.db, query),
      activity: (from, to) => queryActivitySummaries_m0(f.db, { from, to, generatedAt: NOW_m0 }, { ledger, descriptors }) },
  };
  const projection = createOperatorProjection_m0({ database: f.db, stateRoot: f.root, clock: f.clock,
    appVersion: '0.1.0', descriptorSetHash: FingerprintSchema_m0.parse(HASH_m0), ledger, descriptors, reader: servedReader });
  projection.rebuildFromTimeline();
  assert_m0.equal(projection.health().state, 'live');

  const detailDeps = createOperatorRunDetail_m0({ database: f.db, stateRoot: f.root, projection, runReader: reader });
  const observe = (stage: string) => {
    const canonical = projection.queueSurface(runId);
    servedReader.list = () => { throw new Error('whole-history-read-forbidden'); };
    const served = projection.buildDashboardDayWire('2026-09-09').queueSurfaces.find(r => r.runId === runId);
    servedReader.list = reader.list.bind(reader);
    const detail = buildRunDetail_m0(detailDeps, runId);
    assert_m0.ok(canonical && served);
    return { stage, canonicalTitle: canonical.title, servedTitle: served.title,
      detailTitle: detail.header.title, canonicalDisplayName: canonical.displayName, servedDisplayName: served.displayName };
  };
  const before = observe('before-checkpoint');
  assert_m0.equal(before.canonicalTitle, 'Synthetic ingress title');
  assert_m0.equal(before.servedTitle, before.canonicalTitle);
  assert_m0.equal(before.detailTitle, before.canonicalTitle);
  const selected = { emplId: '10000000', name: 'Synthetic Resolved Subject', department: 'Synthetic Department', jobTitle: 'Synthetic Role', employeeStatus: 'active', hdh: true };
  const value = SearchPersonOrgOutputSchema_m0.parse({ results: [selected], selection: { status: 'resolved', selected, candidateEids: [selected.emplId] } });
  const checkpoint = RunCheckpointRecordSchema_m0.parse({ workflowId: e.workflow, itemId: e.itemId, runId,
    nodeId: 'searching', attempt: e.attempt, claimGeneration: running.run.claimGeneration,
    output: { schemaHash: deriveSchemaHash_m0(SearchPersonOrgOutputSchema_m0, 'output'), value },
    descriptorVersion: personLookupDescriptor_m0.version, contractFingerprint: personLookupDescriptor_m0.contractFingerprint,
    implFingerprint: HASH_m0, provenance: [], writtenAt: NOW_m0 });
  f.db.authority.runCheckpoints.insert(checkpoint);
  const resolved = observe('after-checkpoint');
  assert_m0.equal(resolved.canonicalTitle, selected.name);
  assert_m0.equal(resolved.servedTitle, selected.name);
  assert_m0.equal(resolved.detailTitle, selected.name);
  const renamed = f.db.authority.runs.updatePresentation({ runId, expectedVersion: running.run.version, displayName: 'Synthetic Operator Rename', now: NOW_m0 });
  assert_m0.equal(renamed.state, 'applied');
  const afterRename = observe('after-rename');
  assert_m0.equal(afterRename.canonicalTitle, selected.name);
  assert_m0.equal(afterRename.servedTitle, selected.name);
  assert_m0.equal(afterRename.detailTitle, 'Synthetic Operator Rename');
  assert_m0.deepEqual(afterRename.canonicalDisplayName, { state: 'present', value: 'Synthetic Operator Rename' });
  assert_m0.deepEqual(afterRename.servedDisplayName, afterRename.canonicalDisplayName);
} finally { f.dispose(); }
});
}

{

it_m1("serializes only safe Queue facts and aggregate Activity values",()=>{
  const f=foundationFixture_m1();try{

    const queue=queryQueueSummaries_m1(f.db,{limit:10});
    const report=queryActivitySummaries_m1(f.db,{from:"2026-09-09",to:"2026-09-09",generatedAt:f.run.createdAt},{descriptors:{resolve:()=>undefined},ledger:{foldActivityRange:()=>({systems:[]})}});
    const serialized=JSON.stringify({queue,report});
    for(const forbidden of ['"person":','"identity":','"sourceDigest":','"configFingerprint":'])assert_m1.ok(!serialized.includes(forbidden));
    assert_m1.deepEqual(report.people,{state:"present",distinct:0,evidenceRows:0});
  }finally{f.dispose();}
});
}

{


it_m2("keeps JSON, CSV and XLSX write evidence through restart and terminal run deletion", async () => {
  const f = foundationFixture_m2();
  let database = f.db;
  try {
    const run = f.run;
    const commit = ledgerCommitFixture_m2(78, { runId: run.envelope.runId, workflowId: run.envelope.workflow,
      itemId: run.envelope.itemId, traceId: run.envelope.traceId, configFingerprint: run.envelope.configFingerprint, confirmedAt: NOW_m2 });
    assert_m2.equal(database.authority.writeIntents.fenceAttempt({ intent: commit.intent, attempt: commit.attempt }).state, "fenced");
    database.commitWriteAttempt(commit.commit, { ...atomicWriteCheckpoint_m2(commit.commit),
      descriptorVersion: run.envelope.descriptorVersion, contractFingerprint: run.envelope.contractFingerprint });
    const read = () => {
      const db = database;
      const reader = new RunRecordService_m2({ database: db, clock: f.clock, ids: { uuid: () => id_m2(8850) }, publishQueued: () => {} });
      const ledger = createTransactionHistory_m2(db.authority);
      const descriptors = { resolve: () => undefined };
      return createOperatorProjection_m2({ database: db, stateRoot: f.root, clock: f.clock, appVersion: "0.1.0",
        descriptorSetHash: FingerprintSchema_m2.parse("a".repeat(64)), ledger, descriptors,
        reader: { read: reader.read.bind(reader), list: reader.list.bind(reader),
          summaries: { withSnapshot: work => db.withAuthorityReadSnapshot(work), queue: query => queryQueueSummaries_m2(db, query),
            activity: (from, to) => queryActivitySummaries_m2(db, { from, to, generatedAt: NOW_m2 }, { ledger, descriptors }) } },
      }).buildActivityReportWire("2026-01-01", "2026-09-30");
    };

    const reader = new RunRecordService_m2({ database, clock: f.clock, ids: { uuid: () => id_m2(8850) }, publishQueued: () => {} });
    for (const terminal of [run]) {
      const cancelled = reader.transition({ commandId: id_m2(8851), runId: terminal.envelope.runId,
        expectedVersion: terminal.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW_m2 } });
      assert_m2.equal(cancelled.state, "applied");
      if (cancelled.state !== "applied" || cancelled.run.lifecycle.state !== "running") throw new Error("cancellation fixture did not retain its worker claim");
      assert_m2.equal(reader.terminalize({ commandId: id_m2(8856), kind: "cancelled",
        runId: terminal.envelope.runId, expectedVersion: cancelled.run.version,
        claim: { workerId: cancelled.run.lifecycle.workerId, claimGeneration: cancelled.run.claimGeneration },
        endedAt: NOW_m2 }, personLookupDescriptor_m2).state, "applied");
    }
    const before = read();
    const beforeGeneration = database.getMeta().authorityGeneration;
    assert_m2.equal(before.totalRuns, 1);
    assert_m2.equal(before.volume?.coveredRuns, before.totalRuns);
    assert_m2.equal(before.volume?.buckets.reduce((total, bucket) => total + bucket.runs, 0), before.totalRuns);
    assert_m2.equal(before.ledger.systems[0]?.entries, 1);
    database.close();
    database = AuthorityDatabase_m2.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "summary-export-reopen" }, f.clock);
    const reopenedReader = new RunRecordService_m2({ database, clock: f.clock, ids: { uuid: () => id_m2(8852) }, publishQueued: () => {} });
    const retained = database.authority.runs.get(run.envelope.runId);
    assert_m2.ok(retained);
    assert_m2.equal(read().totalRuns, 1);
    assert_m2.equal(reopenedReader.delete({ commandId: id_m2(8853), runId: retained.envelope.runId,
      expectedVersion: retained.version }).state, "deleted");
    const after = read();
    const afterGeneration = database.getMeta().authorityGeneration;
    assert_m2.equal(after.totalRuns, 0);
    assert_m2.equal(after.volume?.coveredRuns, after.totalRuns);
    assert_m2.equal(after.volume?.buckets.reduce((total, bucket) => total + bucket.runs, 0), after.totalRuns);
    assert_m2.deepEqual(after.ledger, before.ledger);
    for (const { report, authorityGeneration } of [
      { report: before, authorityGeneration: beforeGeneration },
      { report: after, authorityGeneration: afterGeneration },
    ]) {
      const csv = activityReportCsv_m2(report);
      const workbook = await composeOperatorXlsxWorkbook_m2({ selection: { kind: "activity", snapshot: {
        from: report.from, to: report.to, generatedAt: report.generatedAt,
        sourceIdentity: database.getSourceDatabaseIdentity(), totalRuns: report.totalRuns,
        authorityGeneration, reportDigest: sha256Hex_m2(canonicalJsonStringify_m2(report)),
      } }, report });
      const sheets = await readXlsxFile_m2(workbook.bytes);
      assert_m2.deepEqual(sheets.find(sheet => sheet.sheet === "Ledger")?.data.slice(1), [["ucpath", 1, 1, 0]]);
      assert_m2.match(csv, /ucpath,1,1,0/);
      const text = JSON.stringify({ report, csv, cells: sheets });
      for (const secret of [String(commit.intent.idempotencyKey), String(commit.intent.idempotencyKeyDigest)]) assert_m2.equal(text.includes(secret), false);
    }
    assert_m2.deepEqual(read().ledger, before.ledger);
    database.close();
    database = AuthorityDatabase_m2.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "summary-delete-reopen" }, f.clock);
    assert_m2.equal(read().totalRuns, 0);
    assert_m2.deepEqual(read().ledger, before.ledger);
  } finally { database.close(); f.dispose(); }
});

it_m2("keeps deterministic cursor ties, day/status/workflow/system membership and canonical stale-action refusal", () => {
  const f = summaryFixture_m2();
  try {
    const ids = [id_m2(8860), id_m2(8861), id_m2(8862), id_m2(8863)];
    f.db.withAuthorityTransaction(() => ids.forEach((runId, n) => f.db.authority.runs.enqueue(RunRecordSchema_m2.parse({ ...f.run,
      envelope: { ...f.run.envelope, runId, itemId: runId, enqueuedAt: n === 3 ? "2026-09-08T12:00:00.000Z" : NOW_m2 },
      lifecycle: { state: "queued" }, version: 1, claimGeneration: 0, createdAt: n === 3 ? "2026-09-08T12:00:00.000Z" : NOW_m2, updatedAt: NOW_m2 }))));
    f.servedReader.list = () => { throw new Error("selected-page-read-history"); };
    const selected = f.projection.buildDashboardDayWire("2026-09-09");
    assert_m2.deepEqual(selected.queueSurfaces.map(row => row.runId), ids.slice(0, 3));
    assert_m2.equal(selected.monthCounts.find(day => day.day === "2026-09-08")?.count, 1);
    assert_m2.equal(selected.workflowCounts.find(row => row.workflowId === "person-lookup")?.count, 3);
    assert_m2.equal(selected.queueSurfaces.filter(row => row.status === "queued" && row.workflowId === "person-lookup"
      && row.resolvedInstances.some(instance => instance.system === "ucpath")).length, 3);
    assert_m2.equal(selected.queueSurfaces.filter(row => row.resolvedInstances.some(instance => String(instance.system) === "unknown-system")).length, 0);
    let after: { localDay: string; runId: string } | undefined;
    const seen: string[] = [];
    do {
      const page = queryQueueSummaries_m2(f.db, { workflow: "person-lookup", fromDay: "2026-09-09", toDay: "2026-09-09", status: "queued", limit: 1, ...(after === undefined ? {} : { after }) });
      seen.push(...page.items.map(row => row.runId)); after = page.next ?? undefined;
    } while (after !== undefined);
    assert_m2.deepEqual(seen, ids.slice(0, 3));
    assert_m2.deepEqual(queryQueueSummaries_m2(f.db, { workflow: "other-workflow", limit: 1 }).items, []);
    const row = selected.queueSurfaces[0];
    assert_m2.equal(f.reader.transition({ commandId: id_m2(8865), runId: row.runId, expectedVersion: row.rowRevision,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW_m2 } }).state, "applied");
    const generation = f.db.getMeta().authorityGeneration;
    assert_m2.deepEqual(f.reader.transition({ commandId: id_m2(8866), runId: row.runId, expectedVersion: row.rowRevision,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW_m2 } }), { state: "refused", refusal: { reason: "conflict", currentVersion: row.rowRevision + 1 } });
    assert_m2.equal(f.db.getMeta().authorityGeneration, generation);
    const refreshed = f.projection.buildDashboardDayWire("2026-09-09");
    assert_m2.equal(refreshed.queueSurfaces.find(item => item.runId === row.runId)?.status, "cancelled");
    assert_m2.equal(refreshed.statusCounts.find(item => item.status === "queued")?.count, 2);
  } finally { f.dispose(); }
});
}

{


it_m3("reads current heartbeats and publishes creation and presentation atomically",()=>{
  const f=foundationFixture_m3();try {
    const before=f.db.readRunSummaries();
    if(f.run.lifecycle.state!=="running")throw new Error("fixture-state");
    const renewed=f.db.authority.runs.renewClaim({runId:f.run.envelope.runId,claim:{workerId:f.run.lifecycle.workerId,claimGeneration:f.run.claimGeneration},now:"2026-09-09T12:00:01.000Z"});
    assert_m3.equal(renewed.state,"renewed");assert_m3.deepEqual(f.db.readRunSummaries(),before.map(row=>({...row,
      sourceGeneration:row.sourceGeneration+1,updatedAt:"2026-09-09T12:00:01.000Z",
      lifecycle:{...row.lifecycle,heartbeatAt:"2026-09-09T12:00:01.000Z"}})));
    f.db.withAuthorityTransaction(()=>{
      assert_m3.throws(()=>f.db.withAuthorityTransaction(()=>{f.createRun(id_m3(2001));throw new Error("nested");}),/nested/);
      f.createRun(id_m3(2002));
    });
    assert_m3.equal(f.db.readRunSummaries().length,2);
    assert_m3.equal(f.db.authority.runs.get(id_m3(2001)),undefined);
    const current=f.db.authority.runs.get(f.run.envelope.runId);assert_m3.ok(current);
    const changed=f.db.authority.runs.updatePresentation({runId:current.envelope.runId,expectedVersion:current.version,displayName:"Synthetic renamed",now:NOW_m3});
    assert_m3.equal(changed.state,"applied");assert_m3.equal(f.db.readRunSummaries().find(row=>row.runId===current.envelope.runId)?.title,"Synthetic renamed");
    const stable=f.db.readRunSummaries();
    assert_m3.throws(()=>f.db.withAuthorityTransaction(()=>{f.db.authority.runs.updatePresentation({runId:current.envelope.runId,expectedVersion:current.version+1,displayName:"Rolled back",now:NOW_m3});throw new Error("outer");}),/outer/);
    assert_m3.deepEqual(f.db.readRunSummaries(),stable);
  }finally{f.dispose();}
});
it_m3("maintains parent rollups and dependencies while batch grouping stays a bounded current relation",()=>{
  const f=foundationFixture_m3();try{
    const batch={...RUN_SESSION_m3,sessionId:id_m3(5000),workflow:"person-lookup"};
    f.db.authority.runSessions.insert(batch);
    const parent=RunRecordSchema_m3.parse({...f.run,envelope:{...f.run.envelope,runId:id_m3(5001),itemId:id_m3(5001),shape:"operation",enqueuedAt:NOW_m3},sessionId:batch.sessionId,lifecycle:{state:"queued"},version:1,claimGeneration:0,createdAt:NOW_m3,updatedAt:NOW_m3});
    f.db.authority.runs.enqueue(parent);
    const child=RunRecordSchema_m3.parse({...parent,envelope:{...parent.envelope,runId:id_m3(5002),itemId:id_m3(5002),shape:"operation-member",parent:{runId:parent.envelope.runId,tracePrefix:parent.envelope.traceId,edgeId:"member"}}});
    f.db.authority.runs.enqueue(child);
    const row=()=>f.db.readRunSummaries().find(row=>row.runId===parent.envelope.runId);
    assert_m3.deepEqual(row()?.children,[{runId:child.envelope.runId,state:"queued",outcome:null}]);
    const policy={onChildFailed:"fail-parent",cascadeCancel:"cascade",afterChildRetry:"resume-parent",visibility:"inline"};
    f.db.withAuthorityTransaction(()=>{
      f.db.authority.delegationManifests.insert({manifestId:id_m3(5003),parentRunId:parent.envelope.runId,edgeId:"member",inputSchemaHash:"a".repeat(64),resultSchemaHash:"a".repeat(64),cardinality:"one",join:"one",policy,children:[{dependencyId:id_m3(5004),childRunId:child.envelope.runId,childItemId:child.envelope.itemId,canonicalInputFingerprint:"a".repeat(64)}],createdAt:NOW_m3,manifestFingerprint:"a".repeat(64)});
      f.db.authority.dependencies.insert({dependencyId:id_m3(5004),manifestId:id_m3(5003),edgeId:"member",parentRunId:parent.envelope.runId,childRunId:child.envelope.runId,childItemId:child.envelope.itemId,policy,state:"active",version:1,createdAt:NOW_m3,updatedAt:NOW_m3});
    });
    assert_m3.deepEqual(row()?.dependencyRunIds,[child.envelope.runId]);
    f.db.authority.runs.transition({runId:child.envelope.runId,expectedVersion:1,lifecycle:{state:"terminal",outcome:"cancelled",endedAt:NOW_m3},now:NOW_m3});
    assert_m3.deepEqual(row()?.children,[{runId:child.envelope.runId,state:"terminal",outcome:"cancelled"}]);
    const query=()=>queryQueueSummaries_m3(f.db,{limit:10,sessionId:batch.sessionId,topLevel:true});
    assert_m3.equal(query().items.length,1);assert_m3.equal(query().items[0].session?.groupInQueue,false);
    f.db.authority.runSessions.setGrouping(batch.sessionId,1,true);
    assert_m3.equal(query().items[0].session?.groupInQueue,true);
    const report=queryActivitySummaries_m3(f.db,{from:"2026-09-09",to:"2026-09-09",generatedAt:NOW_m3},{descriptors:{resolve:()=>undefined},ledger:{foldActivityRange:()=>({systems:[]})}});
    assert_m3.equal(report.totalRuns,1);assert_m3.equal(report.terminalRuns,0);
  }finally{f.dispose();}
});

it_m3("consumes relevant timeline cursors transactionally and exact replay does not rewrite",()=>{
  const f=foundationFixture_m3();try{
    const run=f.run,envelope=run.envelope;
    const event={schemaVersion:1,eventId:id_m3(5100),workflow:envelope.workflow,scope:{kind:"run",runId:envelope.runId},occurredAt:envelope.enqueuedAt,recordedAt:NOW_m3,retentionDate:"2026-09-09",source:{kind:"native"},payload:{kind:"span",event:{t:"run.queued",kind:"run",pid:1,ts:envelope.enqueuedAt,workflow:envelope.workflow,runId:envelope.runId,attempt:envelope.attempt,traceId:envelope.traceId,spanPath:envelope.traceId,itemId:envelope.itemId,shape:envelope.shape,priority:envelope.priority,dryRun:envelope.dryRun,actorId:"local-operator",title:"Timeline title",descriptorVersion:envelope.descriptorVersion,contractFingerprint:envelope.contractFingerprint,resolvedInstance:envelope.resolvedInstance,configFingerprint:envelope.configFingerprint,configSnapshotId:envelope.configSnapshotId}}};
    f.db.authority.timelineEvents.append(event);
    const before=f.db.readRunSummaries();assert_m3.equal(before[0].title,"Timeline title");assert_m3.ok(before[0].sourceCursor>0);
    f.db.authority.timelineEvents.append(event);assert_m3.deepEqual(f.db.readRunSummaries(),before);
    const claimed={t:"run.claimed",pid:1,ts:envelope.enqueuedAt,workflow:envelope.workflow,runId:envelope.runId,attempt:envelope.attempt,traceId:envelope.traceId,spanPath:envelope.traceId,workerId:run.lifecycle.state==="running"?run.lifecycle.workerId:"invalid"};
    assert_m3.throws(()=>f.db.withAuthorityTransaction(()=>{f.db.authority.timelineEvents.append({...event,eventId:id_m3(5101),payload:{kind:"span",event:claimed}});throw new Error("timeline-rollback");}),/timeline-rollback/);
    assert_m3.deepEqual(f.db.readRunSummaries(),before);
  }finally{f.dispose();}
});
it_m3("updates receipt facts exactly once and cancellation filtering uses the same current snapshot",()=>{
  const f=foundationFixture_m3();try{
    const run=f.run;
    const failed = failure_m3();
    assert_m3.equal(terminalizeFixtureFailure_m3(f,run,failed).state,"applied");
    const receipt={...receiptWithWarningsOf_m3({seed:640,summaries:["Synthetic warning"]}),runId:run.envelope.runId,traceId:run.envelope.traceId,attempt:run.envelope.attempt,workflowId:run.envelope.workflow,descriptorFingerprint:run.envelope.contractFingerprint,configFingerprint:run.envelope.configFingerprint,result:"failed",failure:{state:"present",value:failed.failureId}};
    f.db.authority.evidenceReceipts.insert(receipt);
    assert_m3.equal(f.db.readRunSummaries()[0].warningCount,1);
    const before=f.db.readRunSummaries();f.db.authority.evidenceReceipts.insert(receipt);assert_m3.deepEqual(f.db.readRunSummaries(),before);
    const active=f.createRun(id_m3(641));
    const changed=f.db.authority.runs.requestCancellation({runId:active.envelope.runId,expectedVersion:active.version,now:NOW_m3});assert_m3.equal(changed.state,"applied");
    assert_m3.equal(queryQueueSummaries_m3(f.db,{limit:10,status:"running"}).items.length,0);
    const cancelling=queryQueueSummaries_m3(f.db,{limit:10,status:"cancelling"});assert_m3.equal(cancelling.items.length,1);assert_m3.equal(cancelling.items[0].status,"cancelling");
  }finally{f.dispose();}
});
}

{


it_m4("pages stable ties over real summary partitions, without whole-source reads",()=>{
  const f=foundationFixture_m4();try {
    f.db.withAuthorityTransaction(()=>{for(let n=0;n<12;n++)f.db.authority.runs.enqueue(RunRecordSchema_m4.parse({...f.run,
      envelope:{...f.run.envelope,runId:id_m4(3000+n),itemId:id_m4(3000+n)},lifecycle:{state:"queued"},version:1,claimGeneration:0}));});
    f.db.readRunSummaries=()=>{throw new Error("whole-reader-forbidden");};
    const seen:string[]=[];let after:{localDay:string;runId:string}|undefined;
    do{const page=queryQueueSummaries_m4(f.db,{limit:3,...(after===undefined?{}:{after})});seen.push(...page.items.map(row=>row.runId));after=page.next??undefined;}while(after!==undefined);
    assert_m4.equal(seen.length,13);assert_m4.equal(new Set(seen).size,13);assert_m4.deepEqual(seen,[...seen].sort());
    assert_m4.throws(()=>queryQueueSummaries_m4(f.db,{limit:3,fromDay:"2026-09-10",toDay:"2026-09-09"}),/range-invalid/);
    const raw=new DatabaseSync_m4(f.path,{readOnly:true});try{
      const plan=raw.prepare("EXPLAIN QUERY PLAN SELECT * FROM runs INDEXED BY runs_day_idx WHERE workflow=? AND local_day>=? AND local_day<=? AND state=? ORDER BY local_day,id LIMIT ?").all("person-lookup","2026-09-09","2026-09-09","queued",4);
      assert_m4.match(JSON.stringify(plan),/USING INDEX/);
      assert_m4.doesNotMatch(JSON.stringify(plan),/SCAN runs/);
      assert_m4.deepEqual(plan.map(row=>row.detail),[
        "SEARCH runs USING INDEX runs_day_idx (local_day>? AND local_day<?)",
        "USE TEMP B-TREE FOR LAST TERM OF ORDER BY",
      ]);
    }finally{raw.close();}
  }finally{f.dispose();}
});

it_m4("agrees with independent expected totals and the retained Activity projector on identical live authority",()=>{
  const f=foundationFixture_m4(),world=makeWorld_m4();try{
    for(let n=0;n<4;n++)f.db.authority.runs.enqueue(RunRecordSchema_m4.parse({...f.run,
      envelope:{...f.run.envelope,runId:id_m4(3100+n),itemId:id_m4(3100+n),enqueuedAt:n===3?"2025-01-01T12:00:00.000Z":NOW_m4},
      lifecycle:{state:"queued"},version:1,claimGeneration:0,createdAt:n===3?"2025-01-01T12:00:00.000Z":NOW_m4}));
    const terminal=f.db.authority.runs.get(id_m4(3100));assert_m4.ok(terminal);
    f.db.authority.runs.transition({runId:terminal.envelope.runId,expectedVersion:terminal.version,lifecycle:{state:"terminal",outcome:"cancelled",endedAt:"2026-09-09T12:00:05.000Z"},now:"2026-09-09T12:00:05.000Z"});

    for(const row of f.db.readRunSummaries()) {const run=f.db.authority.runs.get(row.runId);assert_m4.ok(run);world.authority.put(run);}
    const expected=world.projection.buildActivityReportWire("2026-09-09","2026-09-09");
    const actual=queryActivitySummaries_m4(f.db,{from:"2026-09-09",to:"2026-09-09",generatedAt:expected.generatedAt},{descriptors:{resolve:()=>undefined},ledger:{foldActivityRange:()=>expected.ledger},timeZone:runtimeTimeZone_m4()});
    assert_m4.equal(actual.totalRuns,3);assert_m4.equal(actual.terminalRuns,1);assert_m4.equal(actual.durations.totalMs,5000);
    const {volume,...reportWithoutVolume}=actual;
    assert_m4.deepEqual(reportWithoutVolume,expected);
    assert_m4.ok(volume);
    assert_m4.equal(volume.state,"complete");assert_m4.equal(volume.coveredRuns,3);
    assert_m4.equal(volume.buckets.reduce((sum,bucket)=>sum+bucket.runs,0),actual.totalRuns);
  }finally{world.dispose();f.dispose();}
});

it_m4("bins the enqueue instant and refuses a timezone mismatch before an indexed day bound can hide a run",()=>{
  const f=foundationFixture_m4();try{
    const enqueuedAt="2026-09-09T07:20:00.000Z";
    const queued=RunRecordSchema_m4.parse({...f.run,
      envelope:{...f.run.envelope,runId:id_m4(3200),itemId:id_m4(3200),enqueuedAt},
      lifecycle:{state:"queued"},version:1,claimGeneration:0,createdAt:enqueuedAt,updatedAt:enqueuedAt});
    f.db.authority.runs.enqueue(queued);
    const claimTime="2026-09-09T08:20:00.000Z";
    const claim=f.db.authority.runs.claimNext({workflow:"person-lookup",workerId:"activity-volume-worker",now:claimTime});
    assert_m4.equal(claim.state,"claimed");

    const timeZone=runtimeTimeZone_m4(),day=activityDatePartAtInstant_m4(enqueuedAt,timeZone);
    const report=queryActivitySummaries_m4(f.db,{from:day,to:day,generatedAt:NOW_m4},{descriptors:{resolve:()=>undefined},ledger:{foldActivityRange:()=>({systems:[]})},timeZone});
    const enqueueBucket=report.volume?.buckets.find(bucket=>Date.parse(bucket.start)<=Date.parse(enqueuedAt)&&Date.parse(enqueuedAt)<Date.parse(bucket.endExclusive));
    assert_m4.equal(enqueueBucket?.runs,1);
    const claimBucket=report.volume?.buckets.find(bucket=>Date.parse(bucket.start)<=Date.parse(claimTime)&&Date.parse(claimTime)<Date.parse(bucket.endExclusive));
    assert_m4.equal(claimBucket?.runs,0);
    assert_m4.equal(report.volume?.coveredRuns,report.totalRuns);
    const mismatchTimeZone=activityDatePartAtInstant_m4(enqueuedAt,"Etc/GMT+12")!==day?"Etc/GMT+12":"Pacific/Kiritimati";
    const mismatchDay=activityDatePartAtInstant_m4(enqueuedAt,mismatchTimeZone);
    assert_m4.notEqual(mismatchDay,day);
    assert_m4.throws(()=>queryActivitySummaries_m4(f.db,{from:mismatchDay,to:mismatchDay,generatedAt:NOW_m4},
      {descriptors:{resolve:()=>undefined},ledger:{foldActivityRange:()=>({systems:[]})},timeZone:mismatchTimeZone}),
    /activity-summary-local-day-time-zone-mismatch/u);
  }finally{f.dispose();}
});

it_m4("folds real summary rows into inclusive DST-day boundaries, distinct repeated hours, and known-zero days",()=>{
  const f=foundationFixture_m4();try{
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
      const queued=RunRecordSchema_m4.parse({...f.run,
        envelope:{...f.run.envelope,runId:id_m4(3300+index),itemId:id_m4(3300+index),enqueuedAt:at},
        lifecycle:{state:"queued"},version:1,claimGeneration:0,createdAt:at,updatedAt:at});
      f.db.authority.runs.enqueue(queued);
    }

    const read=(day:string)=>queryActivitySummaries_m4(f.db,{from:day,to:day,generatedAt:NOW_m4},
      {descriptors:{resolve:()=>undefined},ledger:{foldActivityRange:()=>({systems:[]})},timeZone:zone});

    const spring=read("2026-03-08");
    assert_m4.equal(spring.totalRuns,4);
    assert_m4.equal(spring.volume?.granularity,"hourly");
    assert_m4.equal(spring.volume?.buckets.length,23);
    assert_m4.equal(spring.volume?.coveredRuns,spring.totalRuns);
    assert_m4.equal(spring.volume?.buckets.find(bucket=>bucket.start==="2026-03-08T00:00:00.000-08:00")?.runs,2);
    assert_m4.equal(spring.volume?.buckets.find(bucket=>bucket.start==="2026-03-08T01:00:00.000-08:00")?.runs,1);
    assert_m4.equal(spring.volume?.buckets.find(bucket=>bucket.start==="2026-03-08T03:00:00.000-07:00")?.runs,1);
    assert_m4.ok(!spring.volume?.buckets.some(bucket=>bucket.start.startsWith("2026-03-08T02:")));

    const fall=read("2026-11-01");
    const repeated=fall.volume?.buckets.filter(bucket=>bucket.start.startsWith("2026-11-01T01:00:00"))??[];
    assert_m4.equal(fall.totalRuns,4);
    assert_m4.equal(fall.volume?.buckets.length,25);
    assert_m4.equal(fall.volume?.coveredRuns,fall.totalRuns);
    assert_m4.deepEqual(repeated.map(bucket=>[bucket.start,bucket.runs]),[
      ["2026-11-01T01:00:00.000-07:00",1],
      ["2026-11-01T01:00:00.000-08:00",1],
    ]);

    const nextDay=read("2026-03-09");
    assert_m4.equal(nextDay.totalRuns,1);
    assert_m4.equal(nextDay.volume?.buckets.find(bucket=>bucket.start==="2026-03-09T00:00:00.000-07:00")?.runs,1);

    const knownZero=read("2026-03-10");
    assert_m4.equal(knownZero.totalRuns,0);
    assert_m4.equal(knownZero.volume?.state,"complete");
    assert_m4.equal(knownZero.volume?.coveredRuns,0);
    assert_m4.ok(knownZero.volume?.buckets.every(bucket=>bucket.runs===0));
  }finally{f.dispose();}
});

it_m4("keeps the minimum supported date inside its indexed candidate range",()=>{
  const f=foundationFixture_m4();try{
    const report=queryActivitySummaries_m4(f.db,{from:"0000-02-29",to:"0000-02-29",generatedAt:NOW_m4},
      {descriptors:{resolve:()=>undefined},ledger:{foldActivityRange:()=>({systems:[]})},timeZone:"UTC"});
    assert_m4.equal(report.totalRuns,0);
    assert_m4.equal(report.volume?.interval.start,"0000-02-29T00:00:00.000+00:00");
    assert_m4.equal(report.volume?.interval.endExclusive,"0000-03-01T00:00:00.000+00:00");
  }finally{f.dispose();}
});
}

{


const semanticRows=(rows:ReturnType<AuthorityDatabase_m5["readRunSummaries"]>)=>rows.map(({sourceGeneration,...row})=>{void sourceGeneration;return row;});

describe_m5("native summary snapshots and transaction hooks", () => {
  it_m5("derives new runs atomically and rolls failed mutations back", () => {
    const fixture = foundationFixture_m5();
    try {
      assert_m5.equal(fixture.db.readRunSummaries().length,1);
      const before = fixture.db.readRunSummaries();
      const generation=fixture.db.getMeta().authorityGeneration;
      assert_m5.throws(() => fixture.db.withAuthorityTransaction(() => {
        fixture.createRun(id_m5(601));
        throw new Error("injected-lifecycle-rollback");
      }), /injected-lifecycle-rollback/u);
      assert_m5.deepEqual(fixture.db.readRunSummaries(), before);
      assert_m5.equal(fixture.db.getMeta().authorityGeneration,generation);
      fixture.createRun(id_m5(602));
      const after = fixture.db.readRunSummaries();
      assert_m5.equal(after.length, 2);
      assert_m5.deepEqual(semanticRows(after.filter(row=>row.runId===before[0].runId)),semanticRows(before));
      assert_m5.ok(after.every(row=>row.sourceGeneration===fixture.db.getMeta().authorityGeneration));
      assert_m5.ok(after.every(row=>row.person.state==="unavailable"));
      assert_m5.equal(fixture.db.authority.workerSlots.list("person-lookup").length,2);
    } finally { fixture.dispose(); }
  });

  it_m5("notices resolution annotations without replacing immutable UNKNOWN failure evidence", () => {
    const f = foundationFixture_m5();
    try {
      const record = failure_m5();terminalizeFixtureFailure_m5(f,f.run,record);
      const before=f.db.authority.failures.get(record.failureId);
      assert_m5.ok(before);
      const beforeSummary=f.db.readRunSummaries()[0];assert_m5.ok(beforeSummary);
      f.db.authority.failureResolution.update({ runId:record.runId,failureId:record.failureId,expectedVersion:1,
        resolution:{status:"resolved",version:2,by:"local-operator",at:NOW_m5} });
      const afterSummary=f.db.readRunSummaries()[0];assert_m5.ok(afterSummary);
      assert_m5.equal(afterSummary.resolution?.status,"resolved");
      assert_m5.notEqual(afterSummary.sourceDigest,beforeSummary.sourceDigest);
      assert_m5.deepEqual(f.db.authority.failures.get(record.failureId),before);
      assert_m5.equal(before.writeState,"unknown");
    } finally { f.dispose(); }
  });
});

it_m5("reads a consistent admitted snapshot across an independent writer and refuses corrupt run mirrors after restart",()=>{
  const f=foundationFixture_m5();let peer:AuthorityDatabase_m5|undefined;
  try{
    peer=AuthorityDatabase_m5.open({path:f.path,busyTimeoutMs:500,migrationOwner:"summary-peer"},f.clock);
    const before=f.db.readRunSummaries();
    f.db.withAuthorityReadSnapshot(()=>{
      assert_m5.deepEqual(f.db.readRunSummaries(),before);
      peer?.authority.runs.updatePresentation({runId:f.run.envelope.runId,expectedVersion:f.run.version,displayName:"Concurrent title",now:NOW_m5});
      assert_m5.deepEqual(f.db.readRunSummaries(),before);
    });
    assert_m5.equal(f.db.readRunSummaries()[0].title,"Concurrent title");
    assert_m5.ok(f.db.readRunSummaries()[0].sourceGeneration>before[0].sourceGeneration);
    peer.close();peer=undefined;
    const raw=new DatabaseSync_m5(f.path);try{raw.prepare("UPDATE runs SET version=version+1 WHERE id=?").run(f.run.envelope.runId);}finally{raw.close();}
    assert_m5.throws(()=>AuthorityDatabase_m5.open({path:f.path,busyTimeoutMs:500,migrationOwner:"summary-restart"},f.clock),/run row version does not match its whole-record JSON/u);
  }finally{peer?.close();f.dispose();}
});

it_m5("keeps unrelated source facts unchanged, rolls nested mutations back and pages through the real query port",()=>{
  const f=foundationFixture_m5();
  try {
    const before=f.db.readRunSummaries(),pool=f.db.authority.workerPools.get("person-lookup");assert_m5.ok(pool);
    const beforeGeneration=f.db.getMeta().authorityGeneration;
    const planned=f.db.authority.workerPools.plan({workflow:"person-lookup",expectedVersion:pool.version,desiredWorkers:pool.desiredWorkers,requestedBy:"local-operator",now:NOW_m5});
    assert_m5.equal(planned.state,"applied");
    const afterPlan=f.db.readRunSummaries(),afterGeneration=f.db.getMeta().authorityGeneration;
    assert_m5.ok(afterGeneration>beforeGeneration);
    assert_m5.ok(afterPlan.every(row=>row.sourceGeneration===afterGeneration));
    assert_m5.deepEqual(semanticRows(afterPlan),semanticRows(before));
    f.db.withAuthorityTransaction(()=>{
      assert_m5.throws(()=>f.db.withAuthorityTransaction(()=>{f.createRun(id_m5(810));throw new Error("savepoint-rollback");}),/savepoint-rollback/u);
      f.createRun(id_m5(811));
    });
    assert_m5.equal(f.db.authority.runs.get(id_m5(810)),undefined);
    assert_m5.deepEqual(semanticRows(f.db.readRunSummaries().filter(row=>row.runId===before[0].runId)),semanticRows(before));
    const read=f.db.readRunSummaries.bind(f.db);f.db.readRunSummaries=()=>{throw new Error("whole-reader-forbidden");};
    try {
      const first=queryRunSummarySource_m5(f.db,{workflow:"person-lookup",limit:1});
      assert_m5.equal(first.items.length,1);assert_m5.ok(first.next);
      const second=queryRunSummarySource_m5(f.db,{workflow:"person-lookup",limit:1,after:first.next});
      assert_m5.equal(second.items.length,1);assert_m5.equal(second.next,null);
      assert_m5.notEqual(first.items[0].runId,second.items[0].runId);
      assert_m5.deepEqual(f.db.summaryWorkflows(),["person-lookup"]);
    }finally{f.db.readRunSummaries=read;}
  }finally{f.dispose();}
});
}
