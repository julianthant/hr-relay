import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { createHash as createHash_m1 } from "node:crypto";
import {
chmodSync as chmodSync_m0,
existsSync as existsSync_m1,
lstatSync as lstatSync_m0,
mkdtempSync as mkdtempSync_m0,
readFileSync as readFileSync_m0,
readFileSync as readFileSync_m1,
readdirSync as readdirSync_m0,
realpathSync as realpathSync_m0,
rmSync as rmSync_m0,
writeFileSync as writeFileSync_m0,
writeFileSync as writeFileSync_m1
} from "node:fs";
import { tmpdir as tmpdir_m0 } from "node:os";
import { dirname as dirname_m1,join as join_m0,join as join_m1 } from "node:path";
import { DatabaseSync as DatabaseSync_m0 } from "node:sqlite";
import { isDeepStrictEqual as isDeepStrictEqual_m0 } from "node:util";
import { afterEach as afterEach_m0,describe as describe_m0,describe as describe_m1,it as it_m0,it as it_m1 } from "vitest";
import { buildStorageDoctor as buildStorageDoctor_m0,buildStorageDoctor as buildStorageDoctor_m1 } from "../../../../src/backend/runs/queries/storage.js";
import { acquireEntrypointAdmission as acquireEntrypointAdmission_m0 } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { createCredentialStore as createCredentialStore_m0 } from "../../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase as AuthorityDatabase_m0 } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityHealthPreflightRunner as AuthorityHealthPreflightRunner_m0 } from "../../../../src/backend/storage/sqlite/authority-health-runner.js";
import { doctorAuthorityStorage as doctorAuthorityStorage_m0 } from "../../../../src/backend/storage/sqlite/storage-doctor.js";
import { AuthorityUpgradeRecordSchema as AuthorityUpgradeRecordSchema_m0 } from "../../../../src/models/config/authority.js";
import {
PROTECTED_SETTINGS_SCHEMA_HASH as PROTECTED_SETTINGS_SCHEMA_HASH_m0,
ProtectedSettingsApplyInputSchema as ProtectedSettingsApplyInputSchema_m0,
type ProtectedSettingsPatch as ProtectedSettingsPatch_m0
} from "../../../../src/models/config/protected-settings.js";
import { systemClock as systemClock_m0 } from "../../../../src/rules/time/clock.js";
import { storageRecoveryFixture as storageRecoveryFixture_m1,storageTree as storageTree_m1 } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { AuthorityDatabase as AuthorityDatabase_m1,doctorAuthorityStorage as doctorAuthorityStorage_m1,syntheticStateRoot as syntheticStateRoot_m1 } from "../../../support/helpers/synthetic-storage-admission.js";


