import assert from "node:assert/strict";
import type { ForkOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { afterEach, it, vi } from "vitest";
import { createProfileSettingsProcesses } from "../../../../../src/backend/app/composition/dashboard/profile-settings-processes.js";
import { composeSelectedProfileStorage } from "../../../../../src/backend/app/composition/storage-compose.js";
import { readSettings } from "../../../../../src/backend/runtime/settings/settings-runtime.js";
import { createNoteTimelineWriter } from "../../../../../src/backend/storage/events/note-timeline-writer.js";
import { createDashboardReadHost } from "../../../../../src/backend/storage/sqlite/dashboard-read-host.js";
import { deriveSettingsPatchFingerprint, SETTINGS_SCHEMA_HASH } from "../../../../../src/models/config/settings.js";
import { SettingsCommandRequestSchema } from "../../../../../src/rules/commands/commands.js";
import { systemClock } from "../../../../../src/rules/time/clock.js";
import { LANE_READS_ENTRY } from "../../../../support/fixtures/backend/dashboard-lane-reads.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../../support/helpers/admission-fixture.js";

vi.mock("node:child_process", async original => {
  const childProcess = await original<typeof import("node:child_process")>();
  const { credentialKeychainTestEnvironment } = await import("../../../../support/helpers/credential-keychain-fake.js");
  return { ...childProcess, fork: (module: string | URL, args: readonly string[], options: ForkOptions) =>
    childProcess.fork(module, args, { ...options, env: credentialKeychainTestEnvironment(options.env ?? {}) }) };
});

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

it("leaves a Settings worker commit in the WAL while the dashboard read host owns checkpoints", async () => {
  const profile = await createBoundProfileFixture({ sharedMachine: true });
  cleanups.push(() => profile.close());
  const hostFacts = { primaryDisplay: null };
  const { profileEpoch, assertCurrent, database, account } = composeSelectedProfileStorage({ machineAdmission: profile.machine,
    admission: profile.admission, credentials: boundProfileCredentials(profile.admission), clock: systemClock, hostFacts });
  cleanups.push(async () => { await account.close(); database.close(); });
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
  assert.ok(statSync(`${profile.path}-wal`).size > 32 + 1_000 * (4096 + 24), "the WAL exceeds SQLite's default checkpoint threshold");

  const settings = createProfileSettingsProcesses(profile.admission, profile.lifetime, profileEpoch, hostFacts, assertCurrent);
  cleanups.push(() => settings.closeCommands());
  const commandId = randomUUID(), patch = { "concurrency.defaultWorkers": { set: 3 } };
  const command = SettingsCommandRequestSchema.parse({ commandId, requestedAt: systemClock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface",
    family: "settings", type: "apply-settings", target: { expectedRevision: readSettings(database.authority).revision },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
  const result = await settings.execute(command);
  assert.equal(result.state, "applied");
  assert.ok(database.authority.commands.get(commandId), "the active database sees the committed command");

  // The immutable view of this fixture reads only the main file, without replaying its WAL.
  const file = pathToFileURL(profile.path);
  file.search = "mode=ro&immutable=1";
  const main = new DatabaseSync(file.href, { readOnly: true });
  try { assert.equal(main.prepare("SELECT id FROM commands WHERE id=?").get(commandId), undefined); }
  finally { main.close(); }
  assert.equal(lanes.status().checkpoints.length, 0);
});
