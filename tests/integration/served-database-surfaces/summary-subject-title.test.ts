import { it } from "vitest";
import { FingerprintSchema } from "../../../src/domain/ids.js";
import assert from 'node:assert/strict';
import { foundationFixture, id, HASH, NOW } from '../../unit/database-foundation/fixtures.js';
import { personLookupDescriptor } from '../../helpers/registered-workflows.js';
import { RunRecordSchema } from '../../../src/domain/run/record.js';
import { RunCheckpointRecordSchema } from '../../../src/domain/workflow/checkpoint.js';
import { SearchPersonOrgOutputSchema } from '../../../src/domain/contracts/ucpath/search-person-org.js';
import { deriveSchemaHash } from '../../../src/domain/schema-bound-value.js';
import { RunRecordService } from '../../../src/core/run-record-service.js';
import { createTimelineEmitter } from '../../../src/infra/events/timeline-emitter.js';
import { createTransactionHistory } from '../../../src/infra/sqlite/transaction-history.js';
import { createOperatorProjection, createOperatorRunDetail } from '../../../src/server/dashboard/compose/operator.js';
import { queryQueueSummaries, queryActivitySummaries } from '../../../src/server/dashboard/queries/run-summaries.js';
import { buildRunDetail } from '../../../src/server/dashboard/queries/run-detail.js';

it("keeps the resolved subject and operator label distinct in the summary-backed day", () => {
const f = foundationFixture();
try {
  const runId = id(720);
  f.db.authority.runs.enqueue(RunRecordSchema.parse({ ...f.run,
    envelope: { ...f.run.envelope, runId, itemId: runId, enqueuedAt: NOW },
    input: { ...f.run.input, raw: { emplId: '10000000' },
      parsed: { ...f.run.input.parsed, value: { emplId: '10000000', keepNonHdh: false, includeCrmDates: false }, protectedBindings: [] } },
    lifecycle: { state: 'queued' }, claimGeneration: 0, version: 1, createdAt: NOW, updatedAt: NOW,
  }));
  const claim = f.db.authority.runs.claimNext({ workflow: 'person-lookup', workerId: 'subject-probe-worker', now: NOW });
  assert.equal(claim.state, 'claimed');
  if (claim.state !== 'claimed') throw new Error('fixture-not-claimed');
  assert.equal(claim.run.envelope.runId, runId);
  const validating = f.db.authority.runs.transition({ runId, expectedVersion: claim.run.version,
    claim: { workerId: 'subject-probe-worker', claimGeneration: 1 },
    lifecycle: { state: 'validating', workerId: 'subject-probe-worker', claimedAt: NOW, heartbeatAt: NOW }, now: NOW });
  assert.equal(validating.state, 'applied');
  if (validating.state !== 'applied') throw new Error('fixture-not-validating');
  const running = f.db.authority.runs.transition({ runId, expectedVersion: validating.run.version,
    claim: { workerId: 'subject-probe-worker', claimGeneration: 1 },
    lifecycle: { state: 'running', workerId: 'subject-probe-worker', claimedAt: NOW, heartbeatAt: NOW, currentNodeId: 'searching' }, now: NOW });
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
  const descriptors = { resolve: (workflow: string) => workflow === 'person-lookup' ? personLookupDescriptor : undefined };
  const servedReader: Parameters<typeof createOperatorProjection>[0]["reader"] = { read: reader.read.bind(reader), list: reader.list.bind(reader),
    summaries: { withSnapshot: work => f.db.withAuthorityReadSnapshot(work),
      queue: query => queryQueueSummaries(f.db, query),
      activity: (from, to) => queryActivitySummaries(f.db, { from, to, generatedAt: NOW }, { ledger, descriptors }) },
  };
  const projection = createOperatorProjection({ database: f.db, stateRoot: f.root, clock: f.clock,
    appVersion: '0.1.0', descriptorSetHash: FingerprintSchema.parse(HASH), ledger, descriptors, reader: servedReader });
  projection.rebuildFromTimeline();
  assert.equal(projection.health().state, 'live');
  f.db.refreshRunSummaries();
  // The pre-existing queueSurface comparison uses its full snapshot API.
  // The production served day path under review must never fall back to it.
  const detailDeps = createOperatorRunDetail({ database: f.db, stateRoot: f.root, projection, runReader: reader });
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
  const selected = { emplId: '10000000', name: 'Synthetic Resolved Subject', department: 'Synthetic Department', jobTitle: 'Synthetic Role', employeeStatus: 'active', hdh: true };
  const value = SearchPersonOrgOutputSchema.parse({ results: [selected], selection: { status: 'resolved', selected, candidateEids: [selected.emplId] } });
  const checkpoint = RunCheckpointRecordSchema.parse({ workflowId: e.workflow, itemId: e.itemId, runId,
    nodeId: 'searching', attempt: e.attempt, claimGeneration: running.run.claimGeneration,
    output: { schemaHash: deriveSchemaHash(SearchPersonOrgOutputSchema, 'output'), value },
    descriptorVersion: personLookupDescriptor.version, contractFingerprint: personLookupDescriptor.contractFingerprint,
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
