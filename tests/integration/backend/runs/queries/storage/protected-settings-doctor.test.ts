import { syntheticStateRoot } from "../../../../../support/helpers/synthetic-storage-admission.js";
import assert from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { AuthorityUpgradeRecordSchema } from "../../../../../../src/models/config/authority.js";
import { buildStorageDoctor } from "../../../../../../src/backend/runs/queries/storage.js";
import { AUTHORITY_APPLICATION_ID, SQLITE_MIGRATIONS } from "../../../../../../src/backend/storage/sqlite/migrations.js";
import { createRunSearchIndex } from "../../../../../../src/backend/storage/sqlite/run-search-index.js";
import { randomUUID } from "node:crypto";
import { systemClock } from "../../../../../../src/rules/time/clock.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import {
  PROTECTED_SETTINGS_SCHEMA_HASH,
  ProtectedSettingsApplyInputSchema,
  ProtectedSettingsNameSchema,
  type ProtectedSettingsPatch,
} from "../../../../../../src/models/config/protected-settings.js";
import { createCredentialStore } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { AuthorityHealthPreflightRunner } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { doctorAuthorityStorage } from "../../../../../support/helpers/synthetic-storage-admission.js";

const COMMAND_ID = "11111111-1111-4111-8111-111111111111";
const WRITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.reverse()) cleanup();
  cleanups.length = 0;
});

