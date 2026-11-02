import { FlatStartCleanIntentSchema } from "../../../../src/backend/storage/maintenance/flat-start-clean.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { profileBrowserClosure } from "../../../../src/backend/storage/browser-roots.js";
import assert from "node:assert/strict";
import nativeFs, { existsSync, readFileSync, readdirSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { it, vi } from "vitest";
import { acquireDashboardEntrypointAdmission, acquireStorageBackupEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { composeProfileRuntime } from "../../../../src/backend/app/composition/storage-compose.js";
import { retainedStorageBackup, StorageBackupSchema, file, hash } from "../../../../src/backend/storage/maintenance/existing-data-backup-files.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { createHistoricalFlatProfileFixture } from "../../../support/fixtures/storage/historical-flat-profile-fixture.js";

it("backs up a flat store without credentials, starts empty, and accepts an ordinary fresh sign-up", async () => {
  const f = await createHistoricalFlatProfileFixture();
  try {
    const machine = await acquireDashboardEntrypointAdmission(profileBrowserClosure, f.workspace, "shared", f.lifetime);
    try {
      assert.equal(machine.requiresFlatStoreMigration(), false);
      assert.deepEqual(machine.readProfileRegistry().profiles, []);
      assert.equal(existsSync(f.databasePath), false);
      assert.equal(existsSync(join(f.stateRoot, "credentials")), false);
      const reference = retainedStorageBackup(f.workspace, machine.locator.installationId); assert.ok(reference);
      const record = StorageBackupSchema.parse(JSON.parse(file(reference.backupPath).bytes.toString("utf8")));
      assert.equal(record.files.some(entry => entry.path.startsWith("profile/credentials/")), false);
      assert.ok(record.files.some(entry => entry.path === "profile/state.db"));
      assert.equal(record.kind, "flat-native6-archive");
      assert.equal(existsSync(join(f.workspace, ".tracker", "control", "flat-start-clean.json")), false);
      const completed = FlatStartCleanIntentSchema.parse(JSON.parse(readFileSync(join(f.workspace, ".tracker", "control", "flat-start-clean-complete.json"), "utf8")));
      assert.equal(completed.phase, "complete"); assert.equal(completed.operationId, record.operationId);
      assert.ok(completed.result);
      assert.equal(completed.result.registryDigest, hash(Buffer.from(canonicalJsonStringify(machine.readProfileRegistry()))));
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
    const restarted = await acquireDashboardEntrypointAdmission(profileBrowserClosure, f.workspace, "shared", f.lifetime);
    assert.deepEqual(restarted.readProfileRegistry().profiles, []); restarted.release();
  } finally { await f.close(); }
});

for (const fault of ["write", "verification"] as const) {
  it(`refuses startup on backup ${fault} failure and retains all source data`, async () => {
    const f = await createHistoricalFlatProfileFixture(), before = readFileSync(f.databasePath), artifact = readFileSync(f.artifact), credentials = readFileSync(f.protectedPath);
    const write = nativeFs.writeFileSync;
    const writeSpy = vi.spyOn(nativeFs, "writeFileSync").mockImplementation((path, data, options) => {
      if (fault === "write" && String(path).includes("storage-backups") && String(path).endsWith("source.json")) throw new Error("fixture backup write failure");
      write(path, data, options);
      if (fault === "verification" && String(path).includes("storage-backups/") && String(path).endsWith("backup.json")) write(path, "{}", { mode: 0o600 });
    });
    syncBuiltinESMExports();
    try {
      await assert.rejects(acquireDashboardEntrypointAdmission(profileBrowserClosure, f.workspace, "shared", f.lifetime), error => error instanceof Error && "code" in error && error.code === "PROFILE_FLAT_STORE_MIGRATION_FAILED");
      assert.deepEqual(readFileSync(f.databasePath), before);
      assert.deepEqual(readFileSync(f.artifact), artifact);
      assert.deepEqual(readFileSync(f.protectedPath), credentials);
      assert.equal(existsSync(join(f.stateRoot, "credentials")), true);
      assert.equal(existsSync(join(f.stateRoot, "machine")), false);
      assert.equal(existsSync(join(f.workspace, ".tracker", "control", "profile-registry.json")), false);
      assert.equal(readdirSync(join(f.stateRoot, "artifacts")).length > 0, true);
    } finally { writeSpy.mockRestore(); syncBuiltinESMExports(); await f.close(); }
  });
}

for (const boundary of ["database", "registry", "completion"] as const) for (const tampered of [false, true]) {
  it(`${tampered ? "refuses changed backup binding" : "resumes verified migration"} after interrupted ${boundary} removal or publication`, async () => {
    const f = await createHistoricalFlatProfileFixture(), unlink = nativeFs.unlinkSync, rename = nativeFs.renameSync;
    let interrupted = false;
    const unlinkSpy = vi.spyOn(nativeFs, "unlinkSync").mockImplementation(path => {
      unlink(path);
      if (!interrupted && boundary === "database" && String(path) === f.databasePath) { interrupted = true; throw new Error("fixture migration interrupted"); }
    });
    const renameSpy = vi.spyOn(nativeFs, "renameSync").mockImplementation((source, destination) => {
      if (!interrupted && boundary === "completion" && String(destination) === join(f.workspace, ".tracker", "control", "flat-start-clean-complete.json")) {
        interrupted = true; throw new Error("fixture completion interrupted");
      }
      rename(source, destination);
      if (!interrupted && boundary === "registry" && String(destination) === join(f.stateRoot, "machine", "profiles.json")) { interrupted = true; throw new Error("fixture migration interrupted"); }
    });
    syncBuiltinESMExports();
    try { await assert.rejects(acquireDashboardEntrypointAdmission(profileBrowserClosure, f.workspace, "shared", f.lifetime)); }
    finally { unlinkSpy.mockRestore(); renameSpy.mockRestore(); syncBuiltinESMExports(); }
    try {
      assert.equal(interrupted, true);
      if (tampered) {
        const path = join(f.workspace, ".tracker", "control", "flat-start-clean.json");
        const original = readFileSync(path, "utf8");
        const changed = original.replace(/("backupDigest"\s*:\s*")[a-f0-9]{64}/u, (_match, prefix: string) => `${prefix}${"0".repeat(64)}`);
        assert.notEqual(changed, original);
        nativeFs.writeFileSync(path, changed, { mode: 0o600 });
        const before = storageTree(f.workspace);
        await assert.rejects(acquireDashboardEntrypointAdmission(profileBrowserClosure, f.workspace, "shared", f.lifetime), /storage-backup-binding-refused/u);
        assert.deepEqual(storageTree(f.workspace), before);
        return;
      }
      const machine = await acquireDashboardEntrypointAdmission(profileBrowserClosure, f.workspace, "shared", f.lifetime);
      try {
        assert.deepEqual(machine.readProfileRegistry().profiles, []);
        assert.ok(retainedStorageBackup(f.workspace, machine.locator.installationId));
        assert.equal(existsSync(f.databasePath), false);
        assert.equal(existsSync(join(f.workspace, ".tracker", "control", "flat-start-clean.json")), false);
      } finally { machine.release(); }
    } finally { await f.close(); }
  });
}

for (const change of ["missing-later", "unknown-member", "pepper"] as const) {
  it(`refuses ${change} after an authorized unlink without erasing another member or probing a browser`, async () => {
    const f = await createHistoricalFlatProfileFixture(), unlink = nativeFs.unlinkSync;
    let interrupted = false;
    const spy = vi.spyOn(nativeFs, "unlinkSync").mockImplementation(path => {
      unlink(path);
      if (!interrupted && String(path) === f.artifact) { interrupted = true; throw new Error("fixture erase interrupted"); }
    });
    syncBuiltinESMExports();
    try { await assert.rejects(acquireDashboardEntrypointAdmission(profileBrowserClosure, f.workspace, "shared", f.lifetime)); }
    finally { spy.mockRestore(); syncBuiltinESMExports(); }
    try {
      assert.equal(interrupted, true);
      const control = join(f.workspace, ".tracker", "control");
      const intent = FlatStartCleanIntentSchema.parse(JSON.parse(readFileSync(join(control, "flat-start-clean.json"), "utf8")));
      assert.equal(intent.pending, true);
      const parked = storageTree(f.workspace);
      await assert.rejects(acquireStorageBackupEntrypointAdmission(f.workspace, f.lifetime), /flat-start-clean-pending/u);
      assert.deepEqual(storageTree(f.workspace), parked);
      if (change === "missing-later") unlink(f.databasePath);
      if (change === "unknown-member") nativeFs.writeFileSync(join(f.stateRoot, "unknown"), "unknown", { mode: 0o600 });
      if (change === "pepper") nativeFs.writeFileSync(join(control, `.flat-start-clean-${intent.operationId}.pepper`), Buffer.alloc(32), { mode: 0o600 });
      const before = storageTree(f.workspace), credentials = readFileSync(f.protectedPath);
      let probes = 0;
      await assert.rejects(acquireDashboardEntrypointAdmission({ workerDirectory: input => profileBrowserClosure.workerDirectory(input),
        async probeClosed() { probes++; throw new Error("changed source must refuse before native probe"); } }, f.workspace, "shared", f.lifetime));
      assert.equal(probes, 0); assert.deepEqual(readFileSync(f.protectedPath), credentials);
      assert.deepEqual(storageTree(f.workspace), before);
      assert.equal(existsSync(join(f.stateRoot, "machine")), false);
    } finally { await f.close(); }
  });
}

it("refuses an unbound encrypted credential layout before browser preparation or archive publication", async () => {
  const f = await createHistoricalFlatProfileFixture();
  try {
    nativeFs.writeFileSync(f.protectedPath, JSON.stringify({ schemaVersion: 4, algorithm: "aes-256-gcm", keyId: "unbound", ciphertext: "unknown" }), { mode: 0o600 });
    const before = storageTree(f.workspace);
    let probes = 0;
    await assert.rejects(acquireDashboardEntrypointAdmission({ workerDirectory: input => profileBrowserClosure.workerDirectory(input),
      async probeClosed() { probes++; throw new Error("unsupported layout must refuse before native probe"); } }, f.workspace, "shared", f.lifetime),
    error => error instanceof Error && "code" in error && error.code === "PROFILE_FLAT_STORE_MIGRATION_FAILED");
    assert.equal(probes, 0); assert.deepEqual(storageTree(f.workspace), before);
    assert.equal(existsSync(join(f.workspace, ".tracker", "control", "storage-backups")), false);
  } finally { await f.close(); }
});
