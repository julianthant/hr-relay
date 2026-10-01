import { it } from "vitest";
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { archiveFixture, attachFile } from '../../unit/archive-transfer/fixtures.js';
import { id, NOW } from '../../unit/database-foundation/fixtures.js';
import { ledgerCommitFixture } from '../../fixtures/ledger-projection-fixtures.js';
import { atomicWriteCheckpoint } from '../../helpers/timeline-write-fixture.js';
import { createTransactionHistory } from '../../../src/infra/sqlite/transaction-history.js';
import { RunRecordService } from '../../../src/core/run-record-service.js';
import { createRunLifecycleStorage } from '../../../src/core/run-lifecycle-storage.js';
import { projectArchiveReport } from '../../../src/server/dashboard/queries/archive-reports.js';
import { queryActivitySummaries } from '../../../src/server/dashboard/queries/run-summaries.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
it("keeps authenticated transaction and Activity facts available when unrelated diagnostic bytes are missing", () => {
const f = archiveFixture();
try {
  const run = f.base.run;
  const runId = run.envelope.runId;
  const commit = ledgerCommitFixture(79, { runId, workflowId: run.envelope.workflow, itemId: run.envelope.itemId,
    traceId: run.envelope.traceId, configFingerprint: run.envelope.configFingerprint, confirmedAt: NOW });
  assert.equal(f.database.authority.writeIntents.fenceAttempt({ intent: commit.intent, attempt: commit.attempt }).state, 'fenced');
  f.database.commitWriteAttempt(commit.commit, atomicWriteCheckpoint(commit.commit));
  const attachment = attachFile(f.database, f.base.root, runId, 8790, Buffer.from('synthetic unrelated diagnostic attachment'));
  f.terminal();
  assert.equal(f.kernel.execute(f.applyRequest(f.plan())).state, 'applied');
  f.reopen();
  f.database.refreshRunSummaries();
  const storage = createRunLifecycleStorage(f.database);
  const reader = new RunRecordService({ database: f.database, clock: f.base.clock,
    ids: { uuid: () => id(8799) }, publishQueued: () => { throw new Error('read-created-run'); } });
  const ledger = createTransactionHistory(f.database.authority);
  const descriptors = { resolve: () => undefined };
  const stable = () => {
    const report = storage.readReport(runId);
    assert.ok(report);
    assert.equal(projectArchiveReport(report).state, 'available');
    const existence = reader.read(runId);
    assert.equal(existence.state, 'present');
    if (existence.state !== 'present') throw new Error('archived-run-not-readable');
    assert.equal(existence.disposition, 'archived');
    return { reportHash: hash(report), sourcesHash: hash(report.content.sources), reportDigest: report.digest,
      transferHash: hash(f.database.transferredRun(runId)), generation: f.database.getMeta().authorityGeneration,
      savedReport: 'available', canonicalDisposition: 'archived' };
  };
  const selections = [{ label: 'including-archived-transaction', from: '2026-09-09', to: '2026-09-09' },
    { label: 'excluding-archived-transaction', from: '2026-09-10', to: '2026-09-10' }];
  const observe = () => selections.map(({ label, from, to }) => {
    const call = <T,>(read: () => T) => {
      try { return { state: 'available', value: read() }; }
      catch (error) {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'archive-file-unavailable');
        return { state: 'refused', code: error.message };
      }
    };
    return { label, transactionHistory: call(() => {
      const result = ledger.query({ from, to });
      return { rows: result.rows.length, digest: result.digest };
    }), activity: call(() => {
      const report = queryActivitySummaries(f.database, { from, to, generatedAt: NOW }, { ledger, descriptors });
      return { totalRuns: report.totalRuns, ledger: report.ledger, digest: hash(report) };
    }) };
  });
  const identity = stable();
  const before = observe();
  assert.equal(before[0].transactionHistory.value?.rows, 1);
  assert.equal(before[1].transactionHistory.value?.rows, 0);
  assert.ok(before.every(row => row.transactionHistory.state === 'available' && row.activity.state === 'available'));
  const path = join(f.base.root, 'archive-files', attachment.file.digest);
  const originalBytes = readFileSync(path);
  assert.deepEqual(originalBytes, attachment.bytes);
  unlinkSync(path);
  const missing = observe();
  assert.deepEqual(stable(), identity);
  assert.deepEqual(missing, before);
  writeFileSync(path, originalBytes);
  assert.deepEqual(readFileSync(path), originalBytes);
  const restored = observe();
  assert.deepEqual(restored, before);
  assert.deepEqual(stable(), identity);
} finally { f.dispose(); }
});
