import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it, vi } from "vitest";
import { composeProfileRuntime, initializeRegisteredPersonStores } from "../../../../src/backend/app/composition/storage-compose.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import type { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { OfflineAuthorityRestoreService } from "../../../../src/backend/storage/sqlite/offline-restore.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { manualClock, type TestClock } from "../../../../src/rules/time/clock.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";

const fields = (email: string, clock: TestClock) => ({ email, password: "disposable-fixture-password", at: clock.now().toISOString() });

function signIn(workspace: string, lifetime: RuntimeLifetimeLock, clock: TestClock, email: string) {
  const machine = acquireEntrypointAdmission(workspace, "shared", lifetime);
  const runtime = composeProfileRuntime({ admission: machine, clock, hostFacts: { primaryDisplay: null } });
  return { attempt: () => runtime.session.signIn(fields(email, clock)), async close() { await runtime.close("shutdown"); machine.release(); } };
}

async function assertHeld(workspace: string, lifetime: RuntimeLifetimeLock, clock: TestClock, email: string, code: string): Promise<void> {
  const session = signIn(workspace, lifetime, clock, email);
  try { assert.throws(session.attempt, { code }); } finally { await session.close(); }
}

function searchState(path: string): unknown {
  const database = new DatabaseSync(path, { readOnly: true });
  try { return database.prepare("SELECT search_state FROM database_states WHERE id=1").get()?.search_state; } finally { database.close(); }
}

const held = {
  "critical-fence-missing": "STORAGE_PROFILE_FORMAT_UNSUPPORTED",
  "unknown-record-field": "STORAGE_PROFILE_FORMAT_UNSUPPORTED",
  foreign: "STORAGE_AUTOMATIC_REPAIR_REFUSED",
  future: "STORAGE_PROFILE_NEWER_VERSION",
  unsupported: "STORAGE_PROFILE_FORMAT_UNSUPPORTED",
  "recovery-refusal": "STARTUP_CRASH_RECOVERY_REFUSED",
} as const;

for (const state of ["damaged", "projection-missing", ...Object.keys(held) as (keyof typeof held)[]] as const) it(`restores only SQLite-damaged startup authority and holds everything else: ${state}`, async () => {
  const f = await createBoundProfileFixture(), clock = manualClock(new Date("2026-11-02T12:00:00.000Z"));
  const profileId = f.admission.profileBinding.profileId, registryPath = join(f.machine.stateRoot, "machine", "profiles.json");
  const registry = f.machine.readProfileRegistry(), protectedPath = join(f.stateRoot, "credentials", "protected.json"), protectedBytes = readFileSync(protectedPath);
  const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "startup-repair-fixture" }, clock,
    undefined, undefined, undefined, boundProfileCredentials(f.admission));
  const directory = join(f.stateRoot, "backups", "authority");
  const transport = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("transport forbidden during startup repair"); });
  const restore = vi.spyOn(OfflineAuthorityRestoreService.prototype, "restoreNewest");
  try {
    if (state === "unknown-record-field") database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    const backup = await new AuthorityBackupService(f.admission, database, { directory }, clock).request({ trigger: "operator", requiredGeneration: database.getMeta().authorityGeneration });
    const manifest = backup.manifests[0]; assert.ok(manifest);
    database.close();
    const native = new DatabaseSync(f.path);
    try {
      if (state === "foreign") {
        const foreign = randomUUID(), trigger = native.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='database_states_binding_immutable'").get();
        assert.ok(trigger && typeof trigger.sql === "string");
        native.exec("DROP TRIGGER database_states_binding_immutable");
        try { native.prepare("UPDATE database_states SET profile_id=? WHERE id=1").run(foreign); }
        finally { native.exec(trigger.sql); }
      } else if (state === "future" || state === "unsupported") {
        const version = state === "future" ? CURRENT_AUTHORITY_SCHEMA_VERSION + 1 : 7;
        native.exec(`BEGIN EXCLUSIVE; UPDATE database_states SET schema_version=${version} WHERE id=1; PRAGMA user_version=${version}; COMMIT`);
      } else if (state === "unknown-record-field") {
        assert.equal(native.prepare("UPDATE settings SET payload_json=json_set(payload_json,'$.fieldFromANewerBuild',true) WHERE id='current'").run().changes, 1);
      } else if (state !== "recovery-refusal") native.exec(state === "critical-fence-missing" ? "DROP TABLE write_attempts" : "DROP TABLE run_search");
    } finally { native.close(); }
    const startBytes = readFileSync(f.path);
    writeFileSync(join(directory, "invalid-newer.manifest.json"), "invalid manifest", { mode: 0o600 });
    f.admission.release(); f.machine.release(); clock.advanceWall(1000);
    const classify = state === "damaged" ? vi.spyOn(AuthorityDatabase, "classifyStartupFailure").mockReturnValueOnce({ kind: "damaged" }) : undefined;
    const recovery = state === "recovery-refusal"
      ? vi.spyOn(AuthorityDatabase, "openStoppedStartupRecovery").mockImplementationOnce(() => { throw new Error("injected-recovery-admission-refusal"); }) : undefined;
    try { await initializeRegisteredPersonStores(f.workspace, f.lifetime, { primaryDisplay: null }, clock); }
    finally { classify?.mockRestore(); recovery?.mockRestore(); }
    const after = JSON.parse(readFileSync(registryPath, "utf8")) as { activeProfileId: string | null; sessionGeneration: number };
    if (state === "damaged") {
      assert.equal(restore.mock.calls.length, 1);
      assert.equal(after.activeProfileId, profileId); assert.equal(after.sessionGeneration, registry.sessionGeneration + 1);
      const notice = JSON.parse(readFileSync(join(f.workspace, ".tracker", "control", `automatic-repair-${profileId}.json`), "utf8")) as { profileId: string; backupTime: string };
      assert.equal(notice.profileId, profileId); assert.equal(notice.backupTime, manifest.createdAt);
      assert.equal(readdirSync(join(f.stateRoot, "backups", "suspects")).filter(name => name.endsWith(".sqlite")).length, 1);
    } else {
      assert.equal(restore.mock.calls.length, 0);
      assert.equal(after.activeProfileId, registry.activeProfileId); assert.equal(after.sessionGeneration, registry.sessionGeneration);
      assert.equal(existsSync(join(f.workspace, ".tracker", "control", `automatic-repair-${profileId}.json`)), false);
      assert.equal(existsSync(join(f.stateRoot, "backups", "suspects")), false);
    }
    assert.equal(existsSync(join(f.workspace, ".tracker", "control", "journal.json")), false);
    if (state === "damaged" || state === "projection-missing") {
      const readback = new DatabaseSync(f.path, { readOnly: true });
      try { assert.equal(readback.prepare("PRAGMA quick_check").get()?.quick_check, "ok"); assert.ok(readback.prepare("SELECT name FROM sqlite_master WHERE name='run_search'").get()); }
      finally { readback.close(); }
      if (state === "projection-missing") assert.equal(searchState(f.path), "ready");
      await initializeRegisteredPersonStores(f.workspace, f.lifetime, { primaryDisplay: null }, clock);
      assert.deepEqual(JSON.parse(readFileSync(registryPath, "utf8")), after);
      assert.equal(restore.mock.calls.length, state === "damaged" ? 1 : 0);
    } else {
      if (state !== "recovery-refusal") assert.deepEqual(readFileSync(f.path), startBytes);
      await assertHeld(f.workspace, f.lifetime, clock, "fixture@ucsd.edu", held[state]);
    }
    assert.deepEqual(readFileSync(protectedPath), protectedBytes); assert.equal(transport.mock.calls.length, 0);
  } finally { transport.mockRestore(); restore.mockRestore(); database.close(); await f.close(); }
});

