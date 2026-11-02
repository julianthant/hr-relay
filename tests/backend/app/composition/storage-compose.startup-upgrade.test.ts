import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync,mkdtempSync,rmSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it,vi } from "vitest";
import { RegisteredPersonUpgradeRefusedError,upgradeRegisteredPersonStores } from "../../../../src/backend/app/composition/storage-compose.js";
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
  const release = vi.fn(() => { events.push("release"); });
  const owner = { requiresFlatStoreMigration: () => false, readStartupProfileIds: () => [first, second], release };
  // @ts-expect-error This pure orchestration test replaces the native admission boundary.
  const acquire = vi.spyOn(RuntimeAdmission, "acquireStoppedMachineControlMaintenance").mockReturnValue(owner);
  // @ts-expect-error Only the schema result is consumed at this orchestration boundary.
  const inspect = vi.spyOn(AuthorityDatabase, "inspectRegisteredPersonAtStartup").mockImplementation((_machine, id) => {
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
    if (invalidPeer) {
      await assert.rejects(upgradeRegisteredPersonStores(workspace, lifetime, { primaryDisplay: null }), error => error instanceof RegisteredPersonUpgradeRefusedError
        && error.cause instanceof Error && error.cause.message === "foreign registered peer");
      assert.equal(upgrade.mock.calls.length, 0); assert.equal(release.mock.calls.length, 1);
    } else {
      await upgradeRegisteredPersonStores(workspace, lifetime, { primaryDisplay: null });
      assert.equal(upgrade.mock.calls.length, 1); assert.equal(release.mock.calls.length, 3);
      const before = upgrade.mock.calls.length;
      await upgradeRegisteredPersonStores(workspace, lifetime, { primaryDisplay: null });
      assert.equal(upgrade.mock.calls.length, before);
    }
  } finally { upgrade.mockRestore(); inspect.mockRestore(); acquire.mockRestore(); await lifetime.close(); rmSync(workspace, { recursive: true }); }
});


it("refuses a fabricated logout conversion before any publication", () => {
  // @ts-expect-error An unissued conversion has neither the native proof nor its installation lease.
  assert.throws(() => AuthorityDatabase.consumeStartupLogoutConversion(Object.freeze({}), undefined), /conversion-unissued/u);
});
