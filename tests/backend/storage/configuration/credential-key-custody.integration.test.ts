import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, vi } from "vitest";
import { createCredentialKeyCustody, credentialKeyCustody, type CredentialKeyMigrationAdmission } from "../../../../src/backend/storage/configuration/credential-key-custody.js";
import { encodePrivate } from "../../../../src/rules/validation/private-equal.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { boundProfileCredentials, createBoundProfileFixture, createSyntheticProfileSession } from "../../../support/helpers/admission-fixture.js";
import { FakeKeyringEntry } from "../../../support/helpers/credential-keychain-fake.js";
import { SignUpOperationSchema } from "../../../../src/models/profiles/profile.js";
import { composeProfileCredentialInitializationInventory } from "../../../../src/backend/app/composition/profile-credential-inventory.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { upgradeStoppedMachineControl } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { composeStoppedControlCredentialInventory } from "../../../../src/backend/app/composition/profile-credential-inventory.js";
import { createHistoricalIncompleteProfileFixture } from "../../../support/fixtures/storage/historical-incomplete-profile-fixture.js";
import { systemClock } from "../../../../src/rules/time/clock.js";

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "relay-key-custody-"))), entries = new Map<string, string>();
  const custody = createCredentialKeyCustody({ get: account => entries.get(account) ?? null,
    set: (account, key) => { entries.set(account, key); }, delete: account => { entries.delete(account); } });
  const key = { schemaVersion: 1, installationId: randomUUID(), profileId: randomUUID(), keyId: randomUUID(), key: randomBytes(32).toString("base64") };
  const path = join(root, `${key.profileId}.json`), bytes = Buffer.from(encodePrivate(key));
  writeFileSync(path, bytes, { mode: 0o600 });
  const identity = statSync(path);
  const admit: CredentialKeyMigrationAdmission = (name, witness) => {
    assert.equal(name, `${key.profileId}.json`);
    assert.deepEqual(witness, { keyId: key.keyId, binding: { installationId: key.installationId, profileId: key.profileId },
      file: { device: identity.dev, inode: identity.ino, digest: createHash("sha256").update(bytes).digest("hex") } });
  };
  return { root, path, key, bytes, entries, custody, admit, close: () => rmSync(root, { recursive: true, force: true }) };
}

it("migrates a legacy key, reads back the OS entry, preserves its physical witness and removes disk secret bytes", () => {
  const f = fixture(), before = statSync(f.path);
  try {
    f.custody.migrateDirectory(f.root, f.key.installationId, f.admit);
    const after = statSync(f.path), bytes = readFileSync(f.path), metadata: unknown = JSON.parse(bytes.toString("utf8"));
    assert.equal(after.ino, before.ino); assert.equal(after.dev, before.dev);
    assert.equal(f.custody.fileDigest(bytes), createHash("sha256").update(f.bytes).digest("hex"));
    assert.equal(f.custody.read(metadata).key, f.key.key);
    assert.equal(bytes.includes(f.key.key), false);
    assert.deepEqual(readdirSync(f.root), [`${f.key.profileId}.json`]);
    f.custody.migrateDirectory(f.root, f.key.installationId, f.admit);
    assert.deepEqual(readFileSync(f.path), bytes);
  } finally { f.close(); }
});

it("leaves the legacy source untouched on a mismatched keychain entry or failed readback", () => {
  const f = fixture();
  try {
    f.entries.set(`${f.key.installationId}:${f.key.profileId}`, randomBytes(32).toString("base64"));
    assert.throws(() => f.custody.migrateDirectory(f.root, f.key.installationId, f.admit), { code: "CREDENTIAL_KEYCHAIN_MISMATCH" });
    assert.deepEqual(readFileSync(f.path), f.bytes);
    const custody = createCredentialKeyCustody({ get: () => null, set: () => undefined, delete: () => undefined });
    assert.throws(() => custody.migrateDirectory(f.root, f.key.installationId, f.admit), { code: "CREDENTIAL_KEYCHAIN_MISSING" });
    assert.deepEqual(readFileSync(f.path), f.bytes);
  } finally { f.close(); }
});

