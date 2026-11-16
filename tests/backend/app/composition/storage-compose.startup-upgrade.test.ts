import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync,mkdtempSync,rmSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it,vi } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { readLocalDebugLog } from "../../../../src/backend/storage/events/local-debug-log.js";
import { upgradeRegisteredPersonStores } from "../../../../src/backend/app/composition/storage-compose.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import * as upgrades from "../../../../src/backend/storage/maintenance/upgrade.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";

vi.mock("../../../../src/backend/storage/maintenance/upgrade.js", { spy: true });

it.each([false, true])("checks every registered ready person before any upgrade (invalid peer: %s)", async invalidPeer => {
  const workspace = mkdtempSync(join(tmpdir(), "startup-upgrade-orchestration-")), lifetime = await RuntimeLifetimeLock.acquire(0);
  mkdirSync(join(workspace, ".tracker", "control"), { recursive: true }); writeFileSync(join(workspace, ".tracker", "control", "installation.json"), "mock control");
  const first = randomUUID(), second = randomUUID(), pending = randomUUID(), events: string[] = [];
  let upgraded = false;
  const browserGate = Promise.withResolvers<void>();
  let browserUpgradeCompleted = false;
  const browserUpgrade = vi.fn(async () => { browserUpgradeCompleted = false; await browserGate.promise; browserUpgradeCompleted = true; return "current"; });
  const release = vi.fn(() => { assert.equal(browserUpgradeCompleted, true); events.push("release"); });
  const owner = { upgradeBrowserRoots: browserUpgrade, requiresFlatStoreMigration: () => false, readStartupProfileIds: () => [first, second], release };
  // @ts-expect-error This pure orchestration test replaces the native admission boundary.
  const acquire = vi.spyOn(RuntimeAdmission, "acquireStoppedMachineControlMaintenance").mockReturnValue(owner);
  // @ts-expect-error Only the schema result is consumed at this orchestration boundary.
  const inspect = vi.spyOn(AuthorityDatabase, "inspectRegisteredPersonAtStartup").mockImplementation((_machine, id) => {
    assert.equal(browserUpgradeCompleted, true);
    events.push(`inspect:${id}`);
    assert.notEqual(id, pending);
    if (invalidPeer && id === second) throw new Error("foreign registered peer");
    return { schemaVersion: id === first && !upgraded ? 8 : CURRENT_AUTHORITY_SCHEMA_VERSION };
  });
  const upgrade = vi.spyOn(upgrades, "upgradeProfileAtStartup").mockImplementation(async (_browser, _machine, id) => {
    events.push(`upgrade:${id}`); assert.equal(id, first);
    assert.deepEqual(events.slice(0, 3), [`inspect:${first}`, `inspect:${second}`, "release"]);
    upgraded = true;
    return { state: "upgraded", fromSchemaVersion: 8, toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, credentials: "unchanged" };
  });
  try {
    const pendingUpgrade = upgradeRegisteredPersonStores(workspace, lifetime, { primaryDisplay: null });
    assert.equal(browserUpgrade.mock.calls.length, 1); assert.deepEqual(events, []);
    browserGate.resolve();
    if (invalidPeer) {
      await pendingUpgrade;
      assert.equal(upgrade.mock.calls.length, 1); assert.equal(release.mock.calls.length, 3);
    } else {
      await pendingUpgrade;
      assert.equal(upgrade.mock.calls.length, 1); assert.equal(release.mock.calls.length, 3);
      const before = upgrade.mock.calls.length;
      await upgradeRegisteredPersonStores(workspace, lifetime, { primaryDisplay: null });
      assert.equal(upgrade.mock.calls.length, before);
    }
    assert.equal(browserUpgrade.mock.calls.length, acquire.mock.calls.length);
  } finally { browserGate.resolve(); upgrade.mockRestore(); inspect.mockRestore(); acquire.mockRestore(); await lifetime.close(); rmSync(workspace, { recursive: true }); }
});


it("refuses a fabricated logout conversion before any publication", () => {
  // @ts-expect-error An unissued conversion has neither the native proof nor its installation lease.
  assert.throws(() => AuthorityDatabase.consumeStartupLogoutConversion(Object.freeze({}), undefined), /conversion-unissued/u);
});

function sqliteFailure(): Error {
  const database = new DatabaseSync(":memory:");
  try { database.exec("SELECT * FROM private_canary"); } catch (error) { if (error instanceof Error) return error; } finally { database.close(); }
  throw new Error("sqlite-failure-expected");
}

it.each(["profile-startup-inspection", "profile-startup-upgrade", "profile-startup-readback"] as const)("names a raw failure at %s by area, class and SQLite code without its text", async area => {
  for (const [failure, cause] of [[sqliteFailure(), { message: "Error", code: "ERR_SQLITE_ERROR", reason: "sqlite-errcode-1" }],
    [new Error("Private Canary 123-45-6789"), { message: "Error", code: "INTERNAL_FAILURE", reason: "cause-unavailable" }]] as const) {
    const workspace = mkdtempSync(join(tmpdir(), "startup-upgrade-refusal-log-")), lifetime = await RuntimeLifetimeLock.acquire(0), id = randomUUID();
    mkdirSync(join(workspace, ".tracker", "control"), { recursive: true }); writeFileSync(join(workspace, ".tracker", "control", "installation.json"), "mock control");
    let inspections = 0;
    const owner = { upgradeBrowserRoots: async () => "current", requiresFlatStoreMigration: () => false, readStartupProfileIds: () => [id], release: () => undefined };
    // @ts-expect-error This pure orchestration test replaces the native admission boundary.
    const acquire = vi.spyOn(RuntimeAdmission, "acquireStoppedMachineControlMaintenance").mockReturnValue(owner);
    // @ts-expect-error Only the schema result is consumed at this orchestration boundary.
    const inspect = vi.spyOn(AuthorityDatabase, "inspectRegisteredPersonAtStartup").mockImplementation(() => {
      inspections += 1;
      if (area === "profile-startup-inspection" || area === "profile-startup-readback" && inspections === 2) throw failure;
      return { schemaVersion: 8 };
    });
    const upgrade = vi.spyOn(upgrades, "upgradeProfileAtStartup").mockImplementation(async () => {
      if (area === "profile-startup-upgrade") throw failure;
      return { state: "upgraded", fromSchemaVersion: 8, toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, credentials: "unchanged" };
    });
    try {
      await upgradeRegisteredPersonStores(workspace, lifetime, { primaryDisplay: null });
      const log = readLocalDebugLog(join(workspace, rebuildRuntimeIsolation.stateRoot));
      assert.equal(log.state, "present");
      const events = log.records.flatMap(record => record.payload.kind === "debug" ? [record.payload.event] : []);
      assert.deepEqual(events.map(({ area, code, reason, message }) => ({ area, code, reason, message })), [
        { area, code: "STORAGE_PROFILE_UPGRADE_REFUSED", reason: "unnamed-cause", message: "unnamed-cause" },
        { area, ...cause },
      ]);
      assert.doesNotMatch(JSON.stringify(log.records), /canary|123-45/iu);
    } finally { upgrade.mockRestore(); inspect.mockRestore(); acquire.mockRestore(); await lifetime.close(); rmSync(workspace, { recursive: true }); }
  }
});
