import assert from "node:assert/strict";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { it } from "vitest";
import { archiveFixture, attachFile } from "../../unit/archive-transfer/fixtures.js";
import { id, NOW } from "../../unit/database-foundation/fixtures.js";
import { AuthorityDatabase } from "../../helpers/synthetic-storage-admission.js";
import { backupStoppedAuthority } from "../../helpers/synthetic-storage-admission.js";
import { restoreLifecyclePair, verifyLifecyclePair } from "../../helpers/synthetic-storage-admission.js";
import { RecoveryStopProofStore } from "../../../src/infra/sqlite/recovery-stop-proof.js";
import { observeRuntimeLockSnapshot } from "../../../src/infra/sqlite/runtime-process-locks.js";
import { composeStorageCommand } from "../../helpers/synthetic-storage-admission.js";
import { rebuildRuntimeIsolation } from "../../../src/config/runtime-isolation.js";

for (const step of ["live", "files"] as const) it(`rejects changed pending attachment bytes before paired restore completion after ${step}`, async () => {
  const f = archiveFixture();
  try {
    const {file, bytes} = attachFile(f.database, f.base.root, f.base.run.envelope.runId, 89700);
    f.terminal();
    const request = f.applyRequest(f.plan());
    f.failAfter("readPendingReport");
    assert.throws(() => f.kernel.execute(request), /injected-readPendingReport/u);
    f.database.close();
    const backup = await backupStoppedAuthority(f.base.root, f.base.clock);
    assert.ok("pairedManifestPath" in backup);
    const verified = await verifyLifecyclePair(backup.pairedManifestPath);
    const archiveCopy = join(verified.root, verified.pair.archiveFile);
    assert.equal(existsSync(`${archiveCopy}-shm`), false);
    assert.equal(existsSync(`${archiveCopy}-wal`), false);
    if (step === "live") {
      writeFileSync(`${archiveCopy}-shm`, "preexisting", { mode: 0o600 });
      await assert.rejects(verifyLifecyclePair(backup.pairedManifestPath), /preexisting-companion/u);
      assert.equal(readFileSync(`${archiveCopy}-shm`, "utf8"), "preexisting");
      rmSync(`${archiveCopy}-shm`);
    }
    const processLockRoot = join(f.base.root, "locks");
    const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(f.base.path);
    const proofs = new RecoveryStopProofStore({processLockRoot, maxProofAgeMs:60000}, f.base.clock);
    const proof = () => {
      proofs.recordRuntimeState(observeRuntimeLockSnapshot({processLockRoot, sourceDatabaseIdentity}, f.base.clock));
      return proofs.issue({observedBy:"local-operator", sourceDatabaseIdentity});
    };
    const options = {authorityPath:f.base.path, suspectDirectory:join(f.base.root,"suspects"), busyTimeoutMs:500,
      processLockRoot, stoppedProofMaxAgeMs:60000};
    await assert.rejects(restoreLifecyclePair(options, {manifestPath:backup.pairedManifestPath, stoppedSystemProof:proof()},
      async () => {}, f.base.clock, current => {
        if (current === step) writeFileSync(step === "live"
          ? join(verified.root, verified.pair.fileDirectory, file.digest)
          : join(f.base.root, "archive-files", file.digest), Buffer.alloc(bytes.length, 88));
      }), /lifecycle-restore-incomplete/u);
    assert.equal(existsSync(join(f.base.root,".lifecycle-restore.json")), true);
    assert.throws(() => f.reopen(), /lifecycle-restore-incomplete/u);
    // Repair the selected backup bytes, then settle the exact recorded pair.
    writeFileSync(join(verified.root, verified.pair.fileDirectory, file.digest), bytes);
    await restoreLifecyclePair(options, {manifestPath:backup.pairedManifestPath, stoppedSystemProof:proof()}, async () => {}, f.base.clock);
    assert.equal(existsSync(join(f.base.root,".lifecycle-restore.json")), false);
    assert.deepEqual(readFileSync(join(f.base.root,"archive-files",file.digest)), bytes);
    f.reopen();
    assert.equal(f.kernel.execute(request).state, "applied");
  } finally { f.dispose(); }
});

