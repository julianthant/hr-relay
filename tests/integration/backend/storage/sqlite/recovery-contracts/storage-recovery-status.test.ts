import { syntheticStateRoot } from "../../../../../support/helpers/synthetic-storage-admission.js";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { rebuildRuntimeIsolation } from "../../../../../../src/backend/app/config/runtime-isolation.js";
import { composeStorageCommand } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { StorageDoctorReportSchema } from "../../../../../../src/backend/storage/sqlite/recovery-contracts.js";
import { describe, it } from "vitest";
import { storageRecoveryFixture, storageTree } from "../../../../../support/helpers/integration/storage-recovery-fixture.js";
import { doctorAuthorityStorage } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { inspectAuthorityBackupReadOnly } from "../../../../../../src/backend/storage/sqlite/backup-inspection.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../../../src/backend/storage/sqlite/migrations.js";
import { buildStorageDoctor } from "../../../../../../src/backend/runs/queries/storage.js";

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
      assert.equal(existsSync(`${f.path}-wal`) ? readFileSync(`${f.path}-wal`).length : 0, 0);
      writeFileSync(join(f.root, ".restore-00000000-0000-4000-8000-000000000001.sqlite.tmp"), "retained current stage", { mode: 0o600 });
      const before = snapshot(f.root);
      const report = await doctorAuthorityStorage(options(f.root), f.clock);
      assert.equal(report.authority.state, "healthy");
      assert.equal(report.recovery.state, "interrupted");
      const wire = await buildStorageDoctor({ admission: syntheticStateRoot(f.root), doctorOptions: options(f.root), clock: f.clock,
        serviceState: () => ({state: "never-run", reason: "Explicit backups only"}) });
      assert.deepEqual(wire.recovery, report.recovery);
      assert.deepEqual(snapshot(f.root), before);
    } finally { f.dispose(); }
  });


});

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

it("distinguishes byte verification from current release eligibility", async () => {
  const f = storageRecoveryFixture();
  try {
    AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 500, migrationOwner: "current-eligibility" }, f.clock).close();
    await f.backup();
    const report = await doctorAuthorityStorage(options(f.root), f.clock);
    assert.equal(report.recovery.state, "clear");
    const candidate = report.restoreCandidates[0];
    assert.ok(candidate?.state === "verified-compatible");
    assert.equal(candidate.schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.equal(candidate.restoreEligibility.state, "eligible");
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

it.each(["explorer_overrides", "notifications", "notification_states"])("does not hide a missing current authority table %s after a healthy native inspection", table => {
  const f = storageRecoveryFixture();
  try {
    AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 500, migrationOwner: "current-table-control" }, f.clock).close();
    const admission = syntheticStateRoot(f.root);
    inspectAuthorityBackupReadOnly(admission, f.path);
    const database = new DatabaseSync(f.path);
    try { database.exec(`DROP TABLE ${table}`); } finally { database.close(); }
    assert.throws(() => inspectAuthorityBackupReadOnly(admission, f.path), /authority|schema|table/u);
  } finally { f.dispose(); }
});


it("rechecks the actual native schema after priming its immutable expected identity", () => {
  for (const version of [CURRENT_AUTHORITY_SCHEMA_VERSION, CURRENT_AUTHORITY_SCHEMA_VERSION]) {
    const f = storageRecoveryFixture();
    AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 500, migrationOwner: "schema-recheck" }, f.clock).close();
    const admission = syntheticStateRoot(f.root);
    try {
      assert.equal(inspectAuthorityBackupReadOnly(admission, f.path).schemaVersion, version);
      assert.equal(inspectAuthorityBackupReadOnly(admission, f.path).schemaVersion, version);
      const raw = new DatabaseSync(f.path);
      try { raw.exec("CREATE TABLE forged_schema (value TEXT) STRICT"); } finally { raw.close(); }
      const before = readFileSync(f.path);
      assert.throws(() => inspectAuthorityBackupReadOnly(admission, f.path), /schema.*match|match.*schema/u);
      assert.deepEqual(readFileSync(f.path), before);
    } finally { admission.release(); f.dispose(); }
  }
});
