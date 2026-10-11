import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { createHash as createHash_m1 } from "node:crypto";
import { chmodSync as chmodSync_m1,mkdirSync as mkdirSync_m0,mkdirSync as mkdirSync_m1,mkdtempSync as mkdtempSync_m0,readFileSync as readFileSync_m0,readFileSync as readFileSync_m1,readdirSync as readdirSync_m0,realpathSync as realpathSync_m0,rmSync as rmSync_m0,symlinkSync as symlinkSync_m1,writeFileSync as writeFileSync_m0,writeFileSync as writeFileSync_m1 } from "node:fs";
import { tmpdir as tmpdir_m0 } from "node:os";
import { dirname as dirname_m1,join as join_m0,join as join_m1 } from "node:path";
import { afterEach as afterEach_m0,describe as describe_m0,it as it_m0,it as it_m1 } from "vitest";
import { rebuildRuntimeIsolation as rebuildRuntimeIsolation_m1 } from "../../../../src/backend/app/config/runtime-isolation.js";
import { buildStorageDoctor as buildStorageDoctor_m1 } from "../../../../src/backend/runs/queries/storage.js";
import { AuthorityBackupManifestSchema as AuthorityBackupManifestSchema_m0,StorageDoctorReportSchema as StorageDoctorReportSchema_m1 } from "../../../../src/backend/storage/sqlite/recovery-contracts.js";
import { manualClock as manualClock_m0 } from "../../../../src/rules/time/clock.js";
import { storageRecoveryFixture as storageRecoveryFixture_m1,storageTree as storageTree_m1 } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { AuthorityBackupService as AuthorityBackupService_m0,AuthorityDatabase as AuthorityDatabase_m0,AuthorityDatabase as AuthorityDatabase_m1,composeStorageCommand as composeStorageCommand_m1,doctorAuthorityStorage as doctorAuthorityStorage_m1,syntheticStateRoot as syntheticStateRoot_m1,verifyBackupManifestAtPath as verifyBackupManifestAtPath_m0 } from "../../../support/helpers/synthetic-storage-admission.js";


{


const NOW = "2026-09-06T20:00:00.000Z";
const CLOCK = manualClock_m0(new Date(NOW));
const roots: string[] = [];
const databases: AuthorityDatabase_m0[] = [];

const _afterEachFixture0 = () => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync_m0(root, { recursive: true, force: true });
};

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync_m0(join_m0(realpathSync_m0(tmpdir_m0()), prefix));
  roots.push(root);
  return root;
}

function openCurrentWorld() {
  const root = temporaryRoot("hrauto-v3-backup-");
  const stateRoot = join_m0(root, ".tracker");
  mkdirSync_m0(stateRoot, { recursive: true, mode: 0o700 });
  const authorityPath = join_m0(stateRoot, "state.db");
  const database = AuthorityDatabase_m0.open({
    path: authorityPath,
    busyTimeoutMs: 250,
    migrationOwner: "backup-test",
  }, CLOCK);
  databases.push(database);
  return {
    stateRoot,
    authorityPath,
    database,
    backupDirectory: join_m0(stateRoot, "backups", "authority"),
  };
}

async function takeBackup(world: ReturnType<typeof openCurrentWorld>) {
  const service = new AuthorityBackupService_m0(world.database, { directory: world.backupDirectory }, CLOCK);
  const report = await service.request({
    trigger: "operator",
    requiredGeneration: world.database.getMeta().authorityGeneration,
  });
  const manifest = report.manifests[0];
  assert_m0.ok(manifest !== undefined);
  return {
    report,
    manifest,
    manifestPath: join_m0(world.backupDirectory, `${manifest.backupFileName}.manifest.json`),
  };
}