it("classifies a non-SQLite or malformed person file as damaged and never as version skew", async () => {
  const f = await createBoundProfileFixture();
  const profileId = f.admission.profileBinding.profileId;
  try {
    f.admission.release(); f.machine.release();
    const original = readFileSync(f.path);
    const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
    try {
      for (const damage of ["not-a-database", "malformed-pages"] as const) {
        const bytes = Buffer.from(original);
        if (damage === "not-a-database") bytes.fill(0x5a, 0, 100);
        else bytes.fill(0xff, 4096);
        writeFileSync(f.path, bytes);
        assert.deepEqual(AuthorityDatabase.classifyStartupFailure(machine, profileId), { kind: "damaged" });
      }
    } finally { writeFileSync(f.path, original); machine.release(); }
  } finally { await f.close(); }
});

for (const heldSelected of [false, true]) it(`holds one person's version-skewed database while the other person upgrades, recovers and signs in (held person ${heldSelected ? "left selected" : "not selected"})`, async () => {
  const first = await createBoundProfileFixture(), clock = manualClock(new Date("2026-11-02T12:00:00.000Z"));
  createProfileRegistry(first.machine).advanceSession(null);
  first.admission.release(); first.machine.release();
  const second = await createBoundProfileFixture({ workspace: first.workspace, lifetime: first.lifetime, email: "second@ucsd.edu" });
  const registryPath = join(second.machine.stateRoot, "machine", "profiles.json"), secondProfileId = second.admission.profileBinding.profileId;
  try {
    if (!heldSelected) createProfileRegistry(second.machine).advanceSession(null);
    await second.closeController();
    const before = JSON.parse(readFileSync(registryPath, "utf8")) as { activeProfileId: string | null; sessionGeneration: number };
    assert.equal(before.activeProfileId, heldSelected ? secondProfileId : null);
    const native = new DatabaseSync(second.path);
    try { native.exec("DROP TABLE write_attempts"); } finally { native.close(); }
    const skewed = readFileSync(second.path);
    const restore = vi.spyOn(OfflineAuthorityRestoreService.prototype, "restoreNewest");
    try {
      await initializeRegisteredPersonStores(first.workspace, first.lifetime, { primaryDisplay: null }, clock);
      assert.equal(restore.mock.calls.length, 0);
    } finally { restore.mockRestore(); }
    assert.deepEqual(readFileSync(second.path), skewed);
    const after = JSON.parse(readFileSync(registryPath, "utf8")) as { activeProfileId: string | null; sessionGeneration: number };
    assert.equal(after.activeProfileId, null);
    assert.equal(after.sessionGeneration, before.sessionGeneration + (heldSelected ? 1 : 0));
    await assertHeld(first.workspace, first.lifetime, clock, "second@ucsd.edu", "STORAGE_PROFILE_FORMAT_UNSUPPORTED");
    const session = signIn(first.workspace, first.lifetime, clock, "fixture@ucsd.edu");
    try { const result = session.attempt(); assert.equal(result.state, "active", JSON.stringify(result)); } finally { await session.close(); }
  } finally { await first.close(); }
});
