import { AuthorityBackupManifestSchema } from "../../../../src/backend/storage/sqlite/recovery-contracts.js";
import { inspectAuthorityBackupReadOnly } from "../../../../src/backend/storage/sqlite/backup-inspection.js";
import { ChatGptCredentialRecordSchema, type ChatGptCredentialRecord } from "../../../../src/backend/storage/configuration/chatgpt-credential-repository.js";
import type { OfflineMaintenanceOperation } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { acquireStoppedProfileControlUpgrade } from "../../../../src/backend/storage/admission/installation.js";
import { retainAuthoritySourceClosure } from "../../../../src/backend/storage/source-closure.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { runCredentialSourceRetentionCase } from "../../../support/helpers/credential-source-retention.js";
import { FakeKeyringEntry } from "../../../support/helpers/credential-keychain-fake.js";
import { acquireRuntimeProcessLock } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { authenticateDocument } from "../../../../src/backend/storage/configuration/credential-store.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { CanonicalCredentialHeadSchema } from "../../../../src/backend/storage/configuration/canonical-credential-store.js";
import { writeStoppedProfileControlPredecessor } from "../../../support/fixtures/storage/stopped-profile-control-predecessor.js";
import assert from "node:assert/strict";
import { createHash, createDecipheriv, randomUUID } from "node:crypto";
import nativeFs, { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename, join } from "node:path";
import { it, vi } from "vitest";
import { z } from "zod";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { releaseStoppedMachineControlUpgrade, upgradeStoppedMachineControl } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { composeStoppedControlCredentialInventory } from "../../../../src/backend/app/composition/profile-credential-inventory.js";
import { composeProfileRuntime } from "../../../../src/backend/app/composition/storage-compose.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { createHistoricalIncompleteProfileFixture, historicalIncompleteProfileFields } from "../../../support/fixtures/storage/historical-incomplete-profile-fixture.js";
import { storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";

const hostFacts = { primaryDisplay: null };

async function priorFormatFixture(version: 1 | 2 | 3 | 4 = 1, keyFormat: "metadata" | "inline" = "metadata", chatgpt?: ChatGptCredentialRecord) {
  const f = await createHistoricalIncompleteProfileFixture({ keyFormat });
  if (chatgpt !== undefined) writeFileSync(join(f.profileRoot, "credentials", "chatgpt-account.json"), JSON.stringify(ChatGptCredentialRecordSchema.parse(chatgpt)), { mode: 0o600 });
  writeStoppedProfileControlPredecessor(f, version);
  const key = z.looseObject({ keyId: z.uuid(), installationId: z.uuid(), profileId: z.uuid() }).parse(JSON.parse(readFileSync(f.keyPath, "utf8")));
  const originalKey = keyFormat === "inline" ? z.looseObject({ key: z.string() }).parse(JSON.parse(readFileSync(f.keyPath, "utf8"))).key
    : new FakeKeyringEntry("Relay", `${key.installationId}:${key.profileId}`).getPassword(); assert.ok(originalKey);
  const witness = (path: string) => {
    const stat = nativeFs.lstatSync(path, { throwIfNoEntry: false });
    return stat === undefined ? { state: "absent" as const } : { state: "present" as const, device: stat.dev, inode: stat.ino,
      digest: createHash("sha256").update(readFileSync(path)).digest("hex") };
  };
  const maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
  const restore = maintenance.maintenanceOperation(), control = maintenance.beginStoppedMachineControlUpgrade(restore);
  let sourceInspection: ReturnType<typeof inspectAuthorityBackupReadOnly> | undefined;
  let primary: { error: unknown } | undefined;
  try { sourceInspection = inspectAuthorityBackupReadOnly(RuntimeAdmission.forStoppedControlInventory(control.profileInventory(f.profileId)), f.databasePath); }
  catch (error) { primary = { error }; }
  releaseStoppedMachineControlUpgrade(control, restore, false, { primary, admission: maintenance });
  maintenance.release();
  assert.ok(sourceInspection);
  const settingsPath = join(f.profileRoot, "config", "settings.json");
  return { ...f, sourceInspection, originalTokens: chatgpt?.session === null || chatgpt?.session === undefined ? [] : [chatgpt.session.accessToken, chatgpt.session.refreshToken, chatgpt.session.idToken].filter((value): value is string => value !== null), originalKeyId: key.keyId, originalKey,
    settingsPath, settingsBefore: existsSync(settingsPath) ? readFileSync(settingsPath) : undefined,
    priorHead: witness(f.keyPath),
    priorFiles: { protected: witness(f.protectedPath), duo: witness(join(f.machineRoot, "duo-credentials", `${f.profileId}.json`)),
      chatgpt: witness(join(f.profileRoot, "credentials", "chatgpt-account.json")) },
    beforeTuple: Object.entries({ registry: f.registryPath, control: f.controlPath, marker: f.markerPath }).map(([role, path]) => ({ role, bytes: readFileSync(path) })) };

}

function sourceBytes(f: Awaited<ReturnType<typeof priorFormatFixture>>) {
  return [f.verifierPath, f.databasePath].map(path => ({ path, bytes: readFileSync(path) }));
}

function assertCanonicalCredentialConversion(f: Awaited<ReturnType<typeof priorFormatFixture>>, receiptId: unknown, maintenance: RuntimeAdmission, retainedNames: readonly string[] = []) {
  assert.equal(existsSync(f.settingsPath), f.settingsBefore !== undefined);
  if (f.settingsBefore !== undefined) assert.deepEqual(readFileSync(f.settingsPath), f.settingsBefore);
  const head = CanonicalCredentialHeadSchema.parse(JSON.parse(readFileSync(f.keyPath, "utf8")));
  assert.equal(head.state, "active"); assert.deepEqual(head.counters, []); assert.deepEqual(head.retired, []);
  assert.equal(head.key.keyId, f.originalKeyId);
  const entry = new FakeKeyringEntry("Relay", `${head.key.installationId}:${head.key.profileId}`);
  assert.equal(entry.getPassword(), f.originalKey);
  assert.equal(createHash("sha256").update(Buffer.from(f.originalKey, "base64")).digest("hex"), head.key.keyDigest);
  const frame = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal("protected"), installationId: z.uuid(), profileId: z.uuid(),
    generation: z.number().int().positive(), keyId: z.uuid(), revision: z.number().int().positive(), nonce: z.string(), tag: z.string(), ciphertext: z.string() })
    .parse(JSON.parse(readFileSync(f.protectedPath, "utf8")));
  assert.equal(frame.keyId, head.key.keyId); assert.equal(frame.generation, head.generation);
  const { ciphertext, tag, ...metadata } = frame;
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(f.originalKey, "base64"), Buffer.from(frame.nonce, "base64"));
  decipher.setAAD(Buffer.from(canonicalJsonStringify(metadata))); decipher.setAuthTag(Buffer.from(tag, "base64"));
  const plain = z.strictObject({ revision: z.number().int().positive(), value: z.unknown() }).parse(JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8")));
  assert.equal(plain.revision, frame.revision);
  const document = authenticateDocument(plain.value);
  assert.equal(document.record.entries.ucpathUserId?.value, historicalIncompleteProfileFields.email);
  assert.equal(document.record.entries.ucpathPassword?.value, historicalIncompleteProfileFields.password);
  const directory = join(f.workspace, ".tracker", "control", "profile-control-upgrades"), id = z.uuid().parse(receiptId);
  for (const row of f.beforeTuple) {
    const backup = join(directory, `${id}.${row.role}.before.json`);
    assert.deepEqual(readFileSync(backup), row.bytes); assert.equal(nativeFs.statSync(backup).mode & 0o7777, 0o600);
  }
  const receipt = z.looseObject({ schemaVersion: z.literal(2), retained: z.array(z.looseObject({ name: z.string() })), backups: z.array(z.strictObject({ profileId: z.uuid(), directory: z.string(), verifiedBackup: z.strictObject({ manifest: AuthorityBackupManifestSchema, manifestSha256: z.string() }) })), credentials: z.array(z.strictObject({ profileId: z.uuid(),
    plan: z.looseObject({ digest: z.string(), operation: z.looseObject({ priorHead: z.unknown(),
      files: z.array(z.looseObject({ kind: z.enum(["protected", "duo", "chatgpt"]), prior: z.unknown(), bytes: z.string() })) }) }) })) })
    .parse(JSON.parse(readFileSync(join(directory, `${id}.receipt.json`), "utf8")));
  const source = receipt.credentials.find(row => row.profileId === f.profileId); assert.ok(source);
  assert.equal(createHash("sha256").update(canonicalJsonStringify(source.plan.operation)).digest("hex"), source.plan.digest);
  assert.deepEqual(source.plan.operation.priorHead, f.priorHead);
  for (const kind of ["protected", "duo", "chatgpt"] as const) {
    const file: (typeof source.plan.operation.files)[number] | undefined = source.plan.operation.files.find(row => row.kind === kind); assert.ok(file);
    assert.deepEqual(file.prior, f.priorFiles[kind]);
    const path = kind === "duo" ? join(f.machineRoot, "duo-credentials", `${f.profileId}.json`)
      : join(f.profileRoot, "credentials", kind === "protected" ? "protected.json" : "chatgpt-account.json");
    assert.deepEqual(readFileSync(path), Buffer.from(file.bytes, "base64"));
  }

  assert.deepEqual(receipt.retained.map(row => row.name).sort(), [...retainedNames].sort());
  assert.equal(receipt.backups.length, 1);
  const archived = receipt.backups[0]; assert.ok(archived);
  assert.equal(archived.profileId, f.profileId);
  assert.equal(archived.directory, `${id}.${f.profileId}.authority`);
  assert.deepEqual(readdirSync(directory).sort(), [...retainedNames, `${id}.registry.before.json`, `${id}.control.before.json`,
    `${id}.marker.before.json`, `${id}.receipt.json`, archived.directory].sort());
  assert.equal(existsSync(join(f.workspace, ".tracker", "control", "profile-control-upgrade.json")), false);
  const sqlDirectory = join(directory, archived.directory), manifest = archived.verifiedBackup.manifest;
  assert.deepEqual(readdirSync(sqlDirectory).sort(), [manifest.backupFileName, `${manifest.backupFileName}.manifest.json`].sort());
  assert.equal(nativeFs.statSync(sqlDirectory).mode & 0o7777, 0o700);
  const manifestPath = join(sqlDirectory, `${manifest.backupFileName}.manifest.json`), sqlPath = join(sqlDirectory, manifest.backupFileName);
  const manifestBytes = readFileSync(manifestPath), sqlBytes = readFileSync(sqlPath);
  assert.deepEqual(AuthorityBackupManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8"))), manifest);
  assert.equal(createHash("sha256").update(manifestBytes).digest("hex"), archived.verifiedBackup.manifestSha256);
  assert.equal(createHash("sha256").update(sqlBytes).digest("hex"), manifest.sha256);
  assert.equal(sqlBytes.length, manifest.byteSize);
  assert.equal(manifest.installationId, head.key.installationId); assert.equal(manifest.profileId, f.profileId);
  assert.equal(manifest.sourceDatabaseIdentity, AuthorityDatabase.sourceDatabaseIdentity({ kind: "profile", binding: { installationId: head.key.installationId, profileId: f.profileId } }));
  assert.equal(manifest.authorityContentFingerprint, f.sourceInspection.authorityContentFingerprint);
  assert.equal(manifest.authorityGeneration, f.sourceInspection.authorityGeneration);
  assert.equal(manifest.schemaVersion, f.sourceInspection.schemaVersion);
  let copy: RuntimeAdmission | undefined;
  let archivedInspection: ReturnType<typeof inspectAuthorityBackupReadOnly>;
  try {
    copy = maintenance.verifiedReadOnlyCopy(sqlPath, manifest.sha256);
    archivedInspection = inspectAuthorityBackupReadOnly(copy, sqlPath, manifest.schemaVersion);
  } catch (error) {
    maintenance.retainSourceClosure(error); copy?.retainSourceClosure(error); throw error;
  } finally { copy?.release(); }
  assert.equal(archivedInspection.installationId, f.sourceInspection.installationId);
  assert.equal(archivedInspection.profileId, f.sourceInspection.profileId);
  assert.equal(archivedInspection.installationId, manifest.installationId);
  assert.equal(archivedInspection.profileId, manifest.profileId);
  assert.equal(archivedInspection.schemaVersion, f.sourceInspection.schemaVersion);
  assert.equal(archivedInspection.authorityGeneration, f.sourceInspection.authorityGeneration);
  assert.equal(archivedInspection.authorityContentFingerprint, f.sourceInspection.authorityContentFingerprint);
  assert.equal(AuthorityDatabase.sourceDatabaseIdentity({ kind: "profile", binding: {
    installationId: z.uuid().parse(archivedInspection.installationId), profileId: z.uuid().parse(archivedInspection.profileId) } }), manifest.sourceDatabaseIdentity);
  for (const path of [manifestPath, sqlPath, join(directory, `${id}.receipt.json`)]) assert.equal(nativeFs.statSync(path).mode & 0o7777, 0o600);
  const secrets = [f.originalKey, historicalIncompleteProfileFields.email, historicalIncompleteProfileFields.password, ...f.originalTokens];
  const forbidden = [Buffer.from(f.originalKey, "base64"), ...secrets.flatMap(secret => [Buffer.from(secret), Buffer.from(secret, "utf16le"), Buffer.from(Buffer.from(secret).toString("base64"))])];
  const inspectOutput = (path: string): void => {
    const stat = nativeFs.lstatSync(path); assert.equal(stat.isSymbolicLink(), false);
    if (stat.isDirectory()) { for (const name of readdirSync(path)) inspectOutput(join(path, name)); return; }
    assert.equal(stat.isFile(), true); assert.equal(stat.nlink, 1);
    const bytes = readFileSync(path);
    for (const secret of forbidden) assert.equal(bytes.includes(secret), false, "conversion output contains plaintext credential material");
  };
  if (f.originalTokens.length !== 0) {
    const chatgptPath = join(f.profileRoot, "credentials", "chatgpt-account.json");
    const encrypted = z.looseObject({ nonce: z.string(), tag: z.string(), ciphertext: z.string() }).parse(JSON.parse(readFileSync(chatgptPath, "utf8")));
    const { ciphertext: tokenCiphertext, tag: tokenTag, ...tokenMetadata } = encrypted;
    const tokenDecipher = createDecipheriv("aes-256-gcm", Buffer.from(f.originalKey, "base64"), Buffer.from(encrypted.nonce, "base64"));
    tokenDecipher.setAAD(Buffer.from(canonicalJsonStringify(tokenMetadata))); tokenDecipher.setAuthTag(Buffer.from(tokenTag, "base64"));
    const converted = z.looseObject({ value: ChatGptCredentialRecordSchema }).parse(JSON.parse(Buffer.concat([
      tokenDecipher.update(Buffer.from(tokenCiphertext, "base64")), tokenDecipher.final()]).toString("utf8")));
    assert.ok(converted.value.session);
    assert.deepEqual([converted.value.session.accessToken, converted.value.session.refreshToken, converted.value.session.idToken], f.originalTokens);
    inspectOutput(chatgptPath);
  }
  inspectOutput(directory);
  for (const path of [f.keyPath, f.protectedPath, f.controlPath, f.registryPath, f.markerPath]) inspectOutput(path);
}

it("converts only stopped machine-control format while keeping an incomplete historical profile held", async () => {
  const started = performance.now();
  const f = await priorFormatFixture(), original = sourceBytes(f);
  const created = performance.now();
  console.info("stopped-control timing", { phase: "fixture", milliseconds: Math.round(created - started) });
  const controlBytes = readFileSync(f.controlPath), markerBytes = readFileSync(f.markerPath);
  let maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
  const plan = await upgradeStoppedMachineControl(maintenance, { plan: true, hostFacts }, systemClock, composeStoppedControlCredentialInventory);
  const planned = performance.now();
  console.info("stopped-control timing", { phase: "plan", milliseconds: Math.round(planned - created) });
  assert.deepEqual(plan, { state: "planned", runtimeAccess: "onboarding-incomplete", profileCount: 1 });
  assert.equal(readFileSync(f.controlPath).equals(controlBytes), true); assert.equal(readFileSync(f.markerPath).equals(markerBytes), true);
  maintenance.release();
  maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
  const upgraded = await upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts }, systemClock, composeStoppedControlCredentialInventory);
  console.info("stopped-control timing", { phase: "conversion", milliseconds: Math.round(performance.now() - planned) });
  assert.equal(upgraded.state, "upgraded"); assert.equal(upgraded.runtimeAccess, "onboarding-incomplete"); assert.equal(upgraded.profileCount, 1);
  assert.equal(typeof upgraded.receiptId, "string");
  const backup = join(f.workspace, ".tracker", "control", "profile-control-upgrades");
  assert.equal(readFileSync(join(backup, `${upgraded.receiptId}.control.before.json`)).equals(controlBytes), true);
  assert.equal(readFileSync(join(backup, `${upgraded.receiptId}.marker.before.json`)).equals(markerBytes), true);
  assert.equal(readdirSync(backup).filter(name => name.endsWith(".receipt.json")).length, 1);
  assert.equal(z.looseObject({ schemaVersion: z.number() }).parse(JSON.parse(readFileSync(f.controlPath, "utf8"))).schemaVersion, 5);
  assert.equal(z.strictObject({ schemaVersion: z.number() }).parse(JSON.parse(readFileSync(f.markerPath, "utf8"))).schemaVersion, 6);
  assertCanonicalCredentialConversion(f, upgraded.receiptId, maintenance);
  maintenance.release();
  maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
  const current = await upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts }, systemClock, composeStoppedControlCredentialInventory);
  assert.deepEqual(current, { state: "current", runtimeAccess: "onboarding-incomplete", profileCount: 1 });
  assert.throws(() => maintenance.admitProfile(f.profileId), /offline-maintenance-busy/u);
  for (const source of original) assert.equal(readFileSync(source.path).equals(source.bytes), true);
  maintenance.release();
  const machine = acquireEntrypointAdmission(f.workspace, "exclusive", f.lifetime);
  assert.throws(() => machine.admitProfile(f.profileId), /profile-storage-claim-unavailable/u);
  const profile = composeProfileRuntime({ admission: machine,  hostFacts, clock: systemClock });
  const signed = profile.session.signIn({ email: historicalIncompleteProfileFields.email, password: historicalIncompleteProfileFields.password,
    at: new Date().toISOString() });
  assert.equal(signed.state, "refused");
  if (signed.state !== "refused") throw new Error("fixture historical runtime hold required");
  assert.equal(signed.code, "PROFILE_TRANSITION_BLOCKED");
  await profile.close(); machine.release();
  for (const source of original) assert.equal(readFileSync(source.path).equals(source.bytes), true);
  await f.close();
});

