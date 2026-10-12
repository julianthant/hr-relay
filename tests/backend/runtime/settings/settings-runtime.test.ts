import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { initialSettingsFileRecord } from "../../../../src/models/config/settings.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { seedInitialSettingsRuntimeConfig } from "../../../support/fixtures/operator-command-fixtures.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

it("keeps initial ordinary settings readable after seeding the active runtime", () => {
  const root = mkdtempSync(join(tmpdir(), "hrauto-settings-fixture-"));
  const clock = manualClock(new Date("2026-08-03T17:00:00.000Z"));
  const database = AuthorityDatabase.open({ path: join(root, "state.db"), busyTimeoutMs: 1000, migrationOwner: "initial-settings-fixture" }, clock);
  try {
    seedInitialSettingsRuntimeConfig(database, clock);
    const record = readSettings(database.authority);
    assert.deepEqual(record, initialSettingsFileRecord());
    const resolved = resolveConfigWithProvenance(record.settings, hostConfigFacts({}), clock);
    const active = database.authority.runtimeConfig.requireActive({ settingsRevision: record.revision,
      settingsFingerprint: record.settingsFingerprint, configFingerprint: resolved.fingerprint });
    assert.equal(active.generation, 1);
    assert.deepEqual(database.authority.configSnapshots.get(database.authority.runtimeConfig.get()!.configSnapshotId)?.config, resolved.config);
  } finally { database.close(); rmSync(root, { recursive: true, force: true }); }
});
