import { default as assert } from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { afterEach, describe, it } from "vitest";
import { buildStorageDoctor } from "../../../../src/backend/runs/queries/storage.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityHealthPreflightRunner } from "../../../../src/backend/storage/sqlite/authority-health-runner.js";
import { doctorAuthorityStorage } from "../../../../src/backend/storage/sqlite/storage-doctor.js";
import { AuthorityUpgradeRecordSchema } from "../../../../src/models/config/authority.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsApplyInputSchema, type ProtectedSettingsPatch } from "../../../../src/models/config/protected-settings.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { storageRecoveryFixture, storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { AuthorityDatabase as AuthorityDatabase_m1, doctorAuthorityStorage as doctorAuthorityStorage_m1, syntheticStateRoot } from "../../../support/helpers/synthetic-storage-admission.js";

{

const COMMAND_ID = "11111111-1111-4111-8111-111111111111";
const WRITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const cleanups: (() => void)[] = [];

const _afterEachFixture0 = () => {
  for (const cleanup of cleanups.reverse()) cleanup();
  cleanups.length = 0;
};

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
afterEach(_afterEachFixture0);

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
});

describe("read-only upgrade phase reporting", () => {
afterEach(_afterEachFixture0);

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
});
}

{

// Preserve every byte except SQLite's documented shared reader marks (existing doctor proof).
function snapshot(root: string) {
  const tree = storageTree(root);
  if ("state.db-shm" in tree) {
    const bytes = readFileSync(join(root, "state.db-shm"));
    assert.ok(bytes.length >= 136); bytes.fill(0, 100, 120);
    tree["state.db-shm"] = createHash("sha256").update(bytes).digest("hex");
  }
  return tree;
}

function options(root: string) {
  return { stateRootTrustAnchor: dirname(root), stateRoot: root, authorityPath: join(root, "state.db"),
    backupDirectory: join(root, "backups", "authority"), busyTimeoutMs: 500 };
}

describe("read-only storage recovery truth", () => {
  it("reports interruption separately from healthy integrity and preserves all recovery bytes", async () => {
    const f = storageRecoveryFixture();
    try {
      AuthorityDatabase_m1.open({ path: f.path, busyTimeoutMs: 500, migrationOwner: "doctor-proof" }, f.clock).close();
      await doctorAuthorityStorage_m1(options(f.root), f.clock);
      assert.equal(existsSync(`${f.path}-wal`) ? readFileSync(`${f.path}-wal`).length : 0, 0);
      writeFileSync(join(f.root, ".restore-00000000-0000-4000-8000-000000000001.sqlite.tmp"), "retained current stage", { mode: 0o600 });
      const before = snapshot(f.root);
      const report = await doctorAuthorityStorage_m1(options(f.root), f.clock);
      assert.equal(report.authority.state, "healthy");
      assert.equal(report.recovery.state, "interrupted");
      const wire = await buildStorageDoctor({ admission: syntheticStateRoot(f.root), doctorOptions: options(f.root), clock: f.clock,
        serviceState: () => ({state: "never-run", reason: "Explicit backups only"}) });
      assert.deepEqual(wire.recovery, report.recovery);
      assert.deepEqual(snapshot(f.root), before);
    } finally { f.dispose(); }
  });

});
}
