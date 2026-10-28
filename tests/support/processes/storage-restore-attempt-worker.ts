import { RuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { runClaim } from '../../../src/models/run/record.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { WorkerIdSchema } from '../../../src/rules/identity/ids.js';
import { rebuildRuntimeIsolation } from '../../../src/backend/app/config/runtime-isolation.js';
import { admitDirectWorker } from '../../../src/backend/storage/sqlite/worker-slots.js';
import { bindWorkerProcessAdmission } from '../../../src/backend/storage/sqlite/runtime-process-locks.js';
import { createBoundProfileFixture } from '../helpers/admission-fixture.js';
import { AuthorityDatabase } from '../helpers/synthetic-database-admission.js';
import { seedAtomicWriteOwner } from '../helpers/timeline-write-fixture.js';
import { fenceWriteFixture } from '../helpers/write-fence-fixture.js';
import { ATOMIC_WRITE_COMMIT, COMMAND_FIXTURES, CONFIG_SNAPSHOT, NOW, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from '../fixtures/phase1c-contract-fixtures.js';
import { manualClock } from '../../../src/rules/time/clock.js';

const lifetimeLock = await RuntimeLifetimeLock.acquire(Number(process.argv[2]));
const clock = manualClock(new Date(NOW));
const profile = await createBoundProfileFixture({ lifetime: lifetimeLock });
const authorityPath = realpathSync(profile.path);
const processLockRoot = join(profile.workspace, rebuildRuntimeIsolation.processLockRoot);
const workflow = WRITE_INTENT_ATTEMPTING.workflowId;
const bound = bindWorkerProcessAdmission({ authorityPath, processLockRoot, pid: process.pid, clock,
  open: () => AuthorityDatabase.open({ path: authorityPath, busyTimeoutMs: 250, migrationOwner: 'storage-restore-attempt-worker' }, clock),
  admit: (database) => database.withAuthorityTransaction(repositories => {
    const active = repositories.runtimeConfig.get() ?? repositories.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    assert.equal(active.configSnapshotId, CONFIG_SNAPSHOT.configSnapshotId);
    assert.equal(active.configFingerprint, CONFIG_SNAPSHOT.fingerprint);
    return WorkerIdSchema.parse(admitDirectWorker(repositories, { commandId: randomUUID(), workflow,
        poolIndex: 1, expectedPoolVersion: repositories.workerPools.get(workflow)?.version ?? 0,
        processId: process.pid,
        now: NOW }, randomUUID()).workerId);
}), close: database => database.close() });
const database = bound.value;
assert.equal(database.authority.workerLeases.start({ workerId: bound.workerId, workflow,
  browserSystems: [WRITE_INTENT_ATTEMPTING.system], processId: process.pid,
  requestedBy: 'storage-restore-attempt-worker', now: NOW }).state, "started");
database.authority.commands.insert(COMMAND_FIXTURES[0]);
seedAtomicWriteOwner(database, ATOMIC_WRITE_COMMIT, authorityPath);
const run = database.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId);
assert.ok(run);
const fenced = fenceWriteFixture(database, { intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT });
assert.equal(fenced.state, "fenced");
lifetimeLock.assertHeld();
assert.equal(database.authority.workerLeases.get(bound.workerId)?.processId, process.pid);
const source = database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId);
assert.ok(source);
assert.equal(source.status, 'attempting');
const current = database.authority.runs.get(source.runId);
assert.ok(current);
const claim = runClaim(current);
assert.ok(claim);
assert.equal(claim.workerId, bound.workerId);
assert.equal(claim.claimGeneration, current.claimGeneration);
assert.deepEqual(database.authority.writeAttempts.get(WRITE_ATTEMPT.writeAttemptId), WRITE_ATTEMPT);
const descriptors = () => {
  const report = spawnSync('lsof', ['-nP', '-a', '-p', String(process.pid), '-Fn'], { encoding: 'utf8' });
  assert.equal(report.error, undefined);
  assert.equal(report.status, 0);
  assert.equal(report.stderr, '');
  return report.stdout.split('\n').filter(line => line.startsWith('n')).map(line => line.slice(1));
};
assert.ok(descriptors().includes(authorityPath));
database.close();
const files = [authorityPath, authorityPath + '-wal', authorityPath + '-shm', authorityPath + '-journal'];
assert.equal(descriptors().some(path => files.some(file => path === file || path === file + ' (deleted)')), false);
assert.ok(process.send !== undefined);
process.on('disconnect', () => { process.exitCode = 1; });
process.send({ state: 'attempting', workspace: profile.workspace, stateRoot: profile.stateRoot,
  authorityPath, profileId: profile.admission.profileBinding.profileId, workerId: bound.workerId,
  processLockRoot, pid: process.pid,
  claimGeneration: current.claimGeneration, runId: current.envelope.runId, databaseClosed: true,
  retained: true });
