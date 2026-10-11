import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { acquireEntrypointAdmission } from "../../../../../../src/backend/storage/admission/bootstrap-admission.js";
import { join } from "node:path";
import { describe, it } from "vitest";
import { AuthorityDatabase } from "../../../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService, verifyBackupManifestAtPath } from "../../../../../../src/backend/storage/sqlite/backup-service.js";
import { OfflineAuthorityRestoreService } from "../../../../../../src/backend/storage/sqlite/offline-restore.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../../../src/backend/storage/sqlite/migrations.js";
import { RecoveryStopProofStore } from "../../../../../../src/backend/storage/sqlite/recovery-stop-proof.js";
import { observeRuntimeLockSnapshot } from "../../../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { explorerAuthorityFixture } from "../../../../../support/fixtures/explorer-authority.js";

const FIRST = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";
const THIRD = "33333333-3333-4333-8333-333333333333";

describe("Explorer SQLite command authority", () => {
  it("commits one override revision and one audit in the command transaction, with hot readback and restart replay", () => {
    const f = explorerAuthorityFixture();
    try {
      const command = f.command(FIRST);
      const generation = f.database.getMeta().authorityGeneration;
      assert.equal(f.kernel.execute(command).state, "applied");
      assert.equal(f.transactionCount, 1);
      assert.equal(f.database.getMeta().authorityGeneration, generation + 1);
      const saved = f.database.authority.explorerOverrides.read("person-lookup");
      assert.equal(saved?.revision, 1);
      assert.equal(saved?.presentation.label, "People search");
      assert.equal(f.database.authority.commandAudits.findByCommand(FIRST)?.result.state, "applied");
      assert.equal(f.read().workflows.find(row => row.id === "person-lookup")?.label, "People search");
      f.restart();
      assert.equal(f.kernel.execute(command).state, "already-applied");
      assert.equal(f.database.getMeta().authorityGeneration, generation + 1);
      assert.deepEqual(f.database.authority.explorerOverrides.read("person-lookup"), saved);
      f.restart();
      assert.equal(f.kernel.execute(command).state, "already-applied");
      assert.equal(f.read().workflows.find(row => row.id === "person-lookup")?.label, "People search");
    } finally { f.dispose(); }
  });

  it("backs up and restores committed override, command and audit as one authority, then replays exactly", async () => {
    const workspace = mkdtempSync(join(realpathSync(tmpdir()), "explorer-native-restore-"));
    const admission = acquireEntrypointAdmission(workspace, "exclusive");
    const clock = manualClock(new Date("2026-09-13T10:00:00Z"));
    const path = join(admission.stateRoot, "state.db");
    const f = explorerAuthorityFixture({ root: admission.stateRoot, path,
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
      const restore = new OfflineAuthorityRestoreService(admission, { authorityPath: f.path,
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
    } finally { f.dispose(); }
  });

  it("refuses an executor's fabricated successful readback when the transaction repository has no override", () => {
    const f = explorerAuthorityFixture();
    try {
      f.omitOverrideWrite(true);
      assert.throws(() => f.kernel.execute(f.command(FIRST)), /readback that does not exactly advance/u);
      assert.equal(f.database.authority.commands.get(FIRST), undefined);
      assert.equal(f.database.authority.commandAudits.findByCommand(FIRST), undefined);
      assert.deepEqual(f.database.authority.explorerOverrides.readAll(), []);
      f.omitOverrideWrite(false);
      assert.equal(f.kernel.execute(f.command(SECOND)).state, "applied");
    } finally { f.dispose(); }
  });

  it("rolls back override, revision, command, audit and generation on audit failure; stale then valid competitors work", () => {
    const f = explorerAuthorityFixture();
    try {
      const generation = f.database.getMeta().authorityGeneration;
      f.failAudit(true);
      assert.throws(() => f.kernel.execute(f.command(FIRST)), /injected Explorer audit failure/u);
      assert.equal(f.database.getMeta().authorityGeneration, generation);
      assert.deepEqual(f.database.authority.explorerOverrides.readAll(), []);
      assert.equal(f.database.authority.commands.get(FIRST), undefined);
      assert.equal(f.database.authority.commandAudits.findByCommand(FIRST), undefined);
      f.failAudit(false);
      assert.equal(f.kernel.execute(f.command(SECOND, 1)).state, "conflict");
      assert.equal(f.database.authority.commands.get(SECOND), undefined);
      assert.equal(f.kernel.execute(f.command(THIRD, 0, "Directory search")).state, "applied");
      assert.equal(f.kernel.execute(f.command(FIRST)).state, "conflict");
      assert.equal(f.database.authority.explorerOverrides.read("person-lookup")?.presentation.label, "Directory search");
    } finally { f.dispose(); }
  });

  it.each(["reason", "requestedAt", "source", "requestedBy"] as const)("refuses a divergent %s on restart replay before mutation", field => {
    const f = explorerAuthorityFixture();
    try {
      const command = f.command(FIRST);
      assert.equal(f.kernel.execute(command).state, "applied");
      f.restart();
      const value = field === "requestedAt" ? "2026-09-13T11:00:00Z" : field === "source" ? "cli" : field === "requestedBy" ? "other-operator" : "Changed reason";
      assert.throws(() => f.kernel.execute({ ...command, [field]: value }), /reused|identity|different/u);
      assert.equal(f.database.authority.explorerOverrides.read("person-lookup")?.revision, 1);
    } finally { f.dispose(); }
  });

  it("refuses stale descriptor/version/revision and restores appearance through a new revision", () => {
    const f = explorerAuthorityFixture();
    try {
      const command = f.command(FIRST);
      for (const target of [ { expectedVersion: command.target.expectedVersion + 1 }, { contractFingerprint: "0".repeat(64) }, { expectedOverrideRevision: 8 } ]) {
        assert.equal(f.kernel.execute({ ...command, target: { ...command.target, ...target } }).state, "conflict");
        assert.equal(f.database.authority.commands.get(FIRST), undefined);
      }
      assert.equal(f.kernel.execute(command).state, "applied");
      assert.equal(f.kernel.execute(f.command(SECOND, 1, f.descriptor.label)).state, "applied");
      assert.equal(f.read().workflows.find(row => row.id === "person-lookup")?.label, f.descriptor.label);
      assert.equal(f.database.authority.explorerOverrides.read("person-lookup")?.revision, 2);
      assert.equal(f.kernel.execute(command).state, "already-applied");
    } finally { f.dispose(); }
  });
});
