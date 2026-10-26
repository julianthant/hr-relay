import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,it } from "vitest";
import { defaultRuntimePaths } from "../../../src/backend/app/config/runtime-paths.js";
import { ConfigSchema } from "../../../src/models/config/schema.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../src/rules/validation/sha256.js";
import { NOW,UUID_4 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";
import { AuthorityBootStore,AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";

const profiles: ReturnType<typeof createBoundProfileFixture>[] = [];
const SNAPSHOT_ID = UUID_4;
const CLOCK = manualClock(new Date(NOW), 1_000);

afterEach(() => {
  for (const profile of profiles.splice(0)) profile.close();
});

function databasePath(): string {
  const profile = createBoundProfileFixture();
  profiles.push(profile);
  return profile.path;
}

function currentConfig() {
  return ConfigSchema.parse({ paths: defaultRuntimePaths() });
}

function databaseWithSnapshotMissing(removed: string): string {
  const path = databasePath();
  const database = AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "generation-test" }, CLOCK);
  database.authority.configSnapshots.insert({
    configSnapshotId: SNAPSHOT_ID,
    revision: 1,
    fingerprint: sha256Hex(canonicalJsonStringify(currentConfig())),
    capturedAt: NOW,
    capturedBy: "local-operator",
    config: currentConfig(),
    provenance: { "timeouts.taskMs": "default" },
  });
  database.close();

  const raw = new DatabaseSync(path);
  raw.exec("PRAGMA journal_mode = WAL");
  const triggers = raw.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger' AND tbl_name='settings_snapshots'").all();
  for (const trigger of triggers) {
    assert.equal(typeof trigger.name, "string");
    raw.exec(`DROP TRIGGER "${String(trigger.name).replaceAll('"', '""')}"`);
  }
  raw.prepare("UPDATE settings_snapshots SET payload_json = json_remove(payload_json, ?)")
    .run(`$.config.${removed}`);
  for (const trigger of triggers) {
    assert.equal(typeof trigger.sql, "string");
    raw.exec(String(trigger.sql));
  }
  raw.close();
  return path;
}

describe("strict current config snapshots", () => {
  for (const leaf of ["timeouts.taskMs", "timeouts.sessionAcquireMs", "timeouts.duoCeremonyLeaseGraceMs", "browser", "providers", "providers.geocodeNominatim.timeoutMs"]) {
    it(`refuses missing ${leaf} on boot and read without applying live defaults`, () => {
      const path = databaseWithSnapshotMissing(leaf);
      assert.throws(() => AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "snapshot-test" }, CLOCK), /authority table settings_snapshots failed native record validation/u);
      const boot = AuthorityBootStore.open({ path, busyTimeoutMs: 250, migrationOwner: "snapshot-test" }, CLOCK);
      try { const report = boot.report(); assert.equal(report.state, "degraded-read-only"); assert.equal(report.state === "degraded-read-only" && report.cause.code, "authority-record-invalid"); } finally { boot.close(); }
    });
  }
  it("preserves exact current snapshot bytes and refuses overwriting immutable evidence", () => {
    const path = databasePath(); const database = AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "snapshot-test" }, CLOCK);
    const snapshot = { configSnapshotId: SNAPSHOT_ID, revision: 1, fingerprint: sha256Hex(canonicalJsonStringify(currentConfig())), capturedAt: NOW, capturedBy: "local-operator", config: currentConfig(), provenance: {} };
    try {
      database.authority.configSnapshots.insert(snapshot);
      assert.deepEqual(database.authority.configSnapshots.get(SNAPSHOT_ID), snapshot);
      assert.throws(() => database.authority.configSnapshots.insert({ ...snapshot, config: { ...snapshot.config, browser: { ...snapshot.config.browser, headless: false } } }));
      assert.deepEqual(database.authority.configSnapshots.get(SNAPSHOT_ID), snapshot);
    } finally { database.close(); }
  });
});
