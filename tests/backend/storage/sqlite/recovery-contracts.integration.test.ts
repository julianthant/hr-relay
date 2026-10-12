import { createBackupFixtures } from "../../../support/helpers/storage/backup-fixtures.js";
import { default as assert } from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { buildStorageDoctor } from "../../../../src/backend/runs/queries/storage.js";
import { AuthorityBackupManifestSchema, StorageDoctorReportSchema } from "../../../../src/backend/storage/sqlite/recovery-contracts.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { storageRecoveryFixture, storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { AuthorityDatabase, composeStorageCommand, doctorAuthorityStorage, syntheticStateRoot, verifyBackupManifestAtPath } from "../../../support/helpers/synthetic-storage-admission.js";

{

const NOW = "2026-09-06T20:00:00.000Z";
const CLOCK = manualClock(new Date(NOW));
const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

const _afterEachFixture0 = () => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
};

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), prefix));
  roots.push(root);
  return root;
}

const { openCurrentWorld, takeBackup } = createBackupFixtures(temporaryRoot, databases, CLOCK);



describe("DB-only authority backups", () => {
afterEach(_afterEachFixture0);

  it("writes manifest v3 and never reads or copies settings or credentials", async () => {
    const world = openCurrentWorld();
    const canary = "CANARY-CREDENTIAL-must-not-enter-backup";
    const credentialRoot = join(world.stateRoot, "credentials");
    mkdirSync(credentialRoot, { mode: 0o700 });
    writeFileSync(join(credentialRoot, "protected.json"), canary, { mode: 0o600 });
    writeFileSync(join(world.stateRoot, "unrelated-settings.json"), canary, { mode: 0o600 });

    const { report, manifest, manifestPath } = await takeBackup(world);

    assert.equal(report.manifests.every((entry) => entry.manifestVersion === 3), true);
    assert.equal(manifest.manifestVersion, 3);
    assert.equal("files" in manifest, false);
    assert.equal("protectedSettings" in manifest, false);
    const entries = readdirSync(world.backupDirectory).sort();
    assert.equal(entries.length, 2);
    assert.equal(
      entries.some((name) => readFileSync(join(world.backupDirectory, name)).includes(canary)),
      false,
    );
    assert.equal(AuthorityBackupManifestSchema.safeParse({
      ...manifest,
      protectedSettings: { revision: 1, entries: [] },
    }).success, false);
    await verifyBackupManifestAtPath(manifestPath, world.database.getSourceDatabaseIdentity());
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

for (const invalid of [false, true]) it(`reports unowned recovery evidence beside corrupt authority (${invalid ? "malformed" : "opaque"}) through CLI and BFF`, async () => {
  const f = storageRecoveryFixture();
  const root = join(f.root, rebuildRuntimeIsolation.stateRoot);
  mkdirSync(root, { recursive: true });
  try {
    writeFileSync(join(root, "state.db"), "corrupt synthetic authority");
    writeFileSync(join(root, ".unowned-recovery-entry"), invalid ? '{"SYNTHETIC_PRIVATE_VALUE":' : "SYNTHETIC_PRIVATE_VALUE");
    mkdirSync(join(root, "credentials"));
    writeFileSync(join(root, "credentials", "protected.json"), "SYNTHETIC_PRIVATE_VALUE");
    const before = snapshot(root);
    const outcome = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], f.clock, f.root);
    assert.equal(outcome.exitCode, 1);
    const report = StorageDoctorReportSchema.parse(JSON.parse(outcome.output));
    assert.equal(report.authority.state, "degraded");
    assert.equal(report.recovery.state, "unavailable");
    assert.equal(report.counts.state, "unavailable");
    assert.equal(report.protectedSettings.state, "unavailable");
    assert.ok(!outcome.output.includes("SYNTHETIC_PRIVATE_VALUE"));
    const wire = await buildStorageDoctor({ admission: syntheticStateRoot(root), doctorOptions: options(root), clock: f.clock,
      serviceState: () => ({ state: "never-run", reason: "Explicit backups only" }) });
    assert.deepEqual(wire.recovery, report.recovery);
    assert.equal(wire.authority.state, "degraded");
    assert.deepEqual(snapshot(root), before);
    const text = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor"], f.clock, f.root);
    assert.match(text.output, /recovery: UNAVAILABLE/u);
  } finally { f.dispose(); }
});

for (const fault of ["directory", "symlink", "permissions"] as const) it(`never treats an unreadable ${fault} marker as absent`, async () => {
  const f = storageRecoveryFixture();
  try {
    const marker = join(f.root, ".restore-00000000-0000-4000-8000-000000000001.sqlite.tmp");
    if (fault === "directory") mkdirSync(marker);
    else if (fault === "symlink") symlinkSync(join(f.root, "missing-private-target"), marker);
    else writeFileSync(marker, "{}");
    const before = snapshot(f.root);
    if (fault === "permissions") chmodSync(marker, 0);
    assert.equal((await doctorAuthorityStorage(options(f.root), f.clock)).recovery.state, "unavailable");
    if (fault === "permissions") chmodSync(marker, 0o600);
    assert.deepEqual(snapshot(f.root), before);
  } finally { f.dispose(); }
});

it("withholds absence of custody for an unreadable live database and inaccessible backup directory", async () => {
  const f = storageRecoveryFixture();
  try {
    AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 500, migrationOwner: "current-custody-control" }, f.clock).close();
    await f.backup();
    writeFileSync(f.path, "corrupt synthetic authority");
    const report = await doctorAuthorityStorage(options(f.root), f.clock);
    const half = report.restoreCandidates[0];
    assert.ok(half?.state === "verified-compatible");
    assert.equal(half.generationGap.state, "unavailable");
    assert.equal(half.restoreEligibility.state, "unavailable");
    chmodSync(options(f.root).backupDirectory, 0);
    const inaccessible = await doctorAuthorityStorage(options(f.root), f.clock);
    assert.equal(inaccessible.backup.state, "invalid");
    assert.deepEqual(inaccessible.restoreCandidates, []);
  } finally { chmodSync(options(f.root).backupDirectory, 0o700); f.dispose(); }
});
}
