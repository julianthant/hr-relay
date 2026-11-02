import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it, vi } from "vitest";
import { AutomaticPersonRepairRefusedError, initializeRegisteredPersonStores } from "../../../../src/backend/app/composition/storage-compose.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { OfflineAuthorityRestoreService } from "../../../../src/backend/storage/sqlite/offline-restore.js";
import { StartupCrashRecoveryRefusedError } from "../../../../src/backend/runs/lifecycle/startup-crash-recovery.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";

for (const state of ["projection-corrupt", "critical-fence-unreadable", "foreign", "recovery-refusal"] as const) it(`automatically repairs only provable same-person startup authority: ${state}`, async () => {
  const f = await createBoundProfileFixture(), clock = manualClock(new Date("2026-11-02T12:00:00.000Z"));
  const profileId = f.admission.profileBinding.profileId, registryPath = join(f.machine.stateRoot, "machine", "profiles.json");
  const registry = f.machine.readProfileRegistry(), protectedPath = join(f.stateRoot, "credentials", "protected.json"), protectedBytes = readFileSync(protectedPath);
  const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "startup-repair-fixture" }, clock,
    undefined, undefined, undefined, boundProfileCredentials(f.admission));
  const directory = join(f.stateRoot, "backups", "authority");
  const transport = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("transport forbidden during startup repair"); });
  try {
    const backup = await new AuthorityBackupService(f.admission, database, { directory }, clock).request({ trigger: "operator", requiredGeneration: database.getMeta().authorityGeneration });
    const manifest = backup.manifests[0]; assert.ok(manifest);
    database.close();
    const native = new DatabaseSync(f.path);
    try {
      if (state === "foreign") {
        const foreign = randomUUID(), trigger = native.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='database_states_binding_immutable'").get();
        assert.ok(trigger && typeof trigger.sql === "string");
        assert.throws(() => native.prepare("UPDATE database_states SET profile_id=? WHERE id=1").run(foreign), /profile-database-binding-immutable/u);
        native.exec("DROP TRIGGER database_states_binding_immutable");
        try { native.prepare("UPDATE database_states SET profile_id=? WHERE id=1").run(foreign); }
        finally { native.exec(trigger.sql); }
      }
      else if (state !== "recovery-refusal") native.exec(state === "projection-corrupt" ? "DROP TABLE run_search" : "DROP TABLE write_attempts");
    } finally { native.close(); }
    const corruptBytes = readFileSync(f.path);
    writeFileSync(join(directory, "invalid-newer.manifest.json"), "invalid manifest", { mode: 0o600 });
    f.admission.release(); f.machine.release(); clock.advanceWall(1000);
    if (state === "recovery-refusal") {
      const recovery = vi.spyOn(AuthorityDatabase, "openStoppedStartupRecovery").mockImplementationOnce(() => { throw new Error("injected-recovery-admission-refusal"); });
      const repair = vi.spyOn(OfflineAuthorityRestoreService.prototype, "restoreNewest");
      try {
        await assert.rejects(initializeRegisteredPersonStores(f.workspace, f.lifetime, { primaryDisplay: null }, clock),
          error => error instanceof StartupCrashRecoveryRefusedError && error.cause instanceof Error && error.cause.message === "injected-recovery-admission-refusal");
        assert.equal(repair.mock.calls.length, 0);
        assert.deepEqual(readFileSync(f.path), corruptBytes);
        assert.equal(existsSync(join(f.workspace, ".tracker", "control", "journal.json")), false);
        assert.equal(existsSync(join(f.stateRoot, "backups", "suspects")), false);
      } finally { recovery.mockRestore(); repair.mockRestore(); }
    } else if (state !== "projection-corrupt") {
      await assert.rejects(initializeRegisteredPersonStores(f.workspace, f.lifetime, { primaryDisplay: null }, clock), AutomaticPersonRepairRefusedError);
      assert.deepEqual(readFileSync(f.path), corruptBytes);
      assert.equal(existsSync(join(f.workspace, ".tracker", "control", "journal.json")), false);
      assert.equal(existsSync(join(f.stateRoot, "backups", "suspects")), false);
    } else {
      await initializeRegisteredPersonStores(f.workspace, f.lifetime, { primaryDisplay: null }, clock);
      const after = JSON.parse(readFileSync(registryPath, "utf8")) as { activeProfileId: string | null; sessionGeneration: number };
      assert.equal(after.activeProfileId, null); assert.equal(after.sessionGeneration, registry.sessionGeneration + 1);
      const notice = JSON.parse(readFileSync(join(f.workspace, ".tracker", "control", `automatic-repair-${profileId}.json`), "utf8")) as { profileId: string; backupTime: string };
      assert.equal(notice.profileId, profileId); assert.equal(notice.backupTime, manifest.createdAt);
      assert.equal(existsSync(join(f.workspace, ".tracker", "control", "journal.json")), false);
      assert.equal(readdirSync(join(f.stateRoot, "backups", "suspects")).filter(name => name.endsWith(".sqlite")).length, 1);
      const readback = new DatabaseSync(f.path, { readOnly: true });
      try { assert.deepEqual(readback.prepare("PRAGMA quick_check").get()?.quick_check, "ok"); assert.ok(readback.prepare("SELECT name FROM sqlite_master WHERE name='run_search'").get()); }
      finally { readback.close(); }
      await initializeRegisteredPersonStores(f.workspace, f.lifetime, { primaryDisplay: null }, clock);
      assert.deepEqual(JSON.parse(readFileSync(registryPath, "utf8")), after);
    }
    assert.deepEqual(readFileSync(protectedPath), protectedBytes); assert.equal(transport.mock.calls.length, 0);
  } finally { transport.mockRestore(); database.close(); await f.close(); }
});