it("copies only non-secret metadata into a backup and refuses restore without the machine entry", () => {
  const f = fixture();
  try {
    f.custody.migrateDirectory(f.root, f.key.installationId, f.admit);
    const destination = join(f.root, "backup"); mkdirSync(destination);
    const path = join(destination, `${f.key.profileId}.json`); copyFileSync(f.path, path);
    const bytes = readFileSync(path), metadata: unknown = JSON.parse(bytes.toString("utf8"));
    assert.equal(bytes.includes(f.key.key), false); assert.equal(bytes.includes(Buffer.from(f.key.key, "base64")), false);
    assert.equal(f.custody.read(metadata).key, f.key.key);
    f.entries.clear();
    assert.throws(() => f.custody.migrateDirectory(destination, f.key.installationId, f.admit), { code: "CREDENTIAL_KEYCHAIN_MISSING" });
    assert.deepEqual(readFileSync(path), bytes);
  } finally { f.close(); }
});

it("resumes only exact interrupted rewrite prefixes on the original inode", () => {
  const f = fixture();
  try {
    f.custody.migrateDirectory(f.root, f.key.installationId, f.admit);
    const next = readFileSync(f.path), metadata: unknown = JSON.parse(next.toString("utf8")), info = statSync(f.path);
    for (const prefix of [0, 2, f.bytes.length - 3, next.length]) {
      writeFileSync(f.path, Buffer.concat([next.subarray(0, prefix), f.bytes.subarray(prefix)]));
      writeFileSync(join(f.root, `.keychain-migration.${f.key.profileId}.json`), encodePrivate({ metadata, device: info.dev, inode: info.ino }), { mode: 0o600 });
      f.custody.migrateDirectory(f.root, f.key.installationId, f.admit);
      assert.deepEqual(readFileSync(f.path), next);
      assert.equal(statSync(f.path).ino, info.ino);
    }
    writeFileSync(f.path, "changed-source");
    writeFileSync(join(f.root, `.keychain-migration.${f.key.profileId}.json`), encodePrivate({ metadata, device: info.dev, inode: info.ino }), { mode: 0o600 });
    assert.throws(() => f.custody.migrateDirectory(f.root, f.key.installationId, f.admit), { code: "CREDENTIAL_KEYCHAIN_UNCERTAIN" });
    assert.equal(readFileSync(f.path, "utf8"), "changed-source");
  } finally { f.close(); }
});

it("refuses a foreign installation or migration with peer leases without touching the source", () => {
  const f = fixture();
  try {
    assert.throws(() => f.custody.migrateDirectory(f.root, randomUUID(), f.admit), { code: "CREDENTIAL_KEYCHAIN_MISMATCH" });
    assert.throws(() => f.custody.migrateDirectory(f.root, f.key.installationId, f.admit, false), { code: "CREDENTIAL_KEYCHAIN_UNCERTAIN" });
    assert.deepEqual(readFileSync(f.path), f.bytes); assert.equal(f.entries.size, 0);
    assert.throws(() => f.custody.read(f.key), { code: "CREDENTIAL_KEYCHAIN_MISMATCH" });
  } finally { f.close(); }
});

it("migrates a stopped installation at startup, retains readable ciphertext and refuses reopening without its OS entry", async () => {
  const f = await createBoundProfileFixture({ sharedMachine: true }), binding = f.admission.profileBinding;
  const keyPath = join(f.machine.stateRoot, "machine", "credential-keys", `${binding.profileId}.json`);
  const key = credentialKeyCustody.read(JSON.parse(readFileSync(keyPath, "utf8"))), original = boundProfileCredentials(f.admission).read();
  const protectedPath = join(f.stateRoot, "credentials", "protected.json"), ciphertext = readFileSync(protectedPath);
  const controlPath = join(f.workspace, ".tracker", "control", "profile-registry.json");
  f.admission.release(); f.machine.release();
  try {
    const legacy = encodePrivate(key), control = JSON.parse(readFileSync(controlPath, "utf8")) as { erasures: { profileId: string; credentialKey?: { file: { digest: string } } }[] };
    const anchor = control.erasures.find(row => row.profileId === binding.profileId)?.credentialKey;
    assert.ok(anchor);
    anchor.file.digest = createHash("sha256").update(legacy).digest("hex");
    writeFileSync(controlPath, JSON.stringify(control)); writeFileSync(keyPath, legacy);
    credentialKeyCustody.delete(binding);
    const machine = acquireEntrypointAdmission(f.workspace, "exclusive");
    const admission = machine.admitProfile(machine.issueRegisteredProfileClaim(binding.profileId));
    try {
      const store = createCredentialStore({ admission, stateRoot: f.stateRoot, erasureJournalAdmission: machine,
        erasureJournalPath: join(machine.stateRoot, "machine", "erasures", `${binding.profileId}.json`) });
      assert.deepEqual(store.read(), original); assert.deepEqual(readFileSync(protectedPath), ciphertext);
      assert.equal(readFileSync(keyPath).includes(key.key), false);
      credentialKeyCustody.delete(binding);
      assert.throws(() => store.read(), { code: "CREDENTIAL_KEYCHAIN_MISSING" });
    } finally { admission.release(); machine.release(); }
    const metadata = readFileSync(keyPath);
    assert.throws(() => acquireEntrypointAdmission(f.workspace, "exclusive"), { code: "CREDENTIAL_KEYCHAIN_MISSING" });
    assert.deepEqual(readFileSync(keyPath), metadata); assert.deepEqual(readFileSync(protectedPath), ciphertext);
  } finally { await f.close(); }
});

