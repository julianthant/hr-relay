import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/native-profile-probe.js";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { afterEach, it } from "vitest";
import { acquireInstallation, type RelocationCompletionReceipt } from "../../../../src/backend/storage/admission/installation.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { upgradeStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { verifyBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { createSettingsActivationRepositories } from "../../../../src/backend/storage/sqlite/settings-activation.js";
import { createInstallationControlTestWorld } from "../../../support/helpers/backend/installation-control-world.js";

const { fixture, adoptSynthetic, restore, relocationPlan, prepareDestination, staged, cleanup } = createInstallationControlTestWorld();
afterEach(cleanup);
it("admits a completed schema-3 relocation and upgrades with an exact verified backup without rewriting history", async () => {
  const { workspace, pair, lifetime } = await fixture();
  const initial = adoptSynthetic(workspace, pair, lifetime); initial.release();
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "retained artifact");
  const lease = acquireInstallation(workspace, "exclusive", lifetime), held = restore(workspace);
  const destination = { stateRoot: join(dirname(workspace), "relocated-state"), artifactRoot: join(dirname(workspace), "relocated-artifacts") };
  let completed!: RelocationCompletionReceipt;
  try {
    const plan = relocationPlan(lease, destination);
    const operationId = lease.beginRelocation(destination, plan, held);
    prepareDestination(lease, destination);
    const verify = staged(lease, destination, operationId, plan);
    lease.recordVerifiedStage(verify); lease.fenceRelocationSource(); lease.retainRelocationSources();
    lease.switchRelocationLocator(verify); lease.settleRelocation(verify);
  } finally { lease.release(); held.release(); }
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
  const path = join(destination.stateRoot, "state.db");
  writeFileSync(path, "");
  const clock = manualClock(new Date("2026-10-01T12:00:00Z"));
  const raw = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  try {
    for (const migration of SQLITE_MIGRATIONS.filter(migration => migration.version <= 3)) for (const sql of migration.statements) raw.exec(sql);
    raw.exec("PRAGMA application_id=1217249861; PRAGMA user_version=3");
    raw.prepare("INSERT INTO database_states VALUES(1,3,0,?,0,'ready')").run(clock.now().toISOString());
    const baseline = { recordKey: randomUUID(), upgradeId: "fresh", phase: "baseline", fromSchemaVersion: 0, toSchemaVersion: 3, by: "local-operator", recordedAt: clock.now().toISOString() };
    raw.prepare("INSERT INTO database_upgrades VALUES(?,'fresh','baseline',NULL,?,?)").run(baseline.recordKey, JSON.stringify(baseline), baseline.recordedAt);
    createSettingsActivationRepositories({ database: raw, mutate: work => work().result, readRecord: () => undefined }).runtimeConfig.initialize(CONFIG_SNAPSHOT);
  } finally { raw.close(); }
  const admission = acquireEntrypointAdmission(workspace, "exclusive", lifetime);
  try {
    assert.deepEqual(admission.readInstallationContext()?.receipts, [historical]);
    const source = AuthorityDatabase.sourceDatabaseIdentity(path);
    const report = await upgradeStorage(profileBrowserClosure, admission, { stateRoot: destination.stateRoot, processLockRoot: join(pair.stateRoot, "locks"), plan: false }, clock);
    assert.equal(report.state, "upgraded");
    const directory = join(destination.stateRoot, "backups/authority");
    const names = readdirSync(directory).filter(name => name.endsWith(".manifest.json"));
    assert.equal(names.length, 1);
    const backup = await verifyBackupManifestAtPath(admission, join(directory, names[0]), source);
    assert.equal(backup.manifest.schemaVersion, 3);
    const database = AuthorityDatabase.open(admission, { path, busyTimeoutMs: 250, migrationOwner: "historical-relocation-upgrade" }, clock);
    try { assert.equal(database.getMeta().schemaVersion, 6); } finally { database.close(); }
    assert.deepEqual(readFileSync(receiptPath), historicalBytes);
    assert.deepEqual(admission.readInstallationContext()?.receipts, [historical]);
  } finally { admission.release(); }
  for (const section of ["preparation", "evidence"] as const) {
    for (const version of [0, -1, 1.5, 7]) {
      const invalid = structuredClone(historical);
      Reflect.set(invalid[section], section === "preparation" ? "sourceSchemaVersion" : "authorityVersion", version);
      writeFileSync(receiptPath, canonicalJsonStringify(invalid));
      try { assert.throws(() => acquireEntrypointAdmission(workspace, "exclusive", lifetime), /sourceSchemaVersion|authorityVersion/); }
      finally { writeFileSync(receiptPath, historicalBytes); }
    }
  }
  const tampered = structuredClone(historical);
  tampered.preparation.backupFileSha256 = '9'.repeat(64);
  writeFileSync(receiptPath, canonicalJsonStringify(tampered));
  try { assert.throws(() => acquireEntrypointAdmission(workspace, 'exclusive', lifetime), /fence|tombstone|binding/); }
  finally { writeFileSync(receiptPath, historicalBytes); }
});
it("refuses schema-3 preparation and stage evidence for a new relocation", async () => {
  const { workspace, pair, lifetime } = await fixture();
  const initial = adoptSynthetic(workspace, pair, lifetime); initial.release();
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact");
  const lease = acquireInstallation(workspace, "exclusive", lifetime), held = restore(workspace);
  try {
    const destination = { stateRoot: join(dirname(workspace), "new-state"), artifactRoot: join(dirname(workspace), "new-artifacts") };
    const plan = relocationPlan(lease, destination), operationId = lease.beginRelocation(destination, plan, held);
    const preparation = { operationId, installationId: lease.locator.installationId,
      sourceGeneration: lease.locator.generation, source: pair, destination, plan,
      sourceDatabaseIdentity: "e".repeat(64), sourceSchemaVersion: 6 as const, sourceAuthorityGeneration: 0,
      sourceAuthorityContentFingerprint: "f".repeat(64), backupReceiptId: "historical-schema-refused",
      backupManifestPath: join(pair.stateRoot, "backup.manifest.json"), backupManifestSha256: "1".repeat(64),
      backupFilePath: join(pair.stateRoot, "backup.sqlite"), backupFileSha256: "2".repeat(64) };
    Reflect.set(preparation, 'sourceSchemaVersion', 3);
    assert.throws(() => lease.recordVerifiedPreparation(() => preparation), /expected 6/);
    prepareDestination(lease, destination);
    const verify = staged(lease, destination, operationId, plan), evidence = verify();
    Reflect.set(evidence, 'authorityVersion', 3);
    assert.throws(() => lease.recordVerifiedStage(() => evidence), /expected 6/);
    const journalPath = join(workspace, ".tracker/control/journal.json");
    const journalBytes = readFileSync(journalPath);
    const journal = z.record(z.string(), z.unknown()).parse(JSON.parse(journalBytes.toString("utf8")));
    const recordedPreparation = z.record(z.string(), z.unknown()).parse(journal.preparation);
    recordedPreparation.sourceSchemaVersion = 3;
    journal.preparation = recordedPreparation;
    writeFileSync(journalPath, canonicalJsonStringify(journal));
    try { assert.throws(() => lease.relocationInventory(), /expected 6/); }
    finally { writeFileSync(journalPath, journalBytes); }
  } finally { lease.release(); held.release(); }
});
