import { createWorkbookLibraryRepository } from "../../../../src/backend/storage/sqlite/workbook-library-repository.js";
import { createWorkbookLibraryService } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { DatabaseSync } from "node:sqlite";
import { inspectOpenDatabase } from "../../../../src/backend/storage/sqlite/backup-inspection.js";
import { withReadonlyAuthoritySnapshot } from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { SQLITE_MIGRATIONS, AUTHORITY_APPLICATION_ID, CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { StoppedAuthorityBackupManifestSchema } from "../../../../src/backend/storage/sqlite/recovery-contracts.js";
import { authoritySourceDatabaseIdentity } from "../../../../src/backend/storage/sqlite/database-identity.js";
import { hasUnprovedSourceClosure, retainAuthoritySourceClosure, retainUnprovedSourceOwners } from "../../../../src/backend/storage/source-closure.js";
import { authenticateDocument, type CredentialDocument } from "../../../../src/backend/storage/configuration/credential-store.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { composeProfileRuntime, composeSelectedProfileStorage } from "../../../../src/backend/app/composition/storage-compose.js";
import { composeStoppedControlCredentialInventory } from "../../../../src/backend/app/composition/profile-credential-inventory.js";
import { upgradeStoppedMachineControl } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { createCanonicalCredentials, CanonicalCredentialHeadSchema } from "../../../../src/backend/storage/configuration/canonical-credential-store.js";
import { FakeKeyringEntry } from "../../helpers/credential-keychain-fake.js";
import { Entry } from "@napi-rs/keyring";
import { createSyntheticVerifier, emailKey, passwordMatches } from "../../../../src/backend/storage/configuration/synthetic-verifier.js";
import { deriveProfileNames, advanceProfileRegistryDocument, ProfileRegistryDocumentSchema, ProfileVerifierDocumentSchema, SignUpOperationSchema } from "../../../../src/models/profiles/profile.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { createBoundProfileFixture, boundProfileCredentials } from "../../helpers/admission-fixture.js";

export async function createHistoricalRegisteredProfileFixture(options: { sourceVersion: 8 | 9 | 10; workspace?: string; lifetime?: RuntimeLifetimeLock }) {
  assert.equal(Entry, FakeKeyringEntry, "historical fixture requires the actual fake keychain before backend imports");
  const lifetime = options.lifetime ?? await RuntimeLifetimeLock.acquire(0);
  const fixture = await createBoundProfileFixture({ pending: "onboarding", lifetime, ...(options.workspace === undefined ? {} : { workspace: options.workspace }) });
  const binding = fixture.admission.profileBinding;
  const draft = fixture.draft;
  assert.ok(draft?.state === "onboarding");
  const operationPath = join(fixture.machine.stateRoot, "machine", "operations", `${draft.operationId}.json`);
  const signupOperation = SignUpOperationSchema.parse(JSON.parse(readFileSync(operationPath, "utf8")));
  const priorRegistry = fixture.machine.readProfileRegistry();
  const active = await fixture.finish();
  assert.equal(active.state, "active");
  const registry = fixture.machine.readProfileRegistry(), row = registry.profiles.find(profile => profile.profileId === binding.profileId);
  assert.ok(row?.registration.onboardingCompletion);
  assert.equal(row.lifecycle, "ready"); assert.equal(row.credentialState, "saved"); assert.equal(row.duoState, "ready");
  assert.equal(row.registration.operationId, signupOperation.operationId); assert.equal(row.registration.commandId, signupOperation.commandId);
  assert.equal(row.registration.writeId, signupOperation.writeId);
  assert.equal(registry.activeProfileId, binding.profileId); assert.equal(registry.sessionGeneration, priorRegistry.sessionGeneration + 1);
  assert.equal(existsSync(operationPath), false);
  const frame = createCanonicalCredentials(fixture.admission).readRecord("protected"); assert.ok(frame);
  const protectedDocument = authenticateDocument(frame.value), protectedPath = join(fixture.stateRoot, "credentials", "protected.json");
  const protectedBytes = readFileSync(protectedPath);
  assert.ok(protectedDocument.latestRequest?.kind === "apply");
  assert.equal(protectedDocument.latestRequest.request.commandId, signupOperation.commandId);
  assert.equal(protectedDocument.latestRequest.request.writeId, signupOperation.writeId);
  assert.equal(protectedDocument.record.entries.ucpathUserId?.value, "fixture@ucsd.edu");
  assert.equal(protectedDocument.record.entries.ucpathPassword?.value, "disposable-fixture-password");
  assert.equal(row.registration.credentialRevision, protectedDocument.record.revision);
  const machineRoot = join(fixture.machine.stateRoot, "machine");
  const verifier = ProfileVerifierDocumentSchema.parse(JSON.parse(readFileSync(join(machineRoot, "profile-verifiers.json"), "utf8"))).profiles.find(profile => profile.profileId === binding.profileId);
  assert.ok(verifier);
  assert.equal(verifier.emailKey, emailKey(readFileSync(join(machineRoot, "profile-pepper")), "fixture@ucsd.edu"));
  assert.equal(passwordMatches("disposable-fixture-password", verifier), true);
  const storage = composeSelectedProfileStorage({ machineAdmission: fixture.machine, admission: fixture.admission,
    credentials: boundProfileCredentials(fixture.admission), clock: systemClock, hostFacts: { primaryDisplay: null } });
  await storage.account.close(); storage.database.close();
  await fixture.closeController();
  assertClosedWorkspace(fixture.workspace);
  const database = new DatabaseSync(fixture.path);
  let failure: { error: unknown } | undefined;
  try {
    database.exec("PRAGMA foreign_keys=ON; BEGIN EXCLUSIVE");
    for (const table of ["assistant_actions", "assistant_chats", "assistant_grants"]) assert.equal(database.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count, 0);
    if (options.sourceVersion < 10) {
      const editor = SQLITE_MIGRATIONS[0].statements.join("\n").match(/CREATE TABLE explorer_overrides \([\s\S]*?\n\) STRICT;/u)?.[0];
      assert.ok(editor); database.exec(editor);
    }
    if (options.sourceVersion < 9) database.exec("DROP TABLE assistant_model_preference");
    database.prepare("UPDATE database_states SET schema_version=? WHERE id=1").run(options.sourceVersion);
    database.exec(`PRAGMA user_version=${options.sourceVersion}; COMMIT`);
    inspectOpenDatabase(database, options.sourceVersion);
  } catch (error) { failure = { error }; }
  try { database.close(); }
  catch (error) {
    const retained = retainAuthoritySourceClosure(failure === undefined ? [error] : [failure.error, error], { database, admission: fixture });
    lifetime.retainSourceClosure(retained); throw retained;
  }
  if (failure !== undefined) throw failure.error;
  const databaseBytes = readFileSync(fixture.path);
  assert.deepEqual(readFileSync(protectedPath), protectedBytes);
  const observed = withReadonlyAuthoritySnapshot(fixture.path, native => inspectOpenDatabase(native, options.sourceVersion));
  assert.equal(observed.schemaVersion, options.sourceVersion);
  assert.equal(observed.installationId, binding.installationId); assert.equal(observed.profileId, binding.profileId);
  assert.deepEqual(readFileSync(fixture.path), databaseBytes);
  return { ...fixture, binding, signupOperation, async close() {
    assertClosedWorkspace(fixture.workspace);
    if (options.lifetime === undefined) await lifetime.close();
    await fixture.close();
  } };
}

export const historicalIncompleteProfileFields = Object.freeze({ firstName: "Historical", lastName: "Fixture",
  email: "historical-fixture@ucsd.edu", password: "disposable-historical-fixture" });

function assertClosedWorkspace(workspace: string): void {
  const result = spawnSync("lsof", ["-nP", "+D", workspace, "-Fn"], { encoding: "utf8" });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, "historical fixture source closure unproved");
  assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
}

