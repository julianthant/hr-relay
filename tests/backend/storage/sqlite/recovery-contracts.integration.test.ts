import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { doctorAuthorityStorage as doctorProfileAuthorityStorage } from "../../../../src/backend/storage/sqlite/storage-doctor.js";
import { ProtectedSettingsApplyInputSchema, PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import { verifyBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { createBackupFixtures } from "../../../support/helpers/storage/backup-fixtures.js";
import { default as assert } from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { buildStorageDoctor } from "../../../../src/backend/runs/queries/storage.js";
import { AuthorityBackupManifestSchema, StorageDoctorReportSchema } from "../../../../src/backend/storage/sqlite/recovery-contracts.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { composeStorageCommand, doctorAuthorityStorage, syntheticStateRoot } from "../../../support/helpers/synthetic-storage-admission.js";

{

const NOW = "2026-09-06T20:00:00.000Z";
const CLOCK = manualClock(new Date(NOW));
const cleanups: (() => void)[] = [];
const _afterEachFixture0 = () => { for (const cleanup of [...cleanups]) { cleanup(); cleanups.splice(cleanups.indexOf(cleanup), 1); } };
const { openCurrentWorld, takeBackup } = createBackupFixtures(cleanups, CLOCK);


describe("DB-only authority backups", () => {
afterEach(_afterEachFixture0);

  it("writes manifest v3 and never reads or copies settings or credentials", async () => {
    const world = await openCurrentWorld();
    const canary = "CANARY-CREDENTIAL-must-not-enter-backup";
    const applied = world.credentials.apply(ProtectedSettingsApplyInputSchema.parse({
      commandId: randomUUID(), commandFingerprint: "a".repeat(64), writeId: randomUUID(),
      expectedRevision: world.credentials.read().revision, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
      entries: { ucpathPassword: { set: canary } }, updatedAt: NOW,
    }));
    assert.equal(applied.state, "applied");
    const profileId = world.admission.profileBinding.profileId;
    const journalPath = join(world.machine.stateRoot, "machine", "erasures", `${profileId}.json`);
    const protectedPaths = [join(world.stateRoot, "credentials", "protected.json"),
      join(world.machine.stateRoot, "machine", "credential-keys", `${profileId}.json`), journalPath, `${journalPath}.authority`];
    const witnesses = protectedPaths.map(path => ({ path, bytes: existsSync(path) ? readFileSync(path) : undefined }));
    assert.ok(witnesses[0]?.bytes !== undefined);
    assert.ok(witnesses[1]?.bytes !== undefined);
    writeFileSync(join(world.stateRoot, "unrelated-settings.json"), canary, { mode: 0o600 });

    const { report, manifest, manifestPath } = await takeBackup(world);

    assert.equal(report.manifests.every((entry) => entry.manifestVersion === 4), true);
    assert.equal(manifest.manifestVersion, 4);
    assert.equal("files" in manifest, false);
    assert.equal("protectedSettings" in manifest, false);
    const entries = readdirSync(world.backupDirectory).sort();
    assert.equal(entries.length, 2);
    assert.equal(
      entries.some((name) => readFileSync(join(world.backupDirectory, name)).includes(canary)),
      false,
    );
    for (const witness of witnesses) {
      const bytes = witness.bytes;
      if (bytes === undefined) assert.equal(existsSync(witness.path), false);
      else {
        assert.deepEqual(readFileSync(witness.path), bytes);
        assert.equal(entries.some(name => readFileSync(join(world.backupDirectory, name)).includes(bytes)), false);
      }
    }
    assert.equal(AuthorityBackupManifestSchema.safeParse({
      ...manifest,
      protectedSettings: { revision: 1, entries: [] },
    }).success, false);
    await verifyBackupManifestAtPath(world.admission, manifestPath);
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
  const f = await createBoundProfileFixture();
  const root = f.stateRoot;
  const clock = manualClock(new Date("2026-09-10T20:00:00Z"));
  try {
    writeFileSync(join(root, "state.db"), "corrupt synthetic authority");
    writeFileSync(join(root, ".unowned-recovery-entry"), invalid ? '{"SYNTHETIC_PRIVATE_VALUE":' : "SYNTHETIC_PRIVATE_VALUE");

    writeFileSync(join(root, "credentials", "protected.json"), "SYNTHETIC_PRIVATE_VALUE");
    const before = snapshot(root);
    const outcome = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], clock, f.workspace);
    assert.equal(outcome.exitCode, 1);
    const report = StorageDoctorReportSchema.parse(JSON.parse(outcome.output));
    assert.equal(report.authority.state, "degraded");
    assert.equal(report.recovery.state, "unavailable");
    assert.equal(report.counts.state, "unavailable");
    assert.equal(report.protectedSettings.state, "unavailable");
    assert.ok(!outcome.output.includes("SYNTHETIC_PRIVATE_VALUE"));
    const wire = await buildStorageDoctor({ admission: syntheticStateRoot(root), doctorOptions: options(root), clock,
      serviceState: () => ({ state: "never-run", reason: "Explicit backups only" }) });
    assert.deepEqual(wire.recovery, report.recovery);
    assert.equal(wire.authority.state, "degraded");
    assert.deepEqual(snapshot(root), before);
    const text = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor"], clock, f.workspace);
    assert.match(text.output, /recovery: UNAVAILABLE/u);
  } finally { await f.close(); }
});

for (const fault of ["directory", "symlink", "permissions"] as const) it(`never treats an unreadable ${fault} marker as absent`, async () => {
  const f = await createBoundProfileFixture();
  const clock = manualClock(new Date("2026-09-10T20:00:00Z"));
  try {
    const marker = join(f.stateRoot, ".restore-00000000-0000-4000-8000-000000000001.sqlite.tmp");
    if (fault === "directory") mkdirSync(marker);
    else if (fault === "symlink") symlinkSync(join(f.stateRoot, "missing-private-target"), marker);
    else writeFileSync(marker, "{}");
    const before = snapshot(f.stateRoot);
    if (fault === "permissions") chmodSync(marker, 0);
    assert.equal((await doctorAuthorityStorage(options(f.stateRoot), clock)).recovery.state, "unavailable");
    if (fault === "permissions") chmodSync(marker, 0o600);
    assert.deepEqual(snapshot(f.stateRoot), before);
  } finally { await f.close(); }
});

it("withholds absence of custody for an unreadable live database and inaccessible backup directory", async () => {
  const cleanups: (() => void)[] = [];
  const clock = manualClock(new Date("2026-09-10T20:00:00Z"));
  const { openCurrentWorld, takeBackup } = createBackupFixtures(cleanups, clock);
  let primary: { error: unknown } | undefined = undefined;
  let changedDirectory: string | undefined = undefined;
  try {
    const world = await openCurrentWorld();
    const f = { root: world.stateRoot, path: world.authorityPath };
    await takeBackup(world);
    world.closeDatabase();
    writeFileSync(f.path, "corrupt synthetic authority");
    const report = await doctorProfileAuthorityStorage(world.admission, options(f.root), clock, world.credentials);
    const half = report.restoreCandidates[0];
    assert.ok(half?.state === "verified-compatible");
    assert.equal(half.generationGap.state, "unavailable");
    assert.equal(half.restoreEligibility.state, "unavailable");
    chmodSync(options(f.root).backupDirectory, 0);
    changedDirectory = options(f.root).backupDirectory;
    const inaccessible = await doctorProfileAuthorityStorage(world.admission, options(f.root), clock, world.credentials);
    assert.equal(inaccessible.backup.state, "invalid");
    assert.deepEqual(inaccessible.restoreCandidates, []);
  } catch (error) { primary = { error }; }
  const cleanupFailures: unknown[] = [];
  if (changedDirectory !== undefined && existsSync(changedDirectory)) {
    try { chmodSync(changedDirectory, 0o700); } catch (error) { cleanupFailures.push(error); }
  }
  for (const cleanup of cleanups) {
    try { cleanup(); } catch (error) { cleanupFailures.push(error); }
  }
  if (primary !== undefined) {
    if (cleanupFailures.length !== 0) throw new AggregateError([primary.error, ...cleanupFailures], "recovery-contract-cleanup-failed", { cause: primary.error });
    throw primary.error;
  }
  if (cleanupFailures.length !== 0) throw new AggregateError(cleanupFailures, "recovery-contract-cleanup-failed", { cause: cleanupFailures[0] });
});
}
