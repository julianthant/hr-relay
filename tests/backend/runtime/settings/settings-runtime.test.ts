import assert from "node:assert/strict";
import { it } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { initialSettingsFileRecord } from "../../../../src/models/config/settings.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { seedInitialSettingsRuntimeConfig } from "../../../support/fixtures/operator-command-fixtures.js";
import { openBoundDatabaseFixture } from "../../../support/helpers/admission-fixture.js";

it("keeps initial ordinary settings readable after seeding the active runtime", () => {
  const clock = manualClock(new Date("2026-08-03T17:00:00.000Z"));
  const opened = openBoundDatabaseFixture("initial-settings-fixture", clock, 1000);
  const { database } = opened;
  try {
    seedInitialSettingsRuntimeConfig(database, clock);
    const record = readSettings(database.authority);
    assert.deepEqual(record, initialSettingsFileRecord());
    const resolved = resolveConfigWithProvenance(record.settings, hostConfigFacts({}), clock);
    const active = database.authority.runtimeConfig.requireActive({ settingsRevision: record.revision,
      settingsFingerprint: record.settingsFingerprint, configFingerprint: resolved.fingerprint });
    assert.equal(active.generation, 1);
    assert.deepEqual(database.authority.configSnapshots.get(database.authority.runtimeConfig.get()!.configSnapshotId)?.config, resolved.config);
  } finally { opened.close(); }
});
