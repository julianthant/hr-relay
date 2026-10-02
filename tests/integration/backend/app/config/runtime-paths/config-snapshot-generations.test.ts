import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { defaultRuntimePaths } from "../../../../../../src/backend/app/config/runtime-paths.js";
import { ConfigSchema } from "../../../../../../src/models/config/schema.js";
import {
  CURRENT_CONFIG_SNAPSHOT_GENERATION,
  StoredConfigSchema,
  configSnapshotAbsentLeaves,
  configSnapshotGeneration,
  executionConfigFromStored,
} from "../../../../../../src/models/config/snapshot-generations.js";
import { ConfigSnapshotRecordSchema, ConfigSnapshotWriteSchema } from "../../../../../../src/models/config/snapshot.js";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { AuthorityBootStore } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { HASH_B, NOW, UUID_4 } from "../../../../../support/fixtures/phase1c-contract-fixtures.js";

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

function legacyPhoneCaptureConfig() {
  return {
    ...currentConfig(),
    operator: { timekeeperName: "synthetic historical value" },
    capture: {
      ingress: "disabled",
      preConnectTtlMs: 120_000,
      activeIdleTtlMs: 300_000,
      maxPhotoBytes: 5_000_000,
      maxPhotos: 12,
      width: 1_440,
      maxWidth: 1_440,
      sliceHeight: 1_200,
      sliceOverlap: 48,
      maxSlices: 16,
    },
  };
}

/**
 * A current-generation database whose one config snapshot is then rewritten to
 * the shape it had at `removed` — the same surgery history performed, so the
 * row is a genuine older snapshot rather than a hand-written approximation of
 * one. `.tracker/phase1-exit-state.db` (the preserved Phase-1 exit
 * database, gitignored) reproduces exactly this shape with `removed` set to
 * `timeouts.sessionAcquireMs`.
 */
function databaseWithSnapshotMissing(removed: string): string {
  const path = databasePath();
  const database = AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "generation-test" }, CLOCK);
  database.authority.configSnapshots.insert({
    configSnapshotId: SNAPSHOT_ID,
    revision: 1,
    fingerprint: HASH_B,
    capturedAt: NOW,
    capturedBy: "local-operator",
    config: currentConfig(),
    provenance: { "timeouts.taskMs": "default" },
  });
  database.close();

  const raw = new DatabaseSync(path);
  raw.exec("PRAGMA journal_mode = WAL");
  raw.prepare("UPDATE settings_snapshots SET record_json = json_remove(record_json, ?)")
    .run(`$.config.${removed}`);
  raw.close();
  return path;
}

