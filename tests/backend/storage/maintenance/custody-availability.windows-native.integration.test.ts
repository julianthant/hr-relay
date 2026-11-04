import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { openAuthorityBackupSourceReadOnly } from "../../../../src/backend/storage/sqlite/backup-inspection.js";
import { StorageMaintenanceCustodyUnavailableError } from "../../../../src/backend/storage/maintenance/custody-availability.js";
import { initializeRegisteredPersonStores } from "../../../../src/backend/app/composition/storage-compose.js";
import { composeDashboardApplication } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import { healthyRuntimePreflightRunners } from "../../../support/fixtures/preflight-seams.js";

const clock = manualClock(new Date("2026-11-04T02:00:00.000Z"));

describe.skipIf(process.platform !== "win32")("actual Windows maintenance refusal", () => {
  it("refuses service and direct backup capture while preserving source and credentials", async () => {
    const f = await createBoundProfileFixture();
    const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "native-refusal" }, clock,
      undefined, undefined, undefined, boundProfileCredentials(f.admission));
    const credential = join(f.stateRoot, "credentials", "protected.json");
    const source = readFileSync(f.path), protectedBytes = readFileSync(credential), target = join(f.stateRoot, "refused-backup.sqlite");
    try {
      const service = new AuthorityBackupService(f.admission, database, { directory: join(f.stateRoot, "backups", "authority") }, clock);
      assert.throws(() => service.request({ trigger: "operator", requiredGeneration: database.getMeta().authorityGeneration }), StorageMaintenanceCustodyUnavailableError);
      assert.throws(() => openAuthorityBackupSourceReadOnly(f.admission, f.path), StorageMaintenanceCustodyUnavailableError);
      await assert.rejects(database.onlineBackupTo(target), StorageMaintenanceCustodyUnavailableError);
      assert.equal(existsSync(target), false);
      assert.equal(existsSync(join(f.stateRoot, "backups", "authority")), false);
      assert.deepEqual(readFileSync(f.path), source); assert.deepEqual(readFileSync(credential), protectedBytes);
    } finally { database.close(); await f.close(); }
  });

  it("refuses ready-account deletion while preserving registry and credential files", async () => {
    const f = await createBoundProfileFixture(), profileId = f.admission.profileBinding.profileId;
    const epoch = createProfileRegistry(f.machine).advanceSession(null);
    f.admission.release();
    const registry = f.machine.readProfileRegistry(), key = join(f.machine.stateRoot, "machine", "credential-keys", `${profileId}.json`);
    const keyBytes = readFileSync(key), source = readFileSync(f.path);
    try {
      assert.throws(() => f.machine.deleteProfileAccount(profileId, epoch), StorageMaintenanceCustodyUnavailableError);
      assert.deepEqual(f.machine.readProfileRegistry(), registry);
      assert.deepEqual(readFileSync(key), keyBytes); assert.deepEqual(readFileSync(f.path), source);
    } finally { await f.close(); }
  });

  it("boots current profiles and closes runtime before reporting the unavailable shutdown backup", async () => {
    const f = await createBoundProfileFixture(), port = f.lifetime.port;
    f.admission.release(); f.machine.release();
    try {
      await initializeRegisteredPersonStores(f.workspace, f.lifetime, { primaryDisplay: null }, clock);
      const machine = acquireEntrypointAdmission(f.workspace, "exclusive", f.lifetime);
      const application = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: machine,
        isolation: rebuildRuntimeIsolation, repoRoot: process.cwd(), backendPortOverride: 0, frontendPortOverride: 0,
        env: {}, clock, preflightRunnerFactory: healthyRuntimePreflightRunners });
      await assert.rejects(application.stop(), StorageMaintenanceCustodyUnavailableError);
      assert.throws(() => machine.assertLive());
      await assert.rejects(fetch(`http://127.0.0.1:${application.port}/api/v1/profile`));
      await f.lifetime.close();
      const restarted = await RuntimeLifetimeLock.acquire(port);
      try { restarted.assertHeld(); } finally { await restarted.close(); }
      assert.equal(existsSync(join(f.stateRoot, "backups", "authority")), false);
    } finally { await f.close(); }
  });
});
