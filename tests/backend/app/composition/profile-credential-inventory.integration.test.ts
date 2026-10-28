import { credentialKeyCustody } from "../../../../src/backend/storage/configuration/credential-key-custody.js";
import { retainAuthoritySourceClosure } from '../../../../src/backend/storage/source-closure.js';
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { AuthoritySchemaVersionError } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { admitDirectWorker } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { bindWorkerProcessAdmission } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { workerProfileDirectory } from "../../../../src/backend/runtime/browser/browser-session-factory.js";
import { join } from "node:path";
import { it } from "vitest";
import { composeSelectedProfileStorage } from "../../../../src/backend/app/composition/storage-compose.js";
import { composeProfileCredentialRepairInventory, composeProfileCredentialInitializationInventory, composeProfileCredentialInventory, scanProfileCredentialCopy } from "../../../../src/backend/app/composition/profile-credential-inventory.js";
import { appendEmergencyFault } from "../../../../src/backend/logs/emergency-faults.js";
import { createCredentialStore, inspectCredentialKeyCopy } from "../../../../src/backend/storage/configuration/credential-store.js";
import { upgradeStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { SQLITE_MIGRATIONS, AUTHORITY_APPLICATION_ID, CURRENT_AUTHORITY_SCHEMA_VERSION, deriveAuthorityUpgradePlanDigest } from "../../../../src/backend/storage/sqlite/migrations.js";
import { AuthorityUpgradeRecordSchema, type AuthorityUpgradeRecord } from "../../../../src/models/config/authority.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { AuthorityBackupService, parseBackupManifestFile } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { createProfileSession } from "../../../../src/backend/profiles/profile-session.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { createWorkbookLibraryService } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

async function fixture(f?: Awaited<ReturnType<typeof createBoundProfileFixture>>) {
  f ??= await createBoundProfileFixture();
  const clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  const credentials = boundProfileCredentials(f.admission);
  const context = composeSelectedProfileStorage({ machineAdmission: f.machine, admission: f.admission, credentials, clock, hostFacts: { primaryDisplay: null } });
  const before = credentials.read();
  const capturedSecrets = [before.entries.ucpathUserId?.value, before.entries.ucpathPassword?.value].filter((value): value is string => value !== undefined);
  assert.equal(capturedSecrets.length, 2);
  const inventory = composeProfileCredentialInventory({ machine: f.machine, admission: f.admission, database: context.database, clock, hostFacts: { primaryDisplay: null } });
  const session = createProfileSession({ admission: f.machine, machineRoot: f.machine.stateRoot,
    repairInventory: (child, request, writer, copies) => composeProfileCredentialRepairInventory({ machine: f.machine, admission: child, clock, hostFacts: { primaryDisplay: null } })(request, writer, copies),
    initializationInventory: (child, operation, writer, copies) => composeProfileCredentialInitializationInventory({ machine: f.machine, admission: child,
      clock, hostFacts: { primaryDisplay: null } })(operation, writer, copies),
    activity: { hasUnquiescedWork: () => false } });
  return { ...f, clock, context, capturedSecrets, inventory,
    erase() {
      const active = session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
      assert.equal(active.state, "active");
      if (active.state !== "active") throw new Error("synthetic profile sign-in refused");
      const blocked = session.logOut(active.token, { at: clock.now().toISOString() });
      assert.equal(blocked.state, "refused");
      if (blocked.state !== "refused") throw new Error("synthetic logout did not retain exact inventory custody");
      assert.equal(blocked.code, "PROFILE_LOGOUT_INVENTORY_BLOCKED");
      const operation = session.logoutOperations()[0];
      assert.ok(operation);
      const admission = f.machine.admitProfile(createProfileRegistry(f.machine).settlementClaim(operation.operationId));
      const store = createCredentialStore({ admission, stateRoot: f.stateRoot, erasureJournalAdmission: f.machine,
        erasureJournalPath: join(f.machine.stateRoot, "machine", "erasures", `${admission.profileBinding.profileId}.json`) });
      return { admission, credentials: store, operationId: operation.operationId };
    },
    async cleanup() { await context.account.close(); context.database.close(); session.close(); await f.close(); },
  };
}

const failedUpgradeFixtures = new Set<Readonly<{ profile: Awaited<ReturnType<typeof createBoundProfileFixture>>; owners: readonly unknown[]; primary: unknown }>>();

async function upgradedFixture(version: 6 | 7 | 8) {
  const f = await createBoundProfileFixture({ pending: "onboarding" }), clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  const databases: DatabaseSync[] = [];
  try {
    rmSync(f.path);
    const raw = new DatabaseSync(f.path);
    databases.push(raw);
    let sourceFailure: { error: unknown } | undefined;
    try {
      for (const migration of SQLITE_MIGRATIONS.filter(value => value.version <= version)) for (const statement of migration.statements) raw.exec(statement);
      if (version === 7 || version === 8) raw.prepare("INSERT INTO database_states(id,schema_version,authority_generation,updated_at,search_generation,search_state,installation_id,profile_id) VALUES(1,?,7,?,NULL,'unbuilt',?,?)")
        .run(version, clock.now().toISOString(), f.admission.profileBinding.installationId, f.admission.profileBinding.profileId);
      else raw.prepare("INSERT INTO database_states(id,schema_version,authority_generation,updated_at,search_generation,search_state) VALUES(1,6,7,?,NULL,'unbuilt')").run(clock.now().toISOString());
      raw.exec(`PRAGMA user_version=${String(version)}; PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}`);
    } catch (error) { sourceFailure = { error }; }
    try { raw.close(); }
    catch (error) { throw retainAuthoritySourceClosure(sourceFailure === undefined ? [error] : [sourceFailure.error, error], { database: raw, admission: f.admission }); }
    if (sourceFailure !== undefined) throw sourceFailure.error;
    assert.equal((await upgradeStorage(f.admission, { stateRoot: f.stateRoot,
      processLockRoot: join(f.workspace, rebuildRuntimeIsolation.processLockRoot), plan: false }, clock)).state, "upgraded");
    const inspected = new DatabaseSync(f.path, { readOnly: true });
    databases.push(inspected);
    let inspectionFailure: { error: unknown } | undefined;
    try {
      const row = inspected.prepare("SELECT payload_json FROM database_upgrades WHERE phase='settled'").get();
      assert.equal(typeof row?.payload_json, "string");
      if (typeof row?.payload_json !== "string") throw new Error("upgrade fixture receipt missing");
      const record = AuthorityUpgradeRecordSchema.parse(JSON.parse(row.payload_json)); assert.equal(record.phase, "settled");
      if (record.phase !== "settled") throw new Error("upgrade fixture receipt unsettled");
      assert.equal(record.planDigest, createHash("sha256").update(canonicalJsonStringify({ fromSchemaVersion: version,
        toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, sourceContentFingerprint: record.upgradeId,
        statements: SQLITE_MIGRATIONS.filter(migration => migration.version > version).flatMap(migration => migration.statements) })).digest("hex"));
    } catch (error) { inspectionFailure = { error }; }
    try { inspected.close(); }
    catch (error) { throw retainAuthoritySourceClosure(inspectionFailure === undefined ? [error] : [inspectionFailure.error, error], { database: inspected, admission: f.admission }); }
    if (inspectionFailure !== undefined) throw inspectionFailure.error;
    await f.finish();
    return await fixture(f);
  } catch (error) { failedUpgradeFixtures.add({ profile: f, owners: databases, primary: error }); throw error; }
}

function retainedBackup(f: Awaited<ReturnType<typeof fixture>>) {
  const directory = join(f.stateRoot, "backups", "authority");
  const names = readdirSync(directory).filter(name => name.endsWith(".manifest.json")); assert.equal(names.length, 1);
  const name = names[0]; assert.ok(name);
  const manifestPath = join(directory, name), manifest = parseBackupManifestFile(manifestPath);
  return { manifestPath, manifest, path: join(directory, manifest.backupFileName) };
}

type ForwardUpgrade = Exclude<AuthorityUpgradeRecord, { phase: "baseline" }>;
function changeUpgradeProof(f: Awaited<ReturnType<typeof fixture>>, transform: (record: ForwardUpgrade) => readonly AuthorityUpgradeRecord[]) {
  const record = f.context.database.readProfileResourceCustody().upgrades.find(value => value.phase === "settled");
  assert.ok(record && record.phase === "settled");
  const records = transform(record).map(value => AuthorityUpgradeRecordSchema.parse(value));
  const raw = new DatabaseSync(f.path);
  try {
    const triggers = raw.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='database_upgrades' ORDER BY name").all();
    assert.equal(triggers.length, 3);
    raw.exec("BEGIN");
    for (const trigger of triggers) { assert.equal(typeof trigger.name, "string"); assert.match(String(trigger.name), /^database_upgrades_[a-z_]+$/u); raw.exec(`DROP TRIGGER ${String(trigger.name)}`); }
    raw.prepare("DELETE FROM database_upgrades WHERE id=?").run(record.recordKey);
    for (const value of records) raw.prepare("INSERT INTO database_upgrades(id,upgrade_id,phase,backup_digest,payload_json,created_at) VALUES(?,?,?,?,?,?)")
      .run(value.recordKey, value.upgradeId, value.phase, value.phase === "baseline" ? null : value.backup.sha256, canonicalJsonStringify(value), value.recordedAt);
    for (const trigger of triggers) { assert.equal(typeof trigger.sql, "string"); raw.exec(String(trigger.sql)); }
    raw.exec("COMMIT");
  } finally { raw.close(); }
}

it("qualifies a genuine retained bound7 backup through its exact settled upgrade and preserves its bytes through erasure inventory", async () => {
  const f = await upgradedFixture(8), backup = retainedBackup(f), bytes = readFileSync(backup.path);
  let settlement: ReturnType<typeof f.erase> | undefined;
  try {
    assert.equal(backup.manifest.schemaVersion, 8);
    assert.equal(backup.manifest.profileId, f.admission.profileBinding.profileId);
    assert.equal(backup.manifest.installationId, f.admission.profileBinding.installationId);
    await f.context.account.close();
    await f.inventory.prepare();
    settlement = f.erase();
    const observed = f.inventory.assess({ ...settlement, capturedSecrets: f.capturedSecrets, capturedSecretsComplete: true });
    assert.equal(observed.logoutComplete, true);
    assert.deepEqual(observed.backupPlaintext, []); assert.deepEqual(observed.unknownFormats, []);
    assert.equal(readFileSync(backup.path).equals(bytes), true);
  } finally { settlement?.admission.release(); await f.cleanup(); }
});

for (const mutation of ["absent", "duplicate", "unfinished", "forged-plan", "forged-path", "forged-source"] as const) it(`refuses retained bound7 copy with ${mutation} canonical upgrade provenance`, async () => {
  const f = await upgradedFixture(8), backup = retainedBackup(f), bytes = readFileSync(backup.path);
  try {
    await f.context.account.close(); await f.inventory.prepare();
    changeUpgradeProof(f, record => {
      if (mutation === "absent") return [];
      if (mutation === "duplicate") return [record, { ...record, recordKey: randomUUID(), upgradeId: FingerprintSchema.parse("e".repeat(64)) }];
      if (mutation === "unfinished") return [{ ...record, phase: "committed" }];
      if (mutation === "forged-plan") { assert.notEqual(record.planDigest, "e".repeat(64)); return [{ ...record, planDigest: FingerprintSchema.parse("e".repeat(64)) }]; }
      if (mutation === "forged-source") { assert.notEqual(record.upgradeId, "e".repeat(64)); return [{ ...record, upgradeId: FingerprintSchema.parse("e".repeat(64)) }]; }
      return [{ ...record, backup: { ...record.backup, manifestPath: `${record.backup.manifestPath}.foreign` } }];
    });
    const generation = f.context.database.getMeta().authorityGeneration;
    await assert.rejects(f.inventory.prepare(), error => error instanceof Error && error.message === "profile-inventory-backup-upgrade-unproved");
    assert.equal(f.context.database.getMeta().authorityGeneration, generation);
    assert.equal(readFileSync(backup.path).equals(bytes), true);
  } finally { await f.cleanup(); }
});

it("refuses a genuine foreign bound7 copy even when its manifest claims the current source namespace", async () => {
  const f = await upgradedFixture(8), other = await upgradedFixture(8);
  try {
    const target = retainedBackup(f), foreign = retainedBackup(other);
    assert.notEqual(foreign.manifest.profileId, target.manifest.profileId);
    await f.context.account.close(); await f.inventory.prepare();
    copyFileSync(foreign.path, target.path);
    writeFileSync(target.manifestPath, canonicalJsonStringify({ ...foreign.manifest,
      backupFileName: target.manifest.backupFileName, sourceDatabaseIdentity: target.manifest.sourceDatabaseIdentity }), { mode: 0o600 });
    await assert.rejects(f.inventory.prepare(), error => error instanceof Error && error.message === "profile-inventory-backup-binding-mismatch");
  } finally { await other.cleanup(); await f.cleanup(); }
});

it("refuses substitution of a qualified bound7 copy before assessment", async () => {
  const f = await upgradedFixture(8), backup = retainedBackup(f);
  let settlement: ReturnType<typeof f.erase> | undefined;
  try {
    await f.context.account.close(); await f.inventory.prepare();
    settlement = f.erase();
    const currentSettlement = settlement;
    const bytes = readFileSync(backup.path); bytes[bytes.length - 1] ^= 1;
    writeFileSync(backup.path, bytes, { mode: 0o600 });
    assert.throws(() => f.inventory.assess({ ...currentSettlement, capturedSecrets: f.capturedSecrets, capturedSecretsComplete: true }),
      error => error instanceof Error && error.message === "profile-inventory-membership-changed");
  } finally { settlement?.admission.release(); await f.cleanup(); }
});

it("retains named refusal for an unbound6 upgrade backup rather than deriving an old profile from its path", async () => {
  const f = await upgradedFixture(6), backup = retainedBackup(f);
  try {
    assert.equal(backup.manifest.schemaVersion, 6); assert.equal(backup.manifest.profileId, undefined); assert.equal(backup.manifest.installationId, undefined);
    const bytes = readFileSync(backup.path), credentials = readFileSync(join(f.stateRoot, "credentials", "protected.json"));
    await assert.rejects(f.inventory.prepare(), error => error instanceof Error && error.message === "profile-inventory-backup-binding-mismatch");
    assert.equal(readFileSync(backup.path).equals(bytes), true);
    assert.equal(readFileSync(join(f.stateRoot, "credentials", "protected.json")).equals(credentials), true);
  } finally { await f.cleanup(); }
});

for (const backup of ["none", "clean", "captured-copy", "key-copy", "incomplete-capture"] as const) it(`assesses genuine canonical inventory after exact erasure with ${backup} backup`, async () => {
  const f = await fixture();
  let settlement: ReturnType<typeof f.erase> | undefined;
  try {
    if (backup === "captured-copy" || backup === "key-copy") {
      const key = credentialKeyCustody.read(JSON.parse(readFileSync(join(f.machine.stateRoot, "machine", "credential-keys", `${f.admission.profileBinding.profileId}.json`), "utf8")));
      createWorkbookLibraryService({ repository: f.context.database.authority.workbooks, clock: f.clock }).create({
        name: "Synthetic.xlsx", themes: [], hasFormulas: false,
        sheets: [{ id: "sheet", name: "Synthetic", width: 1, hidden: [], rows: [{ id: "row", cells: [{ value: backup === "key-copy" ? key.key : f.capturedSecrets[1] }] }] }],
      });
    }
    if (backup !== "none") await new AuthorityBackupService(f.admission, f.context.database,
      { directory: join(f.stateRoot, "backups", "authority") }, f.clock).request({ trigger: "operator", requiredGeneration: f.context.database.getMeta().authorityGeneration });
    await f.inventory.prepare();
    settlement = f.erase();
    const observed = f.inventory.assess({ ...settlement, capturedSecrets: f.capturedSecrets, capturedSecretsComplete: backup !== "incomplete-capture" });
    assert.equal(observed.entriesAbsent, true);
    assert.equal(observed.inventoryMissing, false);
    assert.equal(observed.logoutComplete, backup === "none" || backup === "clean");
    if (backup === "captured-copy" || backup === "key-copy") assert.equal(observed.backupPlaintext.length, 1);
    if (backup === "incomplete-capture") assert.equal(observed.unknownFormats.length, 1);
  } finally { settlement?.admission.release(); await f.cleanup(); }
});

for (const mutation of ["forged-source-version", "missing-source-table", "extra-source-table"] as const) it(`rejects ${mutation} before accepting a backup into credential inventory`, async () => {
  const f = await fixture();
  try {
    const report = await new AuthorityBackupService(f.admission, f.context.database,
      { directory: join(f.stateRoot, "backups", "authority") }, f.clock).request({ trigger: "operator", requiredGeneration: f.context.database.getMeta().authorityGeneration });
    const manifest = report.manifests[0]; assert.ok(manifest);
    const path = join(f.stateRoot, "backups", "authority", manifest.backupFileName);
    const manifestPath = `${path}.manifest.json`;
    await f.inventory.prepare();
    const protectedPath = join(f.stateRoot, "credentials", "protected.json"), protectedBefore = readFileSync(protectedPath);
    const sourceBefore = f.context.database.getMeta();
    if (mutation === "forged-source-version") {
      writeFileSync(manifestPath, JSON.stringify({ ...manifest, schemaVersion: 7,
        verification: { ...manifest.verification, schemaVersion: 7 } }), { mode: 0o600 });
    } else {
      const raw = new DatabaseSync(path);
      try { raw.exec(mutation === "missing-source-table" ? "PRAGMA foreign_keys=OFF; DROP TABLE assistant_actions" : "CREATE TABLE unowned_authority(id TEXT)"); }
      finally { raw.close(); }
      const bytes = readFileSync(path);
      writeFileSync(manifestPath, JSON.stringify({ ...manifest, byteSize: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex") }), { mode: 0o600 });
    }
    await assert.rejects(f.inventory.prepare(), error => mutation === "forged-source-version"
      ? error instanceof AuthoritySchemaVersionError && error.schemaVersion === CURRENT_AUTHORITY_SCHEMA_VERSION
      : error instanceof Error && error.message === "authority-native-schema-shape-mismatch");
    assert.deepEqual(f.context.database.getMeta(), sourceBefore);
    assert.equal(readFileSync(protectedPath).equals(protectedBefore), true);
  } finally { await f.cleanup(); }
});

for (const problem of ["extra-file", "contained-symlink", "unreferenced-backup"] as const) it(`refuses canonical inventory with ${problem}`, async () => {
  const f = await fixture();
  try {
    await f.inventory.prepare();
    if (problem === "extra-file") writeFileSync(join(f.stateRoot, "unowned.json"), "{}", { mode: 0o600 });
    if (problem === "contained-symlink") symlinkSync(join(f.stateRoot, "credentials", "protected.json"), join(f.stateRoot, "credentials", "copy.json"));
    if (problem === "unreferenced-backup") {
      mkdirSync(join(f.stateRoot, "backups", "authority"), { recursive: true, mode: 0o700 });
      writeFileSync(join(f.stateRoot, "backups", "authority", "unowned.sqlite"), "synthetic", { mode: 0o600 });
    }
    await assert.rejects(f.inventory.prepare());
  } finally { await f.cleanup(); }
});

for (const encoding of ["utf8", "utf16le", "utf16be"] as const) it(`detects ${encoding} synthetic credential bytes crossing the 64 KiB read boundary`, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "profile-copy-scan-"))), path = join(root, "copy.bin");
  const captured = "synthetic-boundary-capture";
  const bytes = encoding === "utf8" ? Buffer.from(captured, "utf8") : Buffer.from(captured, "utf16le");
  if (encoding === "utf16be") bytes.swap16();
  try {
    writeFileSync(path, Buffer.concat([Buffer.alloc(64 * 1024 - 3, 0x78), bytes, Buffer.alloc(17, 0x79)]), { mode: 0o600 });
    assert.equal(scanProfileCredentialCopy(path, [captured]).containsSecret, true);
    assert.equal(scanProfileCredentialCopy(path, ["different-synthetic-capture"]).containsSecret, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const content of ["clean", "escaped-value", "escaped-key-material", "malformed"] as const) it(`inspects decoded canonical boot JSONL with ${content} content`, async () => {
  const f = await fixture();
  let settlement: ReturnType<typeof f.erase> | undefined;
  try {
    const error = new Error("synthetic boot failure"); error.stack = undefined;
    appendEmergencyFault({ stateRoot: f.stateRoot, build: "synthetic", code: "DATABASE_WRITER_UNAVAILABLE", error, now: f.clock.now() });
    const path = join(f.stateRoot, "logs", "boot.jsonl");
    const record = JSON.parse(readFileSync(path, "utf8")) as { payload: { event: { message: string } } };
    const key = credentialKeyCustody.read(JSON.parse(readFileSync(join(f.machine.stateRoot, "machine", "credential-keys", `${f.admission.profileBinding.profileId}.json`), "utf8")));
    const secret = content === "escaped-key-material" ? key.key : f.capturedSecrets[1]; assert.ok(secret);
    if (content === "escaped-value" || content === "escaped-key-material") {
      record.payload.event.message = secret;
      const encoded = [...secret].map(character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
      const text = JSON.stringify(record).replace(JSON.stringify(secret), `"${encoded}"`);
      assert.equal(text.includes(secret), false);
      writeFileSync(path, `${text}\n`, { mode: 0o600 });
    }
    if (content === "malformed") writeFileSync(path, "{invalid}\n", { mode: 0o600 });
    await f.inventory.prepare();
    settlement = f.erase();
    const observed = f.inventory.assess({ ...settlement, capturedSecrets: f.capturedSecrets, capturedSecretsComplete: true });
    assert.equal(observed.logoutComplete, content === "clean");
    assert.equal(observed.backupPlaintext.includes(path), content === "escaped-value" || content === "escaped-key-material");
    assert.equal(observed.unknownFormats.includes(path), content === "malformed");
  } finally { settlement?.admission.release(); await f.cleanup(); }
});

for (const content of ["clean", "escaped-key", "escaped-shadowed", "key-material", "malformed"] as const) it(`inspects canonical retained browser JSON with ${content} content`, async () => {
  const f = await fixture();
  let settlement: ReturnType<typeof f.erase> | undefined;
  let worker: ReturnType<typeof bindWorkerProcessAdmission> | undefined;
  try {
    const processLockRoot = join(f.workspace, "inventory-process-locks");
    worker = bindWorkerProcessAdmission({ processLockRoot, authorityPath: f.path, pid: process.pid, clock: f.clock,
      open: () => f.context.database, close: () => undefined,
      admit: () => f.context.database.withAuthorityTransaction(repositories => admitDirectWorker(repositories, {
    commandId: randomUUID(), workflow: "person-lookup", poolIndex: 1, expectedPoolVersion: 0, processId: process.pid,
    now: f.clock.now().toISOString()
}, randomUUID()).workerId),
    });
    const started = f.context.database.authority.workerLeases.start({ workerId: worker.workerId, workflow: "person-lookup", browserSystems: ["crm"],
      processId: process.pid, requestedBy: "local-operator", now: f.clock.now().toISOString() });
    assert.equal(started.state, "started");
    const custody = f.context.database.readProfileResourceCustody(), slot = custody.slots[0], config = custody.configSnapshots[0], lease = custody.leases[0];
    assert.ok(slot); assert.ok(config); assert.ok(lease);
    const directory = workerProfileDirectory({ profileRoot: config.config.paths.browserProfileRoot, slotOrdinal: slot.ordinal, system: "crm" });
    f.context.database.authority.workerControls.observe({ workerId: worker.workerId, leaseGeneration: lease.leaseGeneration,
      sessionId: randomUUID(), system: "crm", configFingerprint: config.fingerprint, signInFingerprint: config.fingerprint,
      browserMode: "headless", profileDirectory: directory, acceptDownloads: false, exclusive: false, health: "closed",
      observedAt: f.clock.now().toISOString(), openedAt: f.clock.now().toISOString(), profileRevision: 1 });
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const key = credentialKeyCustody.read(JSON.parse(readFileSync(join(f.machine.stateRoot, "machine", "credential-keys", `${f.admission.profileBinding.profileId}.json`), "utf8")));
    const path = join(directory, "Preferences"), secret = content === "key-material" ? key.key : f.capturedSecrets[1]; assert.ok(secret);
    const escaped = [...secret].map(character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
    const text = content === "clean" ? '{"profile":{"name":"Synthetic"}}' : content === "malformed" ? "{invalid}" : content === "escaped-shadowed" ? `{"synthetic":"${escaped}","synthetic":"clean"}` : `{"${escaped}":"synthetic"}`;
    assert.equal(text.includes(secret), false);
    writeFileSync(path, text, { mode: 0o600 });
    await f.inventory.prepare(); settlement = f.erase();
    const observed = f.inventory.assess({ ...settlement, capturedSecrets: f.capturedSecrets, capturedSecretsComplete: true });
    assert.equal(observed.logoutComplete, content === "clean");
    assert.equal(observed.backupPlaintext.includes(path), content === "escaped-key" || content === "escaped-shadowed" || content === "key-material");
    assert.equal(observed.unknownFormats.includes(path), content === "malformed");
  } finally { worker?.processLock.release(); settlement?.admission.release(); await f.cleanup(); }
});

for (const encoding of ["raw", "base64", "utf16le", "utf16be"] as const) it(`detects private stable key ${encoding} across the copy chunk boundary`, async () => {
  const f = await fixture(), path = join(f.stateRoot, "synthetic-copy.bin");
  try {
    const key = credentialKeyCustody.read(JSON.parse(readFileSync(join(f.machine.stateRoot, "machine", "credential-keys", `${f.admission.profileBinding.profileId}.json`), "utf8")));
    const bytes = encoding === "raw" ? Buffer.from(key.key, "base64") : Buffer.from(key.key, encoding === "base64" ? "utf8" : "utf16le");
    if (encoding === "utf16be") bytes.swap16();
    writeFileSync(path, Buffer.concat([Buffer.alloc(64 * 1024 - 3, 0x78), bytes, Buffer.alloc(17, 0x79)]), { mode: 0o600 });
    const scan = { containsKey: (value: unknown) => inspectCredentialKeyCopy(boundProfileCredentials(f.admission), value), keyScanOverlap: 4095 };
    assert.equal(scanProfileCredentialCopy(path, [], scan).containsSecret, true);
    writeFileSync(path, Buffer.alloc(64 * 1024 + 100, 0x78), { mode: 0o600 });
    assert.equal(scanProfileCredentialCopy(path, [], scan).containsSecret, false);
  } finally { await f.cleanup(); }
});


it('certifies the unchanged bound backup from a canonical seven-to-current pending-setup conversion', async () => {
  const f = await upgradedFixture(7);
  let settlement: ReturnType<typeof f.erase> | undefined;
  let bodyFailed = false;
  let cleanupFailure: { error: unknown } | undefined;
  try {
    const backup = retainedBackup(f), bytes = readFileSync(backup.path);
    assert.equal(backup.manifest.schemaVersion, 7);
    await f.context.account.close();
    const before = f.context.database.readProfileResourceCustody();
    const proof = before.upgrades.find(record => record.phase === "settled");
    assert.ok(proof && proof.phase === "settled");
    assert.equal(proof.fromSchemaVersion, 7);
    assert.equal(proof.toSchemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    const protectedPath = join(f.stateRoot, "credentials", "protected.json"), protectedBefore = readFileSync(protectedPath);
    await f.inventory.prepare();
    assert.deepEqual(f.context.database.readProfileResourceCustody(), before);
    assert.equal(readFileSync(protectedPath).equals(protectedBefore), true);
    assert.throws(() => f.admission.assertAuthorityDatabase(backup.path));
    settlement = f.erase();
    const observed = f.inventory.assess({ ...settlement, capturedSecrets: f.capturedSecrets, capturedSecretsComplete: true });
    assert.equal(observed.logoutComplete, true);
    assert.deepEqual(observed.backupPlaintext, []);
    assert.deepEqual(observed.unknownFormats, []);
    assert.equal(readFileSync(backup.path).equals(bytes), true);
  } catch (error) {
    bodyFailed = true; failedUpgradeFixtures.add({ profile: f, owners: [f.context, settlement], primary: error }); throw error;
  } finally {
    if (!bodyFailed) {
      try { settlement?.admission.release(); await f.cleanup(); }
      catch (error) { failedUpgradeFixtures.add({ profile: f, owners: [f.context, settlement], primary: error }); cleanupFailure = { error }; }
    }
  }
  if (cleanupFailure !== undefined) {
    const error = cleanupFailure.error;
    if (error instanceof Error) throw error;
    throw new AggregateError([error], 'profile-credential-inventory-cleanup-failed', { cause: error });
  }
});

it('refuses retargeting a setup receipt to historical eight without the matching immutable plan', async () => {
  const f = await upgradedFixture(7);
  let bodyFailed = false;
  let cleanupFailure: { error: unknown } | undefined;
  try {
    const backup = retainedBackup(f), bytes = readFileSync(backup.path);
    await f.context.account.close();
    await f.inventory.prepare();
    const original = f.context.database.readProfileResourceCustody().upgrades.find(record => record.phase === "settled");
    assert.ok(original && original.phase === "settled");
    assert.equal(original.fromSchemaVersion, 7);
    assert.equal(original.toSchemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.notEqual(original.planDigest, deriveAuthorityUpgradePlanDigest(7, original.upgradeId, 8));
    changeUpgradeProof(f, record => [AuthorityUpgradeRecordSchema.parse({ ...record, toSchemaVersion: 8 })]);
    const generation = f.context.database.getMeta().authorityGeneration;
    await assert.rejects(f.inventory.prepare(), error => error instanceof Error && error.message === "profile-inventory-backup-upgrade-unproved");
    assert.equal(f.context.database.getMeta().authorityGeneration, generation);
    assert.equal(readFileSync(backup.path).equals(bytes), true);
    changeUpgradeProof(f, () => [original]);
    await f.inventory.prepare();
    assert.deepEqual(f.context.database.readProfileResourceCustody().upgrades.find(record => record.recordKey === original.recordKey), original);
  } catch (error) {
    bodyFailed = true; failedUpgradeFixtures.add({ profile: f, owners: [f.context], primary: error }); throw error;
  } finally {
    if (!bodyFailed) {
      try { await f.cleanup(); }
      catch (error) { failedUpgradeFixtures.add({ profile: f, owners: [f.context], primary: error }); cleanupFailure = { error }; }
    }
  }
  if (cleanupFailure !== undefined) {
    const error = cleanupFailure.error;
    if (error instanceof Error) throw error;
    throw new AggregateError([error], 'profile-credential-inventory-cleanup-failed', { cause: error });
  }
});