for (const pending of [false, true]) it(`refuses current-schema single-half restore with missing archive and ${pending ? "pending" : "published"} custody`, async () => {
  const f = archiveFixture({repositoryLayout:true});
  try {
    const {file, bytes} = attachFile(f.database, f.base.root, f.base.run.envelope.runId, 89720);
    f.terminal();
    const request = f.applyRequest(f.plan());
    if (pending) {
      f.failAfter("readPendingReport");
      assert.throws(() => f.kernel.execute(request), /injected-readPendingReport/u);
    } else assert.equal(f.kernel.execute(request).state,"applied");
    f.database.close();
    const backup = await backupStoppedAuthority(f.base.root, f.base.clock);
    assert.ok("pairedManifestPath" in backup);
    const verified = await verifyLifecyclePair(backup.pairedManifestPath);
    renameSync(join(f.base.root,"archive.sqlite"), join(f.base.root,"archive.quarantined.sqlite"));
    const repoRoot = dirname(f.base.root);
    writeFileSync(join(repoRoot,"package.json"), JSON.stringify({name:"isolated-restore",version:"0.1.0"}));
    const before = readFileSync(f.base.path);
    const refused = await composeStorageCommand(rebuildRuntimeIsolation, ["restore","--from",join(verified.root,verified.pair.liveManifest),"--json"], f.base.clock, repoRoot);
    assert.equal(refused.exitCode,1,refused.output);
    assert.match(refused.output,/paired-lifecycle-backup-required/u);
    assert.deepEqual(readFileSync(f.base.path),before);
    assert.equal(existsSync(join(f.base.root,"suspects")),false);
    assert.equal(existsSync(join(f.base.root,"archive.sqlite")),false);
    const restored = await composeStorageCommand(rebuildRuntimeIsolation,["restore","--from",backup.pairedManifestPath,"--json"],f.base.clock,repoRoot);
    assert.equal(restored.exitCode,0,restored.output);
    assert.deepEqual(readFileSync(join(f.base.root,"archive-files",file.digest)),bytes);
    f.reopen();
    assert.equal(f.kernel.execute(request).state,pending ? "applied" : "already-applied");
  } finally { f.dispose(); }
});

it("serializes archive deletion custody against another connection's uncommitted capture claim", () => {
  const f = archiveFixture();
  let second: AuthorityDatabase | undefined;
  try {
    const first = attachFile(f.database,f.base.root,f.base.run.envelope.runId,89800);
    f.terminal();
    assert.equal(f.kernel.execute(f.applyRequest(f.plan())).state,"applied");
    const other = f.base.createRun(id(89802));
    attachFile(f.database,f.base.root,other.envelope.runId,89810,first.bytes);
    f.database.authority.runs.transition({runId:other.envelope.runId,expectedVersion:other.version,
      lifecycle:{state:"terminal",outcome:"cancelled",endedAt:NOW},now:NOW});
    const row = f.plan(), request = f.applyRequest(row);
    f.database.authority.runs.delete({runId:f.base.run.envelope.runId,origin:"archive",commandId:id(89820),now:NOW});
    const settlement = AuthorityDatabase.open({path:f.base.path,busyTimeoutMs:25,migrationOwner:"custody-race"},f.base.clock);
    second = settlement;
    const original = f.database.claimVersionChange.bind(f.database);
    f.database.claimVersionChange = input => {
      const result = original(input);
      assert.equal(f.database.readVersionChange(row.changeId)?.pendingCaptures?.length,1);
      assert.equal(settlement.readVersionChange(row.changeId)?.pendingCaptures,undefined);
      assert.throws(() => settlement.settleArchivedDeletion(f.base.run.envelope.runId),/database is locked/u);
      assert.deepEqual(readFileSync(join(f.base.root,"archive-files",first.file.digest)),first.bytes);
      return result;
    };
    f.failAfter("readPendingReport");
    assert.throws(() => f.kernel.execute(request),/injected-readPendingReport/u);
    settlement.settleArchivedDeletion(f.base.run.envelope.runId);
    assert.deepEqual(readFileSync(join(f.base.root,"archive-files",first.file.digest)),first.bytes);
    f.reopen();
    assert.equal(f.kernel.execute(request).state,"applied");
    assert.ok(f.database.lifecycleArchive(true).readPublished(other.envelope.runId));
  } finally { second?.close(); f.dispose(); }
});
