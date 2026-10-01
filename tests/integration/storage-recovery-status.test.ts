import { syntheticStateRoot } from "../helpers/synthetic-storage-admission.js";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { rebuildRuntimeIsolation } from "../../src/config/runtime-isolation.js";
import { composeStorageCommand } from "../helpers/synthetic-storage-admission.js";
import { verifyLifecyclePair } from "../helpers/synthetic-storage-admission.js";
import { StorageDoctorReportSchema } from "../../src/infra/sqlite/recovery-contracts.js";
import { describe, it } from "vitest";
import { storageRecoveryFixture, storageTree } from "./helpers/storage-recovery-fixture.js";
import { archiveFixture, attachFile } from "../unit/archive-transfer/fixtures.js";
import { doctorAuthorityStorage } from "../helpers/synthetic-storage-admission.js";
import { AuthorityDatabase } from "../helpers/synthetic-storage-admission.js";
import { backupStoppedAuthority } from "../helpers/synthetic-storage-admission.js";
import { buildStorageDoctor } from "../../src/backend/runs/dashboard/queries/storage.js";

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
      AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 500, migrationOwner: "doctor-proof" }, f.clock).close();
      await doctorAuthorityStorage(options(f.root), f.clock);
      assert.equal(readFileSync(`${f.path}-wal`).length, 0);
      writeFileSync(join(f.root, ".lifecycle-restore.json"), JSON.stringify({schemaVersion: 1, manifestDigest: "a".repeat(64)}));
      const before = snapshot(f.root);
      assert.throws(() => AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 500, migrationOwner: "doctor-proof" }, f.clock), /lifecycle-restore-incomplete/u);
      const report = await doctorAuthorityStorage(options(f.root), f.clock);
      assert.equal(report.authority.state, "healthy");
      assert.equal(report.recovery.state, "interrupted");
      const wire = await buildStorageDoctor({ admission: syntheticStateRoot(f.root), doctorOptions: options(f.root), clock: f.clock,
        serviceState: () => ({state: "never-run", reason: "Explicit backups only"}) });
      assert.deepEqual(wire.recovery, report.recovery);
      assert.deepEqual(snapshot(f.root), before);
    } finally { f.dispose(); }
  });

  it("reports the authenticated pair rather than admitting a published live half", async () => {
    const f = archiveFixture();
    try {
      attachFile(f.database, f.base.root, f.base.run.envelope.runId, 89720);
      f.terminal();
      assert.equal(f.kernel.execute(f.applyRequest(f.plan())).state, "applied");
      f.database.close();
      const backup = await backupStoppedAuthority(f.base.root, f.base.clock);
      assert.ok("pairedManifestPath" in backup);
      const report = await doctorAuthorityStorage(options(f.base.root), f.base.clock);
      const pair = report.restoreCandidates.find(row => row.manifestFileName.endsWith(".lifecycle.json"));
      assert.ok(pair, "the complete pair must be inspected");
      assert.equal(pair.state, "verified-compatible");
      assert.ok(pair.state === "verified-compatible");
      assert.equal(pair.restoreEligibility.state, "eligible");
      const half = report.restoreCandidates.find(row => row.manifestFileName.endsWith(".manifest.json"));
      assert.ok(half);
      assert.ok(half.state === "verified-compatible");
      assert.equal(half.restoreEligibility.state, "incomplete");
    } finally { f.dispose(); }
  });
});

for (const marker of ["lifecycle-restore", "archive-conversion", "archive-restore"] as const) {
  for (const invalid of [false, true]) it(`reports ${marker} ${invalid ? "invalid" : "interrupted"} beside corrupt authority, through CLI and BFF`, async () => {
    const f = storageRecoveryFixture();
    const root = join(f.root, rebuildRuntimeIsolation.stateRoot);
    mkdirSync(root);
    const identity = AuthorityDatabase.sourceDatabaseIdentity(join(root, "state.db"));
    const record = marker === "lifecycle-restore" ? {schemaVersion: 1, manifestDigest: "b".repeat(64)}
      : {sourceIdentity: identity, backupSha256: "b".repeat(64), ...(marker === "archive-conversion" ? {schemaVersion: 1, recordedAt: f.clock.now().toISOString()} : {})};
    try {
      writeFileSync(join(root, "state.db"), "corrupt synthetic authority");
      writeFileSync(join(root, `.${marker}.json`), invalid ? '{"SYNTHETIC_PRIVATE_VALUE":' : JSON.stringify(record));
      mkdirSync(join(root, "credentials"));
      writeFileSync(join(root, "credentials", "protected.json"), "SYNTHETIC_PRIVATE_VALUE");
      const before = snapshot(root);
      const outcome = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], f.clock, f.root);
      assert.equal(outcome.exitCode, 1);
      const report = StorageDoctorReportSchema.parse(JSON.parse(outcome.output));
      assert.equal(report.authority.state, "degraded");
      assert.equal(report.recovery.state, invalid ? "unavailable" : "interrupted");
      assert.equal(report.counts.state, "unavailable");
      assert.equal(report.protectedSettings.state, "unavailable");
      assert.ok(!outcome.output.includes("SYNTHETIC_PRIVATE_VALUE"));
      const wire = await buildStorageDoctor({admission: syntheticStateRoot(root),doctorOptions: options(root), clock: f.clock,
        serviceState: () => ({state: "never-run", reason: "Explicit backups only"})});
      assert.deepEqual(wire.recovery, report.recovery);
      assert.equal(wire.authority.state, "degraded");
      assert.deepEqual(snapshot(root), before);
      const text = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor"], f.clock, f.root);
      assert.match(text.output, invalid ? /recovery: UNAVAILABLE/u : /recovery: INTERRUPTED/u);
    } finally { f.dispose(); }
  });
}

