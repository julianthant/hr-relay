import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/native-profile-probe.js";
import { runtimeLifetimeLock } from "../../../support/helpers/backend/runtime-lifetime.js";
import assert from "node:assert/strict";
import { mkdtempSync,realpathSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe,it } from "vitest";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService,verifyBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { OfflineAuthorityRestoreService } from "../../../../src/backend/storage/sqlite/offline-restore.js";
import { RecoveryStopProofStore } from "../../../../src/backend/storage/sqlite/recovery-stop-proof.js";
import { observeRuntimeLockSnapshot } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { explorerAuthorityFixture } from "../../../support/fixtures/explorer-authority.js";

const FIRST = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";

describe("Explorer SQLite command authority", () => {

  it("backs up and restores committed override, command and audit as one authority, then replays exactly", async () => {
    const workspace = mkdtempSync(join(realpathSync(tmpdir()), "explorer-native-restore-"));
    const lifetime = await runtimeLifetimeLock();
    const admission = acquireEntrypointAdmission(workspace, "exclusive", lifetime);
    const clock = manualClock(new Date("2026-09-13T10:00:00Z"));
    const path = join(admission.stateRoot, "state.db");
    const f = await explorerAuthorityFixture({ root: admission.stateRoot, path,
      open: () => AuthorityDatabase.open(admission, { path, busyTimeoutMs: 250, migrationOwner: "explorer-proof" }, clock),
      dispose: () => { admission.release(); rmSync(workspace, { recursive: true, force: true }); } });
    try {
      const command = f.command(FIRST);
      assert.equal(f.kernel.execute(command).state, "applied");
      const saved = f.database.authority.explorerOverrides.readAll();
      const audit = f.database.authority.commandAudits.findByCommand(FIRST);
      const directory = join(f.root, "backups");
      const backup = await new AuthorityBackupService(admission, f.database, { directory }, f.clock).request({
        trigger: "operator", requiredGeneration: f.database.getMeta().authorityGeneration,
      });
      const manifest = backup.manifests[0];
      assert.ok(manifest);
      const manifestPath = join(directory, `${manifest.backupFileName}.manifest.json`);
      assert.equal((await verifyBackupManifestAtPath(admission, manifestPath)).manifest.schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
      assert.equal(f.kernel.execute(f.command(SECOND, 1, "After backup")).state, "applied");
      f.database.close();
      const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(f.path);
      const processLockRoot = join(f.root, "locks");
      const proofs = new RecoveryStopProofStore({ processLockRoot, maxProofAgeMs: 60_000 }, f.clock);
      proofs.recordRuntimeState(observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity }, f.clock));
      const stoppedSystemProof = proofs.issue({ observedBy: "local-operator", sourceDatabaseIdentity });
      let rebuilds = 0;
      const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admission, { authorityPath: f.path,
        suspectDirectory: join(f.root, "backups", "suspects"), busyTimeoutMs: 250, processLockRoot, stoppedProofMaxAgeMs: 60_000,
      }, async staged => {
        const stageAdmission = admission.stoppedStagedAuthority(staged);
        try {
          const reopened = AuthorityDatabase.open(stageAdmission, { path: staged, busyTimeoutMs: 250, migrationOwner: "restore-proof" }, f.clock);
          try { assert.deepEqual(reopened.authority.explorerOverrides.readAll(), saved); rebuilds += 1; }
          finally { reopened.close(); }
        } finally { stageAdmission.release(); }
      }, f.clock);
      assert.equal((await restore.restore({ manifestPath, stoppedSystemProof })).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
      assert.equal(rebuilds, 1);
      f.restart();
      assert.deepEqual(f.database.authority.explorerOverrides.readAll(), saved);
      assert.deepEqual(f.database.authority.commandAudits.findByCommand(FIRST), audit);
      assert.equal(f.database.authority.commands.get(SECOND), undefined);
      assert.equal(f.kernel.execute(command).state, "already-applied");
      assert.equal(f.read().workflows.find(row => row.id === "person-lookup")?.label, "People search");
    } finally { await f.dispose(); }
  });
});