{


const COMMAND_ID = "11111111-1111-4111-8111-111111111111";
const WRITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const cleanups: (() => void)[] = [];

const _afterEachFixture0 = () => {
  for (const cleanup of cleanups.reverse()) cleanup();
  cleanups.length = 0;
};

function fixture() {
  const workspace = mkdtempSync_m0(join_m0(realpathSync_m0(tmpdir_m0()), "hr-credential-doctor-"));
  cleanups.push(() => rmSync_m0(workspace, { recursive: true, force: true }));
  const admission = acquireEntrypointAdmission_m0(workspace,"exclusive");
  cleanups.push(() => admission.release());
  const root = admission.stateRoot;
  const authorityPath = join_m0(root,"state.db");
  const database = AuthorityDatabase_m0.open(admission,{path:authorityPath,busyTimeoutMs:100,migrationOwner:"credential-doctor-fixture"});
  cleanups.push(() => database.close());
  const credentialDirectory = join_m0(root,"credentials");
  const credentialPath = join_m0(credentialDirectory,"protected.json");
  const credentialStore = createCredentialStore_m0({admission,stateRoot:root});
  const options = {authorityPath,stateRoot:root,stateRootTrustAnchor:workspace,backupDirectory:join_m0(root,"backups","authority"),busyTimeoutMs:100};
  return {root,workspace,admission,database,credentialDirectory,credentialPath,credentialStore,options};
}

function writeCredentials(f: ReturnType<typeof fixture>, entries: ProtectedSettingsPatch_m0) {
  const outcome = f.credentialStore.apply(ProtectedSettingsApplyInputSchema_m0.parse({
    commandId: COMMAND_ID,
    commandFingerprint: "1".repeat(64),
    expectedRevision: 1,
    protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH_m0,
    writeId: WRITE_ID,
    entries,
    updatedAt: "2026-09-06T20:00:00.000Z",
  }));
  assert_m0.equal(outcome.state, "applied");
  if (outcome.state !== "applied") throw new Error("credential fixture failed to apply");
  return outcome.record;
}

function snapshot(root: string): unknown {
  return readdirSync_m0(root).sort().map((name) => {
    const path = join_m0(root, name);
    const stat = lstatSync_m0(path);
    const bytes = stat.isDirectory() ? undefined : readFileSync_m0(path);
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
  const report = await doctorAuthorityStorage_m0(f.admission,f.options);
  assert_m0.ok(isDeepStrictEqual_m0(snapshot(f.root), before), "doctor changed source inventory or bytes");
  assert_m0.deepEqual(f.database.getMeta(), meta);
  return report.protectedSettings;
}

describe_m0("credential presence doctor", () => {
afterEach_m0(_afterEachFixture0);


  it_m0.each(["corrupt", "permissions"])(
    "keeps %s credential state unavailable and untouched with a closed diagnostic",
    async (fault) => {
      const f = fixture();
      writeCredentials(f, { timekeeperName: { set: "Protected Doctor Canary" } });
      if (fault === "corrupt") writeFileSync_m0(f.credentialPath, "Protected Doctor Canary");
      if (fault === "permissions") chmodSync_m0(f.credentialPath, 0o644);

      assert_m0.deepEqual(await unchanged(f), {
        state: "unavailable",
        cause: {
          code: "authority-unavailable",
          summary: "credentials in credentials could not be verified read-only",
        },
      });
    },
  );
});


describe_m0("read-only upgrade phase reporting", () => {
afterEach_m0(_afterEachFixture0);

  it_m0("projects baseline and each upgrade phase through doctor, browser wire and preflight without private journal payload", async () => {
    const f = fixture();
    const baseline = await doctorAuthorityStorage_m0(f.admission,f.options);
    assert_m0.equal(baseline.authorityUpgrades.state, "available");
    if (baseline.authorityUpgrades.state !== "available") throw new Error("baseline missing");
    assert_m0.deepEqual(baseline.authorityUpgrades.phases.map(({ phase }) => phase), ["baseline"]);
    const expected: { phase: string; fromSchemaVersion: number; toSchemaVersion: number; recordedAt: string }[] = [...baseline.authorityUpgrades.phases];
    for (const [index, phase] of (["planned", "committed", "settled"] as const).entries()) {
      const record = AuthorityUpgradeRecordSchema_m0.parse({
        recordKey: `bbbbbbbb-bbbb-4bbb-8bbb-${String(index + 1).padStart(12, "0")}`,
        upgradeId: "a".repeat(64), planDigest: "b".repeat(64),
        phase, fromSchemaVersion: 0, toSchemaVersion: 1, by: "local-operator",
        recordedAt: "2026-09-06T20:00:00.000Z",
        backup: { manifestPath: `${f.root}/private-manifest.json`, sha256: "c".repeat(64), authorityGeneration: 7 },
      });
      const raw = new DatabaseSync_m0(f.options.authorityPath);
      raw.prepare("INSERT INTO database_upgrades (id, upgrade_id, phase, backup_digest, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(record.recordKey, record.upgradeId, phase, "c".repeat(64), JSON.stringify(record), record.recordedAt);
      raw.close();
      const meta = f.database.getMeta();
      const before = snapshot(f.root);
      const report = await doctorAuthorityStorage_m0(f.admission,f.options);
      const wire = await buildStorageDoctor_m0({ admission: f.admission, doctorOptions: f.options, clock: systemClock_m0,
        serviceState: () => ({ state: "never-run", reason: "No backup requested" }),
      });
      const observation = await new AuthorityHealthPreflightRunner_m0(f.admission,f.options).run({
        signal: new AbortController().signal, timeoutMs: 10_000, deadlineMonotonicMs: 10_000, redaction: "presence-only",
      });
      expected.push({ phase, fromSchemaVersion: record.fromSchemaVersion, toSchemaVersion: record.toSchemaVersion, recordedAt: record.recordedAt });
      assert_m0.deepEqual(report.authorityUpgrades, { state: "available", phases: expected });
      assert_m0.deepEqual(wire.authorityUpgrades, report.authorityUpgrades);
      assert_m0.ok(observation.summary.includes(`authority upgrade phase ${phase}`));
      assert_m0.equal(observation.state, phase === "settled" ? "healthy" : "unhealthy");
      const publicOutput = JSON.stringify({ wire, observation, upgrade: report.authorityUpgrades });
      for (const privateValue of [f.root, record.recordKey, ...["a", "b", "c", "d", "e"].map((value) => value.repeat(64))]) {
        assert_m0.equal(publicOutput.includes(privateValue), false, "private upgrade field escaped");
      }
      assert_m0.ok(isDeepStrictEqual_m0(snapshot(f.root), before), "doctor projection changed source inventory or bytes");
      assert_m0.deepEqual(f.database.getMeta(), meta);
    }
  });
});
}

{


// Preserve every byte except SQLite's documented shared reader marks (existing doctor proof).
function snapshot(root: string) {
  const tree = storageTree_m1(root);
  if ("state.db-shm" in tree) {
    const bytes = readFileSync_m1(join_m1(root, "state.db-shm"));
    assert_m1.ok(bytes.length >= 136); bytes.fill(0, 100, 120);
    tree["state.db-shm"] = createHash_m1("sha256").update(bytes).digest("hex");
  }
  return tree;
}

function options(root: string) {
  return { stateRootTrustAnchor: dirname_m1(root), stateRoot: root, authorityPath: join_m1(root, "state.db"),
    backupDirectory: join_m1(root, "backups", "authority"), busyTimeoutMs: 500 };
}

describe_m1("read-only storage recovery truth", () => {
  it_m1("reports interruption separately from healthy integrity and preserves all recovery bytes", async () => {
    const f = storageRecoveryFixture_m1();
    try {
      AuthorityDatabase_m1.open({ path: f.path, busyTimeoutMs: 500, migrationOwner: "doctor-proof" }, f.clock).close();
      await doctorAuthorityStorage_m1(options(f.root), f.clock);
      assert_m1.equal(existsSync_m1(`${f.path}-wal`) ? readFileSync_m1(`${f.path}-wal`).length : 0, 0);
      writeFileSync_m1(join_m1(f.root, ".restore-00000000-0000-4000-8000-000000000001.sqlite.tmp"), "retained current stage", { mode: 0o600 });
      const before = snapshot(f.root);
      const report = await doctorAuthorityStorage_m1(options(f.root), f.clock);
      assert_m1.equal(report.authority.state, "healthy");
      assert_m1.equal(report.recovery.state, "interrupted");
      const wire = await buildStorageDoctor_m1({ admission: syntheticStateRoot_m1(f.root), doctorOptions: options(f.root), clock: f.clock,
        serviceState: () => ({state: "never-run", reason: "Explicit backups only"}) });
      assert_m1.deepEqual(wire.recovery, report.recovery);
      assert_m1.deepEqual(snapshot(f.root), before);
    } finally { f.dispose(); }
  });


});
}