it("converts stopped schema2 only with authenticated empty suspect membership and preserves Duo and source bytes", async () => {
  const f = await priorFormatFixture(2), original = sourceBytes(f);
  const prior = z.looseObject({ duo: z.array(z.looseObject({ profileId: z.uuid() })) }).parse(JSON.parse(readFileSync(f.controlPath, "utf8")));
  const maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
  let primary: { error: unknown } | undefined;
  try {
    assert.throws(() => RuntimeAdmission.acquireMachine(f.workspace, "exclusive", f.lifetime));
    const result = await upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts }, systemClock, composeStoppedControlCredentialInventory);
    assert.equal(result.state, "upgraded"); assert.equal(result.runtimeAccess, "onboarding-incomplete");
    const current = z.looseObject({ schemaVersion: z.literal(5), operations: z.array(z.unknown()), completedRestores: z.array(z.unknown()) })
      .parse(JSON.parse(readFileSync(f.controlPath, "utf8")));
    assert.deepEqual(current.operations, []); assert.deepEqual(current.completedRestores, []);
    for (const name of ["credentials", "erasures", "duo"]) assert.equal(Object.hasOwn(current, name), false);
    assert.deepEqual(maintenance.readProfileRegistry().profiles.map(row => row.profileId).sort(), prior.duo.map(row => row.profileId).sort());
    assert.deepEqual(JSON.parse(readFileSync(f.markerPath, "utf8")), { schemaVersion: 6 });
    assertCanonicalCredentialConversion(f, result.receiptId, maintenance);
    for (const source of original) assert.deepEqual(readFileSync(source.path), source.bytes);
  } catch (error) { primary = { error }; }
  try { maintenance.release(); await f.close(); }
  catch (error) { throw new AggregateError(primary === undefined ? [error] : [primary.error, error], "schema2-conversion-fixture-close-failed", { cause: error }); }
  if (primary !== undefined) throw primary.error;
});