describe("pre-D125 config snapshots are read forward", () => {
  it("opens an authority database whose snapshot predates timeouts.sessionAcquireMs", () => {
    const path = databaseWithSnapshotMissing("timeouts.sessionAcquireMs");

    const boot = AuthorityBootStore.open({ path, busyTimeoutMs: 250, migrationOwner: "generation-test" }, CLOCK);
    const report = boot.report();
    boot.close();
    assert.equal(report.state, "healthy");

    const database = AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "generation-test" }, CLOCK);
    const record = database.authority.configSnapshots.get(SNAPSHOT_ID);
    database.close();
    assert.notEqual(record, undefined);
    if (record === undefined) return;

    // The absence is REPORTED, not filled: a run that predates D125 held no
    // session-acquire bound at all, and the record must not claim it held 60s.
    assert.equal(record.config.timeouts.sessionAcquireMs, undefined);
    assert.deepEqual(configSnapshotAbsentLeaves(record.config), ["timeouts.sessionAcquireMs"]);
    // A snapshot missing generation 2's leaf IS generation 1, whatever later
    // leaves (D267's generation-3 grace) the fixture happens to carry: the
    // generation is the last one whose every introduced leaf is present.
    assert.equal(configSnapshotGeneration(record.config), 1);
    assert.ok(CURRENT_CONFIG_SNAPSHOT_GENERATION >= 3);
    // Every other leaf still parsed strictly.
    assert.equal(record.config.timeouts.taskMs, currentConfig().timeouts.taskMs);
  });

  it("still fails loud when a snapshot lacks an unregistered leaf", () => {
    const path = databaseWithSnapshotMissing("timeouts.taskMs");

    assert.throws(
      () => AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "generation-test" }, CLOCK),
      /settings_snapshots record .* failed strict record schema validation/,
    );
    const boot = AuthorityBootStore.open({ path, busyTimeoutMs: 250, migrationOwner: "generation-test" }, CLOCK);
    const report = boot.report();
    boot.close();
    assert.equal(report.state, "degraded-read-only");
    assert.equal(report.state === "degraded-read-only" ? report.cause.code : undefined, "authority-record-invalid");
  });

  it("still fails loud when a snapshot lacks a whole group rather than defaulting it", () => {
    const path = databaseWithSnapshotMissing("browser");

    assert.throws(
      () => AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "generation-test" }, CLOCK),
      /settings_snapshots record .* failed strict record schema validation/,
    );
  });

  it("refuses to WRITE a snapshot that omits a current-generation leaf", () => {
    const path = databasePath();
    const database = AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "generation-test" }, CLOCK);
    const { timeouts, ...rest } = currentConfig();
    const { sessionAcquireMs: _omitted, ...withoutBound } = timeouts;
    assert.throws(
      () => database.authority.configSnapshots.insert({
        configSnapshotId: SNAPSHOT_ID,
        revision: 1,
        fingerprint: HASH_B,
        capturedAt: NOW,
        capturedBy: "local-operator",
        config: { ...rest, timeouts: withoutBound },
        provenance: {},
      }),
      /omits current config leaves timeouts\.sessionAcquireMs/,
    );
    database.close();
  });

  it("reads a current-generation snapshot as the current generation", () => {
    const record = ConfigSnapshotRecordSchema.parse({
      configSnapshotId: SNAPSHOT_ID,
      revision: 1,
      fingerprint: HASH_B,
      capturedAt: NOW,
      capturedBy: "local-operator",
      config: currentConfig(),
      provenance: {},
    });
    assert.deepEqual(configSnapshotAbsentLeaves(record.config), []);
    assert.equal(configSnapshotGeneration(record.config), CURRENT_CONFIG_SNAPSHOT_GENERATION);
  });

  it("reads a pre-floor timekeeper snapshot but refuses to mint the retired leaf", () => {
    const historicalRecord = {
      configSnapshotId: SNAPSHOT_ID,
      revision: 1,
      fingerprint: HASH_B,
      capturedAt: NOW,
      capturedBy: "local-operator",
      config: { ...currentConfig(), operator: { timekeeperName: "synthetic historical value" } },
      provenance: { "operator.timekeeperName": "env" },
    };
    const read = ConfigSnapshotRecordSchema.parse(historicalRecord);
    assert.equal("operator" in read.config, true);
    if ("operator" in read.config) {
      assert.equal(read.config.operator.timekeeperName, "synthetic historical value");
    }
    assert.equal(configSnapshotGeneration(read.config), 4);
    assert.equal("operator" in executionConfigFromStored(read.config), false);
    const write = ConfigSnapshotWriteSchema.safeParse(historicalRecord);
    assert.equal(write.success, false);
    if (!write.success) assert.match(write.error.message, /cannot mint retired operator\.timekeeperName/u);
  });

  it("refuses an unregistered partial legacy generation instead of stripping it into execution config", () => {
    const malformed = { ...currentConfig(), capture: { ingress: "disabled" } };
    assert.equal(StoredConfigSchema.safeParse(malformed).success, false);
    assert.throws(() => executionConfigFromStored(malformed));
  });

  it("reads historical test routes but refuses them in new snapshots", () => {
    const config = currentConfig();
    const historical = {
      ...config,
      urls: { ...config.urls, crm: { ...config.urls.crm, test: { entry: "https://sandbox.example.test/hr" } } },
    };
    const stored = StoredConfigSchema.parse(historical);
    assert.equal(executionConfigFromStored(stored).urls.crm.prod.entry, config.urls.crm.prod.entry);
    assert.equal(Object.hasOwn(executionConfigFromStored(stored).urls.crm, "test"), false);
    assert.equal(ConfigSchema.safeParse(historical).success, false);
    const write = ConfigSnapshotWriteSchema.safeParse({
      configSnapshotId: SNAPSHOT_ID, revision: 1, fingerprint: HASH_B,
      capturedAt: NOW, capturedBy: "local-operator", config: historical, provenance: {},
    });
    assert.equal(write.success, false);
    if (!write.success) assert.match(write.error.message, /cannot mint retired crm test routes/u);
  });

  it("reads an immutable pre-D294 capture snapshot but refuses to mint one", () => {
    const legacyRecord = {
      configSnapshotId: SNAPSHOT_ID,
      revision: 1,
      fingerprint: HASH_B,
      capturedAt: NOW,
      capturedBy: "local-operator",
      config: legacyPhoneCaptureConfig(),
      provenance: {},
    };
    const read = ConfigSnapshotRecordSchema.safeParse(legacyRecord);
    assert.equal(read.success, true, "a retained v1–v3 snapshot remains readable evidence");
    assert.equal(ConfigSnapshotWriteSchema.safeParse(legacyRecord).success, false,
      "the read-compatible legacy shape cannot become a new snapshot");

    const path = databasePath();
    const database = AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "generation-test" }, CLOCK);
    assert.throws(
      () => database.authority.configSnapshots.insert(legacyRecord),
      /cannot mint retired phone-capture configuration/,
    );
    database.close();
  });

  it("never applies a group default while reading a stored config", () => {
    const { browser: _browser, ...withoutBrowser } = currentConfig();
    assert.equal(StoredConfigSchema.safeParse(withoutBrowser).success, false);
    // …while the LIVE resolver still defaults it, which is what defaults are for.
    assert.equal(ConfigSchema.parse({ paths: defaultRuntimePaths() }).browser.headless, true);
  });
});