for (const retained of ["none", "witness", "ciphertext"] as const) it(`handles OS entry publication before metadata staging with ${retained} retained`, async () => {
  const f = await createBoundProfileFixture({ pending: true });
  const binding = f.admission.profileBinding, keyPath = join(f.machine.stateRoot, "machine", "credential-keys", `${binding.profileId}.json`);
  const entry = new FakeKeyringEntry("Relay", `${binding.installationId}:${binding.profileId}`);
  const setPassword = entry.setPassword.bind(entry);
  const spy = vi.spyOn(FakeKeyringEntry.prototype, "setPassword").mockImplementation((key: string) => {
    setPassword(key);
    throw new Error("synthetic exit after OS publication");
  });
  try {
    try { await assert.rejects(f.finish(), { code: "CREDENTIAL_KEYCHAIN_UNCERTAIN" }); }
    finally { spy.mockRestore(); }
    assert.equal(existsSync(keyPath), false);
    const directory = join(f.machine.stateRoot, "machine", "credential-keys");
    assert.deepEqual(readdirSync(directory), []);
    const key = entry.getPassword();
    assert.ok(key !== null);
    const operationPath = join(f.machine.stateRoot, "machine", "operations");
    const name = readdirSync(operationPath)[0]; assert.ok(name !== undefined);
    const operation = SignUpOperationSchema.parse(JSON.parse(readFileSync(join(operationPath, name), "utf8")));
    assert.ok(operation.credentialInitialization !== undefined);
    if (retained === "witness") {
      f.machine.publishProfileOperation({ ...operation, credentialInitialization: { ...operation.credentialInitialization, keyDocumentDigest: "f".repeat(64) } });
      await assert.rejects(f.finish(), /credential-initialization-intended-key-missing/u);
    } else if (retained === "ciphertext") {
      mkdirSync(join(f.stateRoot, "credentials"), { recursive: true, mode: 0o700 });
      writeFileSync(join(f.stateRoot, "credentials", "protected.json"), encodePrivate({ schemaVersion: 4, algorithm: "aes-256-gcm", ...binding,
        keyId: operation.credentialInitialization.keyId, nonce: Buffer.alloc(12).toString("base64"), tag: Buffer.alloc(16).toString("base64"), ciphertext: "AAAA" }), { mode: 0o600 });
      await assert.rejects(f.finish(), /credential-key-required/u);
    } else {
      await f.finish();
      assert.equal(credentialKeyCustody.read(JSON.parse(readFileSync(keyPath, "utf8"))).key, key);
    }
    assert.equal(entry.getPassword(), key);
    if (retained !== "none") { assert.equal(existsSync(keyPath), false); assert.deepEqual(readdirSync(directory), []); }
  } finally { spy.mockRestore(); await f.close(); }
});