describe_m0("DB-only authority backups", () => {
afterEach_m0(_afterEachFixture0);

  it_m0("writes manifest v3 and never reads or copies settings or credentials", async () => {
    const world = openCurrentWorld();
    const canary = "CANARY-CREDENTIAL-must-not-enter-backup";
    const credentialRoot = join_m0(world.stateRoot, "credentials");
    mkdirSync_m0(credentialRoot, { mode: 0o700 });
    writeFileSync_m0(join_m0(credentialRoot, "protected.json"), canary, { mode: 0o600 });
    writeFileSync_m0(join_m0(world.stateRoot, "unrelated-settings.json"), canary, { mode: 0o600 });

    const { report, manifest, manifestPath } = await takeBackup(world);

    assert_m0.equal(report.manifests.every((entry) => entry.manifestVersion === 3), true);
    assert_m0.equal(manifest.manifestVersion, 3);
    assert_m0.equal("files" in manifest, false);
    assert_m0.equal("protectedSettings" in manifest, false);
    const entries = readdirSync_m0(world.backupDirectory).sort();
    assert_m0.equal(entries.length, 2);
    assert_m0.equal(
      entries.some((name) => readFileSync_m0(join_m0(world.backupDirectory, name)).includes(canary)),
      false,
    );
    assert_m0.equal(AuthorityBackupManifestSchema_m0.safeParse({
      ...manifest,
      protectedSettings: { revision: 1, entries: [] },
    }).success, false);
    await verifyBackupManifestAtPath_m0(manifestPath, world.database.getSourceDatabaseIdentity());
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

for (const invalid of [false, true]) it_m1(`reports unowned recovery evidence beside corrupt authority (${invalid ? "malformed" : "opaque"}) through CLI and BFF`, async () => {
  const f = storageRecoveryFixture_m1();
  const root = join_m1(f.root, rebuildRuntimeIsolation_m1.stateRoot);
  mkdirSync_m1(root, { recursive: true });
  try {
    writeFileSync_m1(join_m1(root, "state.db"), "corrupt synthetic authority");
    writeFileSync_m1(join_m1(root, ".unowned-recovery-entry"), invalid ? '{"SYNTHETIC_PRIVATE_VALUE":' : "SYNTHETIC_PRIVATE_VALUE");
    mkdirSync_m1(join_m1(root, "credentials"));
    writeFileSync_m1(join_m1(root, "credentials", "protected.json"), "SYNTHETIC_PRIVATE_VALUE");
    const before = snapshot(root);
    const outcome = await composeStorageCommand_m1(rebuildRuntimeIsolation_m1, ["doctor", "--json"], f.clock, f.root);
    assert_m1.equal(outcome.exitCode, 1);
    const report = StorageDoctorReportSchema_m1.parse(JSON.parse(outcome.output));
    assert_m1.equal(report.authority.state, "degraded");
    assert_m1.equal(report.recovery.state, "unavailable");
    assert_m1.equal(report.counts.state, "unavailable");
    assert_m1.equal(report.protectedSettings.state, "unavailable");
    assert_m1.ok(!outcome.output.includes("SYNTHETIC_PRIVATE_VALUE"));
    const wire = await buildStorageDoctor_m1({ admission: syntheticStateRoot_m1(root), doctorOptions: options(root), clock: f.clock,
      serviceState: () => ({ state: "never-run", reason: "Explicit backups only" }) });
    assert_m1.deepEqual(wire.recovery, report.recovery);
    assert_m1.equal(wire.authority.state, "degraded");
    assert_m1.deepEqual(snapshot(root), before);
    const text = await composeStorageCommand_m1(rebuildRuntimeIsolation_m1, ["doctor"], f.clock, f.root);
    assert_m1.match(text.output, /recovery: UNAVAILABLE/u);
  } finally { f.dispose(); }
});

for (const fault of ["directory", "symlink", "permissions"] as const) it_m1(`never treats an unreadable ${fault} marker as absent`, async () => {
  const f = storageRecoveryFixture_m1();
  try {
    const marker = join_m1(f.root, ".restore-00000000-0000-4000-8000-000000000001.sqlite.tmp");
    if (fault === "directory") mkdirSync_m1(marker);
    else if (fault === "symlink") symlinkSync_m1(join_m1(f.root, "missing-private-target"), marker);
    else writeFileSync_m1(marker, "{}");
    const before = snapshot(f.root);
    if (fault === "permissions") chmodSync_m1(marker, 0);
    assert_m1.equal((await doctorAuthorityStorage_m1(options(f.root), f.clock)).recovery.state, "unavailable");
    if (fault === "permissions") chmodSync_m1(marker, 0o600);
    assert_m1.deepEqual(snapshot(f.root), before);
  } finally { f.dispose(); }
});

it_m1("withholds absence of custody for an unreadable live database and inaccessible backup directory", async () => {
  const f = storageRecoveryFixture_m1();
  try {
    AuthorityDatabase_m1.open({ path: f.path, busyTimeoutMs: 500, migrationOwner: "current-custody-control" }, f.clock).close();
    await f.backup();
    writeFileSync_m1(f.path, "corrupt synthetic authority");
    const report = await doctorAuthorityStorage_m1(options(f.root), f.clock);
    const half = report.restoreCandidates[0];
    assert_m1.ok(half?.state === "verified-compatible");
    assert_m1.equal(half.generationGap.state, "unavailable");
    assert_m1.equal(half.restoreEligibility.state, "unavailable");
    chmodSync_m1(options(f.root).backupDirectory, 0);
    const inaccessible = await doctorAuthorityStorage_m1(options(f.root), f.clock);
    assert_m1.equal(inaccessible.backup.state, "invalid");
    assert_m1.deepEqual(inaccessible.restoreCandidates, []);
  } finally { chmodSync_m1(options(f.root).backupDirectory, 0o700); f.dispose(); }
});
}
