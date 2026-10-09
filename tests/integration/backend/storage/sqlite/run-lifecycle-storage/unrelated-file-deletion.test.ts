import { it } from "vitest";
import assert from 'node:assert/strict';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { archiveFixture, attachFile } from '../../../../../support/helpers/archive-transfer/fixtures.js';
import { id, NOW } from '../../../../../support/helpers/database-foundation/fixtures.js';
import { createRunLifecycleStorage } from '../../../../../../src/backend/storage/sqlite/run-lifecycle-storage.js';
import { projectArchiveReport } from '../../../../../../src/backend/runs/queries/archive-reports.js';

function runCase(missing: 'none' | 'target' | 'unrelated') {
  const f = archiveFixture();
  try {
    const otherRun = f.base.createRun(id(8810));
    f.terminal();
    assert.equal(f.database.authority.runs.transition({ runId: otherRun.envelope.runId, expectedVersion: otherRun.version,
      lifecycle: { state: 'terminal', outcome: 'cancelled', endedAt: NOW }, now: NOW }).state, 'applied');
    const other = attachFile(f.database, f.base.root, f.base.run.envelope.runId, 8820, Buffer.from('synthetic unrelated report file'));
    const target = attachFile(f.database, f.base.root, otherRun.envelope.runId, 8830, Buffer.from('synthetic target report file'));
    assert.equal(f.kernel.execute(f.applyRequest(f.plan())).state, 'applied');
    const storage = createRunLifecycleStorage(f.database);
    const report = projectArchiveReport(storage.readReport(otherRun.envelope.runId));
    assert.equal(report.state, 'available');
    if (report.state !== 'available') throw new Error('target-report-unavailable');
    const request = { commandId: id(8840), requestedAt: NOW, requestedBy: 'local-operator', source: 'archive', family: 'version-archive',
      type: 'delete-archived-run', target: { archivedRunId: otherRun.envelope.runId, archiveFingerprint: report.archiveFingerprint } };
    const file = missing === 'target' ? target : other;
    const path = join(f.base.root, 'archive-files', file.file.digest);
    const bytes = readFileSync(path);
    if (missing !== 'none') unlinkSync(path);
    const execute = () => {
      try { return { kind: 'result', result: f.kernel.execute(request) }; }
      catch (error) {
        assert.ok(error instanceof Error);
        return { kind: 'error', code: error.message };
      }
    };
    const first = execute();
    const intermediate = {
      targetReceipt: f.database.authority.deletedRuns.get(otherRun.envelope.runId) !== undefined,
      targetArchiveDeletion: f.database.lifecycleArchive(true).deletion(otherRun.envelope.runId)?.state ?? null,
      unrelatedReport: projectArchiveReport(storage.readReport(f.base.run.envelope.runId)).state,
    };
    if (missing !== 'target') assert.equal(first.result?.state, 'applied');
    else { assert.equal(first.kind, 'error'); assert.equal(first.code, 'archive-file-unavailable'); }
    if (missing !== 'none') writeFileSync(path, bytes);
    const recovery = execute();
    assert.ok(recovery.result?.state === 'applied' || recovery.result?.state === 'already-applied');
    assert.equal(f.database.lifecycleArchive(true).deletion(otherRun.envelope.runId)?.state, 'deleted');
    assert.equal(projectArchiveReport(storage.readReport(f.base.run.envelope.runId)).state, 'available');
    return { missing, first, intermediate, exactBytesRecovery: recovery.result?.state };
  } finally { f.dispose(); }
}
for (const missing of ['none', 'target', 'unrelated'] as const) it(`settles deletion with ${missing} file absent without losing custody`, () => { runCase(missing); });