function fixtureJson(path: string, value: unknown): void {
  const stage = join(dirname(path), `.${basename(path)}.${randomUUID()}.fixture`);
  writeFileSync(stage, JSON.stringify(value), { mode: 0o600, flag: "wx" }); renameSync(stage, path);
}

function historicalAuthorityArchive(profileRoot: string, binding: { installationId: string; profileId: string },
  version: 6 | 7 | 8, lifetime: RuntimeLifetimeLock, copyValue?: string) {
  const primaryPath = join(profileRoot, "state.db"), primaryDigest = createHash("sha256").update(readFileSync(primaryPath)).digest("hex");
  let primary: ReturnType<typeof inspectOpenDatabase>;
  try { primary = withReadonlyAuthoritySnapshot(primaryPath, database => inspectOpenDatabase(database, CURRENT_AUTHORITY_SCHEMA_VERSION)); }
  catch (error) { lifetime.retainSourceClosure(error); throw error; }
  const directory = join(profileRoot, "backups", "authority"), createdAt = new Date().toISOString();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const backupFileName = `authority-g${primary.authorityGeneration}-${Date.parse(createdAt)}-${randomUUID()}.sqlite`, path = join(directory, backupFileName);
  writeFileSync(path, Buffer.alloc(0), { mode: 0o600, flag: "wx" });
  const database = new DatabaseSync(path);
  let inspection: ReturnType<typeof inspectOpenDatabase> | undefined, failure: { error: unknown } | undefined;
  try {
    for (const migration of SQLITE_MIGRATIONS.filter(row => row.version <= version)) for (const statement of migration.statements) database.exec(statement);
    if (version >= 7) database.prepare("INSERT INTO database_states(id,schema_version,authority_generation,updated_at,search_generation,search_state,installation_id,profile_id) VALUES(1,?,?,?,NULL,'unbuilt',?,?)")
      .run(version, primary.authorityGeneration, createdAt, binding.installationId, binding.profileId);
    else database.prepare("INSERT INTO database_states(id,schema_version,authority_generation,updated_at,search_generation,search_state) VALUES(1,?,?,?,NULL,'unbuilt')")
      .run(version, primary.authorityGeneration, createdAt);
    database.exec(`PRAGMA user_version=${version}; PRAGMA application_id=${AUTHORITY_APPLICATION_ID}`);
    if (copyValue !== undefined) {
      const repository = createWorkbookLibraryRepository({ database, read: work => work(), mutate: work => {
        database.exec("BEGIN");
        try { const result = work(); database.exec("COMMIT"); return result.result; }
        catch (error) {
          try { database.exec("ROLLBACK"); }
          catch (cleanup) {
            const retained = retainAuthoritySourceClosure([error, cleanup], { database, admission: { lifetime } });
            lifetime.retainSourceClosure(retained); throw retained;
          }
          throw error;
        }
      } });
      createWorkbookLibraryService({ repository, clock: systemClock }).create({ name: "Synthetic historical copy.xlsx", themes: [], hasFormulas: false,
        sheets: [{ id: "sheet", name: "Synthetic", width: 1, hidden: [], rows: [{ id: "row", cells: [{ value: copyValue }] }] }] });
    }
    inspection = inspectOpenDatabase(database, version);
  } catch (error) { failure = { error }; }
  if (failure !== undefined && hasUnprovedSourceClosure(failure.error)) {
    lifetime.retainSourceClosure(failure.error); retainUnprovedSourceOwners(failure.error, { database, admission: { lifetime } }); throw failure.error;
  }
  try { database.close(); }
  catch (error) {
    const retained = retainAuthoritySourceClosure(failure === undefined ? [error] : [failure.error, error], { database, admission: { lifetime } });
    lifetime.retainSourceClosure(retained); throw retained;
  }
  if (failure !== undefined) throw failure.error;
  assert.ok(inspection);
  const observed = inspection, bytes = readFileSync(path), sha256 = createHash("sha256").update(bytes).digest("hex");
  const source = version === 6 ? { kind: "unbound-predecessor" as const, schemaVersion: 6 as const,
    authorityContentFingerprint: observed.authorityContentFingerprint } : { kind: "profile" as const, binding };
  const manifest = StoppedAuthorityBackupManifestSchema.parse({ kind: "hrauto-authority-backup", manifestVersion: version === 6 ? 3 : 4,
    backupFileName, sourceDatabaseIdentity: authoritySourceDatabaseIdentity(source), applicationId: observed.applicationId,
    schemaVersion: version, ...(version === 6 ? {} : binding), pageCount: observed.pageCount, authorityGeneration: observed.authorityGeneration,
    authorityContentFingerprint: observed.authorityContentFingerprint, createdAt, byteSize: bytes.length, sha256,
    verification: { state: "verified", observedFrom: "backup-copy", observedAt: createdAt, applicationId: observed.applicationId,
      schemaVersion: version, ...(version === 6 ? {} : binding), pageCount: observed.pageCount, authorityGeneration: observed.authorityGeneration,
      authorityContentFingerprint: observed.authorityContentFingerprint, quickCheck: observed.quickCheck,
      foreignKeyViolations: observed.foreignKeyViolations, invariantViolations: observed.invariantViolations, exactTableRegistry: observed.exactTableRegistry } });
  const manifestPath = `${path}.manifest.json`;
  writeFileSync(manifestPath, `${canonicalJsonStringify(manifest)}\n`, { mode: 0o600, flag: "wx", flush: true });
  assert.equal(createHash("sha256").update(readFileSync(primaryPath)).digest("hex"), primaryDigest);
  return Object.freeze({ path, manifestPath, manifest });
}