it("retains unbound schema2 suspect files and refuses conversion before control or key effects", async () => {
  const f = await priorFormatFixture(2);
  const suspects = join(f.profileRoot, "backups", "suspects");
  mkdirSync(suspects, { recursive: true, mode: 0o700 });
  writeFileSync(join(suspects, "unbound.sqlite"), "synthetic-unbound-suspect", { mode: 0o600 });
  try {
    const before = storageTree(f.workspace);
    const maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
    try { await assert.rejects(upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts }, systemClock, composeStoppedControlCredentialInventory), /profile-control-upgrade-suspect-custody-unproved/u); }
    finally { maintenance.release(); }
    assert.deepEqual(storageTree(f.workspace), before);
  } finally { await f.close(); }
});

for (const boundary of ["registry", "control", "marker"] as const) it(`retains the runtime hold through cold machine-control ${boundary} publication recovery`, async () => {
  const f = await priorFormatFixture(), original = sourceBytes(f), maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
  const rename = nativeFs.renameSync; let fired = false;
  const fault = vi.spyOn(nativeFs, "renameSync").mockImplementation((source, target) => {
    rename(source, target);
    if (!fired && String(target) === (boundary === "registry" ? f.registryPath : boundary === "control" ? f.controlPath : f.markerPath)) { fired = true; throw new Error("fixture stopped format publication boundary"); }
  });
  syncBuiltinESMExports();
  try { await assert.rejects(upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts }, systemClock, composeStoppedControlCredentialInventory)); }
  finally { fault.mockRestore(); syncBuiltinESMExports(); }
  assert.equal(fired, true);
  assert.equal(existsSync(join(f.workspace, ".tracker", "control", "profile-control-upgrade.json")), true);
  maintenance.release();
  let cold = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
  const recovered = await upgradeStoppedMachineControl(cold, { plan: false, hostFacts }, systemClock, composeStoppedControlCredentialInventory);
  assert.equal(recovered.state, "upgraded"); assert.equal(recovered.runtimeAccess, "onboarding-incomplete"); assert.equal(recovered.profileCount, 1);
  assertCanonicalCredentialConversion(f, recovered.receiptId, cold);
  cold.release();
  cold = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
  const current = await upgradeStoppedMachineControl(cold, { plan: false, hostFacts }, systemClock, composeStoppedControlCredentialInventory);
  assert.deepEqual(current, { state: "current", runtimeAccess: "onboarding-incomplete", profileCount: 1 });
  assert.throws(() => cold.admitProfile(f.profileId), /offline-maintenance-busy/u);
  for (const source of original) assert.equal(readFileSync(source.path).equals(source.bytes), true);
  cold.release();
  const machine = acquireEntrypointAdmission(f.workspace, "exclusive", f.lifetime);
  try { assert.throws(() => machine.admitProfile(f.profileId), /profile-storage-claim-unavailable/u); }
  finally { machine.release(); await f.close(); }
});

