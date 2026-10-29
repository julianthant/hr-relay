import { RuntimeLifetimeLock, WorkerRuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { runClaim } from "../../../src/models/run/record.js";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { z } from "zod";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { createProfileRegistry } from "../../../src/backend/profiles/registry.js";
import { createBoundProfileFixture } from "../helpers/admission-fixture.js";
import { AuthorityDatabase } from "../helpers/synthetic-database-admission.js";
import { AuthorityBackupService } from "../../../src/backend/storage/sqlite/backup-service.js";
import { FakeKeyringEntry } from "../helpers/credential-keychain-fake.js";
import { resolveConfigWithProvenance } from "../../../src/backend/app/config/resolve.js";
import { initialSettingsFileRecord } from "../../../src/models/config/settings.js";
import { ConfigSnapshotRecordSchema } from "../../../src/models/config/snapshot.js";
import { seedAtomicWriteOwner } from "../helpers/timeline-write-fixture.js";
import { fenceWriteFixture } from "../helpers/write-fence-fixture.js";
import { ATOMIC_WRITE_COMMIT, COMMAND_FIXTURES, CONFIG_SNAPSHOT, NOW, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../fixtures/phase1c-contract-fixtures.js";
import { manualClock } from "../../../src/rules/time/clock.js";

assert.ok(process.send !== undefined);
if (process.argv[2] === "worker") {
  const lifetime = await WorkerRuntimeLifetimeLock.receive(Number(process.argv[3]), () => { process.exitCode = 1; });
  const machine = RuntimeAdmission.acquireWorker(z.string().min(1).parse(process.argv[4]), lifetime);
  const admission = machine.admitProfile(createProfileRegistry(machine).storageClaim(z.uuid().parse(process.argv[5])));
  admission.assertProfileRuntime();
  const release = once(process, "message");
  process.send({ state: "inherited-held" });
  assert.deepEqual((await release)[0], { state: "release-inherited" });
  admission.release(); machine.release(); await lifetime.close(); process.disconnect();
} else {
  const lifetimeLock = await RuntimeLifetimeLock.acquire(Number(process.argv[2]));
  const clock = manualClock(new Date(NOW));
  const profile = await createBoundProfileFixture({ lifetime: lifetimeLock, sharedMachine: true });
  const authorityPath = realpathSync(profile.path);
  const processLockRoot = join(profile.workspace, rebuildRuntimeIsolation.processLockRoot);
  const database = AuthorityDatabase.open({ path: authorityPath, busyTimeoutMs: 250, migrationOwner: "storage-restore-attempt-worker" }, clock);
  const closePhysicalDatabase = database.close.bind(database);
  const resolved = resolveConfigWithProvenance(initialSettingsFileRecord().settings, { primaryDisplay: null }, clock,
    { stateRoot: profile.stateRoot, artifactRoot: profile.admission.artifactRoot });
  const snapshot = ConfigSnapshotRecordSchema.parse({ ...CONFIG_SNAPSHOT, config: resolved.config, fingerprint: resolved.fingerprint, provenance: resolved.provenance });
  database.authority.commands.insert(COMMAND_FIXTURES[0]);
  seedAtomicWriteOwner(database, { ...ATOMIC_WRITE_COMMIT,
    transaction: { ...ATOMIC_WRITE_COMMIT.transaction, configFingerprint: snapshot.fingerprint } }, authorityPath, 1, snapshot);
  assert.equal(fenceWriteFixture(database, { intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT }).state, "fenced");
  const source = database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId);
  assert.ok(source); assert.equal(source.status, "attempting");
  const current = database.authority.runs.get(source.runId);
  assert.ok(current); const claim = runClaim(current); assert.ok(claim);
  assert.equal(claim.claimGeneration, current.claimGeneration);
  assert.equal(current.envelope.attempt, source.runAttempt);
  assert.equal(database.authority.workerLeases.get(claim.workerId)?.processId, process.pid);
  assert.deepEqual(database.authority.writeAttempts.get(WRITE_ATTEMPT.writeAttemptId), WRITE_ATTEMPT);
  const directory = join(profile.stateRoot, "backups", "authority");
  const report = await new AuthorityBackupService(profile.admission, database, { directory }, clock)
    .request({ trigger: "operator", requiredGeneration: database.getMeta().authorityGeneration });
  const manifest = report.manifests[0]; assert.ok(manifest);
  const descriptors = () => {
    const report = spawnSync("lsof", ["-nP", "-a", "-p", String(process.pid), "-Fn"], { encoding: "utf8" });
    assert.equal(report.error, undefined); assert.equal(report.status, 0); assert.equal(report.stderr, "");
    return report.stdout.split("\n").filter(line => line.startsWith("n")).map(line => line.slice(1));
  };
  assert.ok(descriptors().includes(authorityPath));
  closePhysicalDatabase();
  const files = [authorityPath, authorityPath + "-wal", authorityPath + "-shm", authorityPath + "-journal"];
  assert.equal(descriptors().some(path => files.some(file => path === file || path === file + " (deleted)")), false);
  lifetimeLock.assertHeld();
  let inherited: ReturnType<typeof spawn> | undefined;
  let inheritedClose: Promise<unknown[]> | undefined;
  if (process.argv[3] === "inherited-child") {
    inherited = spawn(process.execPath, ["--import", "tsx", import.meta.filename, "worker", String(lifetimeLock.port), profile.workspace, profile.admission.profileBinding.profileId],
      { stdio: ["ignore", "ignore", "pipe", "ipc"] });
    inherited.stderr?.resume();
    inheritedClose = once(inherited, "close");
    const held = Promise.race([once(inherited, "message"), inheritedClose.then(() => { throw new Error("inherited-attempt-worker-exited-before-held"); })]);
    await lifetimeLock.share(inherited);
    assert.deepEqual((await held)[0], { state: "inherited-held" });
  }
  const request = once(process, "message");
  const binding = profile.admission.profileBinding;
  const keychain = FakeKeyringEntry.snapshot().filter(([account]) => account === `Relay:${binding.installationId}:${binding.profileId}`);
  assert.equal(keychain.length, 1);
  process.send({ state: "attempting", workspace: profile.workspace, stateRoot: profile.stateRoot,
    authorityPath, profileId: binding.profileId, installationId: binding.installationId, workerId: claim.workerId,
    processLockRoot, pid: process.pid, keychain, manifestPath: join(directory, manifest.backupFileName + ".manifest.json"),
    claimGeneration: current.claimGeneration, runId: current.envelope.runId, databaseClosed: true, retained: true });
  if (inherited !== undefined) {
    assert.deepEqual((await request)[0], { state: "close-root-listener" });
    await lifetimeLock.close();
    const release = once(process, "message");
    process.send({ state: "root-listener-closed" });
    assert.deepEqual((await release)[0], { state: "release-inherited" });
    inherited.send({ state: "release-inherited" });
    assert.deepEqual(await inheritedClose, [0, null]);
    process.send({ state: "inherited-closed" });
  } else {
    z.never().parse((await request)[0]);
  }
  process.on("disconnect", () => { process.exitCode = 1; });
}
