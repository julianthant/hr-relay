import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { afterEach, it } from "vitest";
import { createProfileSettingsProcesses } from "../../../../../src/backend/app/composition/dashboard/profile-settings-processes.js";
import { captureSelectedProfileStorage } from "../../../../../src/backend/app/composition/storage-compose.js";
import { readSettings } from "../../../../../src/backend/runtime/settings/settings-runtime.js";
import { createNoteTimelineWriter } from "../../../../../src/backend/storage/events/note-timeline-writer.js";
import { createDashboardReadHost } from "../../../../../src/backend/storage/sqlite/dashboard-read-host.js";
import { deriveSettingsPatchFingerprint, SETTINGS_SCHEMA_HASH } from "../../../../../src/models/config/settings.js";
import { SettingsCommandRequestSchema } from "../../../../../src/rules/commands/commands.js";
import { systemClock } from "../../../../../src/rules/time/clock.js";
import { LANE_READS_ENTRY } from "../../../../support/fixtures/backend/dashboard-lane-reads.js";
import { createBoundProfileFixture, openBoundDatabaseFixture } from "../../../../support/helpers/admission-fixture.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

it("leaves a Settings worker commit in the WAL while the dashboard read host owns checkpoints", async () => {
  const f = await openBoundDatabaseFixture("settings-worker-checkpoint", systemClock, 250, undefined, undefined, undefined,
    () => createBoundProfileFixture({ sharedMachine: true }));
  cleanups.push(() => f.close());
  const { profile, database } = f;
  const lanes = createDashboardReadHost({ admission: profile.admission, database, clock: systemClock,
    lanes: ["navigation"], entry: LANE_READS_ENTRY, checkpoint: { thresholdBytes: Number.MAX_SAFE_INTEGER } });
  cleanups.push(() => lanes.close());
  await lanes.ready;
  assert.equal(database.autoCheckpointPages(), 0);

  const notes = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock: systemClock });
  database.withAuthorityTransaction(() => {
    for (let index = 0; index < 32; index++) {
      notes.emitNote({ workflow: "person-lookup", address: { workerId: "worker-1", spanPath: "worker-1" },
        level: "step", message: "w".repeat(192 * 1024) });
    }
  });
  assert.ok(statSync(`${f.path}-wal`).size > 32 + 1_000 * (4096 + 24), "the WAL exceeds SQLite's default checkpoint threshold");

  const selected = captureSelectedProfileStorage(profile.machine);
  const settings = createProfileSettingsProcesses(profile.admission, profile.lifetime, selected.epoch, { primaryDisplay: null }, selected.assertCurrent);
  cleanups.push(() => settings.closeCommands());
  const commandId = randomUUID(), patch = { "concurrency.defaultWorkers": { set: 3 } };
  const command = SettingsCommandRequestSchema.parse({ commandId, requestedAt: systemClock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface",
    family: "settings", type: "apply-settings", target: { expectedRevision: readSettings(database.authority).revision },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
  const result = await settings.execute(command);
  assert.equal(result.state, "applied");
  assert.ok(database.authority.commands.get(commandId), "the active database sees the committed command");

  // The immutable view of this fixture reads only the main file, without replaying its WAL.
  const file = pathToFileURL(f.path);
  file.searchParams.set("immutable", "1");
  const main = new DatabaseSync(file, { readOnly: true });
  try { assert.equal(main.prepare("SELECT id FROM commands WHERE id=?").get(commandId), undefined); }
  finally { main.close(); }
  assert.equal(lanes.status().checkpoints.length, 0);
});