it("converts settled control3 and preserves exact completed historical upgrade artifacts", async () => {
  const f = await priorFormatFixture(3), original = sourceBytes(f);
  const directory = join(f.workspace, ".tracker", "control", "profile-control-upgrades");
  mkdirSync(directory, { mode: 0o700 });
  const operationId = "7e48de5d-7292-419b-afc2-32a363106b38";
  const retained = ["control.before.json", "marker.before.json", "receipt.json"].map(suffix => {
    const path = join(directory, `${operationId}.${suffix}`), bytes = Buffer.from(`retained historical ${suffix}`);
    writeFileSync(path, bytes, { mode: 0o600 }); return { path, bytes };
  });
  const maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
  try {
    const result = await upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts }, systemClock, composeStoppedControlCredentialInventory);
    assert.equal(result.state, "upgraded");
    assertCanonicalCredentialConversion(f, result.receiptId, maintenance, retained.map(row => basename(row.path)));
    for (const source of [...original, ...retained]) assert.deepEqual(readFileSync(source.path), source.bytes);
    const document = z.looseObject({ installationId: z.string(), revision: z.literal(1) }).parse(JSON.parse(readFileSync(f.registryPath, "utf8")));
    assert.equal(document.installationId, maintenance.locator.installationId);
  } finally { maintenance.release(); await f.close(); }
});