for (const fault of ["directory", "symlink", "permissions"] as const) it(`never treats an unreadable ${fault} marker as absent`, async () => {
  const f = storageRecoveryFixture(51);
  try {
    const marker = join(f.root, ".lifecycle-restore.json");
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

for (const version of [45, 46, 50, 51, 52]) it(`distinguishes byte verification from release eligibility at schema ${String(version)}`, async () => {
  const f = storageRecoveryFixture(version);
  try {
    await f.backup();
    const report = await doctorAuthorityStorage(options(f.root), f.clock);
    assert.equal(report.recovery.state, "clear");
    const candidate = report.restoreCandidates[0];
    assert.ok(candidate?.state === "verified-compatible");
    assert.equal(candidate.schemaVersion, version);
    assert.equal(candidate.restoreEligibility.state, version < 46 ? "unsupported" : version < 52 ? "requires-upgrade" : "eligible");
  } finally { f.dispose(); }
});

for (const pending of [false, true]) {
  for (const fault of ["none", "missing-pair", "corrupt-pair", "missing-archive", "corrupt-archive", "missing-file", "corrupt-file", "wrong-source", "file-directory-alias"] as const) {
    it(`authenticates ${pending ? "pending" : "published"} custody with ${fault}`, async () => {
      const f = archiveFixture();
      try {
        const {file} = attachFile(f.database, f.base.root, f.base.run.envelope.runId, 89720);
        f.terminal();
        if (pending) { f.failAfter("readPendingReport"); assert.throws(() => f.kernel.execute(f.applyRequest(f.plan())), /injected-readPendingReport/u); }
        else assert.equal(f.kernel.execute(f.applyRequest(f.plan())).state, "applied");
        f.database.close();
        const backup = await backupStoppedAuthority(f.base.root, f.base.clock);
        assert.ok("pairedManifestPath" in backup);
        const verified = await verifyLifecyclePair(backup.pairedManifestPath);
        if (fault === "missing-pair") rmSync(backup.pairedManifestPath);
        if (fault === "corrupt-pair") writeFileSync(backup.pairedManifestPath, "SYNTHETIC_PRIVATE_VALUE");
        if (fault === "missing-archive") rmSync(join(verified.root, verified.pair.archiveFile));
        if (fault === "corrupt-archive") writeFileSync(join(verified.root, verified.pair.archiveFile), "SYNTHETIC_PRIVATE_VALUE");
        if (fault === "missing-file") rmSync(join(verified.root, verified.pair.fileDirectory, file.digest));
        if (fault === "corrupt-file") writeFileSync(join(verified.root, verified.pair.fileDirectory, file.digest), "SYNTHETIC_PRIVATE_VALUE");
        if (fault === "wrong-source") writeFileSync(backup.pairedManifestPath, JSON.stringify({...verified.pair, sourceDatabaseIdentity: "e".repeat(64)}));
        if (fault === "file-directory-alias") {
          rmSync(join(verified.root, verified.pair.fileDirectory), {recursive: true});
          symlinkSync(join(f.base.root, "archive-files"), join(verified.root, verified.pair.fileDirectory));
        }
        // Warm the existing SQLite reader bookkeeping; preserve all retained evidence afterwards.
        await doctorAuthorityStorage(options(f.base.root), f.base.clock);
        const before = snapshot(f.base.root);
        const report = await doctorAuthorityStorage(options(f.base.root), f.base.clock);
        const pair = report.restoreCandidates.find(row => row.manifestFileName.endsWith(".lifecycle.json"));
        if (fault === "missing-pair") assert.equal(pair, undefined);
        else assert.equal(pair?.state, fault === "none" ? "verified-compatible" : "invalid");
        const half = report.restoreCandidates.find(row => row.manifestFileName.endsWith(".manifest.json"));
        assert.ok(half?.state === "verified-compatible");
        assert.equal(half.restoreEligibility.state, "incomplete");
        assert.ok(!JSON.stringify(report).includes("SYNTHETIC_PRIVATE_VALUE"));
        assert.deepEqual(snapshot(f.base.root), before);
      } finally { f.dispose(); }
    });
  }
}

it("withholds absence of custody for an unreadable live database and inaccessible backup directory", async () => {
  const f = storageRecoveryFixture(52);
  try {
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

it.each(["explorer_overrides", "notification_publications", "notification_health"])("does not hide a missing current authority table %s after historical fingerprint correction", table => {
  const f = storageRecoveryFixture(52);
  try {
    AuthorityDatabase.inspectSpanRunAuthorityReadOnly(f.path, [], 500);
    const database = new DatabaseSync(f.path);
    try { database.exec(`DROP TABLE ${table}`); } finally { database.close(); }
    assert.throws(() => AuthorityDatabase.inspectSpanRunAuthorityReadOnly(f.path, [], 500), new RegExp(`authority database tables do not match registry:.*expected=.*${table}`, "u"));
  } finally { f.dispose(); }
});
