import { withOfflineMaintenanceSync } from "../../../support/helpers/admission-fixture.js";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { z } from "zod";
import { afterEach, it } from "vitest";
import { acquireInstallation, type RelocationCompletionReceipt, type VerifiedRelocationPreparation } from "../../../../src/backend/storage/admission/installation.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { verifyBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { inspectAuthorityBackupReadOnly } from "../../../../src/backend/storage/sqlite/backup-inspection.js";
import { storageRecoveryFixture, storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { createInstallationControlTestWorld } from "../../../support/helpers/backend/installation-control-world.js";

const { fixture, adoptSynthetic, restore, relocationPlan, prepareDestination, staged, cleanup } = createInstallationControlTestWorld();
afterEach(cleanup);
it("admits a completed schema-3 relocation without rewriting its authenticated receipt or retention history", async () => {
  const { workspace, pair, lifetime } = await fixture();
  const initial = adoptSynthetic(workspace, pair, lifetime); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "synthetic installation-lease copy source", { mode: 0o600 });
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "retained artifact");
  const lease = acquireInstallation(workspace, "exclusive", lifetime), held = restore(workspace, lifetime);
  const destination = { stateRoot: join(dirname(workspace), "relocated-state"), artifactRoot: join(dirname(workspace), "relocated-artifacts") };
  let completed!: RelocationCompletionReceipt;
  try {
    const plan = relocationPlan(lease, destination);
    const operationId = lease.beginRelocation(destination, plan, held);
    prepareDestination(lease, destination);
    const verify = staged(lease, destination, operationId, plan);
    lease.recordVerifiedStage(verify); lease.fenceRelocationSource(); lease.retainRelocationSources();
    lease.switchRelocationLocator(verify); lease.settleRelocation(verify);
  } finally { held.release(); lease.release(); }
  const reader = acquireInstallation(workspace, 'shared', lifetime);
  try { completed = reader.readRelocationReceipts()[0]; } finally { reader.release(); }
  const receiptDirectory = join(workspace, ".tracker/control/relocation-receipts");
  const receiptPath = join(receiptDirectory, readdirSync(receiptDirectory)[0]);
  // Synthetic retained receipt and witnesses use the historical schema-3 evidence contract.
  const historical = structuredClone(completed);
  Reflect.set(historical.preparation, 'sourceSchemaVersion', 3);
  Reflect.set(historical.evidence, 'authorityVersion', 3);
  const { toGeneration: _to, completedAt: _at, evidence: _evidence, ...binding } = historical;
  const digest = createHash("sha256").update("hrauto:runtime-relocation:v1\0").update(canonicalJsonStringify(binding)).digest("hex");
  function bindWitness(path: string): void {
    if (statSync(path).isDirectory()) { for (const name of readdirSync(path)) bindWitness(join(path, name)); return; }
    const bytes = readFileSync(path, 'utf8');
    if (!bytes.startsWith('{')) return;
    const value = z.record(z.string(), z.unknown()).parse(JSON.parse(bytes));
    if (!('bindingDigest' in value)) return;
    value.bindingDigest = digest;
    const mode = statSync(path).mode & 0o777;
    chmodSync(path, 0o600);
    try { writeFileSync(path, canonicalJsonStringify(value)); } finally { chmodSync(path, mode); }
  }
  for (const retention of historical.retentions) {
    bindWitness(retention.source); bindWitness(retention.retained);
  }
  writeFileSync(receiptPath, canonicalJsonStringify(historical));
  const historicalBytes = readFileSync(receiptPath);
  const admitted = acquireInstallation(workspace, "shared", lifetime);
  try {
    assert.deepEqual(admitted.readRelocationReceipts(), [historical]);
    assert.deepEqual(readFileSync(receiptPath), historicalBytes);
  } finally { admitted.release(); }
  for (const section of ["preparation", "evidence"] as const) {
    for (const version of [0, -1, 1.5, CURRENT_AUTHORITY_SCHEMA_VERSION + 1]) {
      const invalid = structuredClone(historical);
      Reflect.set(invalid[section], section === "preparation" ? "sourceSchemaVersion" : "authorityVersion", version);
      writeFileSync(receiptPath, canonicalJsonStringify(invalid));
      try { assert.throws(() => acquireInstallation(workspace, "exclusive", lifetime), /sourceSchemaVersion|authorityVersion/); }
      finally { writeFileSync(receiptPath, historicalBytes); }
    }
  }
  const tampered = structuredClone(historical);
  tampered.preparation.backupFileSha256 = '9'.repeat(64);
  writeFileSync(receiptPath, canonicalJsonStringify(tampered));
  try { assert.throws(() => acquireInstallation(workspace, 'exclusive', lifetime), /fence|tombstone|binding/); }
  finally { writeFileSync(receiptPath, historicalBytes); }
  const foreignInstallation = structuredClone(historical);
  foreignInstallation.installationId = randomUUID();
  writeFileSync(receiptPath, canonicalJsonStringify(foreignInstallation));
  try { assert.throws(() => acquireInstallation(workspace, "exclusive", lifetime), /installation|receipt|fence|tombstone|binding/u); }
  finally { writeFileSync(receiptPath, historicalBytes); }
});
it("upgrades admitted setup schema 3 with an exact verified backup and preserves independent source bytes", async () => {
  const f = await storageRecoveryFixture(3);
  try {
    const before = storageTree(f.root);
    const context = f.admission.readInstallationContext(); assert.ok(context);
    const workspaceBefore = storageTree(context.workspace);
    const identity = AuthorityDatabase.sourceDatabaseIdentity(f.path);
    const source = withOfflineMaintenanceSync(f.admission, () => AuthorityDatabase.inspectStoppedUpgrade(f.admission, f.path, f.input.processLockRoot, f.clock));
    assert.equal((await f.run(true)).state, "planned");
    assert.deepEqual(storageTree(f.root), before);
    assert.equal((await f.run()).state, "upgraded");
    const directory = join(f.root, "backups", "authority");
    const manifests = readdirSync(directory).filter(name => name.endsWith(".manifest.json"));
    assert.equal(manifests.length, 1);
    const backup = await verifyBackupManifestAtPath(f.admission, join(directory, manifests[0]), identity);
    assert.equal(backup.manifest.schemaVersion, 3);
    assert.equal(backup.manifest.authorityGeneration, source.authorityGeneration);
    assert.equal(backup.manifest.authorityContentFingerprint, source.authorityContentFingerprint);
    const copy = f.admission.verifiedReadOnlyCopy(backup.backupPath, backup.manifest.sha256);
    try {
      const prior = inspectAuthorityBackupReadOnly(copy, backup.backupPath, 3);
      assert.equal(prior.authorityContentFingerprint, source.authorityContentFingerprint);
      assert.equal(prior.authorityGeneration, source.authorityGeneration);
    } finally { copy.release(); }
    const current = inspectAuthorityBackupReadOnly(f.admission, f.path);
    assert.equal(current.schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.equal(current.authorityGeneration, source.authorityGeneration);
    assert.equal(current.installationId, f.admission.profileBinding.installationId);
    assert.equal(current.profileId, f.admission.profileBinding.profileId);
    const after = storageTree(context.workspace);
    const databasePaths = new Set(["", "-wal", "-shm"].map(suffix => relative(context.workspace, f.path + suffix)));
    const lockRoot = relative(context.workspace, f.input.processLockRoot);
    for (const [path, bytes] of Object.entries(workspaceBefore)) {
      if (!databasePaths.has(path) && !path.startsWith(lockRoot + "/")) assert.equal(after[path], bytes, path);
    }
    const backups = relative(context.workspace, directory) + "/";
    for (const path of Object.keys(after).filter(path => !(path in workspaceBefore))) {
      assert.ok(path.startsWith(backups), path);
    }
  } finally { await f.dispose(); }
});
it("refuses schema-3 preparation and stage evidence for a new relocation", async () => {
  const { workspace, pair, lifetime } = await fixture();
  const initial = adoptSynthetic(workspace, pair, lifetime); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "synthetic installation-lease copy source", { mode: 0o600 });
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact");
  const lease = acquireInstallation(workspace, "exclusive", lifetime), held = restore(workspace, lifetime);
  try {
    const destination = { stateRoot: join(dirname(workspace), "new-state"), artifactRoot: join(dirname(workspace), "new-artifacts") };
    const plan = relocationPlan(lease, destination), operationId = lease.beginRelocation(destination, plan, held);
    const preparation: VerifiedRelocationPreparation = { operationId, installationId: lease.locator.installationId,
      sourceGeneration: lease.locator.generation, source: pair, destination, plan,
      sourceDatabaseIdentity: "e".repeat(64), sourceSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, sourceAuthorityGeneration: 0,
      sourceAuthorityContentFingerprint: "f".repeat(64), backupReceiptId: "historical-schema-refused",
      backupManifestPath: join(pair.stateRoot, "backup.manifest.json"), backupManifestSha256: "1".repeat(64),
      backupFilePath: join(pair.stateRoot, "backup.sqlite"), backupFileSha256: "2".repeat(64) };
    Reflect.set(preparation, 'sourceSchemaVersion', 3);
    assert.throws(() => lease.recordVerifiedPreparation(() => preparation), new RegExp(`expected ${CURRENT_AUTHORITY_SCHEMA_VERSION}`, "u"));
    prepareDestination(lease, destination);
    const verify = staged(lease, destination, operationId, plan), evidence = verify();
    Reflect.set(evidence, 'authorityVersion', 3);
    assert.throws(() => lease.recordVerifiedStage(() => evidence), new RegExp(`expected ${CURRENT_AUTHORITY_SCHEMA_VERSION}`, "u"));
    const journalPath = join(workspace, ".tracker/control/journal.json");
    const journalBytes = readFileSync(journalPath);
    const journal = z.record(z.string(), z.unknown()).parse(JSON.parse(journalBytes.toString("utf8")));
    const recordedPreparation = z.record(z.string(), z.unknown()).parse(journal.preparation);
    recordedPreparation.sourceSchemaVersion = 3;
    journal.preparation = recordedPreparation;
    writeFileSync(journalPath, canonicalJsonStringify(journal));
    try { assert.throws(() => lease.relocationInventory(), new RegExp(`expected ${CURRENT_AUTHORITY_SCHEMA_VERSION}`, "u")); }
    finally { writeFileSync(journalPath, journalBytes); }
  } finally { held.release(); lease.release(); }
});