function fixture(version: 55 | 56 = 56) {
  const root = mkdtempSync(join(tmpdir(), "hr-credential-doctor-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const authorityPath = join(root, "state.db");
  if (version === 55) {
    const raw = new DatabaseSync(authorityPath);
    try {
      raw.exec("BEGIN EXCLUSIVE");
      for (const migration of SQLITE_MIGRATIONS.filter(entry => entry.version <= 55)) {
        for (const statement of migration.statements) raw.exec(statement);
      }
      const recordedAt = systemClock.now().toISOString();
      raw.prepare("INSERT INTO database_state(singleton_id,schema_version,authority_generation,updated_at) VALUES(1,55,0,?)").run(recordedAt);
      const baseline = { recordKey: randomUUID(), upgradeId: "fresh", phase: "baseline", fromSchemaVersion: 0,
        toSchemaVersion: 55, by: "local-operator", recordedAt };
      raw.prepare("INSERT INTO database_upgrades(record_key,upgrade_id,phase,record_json,created_at) VALUES(?,?,?,?,?)")
        .run(baseline.recordKey, baseline.upgradeId, baseline.phase, JSON.stringify(baseline), recordedAt);
      createRunSearchIndex(raw).initialize(0, recordedAt);
      raw.exec(`PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}; PRAGMA user_version=55; COMMIT`);
    } finally { raw.close(); }
  }

  const database = AuthorityDatabase.open({
    path: authorityPath,
    busyTimeoutMs: 100,
    migrationOwner: "unit-test",
  });
  cleanups.push(() => database.close());
  const credentialDirectory = join(root, "credentials");
  const credentialPath = join(credentialDirectory, "protected.json");
  const credentialStore = createCredentialStore({ stateRoot: root });
  const options = {
    authorityPath,
    stateRoot: root,
    stateRootTrustAnchor: root,
    backupDirectory: join(root, "backups", "authority"),
    busyTimeoutMs: 100,
  };
  return { root, database, credentialDirectory, credentialPath, credentialStore, options };
}

function writeCredentials(f: ReturnType<typeof fixture>, entries: ProtectedSettingsPatch) {
  const outcome = f.credentialStore.apply(ProtectedSettingsApplyInputSchema.parse({
    commandId: COMMAND_ID,
    commandFingerprint: "1".repeat(64),
    expectedRevision: 1,
    protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
    writeId: WRITE_ID,
    entries,
    updatedAt: "2026-09-06T20:00:00.000Z",
  }));
  assert.equal(outcome.state, "applied");
  if (outcome.state !== "applied") throw new Error("credential fixture failed to apply");
  return outcome.record;
}

function snapshot(root: string): unknown {
  return readdirSync(root).sort().map((name) => {
    const path = join(root, name);
    const stat = lstatSync(path);
    const bytes = stat.isDirectory() ? undefined : readFileSync(path);
    if (name === "state.db-shm") {
      assert.ok(bytes && bytes.length >= 136);
      bytes.fill(0, 100, 120);
    }
    return {
      name,
      mode: stat.mode,
      uid: stat.uid,
      ino: stat.ino,
      size: stat.size,
      mtime: stat.mtimeMs,
      ctime: stat.ctimeMs,
      content: stat.isDirectory() ? snapshot(path) : bytes?.toString("base64"),
    };
  });
}

async function unchanged(f: ReturnType<typeof fixture>) {
  const before = snapshot(f.root);
  const meta = f.database.getMeta();
  const report = await doctorAuthorityStorage(f.options);
  assert.deepEqual(snapshot(f.root), before);
  assert.deepEqual(f.database.getMeta(), meta);
  return report.protectedSettings;
}

describe("D336 credential presence doctor", () => {
  it("reports every name and presence without a credential value or identity", async () => {
    const f = fixture();
    const record = writeCredentials(f, {
      timekeeperName: { set: "Protected Doctor Canary" },
      ucpathPassword: { set: "doctor-private-password" },
    });

    const report = await unchanged(f);

    assert.deepEqual(report, {
      state: "available",
      entries: ProtectedSettingsNameSchema.options.map((name) => ({
        name,
        present: name === "timekeeperName" || name === "ucpathPassword",
      })),
    });
    const serialized = JSON.stringify(report);
    for (const entry of Object.values(record.entries)) {
      assert.equal(serialized.includes(
        typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value),
      ), false);
      assert.equal(serialized.includes(entry.valueId), false);
      assert.equal(serialized.includes(entry.updatedAt), false);
    }
  });

  it("treats an absent credential store as the read-only empty baseline", async () => {
    const f = fixture();
    assert.deepEqual(await unchanged(f), {
      state: "available",
      entries: ProtectedSettingsNameSchema.options.map((name) => ({ name, present: false })),
    });
  });

  it.each(["corrupt", "permissions"])(
    "keeps %s credential state unavailable and untouched with a closed diagnostic",
    async (fault) => {
      const f = fixture();
      writeCredentials(f, { timekeeperName: { set: "Protected Doctor Canary" } });
      if (fault === "corrupt") writeFileSync(f.credentialPath, "Protected Doctor Canary");
      if (fault === "permissions") chmodSync(f.credentialPath, 0o644);

      assert.deepEqual(await unchanged(f), {
        state: "unavailable",
        cause: {
          code: "authority-unavailable",
          summary: "credentials in credentials could not be verified read-only",
        },
      });
    },
  );

  it("reports the same presence facts through authority.health and fails unreadable closed", async () => {
    const f = fixture();
    writeCredentials(f, { timekeeperName: { set: "Protected Doctor Canary" } });
    const runner = new AuthorityHealthPreflightRunner(f.options);
    const context = {
      signal: new AbortController().signal,
      timeoutMs: 10_000,
      deadlineMonotonicMs: 10_000,
      redaction: "presence-only" as const,
    };
    const before = snapshot(f.root);
    const observation = await runner.run(context);
    assert.deepEqual(snapshot(f.root), before);
    for (const name of ProtectedSettingsNameSchema.options) {
      assert.ok(observation.summary.includes(
        `${name}=${name === "timekeeperName" ? "present" : "absent"}`,
      ));
    }
    assert.equal(observation.summary.includes("Protected Doctor Canary"), false);

    chmodSync(f.credentialPath, 0o644);
    const unavailable = await runner.run(context);
    assert.equal(unavailable.state, "unhealthy");
    assert.ok(unavailable.summary.includes("could not be verified read-only"));
    assert.equal(unavailable.summary.includes(f.root), false);
  });
});


describe("D332 read-only upgrade phase reporting", () => {
  it("projects baseline and each upgrade phase through doctor, browser wire and preflight without private journal payload", async () => {
    const f = fixture(55);
    const baseline = await doctorAuthorityStorage(f.options);
    assert.equal(baseline.authorityUpgrades.state, "available");
    if (baseline.authorityUpgrades.state !== "available") throw new Error("baseline missing");
    assert.deepEqual(baseline.authorityUpgrades.phases.map(({ phase }) => phase), ["baseline"]);
    const expected: { phase: string; fromSchemaVersion: number; toSchemaVersion: number; recordedAt: string }[] = [...baseline.authorityUpgrades.phases];
    for (const [index, phase] of (["planned", "committed", "settled"] as const).entries()) {
      const record = AuthorityUpgradeRecordSchema.parse({
        recordKey: `bbbbbbbb-bbbb-4bbb-8bbb-${String(index + 1).padStart(12, "0")}`,
        upgradeId: "a".repeat(64), planDigest: "b".repeat(64),
        phase, fromSchemaVersion: 29, toSchemaVersion: 34, by: "local-operator",
        recordedAt: "2026-09-06T20:00:00.000Z",
        backup: { manifestPath: `${f.root}/private-manifest.json`, sha256: "c".repeat(64), authorityGeneration: 7 },
        settings: { ordinaryRevisionBefore: 1, ordinaryRevisionAfter: 2,
          settingsFingerprintAfter: "d".repeat(64), settingsSchemaHashAfter: "e".repeat(64),
          protectedRevisionAfter: 1, protectedEntryNames: ["private-entry-name"] },
        tombstoneBackfill: { fromRoots: 0, fromReconstructedRoots: 0, unknown: 0 },
        orphanGateRecordsRemoved: 0, historicalExposure: [], envKeysToRemove: ["PRIVATE_ENV_NAME"],
      });
      const raw = new DatabaseSync(f.options.authorityPath);
      raw.prepare("INSERT INTO database_upgrades (record_key, upgrade_id, phase, record_json, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(record.recordKey, record.upgradeId, phase, JSON.stringify(record), record.recordedAt);
      raw.close();
      const before = snapshot(f.root);
      const meta = f.database.getMeta();
      const report = await doctorAuthorityStorage(f.options);
      const wire = await buildStorageDoctor({ admission: syntheticStateRoot(f.options.stateRoot), doctorOptions: f.options, clock: systemClock,
        serviceState: () => ({ state: "never-run", reason: "No backup requested" }),
      });
      const observation = await new AuthorityHealthPreflightRunner(f.options).run({
        signal: new AbortController().signal, timeoutMs: 10_000, deadlineMonotonicMs: 10_000, redaction: "presence-only",
      });
      expected.push({ phase, fromSchemaVersion: record.fromSchemaVersion, toSchemaVersion: record.toSchemaVersion, recordedAt: record.recordedAt });
      assert.deepEqual(report.authorityUpgrades, { state: "available", phases: expected });
      assert.deepEqual(wire.authorityUpgrades, report.authorityUpgrades);
      assert.ok(observation.summary.includes(`authority upgrade phase ${phase}`));
      assert.equal(observation.state, phase === "settled" ? "healthy" : "unhealthy");
      const publicOutput = JSON.stringify({ wire, observation, upgrade: report.authorityUpgrades });
      for (const privateValue of [f.root, record.recordKey, "private-entry-name", "PRIVATE_ENV_NAME", ...["a", "b", "c", "d", "e"].map((value) => value.repeat(64))]) {
        assert.equal(publicOutput.includes(privateValue), false, "private upgrade field escaped");
      }
      assert.deepEqual(snapshot(f.root), before);
      assert.deepEqual(f.database.getMeta(), meta);
    }
  });

  it("keeps a corrupt journal explicitly unavailable without exposing its payload or mutating it", async () => {
    const f = fixture();
    const raw = new DatabaseSync(f.options.authorityPath);
    raw.prepare("INSERT INTO database_upgrades (record_key, upgrade_id, phase, record_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("broken", "private-upgrade-identity", "planned", JSON.stringify({ private: "private-journal-payload" }), "2026-09-06T20:00:00.000Z");
    raw.close();
    const before = snapshot(f.root);
    const report = await doctorAuthorityStorage(f.options);
    assert.deepEqual(report.authorityUpgrades, { state: "unavailable", cause: {
      code: "authority-unavailable", summary: "authority upgrade journal could not be verified",
    } });
    assert.equal(JSON.stringify(report.authorityUpgrades).includes("private-journal-payload"), false);
    assert.deepEqual(snapshot(f.root), before);
  });
});
