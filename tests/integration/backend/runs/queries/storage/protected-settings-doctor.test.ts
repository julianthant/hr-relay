import { acquireEntrypointAdmission } from "../../../../../../src/backend/storage/admission/bootstrap-admission.js";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { AuthorityUpgradeRecordSchema } from "../../../../../../src/models/config/authority.js";
import { buildStorageDoctor } from "../../../../../../src/backend/runs/queries/storage.js";
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
import { createCredentialStore } from "../../../../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityHealthPreflightRunner } from "../../../../../../src/backend/storage/sqlite/authority-health-runner.js";
import { AuthorityDatabase } from "../../../../../../src/backend/storage/sqlite/authority-database.js";
import { doctorAuthorityStorage } from "../../../../../../src/backend/storage/sqlite/storage-doctor.js";

const COMMAND_ID = "11111111-1111-4111-8111-111111111111";
const WRITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.reverse()) cleanup();
  cleanups.length = 0;
});

function fixture() {
  const workspace = mkdtempSync(join(realpathSync(tmpdir()), "hr-credential-doctor-"));
  cleanups.push(() => rmSync(workspace, { recursive: true, force: true }));
  const admission = acquireEntrypointAdmission(workspace,"exclusive");
  cleanups.push(() => admission.release());
  const root = admission.stateRoot;
  const authorityPath = join(root,"state.db");
  const database = AuthorityDatabase.open(admission,{path:authorityPath,busyTimeoutMs:100,migrationOwner:"credential-doctor-fixture"});
  cleanups.push(() => database.close());
  const credentialDirectory = join(root,"credentials");
  const credentialPath = join(credentialDirectory,"protected.json");
  const credentialStore = createCredentialStore({admission,stateRoot:root});
  const options = {authorityPath,stateRoot:root,stateRootTrustAnchor:workspace,backupDirectory:join(root,"backups","authority"),busyTimeoutMs:100};
  return {root,workspace,admission,database,credentialDirectory,credentialPath,credentialStore,options};
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
  const meta = f.database.getMeta();
  const before = snapshot(f.root);
  const report = await doctorAuthorityStorage(f.admission,f.options);
  assert.ok(isDeepStrictEqual(snapshot(f.root), before), "doctor changed source inventory or bytes");
  assert.deepEqual(f.database.getMeta(), meta);
  return report.protectedSettings;
}

describe("credential presence doctor", () => {
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
    const runner = new AuthorityHealthPreflightRunner(f.admission,f.options);
    const context = {
      signal: new AbortController().signal,
      timeoutMs: 10_000,
      deadlineMonotonicMs: 10_000,
      redaction: "presence-only" as const,
    };
    const before = snapshot(f.root);
    const observation = await runner.run(context);
    assert.ok(isDeepStrictEqual(snapshot(f.root), before), "preflight changed source inventory or bytes");
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


describe("read-only upgrade phase reporting", () => {
  it("projects baseline and each upgrade phase through doctor, browser wire and preflight without private journal payload", async () => {
    const f = fixture();
    const baseline = await doctorAuthorityStorage(f.admission,f.options);
    assert.equal(baseline.authorityUpgrades.state, "available");
    if (baseline.authorityUpgrades.state !== "available") throw new Error("baseline missing");
    assert.deepEqual(baseline.authorityUpgrades.phases.map(({ phase }) => phase), ["baseline"]);
    const expected: { phase: string; fromSchemaVersion: number; toSchemaVersion: number; recordedAt: string }[] = [...baseline.authorityUpgrades.phases];
    for (const [index, phase] of (["planned", "committed", "settled"] as const).entries()) {
      const record = AuthorityUpgradeRecordSchema.parse({
        recordKey: `bbbbbbbb-bbbb-4bbb-8bbb-${String(index + 1).padStart(12, "0")}`,
        upgradeId: "a".repeat(64), planDigest: "b".repeat(64),
        phase, fromSchemaVersion: 0, toSchemaVersion: 1, by: "local-operator",
        recordedAt: "2026-09-06T20:00:00.000Z",
        backup: { manifestPath: `${f.root}/private-manifest.json`, sha256: "c".repeat(64), authorityGeneration: 7 },
      });
      const raw = new DatabaseSync(f.options.authorityPath);
      raw.prepare("INSERT INTO database_upgrades (id, upgrade_id, phase, backup_digest, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(record.recordKey, record.upgradeId, phase, "c".repeat(64), JSON.stringify(record), record.recordedAt);
      raw.close();
      const meta = f.database.getMeta();
      const before = snapshot(f.root);
      const report = await doctorAuthorityStorage(f.admission,f.options);
      const wire = await buildStorageDoctor({ admission: f.admission, doctorOptions: f.options, clock: systemClock,
        serviceState: () => ({ state: "never-run", reason: "No backup requested" }),
      });
      const observation = await new AuthorityHealthPreflightRunner(f.admission,f.options).run({
        signal: new AbortController().signal, timeoutMs: 10_000, deadlineMonotonicMs: 10_000, redaction: "presence-only",
      });
      expected.push({ phase, fromSchemaVersion: record.fromSchemaVersion, toSchemaVersion: record.toSchemaVersion, recordedAt: record.recordedAt });
      assert.deepEqual(report.authorityUpgrades, { state: "available", phases: expected });
      assert.deepEqual(wire.authorityUpgrades, report.authorityUpgrades);
      assert.ok(observation.summary.includes(`authority upgrade phase ${phase}`));
      assert.equal(observation.state, phase === "settled" ? "healthy" : "unhealthy");
      const publicOutput = JSON.stringify({ wire, observation, upgrade: report.authorityUpgrades });
      for (const privateValue of [f.root, record.recordKey, ...["a", "b", "c", "d", "e"].map((value) => value.repeat(64))]) {
        assert.equal(publicOutput.includes(privateValue), false, "private upgrade field escaped");
      }
      assert.ok(isDeepStrictEqual(snapshot(f.root), before), "doctor projection changed source inventory or bytes");
      assert.deepEqual(f.database.getMeta(), meta);
    }
  });

  it("keeps a corrupt journal explicitly unavailable without exposing its payload or mutating it", async () => {
    const f = fixture();
    const raw = new DatabaseSync(f.options.authorityPath);
    raw.prepare("INSERT INTO database_upgrades (id, upgrade_id, phase, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("broken", "private-upgrade-identity", "planned", JSON.stringify({ private: "private-journal-payload" }), "2026-09-06T20:00:00.000Z");
    raw.close();
    const before = snapshot(f.root);
    const report = await doctorAuthorityStorage(f.admission,f.options);
    assert.deepEqual(report.authorityUpgrades, { state: "unavailable", cause: {
      code: "authority-unavailable", summary: "authority upgrade journal could not be verified",
    } });
    assert.equal(JSON.stringify(report.authorityUpgrades).includes("private-journal-payload"), false);
    assert.ok(isDeepStrictEqual(snapshot(f.root), before), "corrupt journal inspection changed source inventory or bytes");
  });
});
