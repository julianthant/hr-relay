import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { defaultRuntimePaths } from "../../../../../../src/backend/app/config/runtime-paths.js";
import { ConfigSchema } from "../../../../../../src/models/config/schema.js";
import { ConfigSnapshotRecordSchema, ConfigSnapshotWriteSchema, StoredConfigSchema } from "../../../../../../src/models/config/snapshot.js";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { AuthorityBootStore } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { NOW, UUID_4 } from "../../../../../support/fixtures/phase1c-contract-fixtures.js";
import { canonicalJsonStringify } from "../../../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../../../src/rules/validation/sha256.js";

const roots: string[] = [];
const SNAPSHOT_ID = UUID_4;
const CLOCK = manualClock(new Date(NOW), 1_000);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function databasePath(): string {
  const root = mkdtempSync(join(tmpdir(), "hrauto-config-generation-"));
  roots.push(root);
  return join(root, "authority.sqlite");
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
  it("rejects every missing current group and required timeout or provider leaf on both read and write", () => {
    const config = currentConfig();
    for (const key of Object.keys(config)) {
      const missing = { ...config }; Reflect.deleteProperty(missing, key);
      assert.equal(StoredConfigSchema.safeParse(missing).success, false, key);
    }
    for (const key of Object.keys(config.timeouts)) {
      const timeouts = { ...config.timeouts }; Reflect.deleteProperty(timeouts, key);
      assert.equal(StoredConfigSchema.safeParse({ ...config, timeouts }).success, false, key);
    }
    for (const configValue of [{ ...config, providers: { geocodeCensus: config.providers.geocodeCensus } }, { ...config, providers: { ...config.providers, geocodeNominatim: {} } }, { ...config, operator: {} }, { ...config, capture: {} }, { ...config, providers: { ...config.providers, geocodeCensus: { ...config.providers.geocodeCensus, concurrency: 1 } } }]) {
      const record = { configSnapshotId: SNAPSHOT_ID, revision: 1, fingerprint: sha256Hex(canonicalJsonStringify(configValue)), capturedAt: NOW, capturedBy: "local-operator", config: configValue, provenance: {} };
      assert.equal(ConfigSnapshotRecordSchema.safeParse(record).success, false);
      assert.equal(ConfigSnapshotWriteSchema.safeParse(record).success, false);
    }
    assert.equal(ConfigSchema.parse({ paths: defaultRuntimePaths() }).browser.headless, true);
  });
});
