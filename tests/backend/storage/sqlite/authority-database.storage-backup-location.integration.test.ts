import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,it } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { acquireExclusiveRuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { backupStoppedAuthority } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { OfflineAuthorityRestoreService } from "../../../../src/backend/storage/sqlite/offline-restore.js";
import { RecoveryStopProofStore } from "../../../../src/backend/storage/sqlite/recovery-stop-proof.js";
import { observeRuntimeLockSnapshot } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { doctorAuthorityStorage } from "../../../../src/backend/storage/sqlite/storage-doctor.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { plan,relocate } from "../../../support/helpers/storage/storage-relocation-fixture.js";
const clock = manualClock(new Date("2026-09-26T12:00:00.000Z"));
const workspaces: string[] = [];
afterEach(() => { for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true }); });

async function movedFixture(artifactOnly = false) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "backup-location-")); workspaces.push(root);
  const workspace = join(root, "workspace"); mkdirSync(workspace, {mode: 0o700});
  const initial = acquireEntrypointAdmission(workspace, "exclusive");
  let source = { stateRoot: initial.stateRoot, artifactRoot: initial.artifactRoot };
  try {
    const database = AuthorityDatabase.open(initial, { path: join(initial.stateRoot, "state.db"),
      busyTimeoutMs: 250, migrationOwner: "backup-location-fixture" }, clock);
    try {
      const resolved = resolveConfigWithProvenance({}, hostConfigFacts({}), clock, initial);
      database.authority.runtimeConfig.initialize({ configSnapshotId: randomUUID(), revision: 1,
        fingerprint: resolved.fingerprint, capturedAt: clock.now().toISOString(), capturedBy: "local-operator",
        config: resolved.config, provenance: resolved.provenance });
    } finally { database.close(); }
    await backupStoppedAuthority(initial, initial.stateRoot, clock, join(initial.stateRoot, "locks"));
  } finally { initial.release(); }
  if (artifactOnly) {
    const exterior = { stateRoot: join(root, "exterior-state"), artifactRoot: join(root, "exterior-artifacts") };
    const first = plan(workspace, exterior); await relocate(workspace, first.commandId);
    source = exterior;
  }
  const destination = artifactOnly ? { stateRoot: source.stateRoot, artifactRoot: join(root,"moved-artifacts") }
    : { stateRoot: join(root,"moved-state"), artifactRoot: join(root,"moved-artifacts") };
  const request = plan(workspace, destination); await relocate(workspace, request.commandId);
  const admission = acquireExclusiveRuntimeAdmission(workspace);
  const options = { stateRootTrustAnchor: root, stateRoot: destination.stateRoot,
    authorityPath: join(destination.stateRoot,"state.db"), backupDirectory: join(destination.stateRoot,"backups","authority"), busyTimeoutMs:250 };
  return { workspace, source, destination, admission, options };
}

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
    const restore = new OfflineAuthorityRestoreService(f.admission, options, async () => undefined, clock).restore(request);
    await assert.rejects(restore, /pre-relocation|relocation|restore.*admi|activation/u);
    assert.deepEqual(readFileSync(authorityPath), before);
    assert.equal(existsSync(options.suspectDirectory), false);
    assert.equal(existsSync(join(f.destination.stateRoot, ".lifecycle-restore.json")), false);
    assert.equal(existsSync(join(options.processLockRoot, "restore-admission.lock.json")), false);
  } finally { f.admission.release(); }
});