for (const journal of ["profile-publication.json", "device-recertification.json", "profile-control-upgrade.json", "journal.json"]) {
  it(`refuses an unsupported old ${journal} before any source mutation`, async () => {
    const f = await priorFormatFixture(3);
    try {
      writeFileSync(join(f.workspace, ".tracker", "control", journal), JSON.stringify({ schemaVersion: 1 }), { mode: 0o600 });
      const before = storageTree(f.workspace);
      assert.throws(() => RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime));
      assert.deepEqual(storageTree(f.workspace), before);
    } finally { await f.close(); }
  });
}

it("retains stopped-control restore authority and the actual snapshot when disposal is unproved", async () => {
  await runCredentialSourceRetentionCase("stopped-control-snapshot-disposal");
});

it("refuses an unmatched predecessor marker before source or key effects", async () => {
  const f = await priorFormatFixture(3);
  writeFileSync(f.markerPath, JSON.stringify({ schemaVersion: 99 }), { mode: 0o600 });
  const before = storageTree(f.workspace), keys = FakeKeyringEntry.snapshot();
  try {
    assert.throws(() => RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime));
    assert.deepEqual(storageTree(f.workspace), before); assert.deepEqual(FakeKeyringEntry.snapshot(), keys);
  } finally { await f.close(); }
});