export async function convertHistoricalIncompleteProfileFixture(fixture: { workspace: string; lifetime: RuntimeLifetimeLock }): Promise<void> {
  const maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(fixture.workspace, fixture.lifetime);
  try { await upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts: { primaryDisplay: null } }, systemClock, composeStoppedControlCredentialInventory); }
  finally { maintenance.release(); }
}

export function historicalPlaintextProtectedDocument(document: CredentialDocument, schemaVersion: 2 | 3) {
  assert.ok(document.latestRequest?.kind === "apply");
  if (schemaVersion === 2) return { schemaVersion, record: document.record,
    history: [{ request: document.latestRequest.request,
      setValueIds: Object.fromEntries(Object.entries(document.record.entries).map(([name, value]) => [name, value.valueId])) }] };
  const requestReceipt = createHash("sha256").update(canonicalJsonStringify(document.latestRequest.request)).digest("hex");
  return { schemaVersion, record: document.record,
    history: document.history.map(entry => ({ ...entry, receipt: { ...entry.receipt, requestReceipt } })) };
}

export async function createHistoricalIncompleteProfileFixture(options: { keyFormat?: "metadata" | "inline"; protectedFormat?: 2 | 3; wiped?: true; archivedAuthorityVersion?: 6 | 7 | 8; archivedAuthorityCopy?: "password" | "native-key" } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "incomplete-publication-")));
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(root, name));
  const lifetime = await RuntimeLifetimeLock.acquire(0);
  const machine = acquireEntrypointAdmission(root, "exclusive", lifetime), processLockRoot = join(root, rebuildRuntimeIsolation.processLockRoot);
  mkdirSync(processLockRoot, { recursive: true, mode: 0o700 });
  const profile = composeProfileRuntime({ admission: machine,  hostFacts: { primaryDisplay: null }, clock: systemClock });
  const fields = { ...historicalIncompleteProfileFields, createdAt: new Date().toISOString() };
  const draft = profile.session.signUp(fields); if (draft.state !== "onboarding") throw new Error("fixture genuine Details required");
  const stateRoot = machine.stateRoot, profileRoot = join(stateRoot, "profiles", draft.profileId), machineRoot = join(stateRoot, "machine");
  const operationPath = join(machineRoot, "operations", `${draft.operationId}.json`), registryPath = join(machineRoot, "profiles.json"), verifierPath = join(machineRoot, "profile-verifiers.json");
  const operation = SignUpOperationSchema.parse(JSON.parse(readFileSync(operationPath, "utf8")));
  const admission = machine.admitProfile(draft.profileId);
  const owner = createCanonicalCredentials(admission), protectedFrame = owner.readRecord("protected");
  assert.ok(protectedFrame); assert.equal(owner.readRecord("duo"), undefined); assert.equal(owner.readRecord("chatgpt"), undefined);
  const original = authenticateDocument(protectedFrame.value);
  assert.equal(original.record.entries.ucpathUserId?.value, fields.email); assert.equal(original.record.entries.ucpathPassword?.value, fields.password);
  const installationId = machine.locator.installationId, keyPath = join(machineRoot, "credential-keys", `${draft.profileId}.json`);
  const head = CanonicalCredentialHeadSchema.parse(JSON.parse(readFileSync(keyPath, "utf8")));
  assert.equal(head.state, "active"); assert.deepEqual(head.counters, []); assert.deepEqual(head.retired, []);
  assert.equal(Entry, FakeKeyringEntry, "historical fixture requires the actual fake keychain before backend imports");
  const entry = new FakeKeyringEntry("Relay", `${installationId}:${draft.profileId}`), secret = entry.getPassword();
  assert.ok(secret); const key = Buffer.from(secret, "base64");
  assert.equal(key.length, 32); assert.equal(createHash("sha256").update(key).digest("hex"), head.key.keyDigest);
  admission.release(); await profile.close(); machine.release();
  assertClosedWorkspace(root);

  const priorRegistry = ProfileRegistryDocumentSchema.parse(JSON.parse(readFileSync(registryPath, "utf8")));
  const registry = advanceProfileRegistryDocument(priorRegistry, { sessionGeneration: priorRegistry.sessionGeneration + 1, activeProfileId: options.wiped === true ? null : draft.profileId,
    profiles: [{ profileId: draft.profileId, ...deriveProfileNames(fields.firstName, fields.lastName),
      registration: { operationId: operation.operationId, commandId: operation.commandId, writeId: operation.writeId, credentialRevision: original.record.revision },
      createdAt: operation.createdAt, lastSignedInAt: operation.createdAt, credentialState: options.wiped === true ? "wiped" : "saved", duoState: "not-set-up", lifecycle: "ready" }] });
  const verifier = createSyntheticVerifier(readFileSync(join(machineRoot, "profile-pepper")), fields.email, fields.password);
  fixtureJson(verifierPath, { schemaVersion: 1, profiles: [{ profileId: draft.profileId, ...verifier, consecutiveFailures: 0 }] });
  fixtureJson(registryPath, registry);
  assert.equal(SignUpOperationSchema.parse(JSON.parse(readFileSync(operationPath, "utf8"))).operationId, operation.operationId);
  unlinkSync(operationPath);
  // Construct the complete settled predecessor only after the fresh unused fixture is closed.
  const keyDocument = options.keyFormat === "inline" ? { schemaVersion: 1, installationId, profileId: draft.profileId, keyId: head.key.keyId, key: secret } : head.key;
  fixtureJson(keyPath, keyDocument);
  const keyBytes = readFileSync(keyPath);
  const protectedPath = join(profileRoot, "credentials", "protected.json");
  if (options.protectedFormat !== undefined) {
    fixtureJson(protectedPath, historicalPlaintextProtectedDocument(original, options.protectedFormat));
  } else {
    const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(canonicalJsonStringify({ domain: "relay:protected-current:v4", schemaVersion: 4, algorithm: "aes-256-gcm",
      installationId, profileId: draft.profileId, keyId: head.key.keyId })));
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(canonicalJsonStringify(original))), cipher.final()]);
    fixtureJson(protectedPath, { schemaVersion: 4, algorithm: "aes-256-gcm", installationId, profileId: draft.profileId, keyId: head.key.keyId,
      nonce: nonce.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") });
  }
  unlinkSync(join(profileRoot, "credentials", "chatgpt-account.json"));
  unlinkSync(join(machineRoot, "duo-credentials", `${draft.profileId}.json`));
  rmdirSync(join(machineRoot, "duo-credentials"));
  rmdirSync(join(machineRoot, "credential-operations"));
  const keyStat = statSync(keyPath), controlPath = join(root, ".tracker", "control", "profile-registry.json");
  const control = JSON.parse(readFileSync(controlPath, "utf8")) as Record<string, unknown>;
  fixtureJson(controlPath, { ...control, schemaVersion: 4, digest: createHash("sha256").update(canonicalJsonStringify(registry)).digest("hex"),
    revision: registry.revision, generation: registry.sessionGeneration, operations: [],
    erasures: [{ profileId: draft.profileId, originOperationId: operation.operationId, head: { state: "never-erased", epoch: 0 },
      credentialKey: { keyId: head.key.keyId, binding: { installationId, profileId: draft.profileId },
        file: { device: keyStat.dev, inode: keyStat.ino, digest: createHash("sha256").update(keyBytes).digest("hex") } } }],
    duo: [{ profileId: draft.profileId, state: "never-initialized", revision: 0 }] });
  fixtureJson(join(machineRoot, "profile-registry-version.json"), { schemaVersion: 5 });
  const databasePath = join(profileRoot, "state.db");
  let archive: ReturnType<typeof historicalAuthorityArchive> | undefined;
  if (options.archivedAuthorityVersion !== undefined) {
    try { archive = historicalAuthorityArchive(profileRoot, { installationId, profileId: draft.profileId }, options.archivedAuthorityVersion, lifetime, options.archivedAuthorityCopy === "password" ? fields.password : options.archivedAuthorityCopy === "native-key" ? secret : undefined); }
    catch (error) {
      if (hasUnprovedSourceClosure(error)) { lifetime.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission: { lifetime } }); }
      throw error;
    }
  }
  return { workspace: root, lifetime, stateRoot, machineRoot, profileRoot, profileId: draft.profileId, processLockRoot,
    operation: { operationId: operation.operationId, commandId: operation.commandId, writeId: operation.writeId },
    operationPath, registryPath, verifierPath, controlPath, markerPath: join(machineRoot, "profile-registry-version.json"),
    keyPath, protectedPath, databasePath, archive, keyFormat: options.keyFormat ?? "metadata", nativeKeyAccount: `${installationId}:${draft.profileId}`, schema: { control: 4, marker: 5 } as const,
    async close(): Promise<void> { assertClosedWorkspace(root); await lifetime.close(); entry.deletePassword(); rmSync(root, { recursive: true }); } };
}
