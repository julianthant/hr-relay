import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/native-profile-probe.js";
import { createStorageBackupLocationFixtures } from "../../../support/helpers/storage/storage-relocation-fixture.js";
import assert from "node:assert/strict";

import { existsSync, readFileSync, rmSync } from "node:fs";

import { join } from "node:path";
import { afterEach,it } from "vitest";




import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { OfflineAuthorityRestoreService } from "../../../../src/backend/storage/sqlite/offline-restore.js";
import { RecoveryStopProofStore } from "../../../../src/backend/storage/sqlite/recovery-stop-proof.js";
import { observeRuntimeLockSnapshot } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { doctorAuthorityStorage } from "../../../../src/backend/storage/sqlite/storage-doctor.js";

import { manualClock } from "../../../../src/rules/time/clock.js";

const clock = manualClock(new Date("2026-09-26T12:00:00.000Z"));
const workspaces: string[] = [];
afterEach(() => { for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true }); });

const { movedFixture } = createStorageBackupLocationFixtures(workspaces, clock);

it("refuses a same-origin pre-relocation native backup before any restore effect", async () => {
  const f = await movedFixture(true);
  try {
    const authorityPath = f.options.authorityPath;
    const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(authorityPath);
    const report = await doctorAuthorityStorage(f.admission, f.options, clock);
    const candidate = report.restoreCandidates.find(row => row.state === "verified-compatible"
      && row.restoreEligibility.state === "unavailable");
    assert.ok(candidate?.state === "verified-compatible");
    const manifestFileName = candidate.manifestFileName;
    assert.equal(candidate.restoreEligibility.state, "unavailable");
    const proofStore = new RecoveryStopProofStore({ processLockRoot: join(f.destination.stateRoot, "locks"),
      maxProofAgeMs: 300_000 }, clock);
    proofStore.recordRuntimeState(observeRuntimeLockSnapshot({ processLockRoot: join(f.destination.stateRoot, "locks"),
      sourceDatabaseIdentity }, clock));
    const stoppedSystemProof = proofStore.issue({ observedBy: "local-operator", sourceDatabaseIdentity });
    const options = { authorityPath, suspectDirectory: join(f.destination.stateRoot, "backups", "suspects"), busyTimeoutMs: 250,
      processLockRoot: join(f.destination.stateRoot, "locks"), stoppedProofMaxAgeMs: 300_000 };
    const request = { manifestPath: join(f.options.backupDirectory, manifestFileName), stoppedSystemProof };
    const before = readFileSync(authorityPath);
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, f.admission, options, async () => undefined, clock).restore(request);
    await assert.rejects(restore, /pre-relocation|relocation|restore.*admi|activation/u);
    assert.deepEqual(readFileSync(authorityPath), before);
    assert.equal(existsSync(options.suspectDirectory), false);
    assert.equal(existsSync(join(f.destination.stateRoot, ".lifecycle-restore.json")), false);
    assert.equal(existsSync(join(options.processLockRoot, "restore-admission.lock.json")), false);
  } finally { f.admission.release(); }
});