for (const keyFormat of ["metadata", "inline"] as const) for (const version of [1, 2, 3, 4] as const) it(`admits only the matching stopped predecessor pair ${version} with ${keyFormat} key without ordinary runtime access`, async () => {
  const f = await priorFormatFixture(version, keyFormat);
  try {
    assert.throws(() => RuntimeAdmission.acquireMachine(f.workspace, "exclusive", f.lifetime));
    const maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
    try {
      const before = storageTree(f.workspace), keys = FakeKeyringEntry.snapshot();
      const plan = await upgradeStoppedMachineControl(maintenance, { plan: true, hostFacts }, systemClock, composeStoppedControlCredentialInventory);
      assert.equal(plan.state, "planned"); assert.equal(plan.runtimeAccess, "onboarding-incomplete");
      assert.deepEqual(storageTree(f.workspace), before);
      assert.deepEqual(FakeKeyringEntry.snapshot(), keys);
      assert.throws(() => maintenance.admitProfile(f.profileId));
    } finally { maintenance.release(); }
  } finally { await f.close(); }
});

it("imports only the known inline predecessor key through the same recorded conversion", async () => {
  const chatgpt = ChatGptCredentialRecordSchema.parse({ schemaVersion: 1, revision: 1, hostId: `urn:uuid:${randomUUID()}`,
    clientId: "oaiapp_conversion_fixture", registration: { subject: "conversion-fixture", name: "Synthetic fixture", email: "conversion@example.test" },
    session: { accessToken: `access-${randomUUID()}`, refreshToken: `refresh-${randomUUID()}`, idToken: `id-${randomUUID()}`,
      expiresAt: "2099-01-01T00:00:00.000Z", earliestRefreshAt: null, scopes: ["openid"], usePlan: false, usage: "available" } });
  const f = await priorFormatFixture(4, "inline", chatgpt), original = sourceBytes(f);
  assert.equal(f.originalTokens.length, 3);
  const maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
  try {
    const result = await upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts }, systemClock, composeStoppedControlCredentialInventory);
    assert.equal(result.state, "upgraded"); assertCanonicalCredentialConversion(f, result.receiptId, maintenance);
    for (const source of original) assert.deepEqual(readFileSync(source.path), source.bytes);
  } finally { maintenance.release(); await f.close(); }
});

it("holds a missing real predecessor key without replacing source bytes or generating another key", async () => {
  const f = await priorFormatFixture();
  const key = z.strictObject({ schemaVersion: z.literal(2), installationId: z.uuid(), profileId: z.uuid(), keyId: z.uuid(),
    keyDigest: z.string().regex(/^[0-9a-f]{64}$/u), legacyWitness: z.literal(true).optional() }).parse(JSON.parse(readFileSync(f.keyPath, "utf8")));
  const entry = new FakeKeyringEntry("Relay", `${key.installationId}:${key.profileId}`);
  assert.ok(entry.getPassword());
  entry.deletePassword();
  const before = storageTree(f.workspace);
  let maintenance: RuntimeAdmission | undefined;
  try {
    await assert.rejects(async () => {
      maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
      await upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts }, systemClock, composeStoppedControlCredentialInventory);
    }, error => {
      const pending: unknown[] = [error], seen = new Set<unknown>();
      while (pending.length > 0) {
        const value = pending.pop(); if (seen.has(value)) continue; seen.add(value);
        if (value instanceof Error && "code" in value && value.code === "CREDENTIAL_KEYCHAIN_MISSING") return true;
        if (value instanceof Error && value.cause !== undefined) pending.push(value.cause);
        if (value instanceof AggregateError) { const errors: readonly unknown[] = value.errors; pending.push(...errors); }
      }
      return false;
    });
    assert.deepEqual(storageTree(f.workspace), before);
    assert.equal(entry.getPassword(), null);
  } finally { maintenance?.release(); await f.close(); }
});