for (const changed of ["key", "keyId", "filename", "inode"] as const) it(`refuses legacy startup migration with changed ${changed} before OS or source effects`, async () => {
  const f = await createBoundProfileFixture({ sharedMachine: true }), binding = f.admission.profileBinding;
  const directory = join(f.machine.stateRoot, "machine", "credential-keys"), keyPath = join(directory, `${binding.profileId}.json`);
  const key = credentialKeyCustody.read(JSON.parse(readFileSync(keyPath, "utf8"))), legacy = encodePrivate(key);
  const controlPath = join(f.workspace, ".tracker", "control", "profile-registry.json");
  const control = JSON.parse(readFileSync(controlPath, "utf8")) as { erasures: { profileId: string; credentialKey?: { file: { digest: string } } }[] };
  const anchor = control.erasures.find(row => row.profileId === binding.profileId)?.credentialKey;
  assert.ok(anchor);
  anchor.file.digest = createHash("sha256").update(legacy).digest("hex");
  writeFileSync(controlPath, JSON.stringify(control)); writeFileSync(keyPath, legacy);
  credentialKeyCustody.delete(binding);
  f.admission.release(); f.machine.release();
  let path = keyPath;
  if (changed === "key") writeFileSync(path, encodePrivate({ ...key, key: randomBytes(32).toString("base64") }));
  if (changed === "keyId") writeFileSync(path, encodePrivate({ ...key, keyId: randomUUID() }));
  if (changed === "filename") { path = join(directory, `${randomUUID()}.json`); renameSync(keyPath, path); }
  if (changed === "inode") { const replacement = join(directory, "replacement"); writeFileSync(replacement, legacy, { mode: 0o600 }); renameSync(replacement, path); }
  const before = readFileSync(path), identity = statSync(path), entries = FakeKeyringEntry.snapshot();
  try {
    assert.throws(() => acquireEntrypointAdmission(f.workspace, "exclusive"));
    assert.equal(readFileSync(path).equals(before), true, "legacy source must remain unchanged");
    assert.equal(statSync(path).ino, identity.ino);
    assert.equal(JSON.stringify(FakeKeyringEntry.snapshot()) === JSON.stringify(entries), true, "OS entries must remain unchanged");
    assert.deepEqual(readdirSync(directory), [path.slice(directory.length + 1)]);
  } finally { await f.close(); }
});

for (const boundary of ["journal", "intent"] as const) for (const changed of (boundary === "journal" ? [false, true, "capture", "capture-journal"] as const : [false, true] as const)) it(`admits only original legacy stage custody after ${boundary}, changed=${changed}`, async () => {
  const f = await createBoundProfileFixture({ pending: true }), binding = f.admission.profileBinding;
  const session = createSyntheticProfileSession({ admission: f.machine, machineRoot: f.machine.stateRoot,
    initializationInventory: (admission, operation, writer, copies) => composeProfileCredentialInitializationInventory({ machine: f.machine, admission,
      clock: systemClock, hostFacts: { primaryDisplay: null } })(operation, writer, copies),
    credentialHooks: { [boundary === "journal" ? "afterKeyStageJournal" : "afterKeyStageIntent"]: () => { throw new Error("synthetic stage migration boundary"); } } });
  try {
    assert.throws(() => session.signUp({ firstName: "Fixture", lastName: "Example", email: "fixture@ucsd.edu",
      password: "disposable-fixture-password", createdAt: "2026-10-01T12:00:00.000Z" }));
    await session.close();
    const directory = join(f.machine.stateRoot, "machine", "credential-keys"), name = readdirSync(directory)[0];
    assert.ok(name?.startsWith(".credential-key."));
    const path = join(directory, name), bytes = readFileSync(path), key = credentialKeyCustody.read(JSON.parse(bytes.toString("utf8"))), legacy = Buffer.from(encodePrivate(key));
    const beforeDigest = createHash("sha256").update(bytes).digest("hex"), legacyDigest = createHash("sha256").update(legacy).digest("hex");
    const operations = join(f.machine.stateRoot, "machine", "operations"), controlPath = join(f.workspace, ".tracker", "control", "profile-registry.json");
    const intentPath = join(f.workspace, ".tracker", "control", "profile-publication.json");
    for (const file of [...readdirSync(operations).map(entry => join(operations, entry)), ...(existsSync(intentPath) ? [intentPath] : [])]) {
      writeFileSync(file, readFileSync(file, "utf8").replaceAll(beforeDigest, legacyDigest));
    }
    const control = JSON.parse(readFileSync(controlPath, "utf8")) as { operations: { operationId: string; digest: string }[] };
    for (const row of control.operations) row.digest = createHash("sha256").update(canonicalJsonStringify(JSON.parse(readFileSync(join(operations, `${row.operationId}.json`), "utf8")))).digest("hex");
    writeFileSync(controlPath, JSON.stringify(control));
    const migratedKey = changed ? { ...key, keyId: randomUUID() } : key;
    writeFileSync(path, encodePrivate(migratedKey));
    if (changed === "capture" || changed === "capture-journal") {
      const intent = JSON.parse(readFileSync(intentPath, "utf8")) as { keyStage: { key: { keyId: string; file: { digest: string } } } };
      intent.keyStage.key.keyId = migratedKey.keyId;
      intent.keyStage.key.file.digest = createHash("sha256").update(encodePrivate(migratedKey)).digest("hex");
      writeFileSync(intentPath, JSON.stringify(intent));
    }
    credentialKeyCustody.delete(binding);
    if (changed === "capture-journal") {
      const info = statSync(path);
      new FakeKeyringEntry("Relay", `${binding.installationId}:${binding.profileId}`).setPassword(migratedKey.key);
      writeFileSync(join(directory, `.keychain-migration.${name}`), encodePrivate({ metadata: { schemaVersion: 2, ...binding,
        keyId: migratedKey.keyId, keyDigest: createHash("sha256").update(Buffer.from(migratedKey.key, "base64")).digest("hex"), legacyWitness: true }, device: info.dev, inode: info.ino }), { mode: 0o600 });
    }
    f.admission.release(); f.machine.release();
    const before = readFileSync(path), entries = FakeKeyringEntry.snapshot();
    const directoryBefore = readdirSync(directory).map(entry => ({ name: entry, bytes: readFileSync(join(directory, entry)) }));
    if (changed) {
      assert.throws(() => acquireEntrypointAdmission(f.workspace, "exclusive"));
      assert.equal(readFileSync(path).equals(before), true);
      assert.equal(JSON.stringify(FakeKeyringEntry.snapshot()) === JSON.stringify(entries), true);
      assert.deepEqual(readdirSync(directory).map(entry => ({ name: entry, bytes: readFileSync(join(directory, entry)) })), directoryBefore);
    } else {
      const machine = acquireEntrypointAdmission(f.workspace, "exclusive");
      try {
        assert.equal(credentialKeyCustody.read(JSON.parse(readFileSync(path, "utf8"))).key === key.key, true);
        assert.equal(credentialKeyCustody.fileDigest(readFileSync(path)), legacyDigest);
        assert.equal(readFileSync(path).includes(key.key), false);
      } finally { machine.release(); }
    }
  } finally { await session.close(); await f.close(); }
});


