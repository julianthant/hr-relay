import { createCredentialDoctorWriter } from "../../../support/helpers/credential-doctor-fixtures.js";
import { createCredentialDoctorFixtures } from "../../../support/helpers/credential-doctor-fixtures.js";
import { default as assert } from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";

import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { afterEach, describe, it } from "vitest";
import { buildStorageDoctor } from "../../../../src/backend/runs/queries/storage.js";



import { AuthorityHealthPreflightRunner } from "../../../../src/backend/storage/sqlite/authority-health-runner.js";
import { doctorAuthorityStorage } from "../../../../src/backend/storage/sqlite/storage-doctor.js";
import { AuthorityUpgradeRecordSchema } from "../../../../src/models/config/authority.js";

import { systemClock } from "../../../../src/rules/time/clock.js";
import { storageRecoveryFixture, storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";

{

const COMMAND_ID = "11111111-1111-4111-8111-111111111111";
const WRITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const cleanups: (() => void)[] = [];

const _afterEachFixture0 = () => {
  for (const cleanup of cleanups.reverse()) cleanup();
  cleanups.length = 0;
};

const { fixture, snapshot } = createCredentialDoctorFixtures(cleanups);

const writeCredentials = createCredentialDoctorWriter(COMMAND_ID, WRITE_ID);



async function unchanged(f: ReturnType<typeof fixture>) {
  const meta = f.database.getMeta();
  const before = snapshot(f.machineRoot), controlBefore = snapshot(join(f.workspace, ".tracker", "control"));
  const report = await doctorAuthorityStorage(f.admission,f.options, undefined, f.credentialStore);
  assert.ok(isDeepStrictEqual(snapshot(f.machineRoot), before), "doctor changed source inventory or bytes");
  assert.ok(isDeepStrictEqual(snapshot(join(f.workspace, ".tracker", "control")), controlBefore), "doctor changed control bytes");
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
    const baseline = await doctorAuthorityStorage(f.admission,f.options, undefined, f.credentialStore);
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
      const before = snapshot(f.machineRoot), controlBefore = snapshot(join(f.workspace, ".tracker", "control"));
      const report = await doctorAuthorityStorage(f.admission,f.options, undefined, f.credentialStore);
      const wire = await buildStorageDoctor({ credentials: f.credentialStore, admission: f.admission, doctorOptions: f.options, clock: systemClock,
        serviceState: () => ({ state: "never-run", reason: "No backup requested" }),
      });
      const observation = await new AuthorityHealthPreflightRunner(f.admission,f.options, undefined, f.credentialStore).run({
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
      assert.ok(isDeepStrictEqual(snapshot(f.machineRoot), before), "doctor projection changed source inventory or bytes");
      assert.ok(isDeepStrictEqual(snapshot(join(f.workspace, ".tracker", "control")), controlBefore), "doctor projection changed control bytes");
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
      f.finish();
      await doctorAuthorityStorage(f.admission, options(f.root), f.clock, boundProfileCredentials(f.admission));
      assert.equal(existsSync(`${f.path}-wal`) ? readFileSync(`${f.path}-wal`).length : 0, 0);
      writeFileSync(join(f.root, ".restore-00000000-0000-4000-8000-000000000001.sqlite.tmp"), "retained current stage", { mode: 0o600 });
      const before = snapshot(f.root);
      const report = await doctorAuthorityStorage(f.admission, options(f.root), f.clock, boundProfileCredentials(f.admission));
      assert.equal(report.authority.state, "healthy");
      assert.equal(report.recovery.state, "interrupted");
      const wire = await buildStorageDoctor({ admission: f.admission, credentials: boundProfileCredentials(f.admission), doctorOptions: options(f.root), clock: f.clock,
        serviceState: () => ({state: "never-run", reason: "Explicit backups only"}) });
      assert.deepEqual(wire.recovery, report.recovery);
      assert.deepEqual(snapshot(f.root), before);
    } finally { f.dispose(); }
  });

});
}