for (const released of [false, true]) it(`holds ${released ? "released" : "live"} old-process artifacts without deleting their evidence`, async () => {
  const f = await priorFormatFixture();
  const lock = acquireRuntimeProcessLock({ processLockRoot: f.processLockRoot, name: "server", pid: process.pid });
  if (released) lock.release();
  const before = storageTree(f.workspace);
  try {
    assert.throws(() => RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime), { code: "RUNTIME_OLD_BUILD_ARTIFACTS" });
    assert.deepEqual(storageTree(f.workspace), before);
  } finally { lock.release(); await f.close(); }
});

for (const change of ["bytes", "same-byte-inode"] as const) it(`holds the actual stopped converter stage after ${change} substitution and preserves exact backups`, async () => {
  const f = await priorFormatFixture(), before = sourceBytes(f);
  const originalControl = readFileSync(f.controlPath), originalMarker = readFileSync(f.markerPath), originalRegistry = readFileSync(f.registryPath);
  const rename = nativeFs.renameSync;
  let fired = false;
  const fault = vi.spyOn(nativeFs, "renameSync").mockImplementation((source, destination) => {
    if (!fired && String(destination) === f.controlPath && String(source).endsWith(".control.stage")) {
      fired = true; throw new Error("fixture converter before control publication");
    }
    rename(source, destination);
  });
  syncBuiltinESMExports();
  const maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
  try { await assert.rejects(upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts }, systemClock, composeStoppedControlCredentialInventory)); }
  finally { fault.mockRestore(); syncBuiltinESMExports(); maintenance.release(); }
  assert.equal(fired, true);
  const directory = join(f.workspace, ".tracker", "control", "profile-control-upgrades");
  const stage = readdirSync(directory).find(name => name.endsWith(".control.stage")); assert.ok(stage);
  const path = join(directory, stage), original = readFileSync(path), identity = nativeFs.lstatSync(path);
  const backups = readdirSync(directory).filter(name => name.endsWith(".before.json")).sort();
  assert.equal(backups.length, 3);
  const saved = backups.map(name => ({ name, bytes: readFileSync(join(directory, name)) }));
  for (const [role, bytes] of [["control", originalControl], ["marker", originalMarker], ["registry", originalRegistry]] as const) {
    const backup = saved.find(row => row.name.endsWith(`.${role}.before.json`)); assert.ok(backup);
    assert.deepEqual(backup.bytes, bytes);
  }
  for (const row of saved) assert.equal(nativeFs.statSync(join(directory, row.name)).mode & 0o7777, 0o600);
  if (change === "bytes") {
    const changed = Buffer.from(original); changed[0] = (changed[0] ?? 0) ^ 1; writeFileSync(path, changed);
  } else {
    rename(path, join(f.workspace, "fixture-owned-stage")); writeFileSync(path, original, { flag: "wx", mode: 0o600 });
    assert.notEqual(nativeFs.statSync(path).ino, identity.ino);
  }
  const held = storageTree(f.workspace);
  try {
    for (const plan of [true, false]) await assert.rejects(async () => {
      const candidate = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
      try { await upgradeStoppedMachineControl(candidate, { plan, hostFacts }, systemClock, composeStoppedControlCredentialInventory); }
      finally { candidate.release(); }
    }, { message: "runtime-control: profile-control-upgrade-publication-uncertain" });
    assert.deepEqual(storageTree(f.workspace), held);
    for (const row of saved) assert.deepEqual(readFileSync(join(directory, row.name)), row.bytes);
    const database = before.find(row => row.path === f.databasePath); assert.ok(database);
    assert.deepEqual(readFileSync(f.databasePath), database.bytes);
  } finally { await f.close(); }
});