it("migrates an original schema-1 key before supported stopped prior-control conversion without granting runtime access", async () => {
  const f = await createHistoricalIncompleteProfileFixture();
  try {
    const key = credentialKeyCustody.read(JSON.parse(readFileSync(f.keyPath, "utf8"))), legacy = Buffer.from(encodePrivate(key)), identity = statSync(f.keyPath);
    const current = JSON.parse(readFileSync(f.controlPath, "utf8")) as { schemaVersion: number; duo?: unknown; erasures: { credentialKey: { file: { digest: string } } }[] };
    const { duo: _duo, ...prior } = current;
    for (const row of prior.erasures) row.credentialKey.file.digest = createHash("sha256").update(legacy).digest("hex");
    writeFileSync(f.controlPath, JSON.stringify({ ...prior, schemaVersion: 1 }));
    writeFileSync(f.markerPath, JSON.stringify({ schemaVersion: 2 }));
    writeFileSync(f.keyPath, legacy);
    credentialKeyCustody.delete(key);
    const before = [f.registryPath, f.verifierPath, f.protectedPath, f.databasePath].map(path => ({ path, bytes: readFileSync(path) }));
    const control = readFileSync(f.controlPath), marker = readFileSync(f.markerPath);
    const maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
    try {
      assert.equal(credentialKeyCustody.read(JSON.parse(readFileSync(f.keyPath, "utf8"))).key === key.key, true);
      assert.equal(readFileSync(f.keyPath).includes(key.key), false);
      assert.equal(statSync(f.keyPath).ino, identity.ino);
      assert.equal(credentialKeyCustody.fileDigest(readFileSync(f.keyPath)), createHash("sha256").update(legacy).digest("hex"));
      assert.equal(readFileSync(f.controlPath).equals(control), true);
      assert.equal(readFileSync(f.markerPath).equals(marker), true);
      maintenance.release();
      assert.throws(() => acquireEntrypointAdmission(f.workspace, "exclusive"));
      const cold = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
      try {
        const upgraded = await upgradeStoppedMachineControl(cold, { plan: false, hostFacts: { primaryDisplay: null } }, systemClock, composeStoppedControlCredentialInventory);
        assert.equal(upgraded.state, "upgraded");
        assert.equal(upgraded.runtimeAccess, "owner-claim-required");
      } finally { cold.release(); }
      for (const source of before) assert.equal(readFileSync(source.path).equals(source.bytes), true);
    } finally { maintenance.release(); }
  } finally { await f.close(); }
});
