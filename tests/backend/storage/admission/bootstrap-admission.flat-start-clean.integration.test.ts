import assert from "node:assert/strict";
import nativeFs, { existsSync, readFileSync, readdirSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { it, vi } from "vitest";
import { acquireDashboardEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { composeProfileRuntime } from "../../../../src/backend/app/composition/storage-compose.js";
import { retainedStorageBackup, StorageBackupSchema, file } from "../../../../src/backend/storage/maintenance/existing-data-backup-files.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { createHistoricalFlatProfileFixture } from "../../../support/fixtures/storage/historical-flat-profile-fixture.js";

it("backs up a flat store without credentials, starts empty, and accepts an ordinary fresh sign-up", async () => {
  const f = await createHistoricalFlatProfileFixture();
  try {
    const machine = await acquireDashboardEntrypointAdmission(f.workspace, "shared", f.lifetime);
    try {
      assert.equal(machine.requiresFlatStoreMigration(), false);
      assert.deepEqual(machine.readProfileRegistry().profiles, []);
      assert.equal(existsSync(f.databasePath), false);
      assert.equal(existsSync(join(f.stateRoot, "credentials")), false);
      const reference = retainedStorageBackup(f.workspace, machine.locator.installationId); assert.ok(reference);
      const record = StorageBackupSchema.parse(JSON.parse(file(reference.backupPath).bytes.toString("utf8")));
      assert.equal(record.files.some(entry => entry.path.startsWith("profile/credentials/")), false);
      assert.ok(record.files.some(entry => entry.path.startsWith("profile/backups/authority/") && entry.path.endsWith(".sqlite")));
      assert.equal(existsSync(join(f.workspace, ".tracker", "control", "flat-start-clean.json")), false);
      const profile = composeProfileRuntime({ admission: machine,  hostFacts: { primaryDisplay: null }, clock: systemClock });
      try {
        const draft = profile.session.signUp({ firstName: "Fresh", lastName: "Fixture", email: "fresh-fixture@ucsd.edu", password: "disposable-new-password", createdAt: systemClock.now().toISOString() });
        assert.equal(draft.state, "onboarding");
        assert.deepEqual(machine.readProfileRegistry().profiles, []);
        if (draft.state !== "onboarding") throw new Error("fresh draft required");
        assert.deepEqual(await profile.session.cancelOnboarding(draft.token, draft.operationId), { state: "signed-out" });
        assert.equal(existsSync(join(machine.stateRoot, "profiles", draft.profileId)), false);
      } finally { await profile.close(); }
    } finally { machine.release(); }
    const restarted = await acquireDashboardEntrypointAdmission(f.workspace, "shared", f.lifetime);
    assert.deepEqual(restarted.readProfileRegistry().profiles, []); restarted.release();
  } finally { await f.close(); }
});

for (const fault of ["write", "verification"] as const) {
  it(`refuses startup on backup ${fault} failure and retains non-credential source data`, async () => {
    const f = await createHistoricalFlatProfileFixture(), before = readFileSync(f.databasePath), artifact = readFileSync(f.artifact);
    const write = nativeFs.writeFileSync, rename = nativeFs.renameSync;
    const writeSpy = vi.spyOn(nativeFs, "writeFileSync").mockImplementation((path, data, options) => {
      if (fault === "write" && String(path).includes("storage-backups") && String(path).endsWith("source.json")) throw new Error("fixture backup write failure");
      write(path, data, options);
    });
    const renameSpy = vi.spyOn(nativeFs, "renameSync").mockImplementation((source, destination) => {
      rename(source, destination);
      if (fault === "verification" && String(destination).includes("backups/authority/") && String(destination).endsWith(".manifest.json")) {
        nativeFs.writeFileSync(destination, "{}", { mode: 0o600 });
      }
    });
    syncBuiltinESMExports();
    try {
      await assert.rejects(acquireDashboardEntrypointAdmission(f.workspace, "shared", f.lifetime), error => error instanceof Error && "code" in error && error.code === "PROFILE_FLAT_STORE_MIGRATION_FAILED");
      assert.deepEqual(readFileSync(f.databasePath), before);
      assert.deepEqual(readFileSync(f.artifact), artifact);
      assert.equal(existsSync(join(f.stateRoot, "credentials")), false);
      assert.equal(existsSync(join(f.stateRoot, "machine")), false);
      assert.equal(existsSync(join(f.workspace, ".tracker", "control", "profile-registry.json")), false);
      assert.equal(readdirSync(join(f.stateRoot, "artifacts")).length > 0, true);
    } finally { writeSpy.mockRestore(); renameSpy.mockRestore(); syncBuiltinESMExports(); await f.close(); }
  });
}

for (const boundary of ["database", "registry"] as const) {
  it(`resumes the verified migration after interrupted ${boundary} removal or publication`, async () => {
    const f = await createHistoricalFlatProfileFixture(), unlink = nativeFs.unlinkSync, rename = nativeFs.renameSync;
    let interrupted = false;
    const unlinkSpy = vi.spyOn(nativeFs, "unlinkSync").mockImplementation(path => {
      unlink(path);
      if (!interrupted && boundary === "database" && String(path) === f.databasePath) { interrupted = true; throw new Error("fixture migration interrupted"); }
    });
    const renameSpy = vi.spyOn(nativeFs, "renameSync").mockImplementation((source, destination) => {
      rename(source, destination);
      if (!interrupted && boundary === "registry" && String(destination) === join(f.stateRoot, "machine", "profiles.json")) { interrupted = true; throw new Error("fixture migration interrupted"); }
    });
    syncBuiltinESMExports();
    try { await assert.rejects(acquireDashboardEntrypointAdmission(f.workspace, "shared", f.lifetime)); }
    finally { unlinkSpy.mockRestore(); renameSpy.mockRestore(); syncBuiltinESMExports(); }
    try {
      assert.equal(interrupted, true);
      const machine = await acquireDashboardEntrypointAdmission(f.workspace, "shared", f.lifetime);
      try {
        assert.deepEqual(machine.readProfileRegistry().profiles, []);
        assert.ok(retainedStorageBackup(f.workspace, machine.locator.installationId));
        assert.equal(existsSync(f.databasePath), false);
        assert.equal(existsSync(join(f.workspace, ".tracker", "control", "flat-start-clean.json")), false);
      } finally { machine.release(); }
    } finally { await f.close(); }
  });
}