const retainedStoppedControlSetupOwners = new Set<object>();
async function stoppedControlFixture() {
  const held: { fixture?: Awaited<ReturnType<typeof priorFormatFixture>>; restore?: OfflineMaintenanceOperation;
    upgrade?: ReturnType<typeof acquireStoppedProfileControlUpgrade>; primary?: unknown } = {};
  retainedStoppedControlSetupOwners.add(held);
  try {
    const fixture = await priorFormatFixture(1);
    held.fixture = fixture;
    const profileId = fixture.profileId;
    const controlPath = fixture.controlPath;
    const restore = fixture.lifetime.beginOfflineMaintenance(fixture.workspace);
    held.restore = restore;
    const upgrade = acquireStoppedProfileControlUpgrade(fixture.workspace, restore, fixture.lifetime);
    held.upgrade = upgrade;
    retainedStoppedControlSetupOwners.delete(held);
    return { ...fixture, stateRoot: fixture.profileRoot, path: fixture.databasePath, profileId, controlPath, upgrade, restore,
      async close() {
        restore.assertHeld(); upgrade.release();
        assert.throws(() => restore.assertHeld(), /offline-maintenance-unissued/u);
        restore.release(); await fixture.close();
      } };

  } catch (error) { held.primary = error; throw retainAuthoritySourceClosure([error], { admission: held }); }
}

it("issues only finite read-only stopped-control inventory and preserves database and control bytes", async () => {
  const f = await stoppedControlFixture();
  let admission: RuntimeAdmission | undefined;
  try {
    const before = createHash("sha256").update(readFileSync(f.path)).digest("hex");
    const control = readFileSync(f.controlPath);
    assert.throws(() => RuntimeAdmission.forStoppedControlInventory({ profileId: f.profileId }), /profile-control-upgrade-inventory-unissued/u);
    const issued = f.upgrade.profileInventory(f.profileId);
    admission = RuntimeAdmission.forStoppedControlInventory(issued);
    assert.throws(() => RuntimeAdmission.prototype.readStoppedControlCredentialInventorySource.call({}, issued), error => error instanceof Error && error.message === "runtime-admission: required");
    assert.throws(() => admission?.readStoppedControlCredentialInventorySource({ profileId: f.profileId }), error => error instanceof Error && error.message === "stopped-control-inventory-unissued");
    const otherClaim = f.upgrade.profileInventory(f.profileId);
    assert.throws(() => admission?.readStoppedControlCredentialInventorySource(otherClaim), error => error instanceof Error && error.message === "stopped-control-inventory-unissued");
    const source = admission.readStoppedControlCredentialInventorySource(issued);
    assert.equal(source.binding.profileId, f.profileId);
    source.assertHeld();
    const facts = AuthorityDatabase.readProfileMaintenanceInventory(admission);
    assert.equal(facts.authorityGeneration, 0);
    assert.deepEqual(facts.runs, []);
    assert.deepEqual(facts.writeIntents, []);
    assert.equal(createHash("sha256").update(readFileSync(f.path)).digest("hex"), before);
    assert.equal(readFileSync(f.controlPath).equals(control), true);
    const owned = admission;
    for (const [operation, reason] of [
      [() => owned.assertProfileRuntime(), "profile-bound-authority-required"],
      [() => owned.assertProfileInitialization(), "profile-initialization-authority-required"],
      [() => owned.assertWritable(), "profile-control-upgrade-write-refused"],
      [() => owned.assertCredentialRead(), "profile-control-upgrade-credential-read-refused"],
      [() => owned.assertArtifactRoot(join(f.stateRoot, "artifacts")), "profile-control-upgrade-artifact-refused"],
      [() => owned.assertAuthorityDatabase(f.path), "profile-control-upgrade-write-refused"],
      [() => owned.readProfileRegistry(), "profile-machine-authority-required"],
      [() => AuthorityDatabase.open(owned, { path: f.path, busyTimeoutMs: 100, migrationOwner: "forbidden-upgrade-runtime" }), "profile-bound-authority-required"],
    ] as const) assert.throws(operation, error => error instanceof Error && error.message === reason);
    const copy = admission.verifiedReadOnlyCopy(f.path, before);
    try {
      assert.throws(() => copy.readStoppedControlCredentialInventorySource(issued), error => error instanceof Error && error.message === "stopped-control-inventory-unissued");
      assert.throws(() => copy.assertWritable(), /profile-control-upgrade-write-refused/u);
      assert.throws(() => copy.assertCredentialRead(), /profile-control-upgrade-credential-read-refused/u);
    } finally { copy.release(); }
    admission.release();
    assert.throws(() => admission?.readStoppedControlCredentialInventorySource(issued));
    assert.throws(() => admission?.assertLive(), /missing or released admission/u);
  } finally { admission?.release(); await f.close(); }
});

it.each(["control", "database"] as const)("revokes the genuine stopped inventory when its %s source is replaced", async target => {
  const f = await stoppedControlFixture();
  let admission: RuntimeAdmission | undefined;
  try {
    admission = RuntimeAdmission.forStoppedControlInventory(f.upgrade.profileInventory(f.profileId));
    assert.equal(AuthorityDatabase.readProfileMaintenanceInventory(admission).authorityGeneration, 0);
    const path = target === "control" ? f.controlPath : f.path, substitute = `${path}.substitute`;
    writeFileSync(substitute, readFileSync(path), { mode: 0o600 }); renameSync(substitute, path);
    assert.throws(() => admission?.assertLive(), target === "control"
      ? /profile-control-upgrade-inventory-expired/u : /authority-readonly-source-changed/u);
  } finally { admission?.release(); await f.close(); }
});
