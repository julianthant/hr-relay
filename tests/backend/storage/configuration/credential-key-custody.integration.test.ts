import assert from "node:assert/strict";
import { Entry } from "@napi-rs/keyring";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it, vi } from "vitest";
import { z } from "zod";
import { createCredentialKeyCustody, credentialKeyCustody } from "../../../../src/backend/storage/configuration/credential-key-custody.js";
import { CanonicalCredentialHeadSchema, CanonicalCredentialConversionPlanSchema, captureStoppedIncompleteCredentials, initializeCanonicalCredentials } from "../../../../src/backend/storage/configuration/canonical-credential-store.js";
import { authenticateDocument, createCredentialStore, initialDocument } from "../../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { upgradeStoppedMachineControl } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { composeStoppedControlCredentialInventory } from "../../../../src/backend/app/composition/profile-credential-inventory.js";
import { SignUpOperationSchema } from "../../../../src/models/profiles/profile.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { FakeKeyringEntry } from "../../../support/helpers/credential-keychain-fake.js";
import { createHistoricalIncompleteProfileFixture, historicalIncompleteProfileFields } from "../../../support/fixtures/storage/historical-incomplete-profile-fixture.js";
import { writeStoppedProfileControlPredecessor } from "../../../support/fixtures/storage/stopped-profile-control-predecessor.js";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const snapshot = (paths: readonly string[]) => paths.map(path => ({ path, bytes: existsSync(path) ? readFileSync(path) : undefined }));
const unchanged = (before: ReturnType<typeof snapshot>) => assert.deepEqual(snapshot(before.map(source => source.path)), before);

async function pending() {
  const actualEntry: unknown = Entry; assert.equal(actualEntry, FakeKeyringEntry);
  const f = await createBoundProfileFixture({ pending: "storage" });
  try {
    AuthorityDatabase.initializeProfile(f.admission);
    const directory = join(f.machine.stateRoot, "machine", "operations"), names = readdirSync(directory);
    assert.equal(names.length, 1); const name = names[0]; assert.ok(name);
    const operation = SignUpOperationSchema.parse(JSON.parse(readFileSync(join(directory, name), "utf8")));
    const document = initialDocument(), record = { revision: document.record.revision, value: document };
    const keyPath = join(f.machine.stateRoot, "machine", "credential-keys", f.admission.profileBinding.profileId + ".json");
    const planPath = join(f.machine.stateRoot, "machine", "credential-operations", f.admission.profileBinding.profileId + ".json");
    const paths = [keyPath, join(f.stateRoot, "credentials", "protected.json"),
      join(f.machine.stateRoot, "machine", "duo-credentials", f.admission.profileBinding.profileId + ".json"), join(f.stateRoot, "credentials", "chatgpt-account.json")];
    const entry = new FakeKeyringEntry("Relay", f.admission.profileBinding.installationId + ":" + f.admission.profileBinding.profileId);
    return { f, operation, record, keyPath, planPath, paths, entry,
      initialize: () => initializeCanonicalCredentials(f.machine, f.admission, operation, record),
      ready: () => f.machine.publishProfileOperation({ ...operation, credentials: { ...operation.credentials, phase: "ready", protectedRevision: document.record.revision } }) };
  } catch (error) { await f.close(); throw error; }
}

it("imports only the exact stopped legacy key after its nonsecret intent is prepared, without rewriting its source", () => {
  const entries = new Map<string, string>(), source = { schemaVersion: 1, installationId: randomUUID(), profileId: randomUUID(), keyId: randomUUID(), key: randomBytes(32).toString("base64") };
  const account = source.installationId + ":" + source.profileId;
  let prepared = false, sets = 0;
  const custody = createCredentialKeyCustody({ get: name => entries.get(name) ?? null,
    set(name, secret) { assert.equal(prepared, true); assert.equal(name, account); assert.equal(secret === source.key, true); entries.set(name, secret); sets++; },
    delete: name => { entries.delete(name); } });
  const before = JSON.stringify(source);
  const metadata = custody.importStoppedLegacy(source, (value, key) => {
    assert.equal(entries.has(account), false); assert.equal(JSON.stringify(value).includes(source.key), false);
    assert.equal(value.keyDigest, digest(key)); prepared = true;
  });
  assert.equal(custody.read(metadata).key === source.key, true); assert.equal(JSON.stringify(source), before);
  custody.importStoppedLegacy(source, value => assert.deepEqual(value, metadata));
  assert.equal(sets, 1); assert.throws(() => custody.read(source), { code: "CREDENTIAL_KEYCHAIN_MISMATCH" });
});

it("refuses mismatched native material and failed readback without changing the stopped source", () => {
  const source = { schemaVersion: 1, installationId: randomUUID(), profileId: randomUUID(), keyId: randomUUID(), key: randomBytes(32).toString("base64") }, before = JSON.stringify(source);
  const mismatch = createCredentialKeyCustody({ get: () => randomBytes(32).toString("base64"), set: () => assert.fail("mismatch reached native set"), delete: () => assert.fail("mismatch reached native delete") });
  assert.throws(() => mismatch.importStoppedLegacy(source, () => assert.fail("mismatch prepared an intent")), { code: "CREDENTIAL_KEYCHAIN_MISMATCH" });
  let prepared = false;
  const missing = createCredentialKeyCustody({ get: () => null, set: () => assert.equal(prepared, true), delete: () => assert.fail("readback reached delete") });
  assert.throws(() => missing.importStoppedLegacy(source, () => { prepared = true; }), { code: "CREDENTIAL_KEYCHAIN_MISSING" });
  assert.equal(JSON.stringify(source), before);
});

it("keeps copied key metadata nonsecret and refuses it after its actual native entry is lost", async () => {
  const w = await pending();
  try {
    w.initialize(); w.ready();
    const head = CanonicalCredentialHeadSchema.parse(JSON.parse(readFileSync(w.keyPath, "utf8")));
    const key = w.entry.getPassword(); assert.ok(key !== null);
    const path = join(w.f.workspace, "metadata-backup.json"); writeFileSync(path, JSON.stringify(head.key), { mode: 0o600, flag: "wx" });
    const bytes = readFileSync(path), metadata: unknown = JSON.parse(bytes.toString("utf8"));
    assert.equal(bytes.includes(key), false); assert.equal(bytes.includes(Buffer.from(key, "base64")), false);
    assert.equal(credentialKeyCustody.read(metadata).key === key, true);
    w.entry.deletePassword();
    assert.throws(() => credentialKeyCustody.read(metadata), { code: "CREDENTIAL_KEYCHAIN_MISSING" });
    assert.deepEqual(readFileSync(path), bytes);
  } finally { await w.f.close(); }
});

for (const boundary of ["before", "after"] as const) it("retains the actual create plan and native custody after " + boundary + " native key publication failure", async () => {
  const w = await pending(), set = w.entry.setPassword.bind(w.entry);
  let calls = 0, observationFailure: unknown;
  const spy = vi.spyOn(FakeKeyringEntry.prototype, "setPassword").mockImplementation((secret: string) => {
    calls++;
    try {
      assert.equal(existsSync(w.planPath), true);
      const plan = CanonicalCredentialConversionPlanSchema.shape.operation.parse(JSON.parse(readFileSync(w.planPath, "utf8")));
      assert.equal(plan.operationId, w.operation.credentials.operationId); assert.equal(plan.head.key.keyId, w.operation.credentials.keyId);
      assert.equal(plan.head.key.keyDigest, digest(Buffer.from(secret, "base64")));
      assert.equal(readFileSync(w.planPath).includes(secret), false);
      assert.deepEqual(w.paths.map(existsSync), [false, false, false, false]);
    } catch (error) { observationFailure = error; throw error; }
    if (boundary === "after") set(secret);
    throw new Error("synthetic native publication interruption");
  });
  try {
    assert.throws(w.initialize, { code: "CREDENTIAL_KEYCHAIN_UNCERTAIN" });
    spy.mockRestore();
    if (observationFailure !== undefined) throw observationFailure instanceof Error ? observationFailure : new AggregateError([observationFailure], "native-create-observation-failed", { cause: observationFailure });
    const before = snapshot([w.planPath, ...w.paths]), key = w.entry.getPassword();
    if (boundary === "before") {
      assert.equal(key, null);
      assert.throws(w.initialize, { code: "CREDENTIAL_CREATE_KEY_MISSING" });
      unchanged(before); assert.equal(w.entry.getPassword(), null);
    } else {
      assert.ok(key !== null); w.initialize(); w.ready();
      assert.equal(existsSync(w.planPath), false); assert.deepEqual(w.paths.map(existsSync), [true, true, true, true]);
      const head = CanonicalCredentialHeadSchema.parse(JSON.parse(readFileSync(w.keyPath, "utf8")));
      assert.equal(head.key.keyId, w.operation.credentials.keyId); assert.equal(head.generation, w.operation.credentials.generation);
      assert.equal(credentialKeyCustody.read(head.key).key === key, true);
      assert.deepEqual(createCredentialStore({ admission: w.f.admission, stateRoot: w.f.stateRoot }).read().entries, {});
      for (const path of w.paths) assert.equal(readFileSync(path).includes(key), false);
      const settled = snapshot(w.paths); assert.throws(w.initialize, /profile-credential-creation-changed/u); unchanged(settled);
    }
    assert.equal(calls, 1);
  } finally { spy.mockRestore(); await w.f.close(); }
});

for (const change of ["operation", "keyId", "binding", "ciphertext", "order", "companion"] as const)
  it("refuses changed prepared canonical " + change + " custody before any publication or native replacement", async () => {
    const w = await pending(), set = w.entry.setPassword.bind(w.entry);
    const spy = vi.spyOn(FakeKeyringEntry.prototype, "setPassword").mockImplementation((secret: string) => {
      set(secret); throw new Error("synthetic native publication interruption");
    });
    try {
      assert.throws(w.initialize, { code: "CREDENTIAL_KEYCHAIN_UNCERTAIN" }); spy.mockRestore();
      const plan = CanonicalCredentialConversionPlanSchema.shape.operation.parse(JSON.parse(readFileSync(w.planPath, "utf8")));
      const files = [...plan.files], first = files[0], second = files[1]; assert.ok(first); assert.ok(second);
      const changed = change === "operation" ? { ...plan, operationId: randomUUID() }
        : change === "keyId" ? { ...plan, head: { ...plan.head, key: { ...plan.head.key, keyId: randomUUID() } } }
          : change === "binding" ? { ...plan, head: { ...plan.head, key: { ...plan.head.key, profileId: randomUUID() } } }
            : change === "ciphertext" ? { ...plan, files: [{ ...first, bytes: "e30=" }, ...files.slice(1)] }
              : change === "order" ? { ...plan, files: [second, first, ...files.slice(2)] } : plan;
      writeFileSync(w.planPath, JSON.stringify(changed));
      const companion = join(w.f.stateRoot, "credentials", "unowned.json");
      if (change === "companion") writeFileSync(companion, "{}", { mode: 0o600, flag: "wx" });
      const before = snapshot([w.planPath, ...w.paths, companion]), entries = FakeKeyringEntry.snapshot();
      const native = vi.spyOn(FakeKeyringEntry.prototype, "setPassword");
      try { assert.throws(w.initialize); assert.equal(native.mock.calls.length, 0); }
      finally { native.mockRestore(); }
      unchanged(before); assert.equal(JSON.stringify(FakeKeyringEntry.snapshot()) === JSON.stringify(entries), true);
    } finally { spy.mockRestore(); await w.f.close(); }
  });

it("refuses a missing established native key on both current reads and a genuine cold start without replacing ciphertext", async () => {
  const f = await createBoundProfileFixture(), id = f.admission.profileBinding.profileId;
  const headPath = join(f.machine.stateRoot, "machine", "credential-keys", id + ".json"), path = join(f.stateRoot, "credentials", "protected.json");
  try {
    const head = CanonicalCredentialHeadSchema.parse(JSON.parse(readFileSync(headPath, "utf8")));
    const before = snapshot([headPath, path]), store = createCredentialStore({ admission: f.admission, stateRoot: f.stateRoot });
    credentialKeyCustody.delete(head.key);
    assert.throws(() => store.read(), { code: "CREDENTIAL_UNAVAILABLE" }); unchanged(before);
    await f.closeController();
    const lifetime = await RuntimeLifetimeLock.acquire(0);
    try { assert.throws(() => acquireEntrypointAdmission(f.workspace, "exclusive", lifetime), { code: "CREDENTIAL_KEYCHAIN_MISSING" }); unchanged(before); }
    finally { await lifetime.close(); }
  } finally { await f.close(); }
});

it("converts a complete supported inline-key predecessor only through stopped control while preserving its logical protected record", async () => {
  const f = await createHistoricalIncompleteProfileFixture({ keyFormat: "inline" });
  const entry = new FakeKeyringEntry("Relay", f.nativeKeyAccount), key = entry.getPassword(); assert.ok(key !== null);
  try {
    writeStoppedProfileControlPredecessor(f, 1); entry.deletePassword();
    const before = snapshot([f.keyPath, f.protectedPath, f.registryPath, f.verifierPath, f.databasePath]);
    const maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
    try {
      unchanged(before); assert.equal(entry.getPassword(), null);
      assert.throws(() => maintenance.admitProfile(f.profileId));
      const report = await upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts: { primaryDisplay: null } }, systemClock, composeStoppedControlCredentialInventory);
      assert.equal(report.state, "upgraded"); assert.equal(report.runtimeAccess, "onboarding-incomplete");
      const child = maintenance.forStoppedIncompleteProfileInventory(f.profileId);
      try {
        const current = captureStoppedIncompleteCredentials(child), document = authenticateDocument(current.record.value);
        assert.equal(document.record.entries.ucpathUserId?.value, historicalIncompleteProfileFields.email);
        assert.equal(document.record.entries.ucpathPassword?.value, historicalIncompleteProfileFields.password);
        assert.equal(document.record.lastApplied?.commandId, f.operation.commandId);
        assert.equal(entry.getPassword() === key, true);
        assert.equal(readFileSync(f.keyPath).includes(key), false);
        assert.throws(() => child.assertCredentialRead(), /profile-control-upgrade-credential-read-refused/u);
      } finally { child.release(); }
    } finally { maintenance.release(); }
  } finally { await f.close(); }
});

for (const change of ["key", "keyId", "filename", "inode", "witness", "registry"] as const)
  it("holds the complete stopped predecessor after " + change + " drift without native or canonical effects", async () => {
    const f = await createHistoricalIncompleteProfileFixture({ keyFormat: "inline" });
    try {
      writeStoppedProfileControlPredecessor(f, 1);
      const entry = new FakeKeyringEntry("Relay", f.nativeKeyAccount); entry.deletePassword();
      let path = f.keyPath;
      const key = z.record(z.string(), z.unknown()).parse(JSON.parse(readFileSync(path, "utf8")));
      if (change === "key" || change === "keyId") writeFileSync(path, JSON.stringify({ ...key, [change]: change === "key" ? randomBytes(32).toString("base64") : randomUUID() }));
      if (change === "filename") { path = join(f.machineRoot, "credential-keys", randomUUID() + ".json"); renameSync(f.keyPath, path); }
      if (change === "inode") { const replacement = join(f.workspace, "replaced-key"); copyFileSync(path, replacement); renameSync(replacement, path); }
      if (change === "witness") {
        const control = z.looseObject({ erasures: z.array(z.looseObject({ credentialKey: z.looseObject({ file: z.looseObject({ digest: z.string() }) }) })) }).parse(JSON.parse(readFileSync(f.controlPath, "utf8")));
        for (const row of control.erasures) row.credentialKey.file.digest = "0".repeat(64);
        writeFileSync(f.controlPath, JSON.stringify(control));
      }
      if (change === "registry") {
        const registry = z.looseObject({ sessionGeneration: z.number().int().nonnegative() }).parse(JSON.parse(readFileSync(f.registryPath, "utf8")));
        writeFileSync(f.registryPath, JSON.stringify({ ...registry, sessionGeneration: registry.sessionGeneration + 1 }));
      }
      const before = snapshot([path, f.controlPath, f.markerPath, f.protectedPath, f.registryPath, f.verifierPath, f.databasePath]), identity = statSync(path);
      let maintenance: RuntimeAdmission | undefined;
      const native = vi.spyOn(FakeKeyringEntry.prototype, "setPassword");
      try {
        await assert.rejects(async () => {
          maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
          await upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts: { primaryDisplay: null } }, systemClock, composeStoppedControlCredentialInventory);
        });
        assert.equal(native.mock.calls.length, 0); unchanged(before); assert.equal(entry.getPassword(), null); assert.equal(statSync(path).ino, identity.ino);
      } finally { native.mockRestore(); maintenance?.release(); }
    } finally { await f.close(); }
  });

it("refuses foreign, changed and expired genuine initialization capabilities before native or source effects", async () => {
  const w = await pending(), other = await pending();
  try {
    const empty = snapshot([w.planPath, ...w.paths]), entries = FakeKeyringEntry.snapshot();
    assert.throws(() => initializeCanonicalCredentials(w.f.machine, other.f.admission, w.operation, w.record), /profile-credential-creation-owner-mismatch/u);
    const changed = SignUpOperationSchema.parse({ ...w.operation, credentials: { ...w.operation.credentials, keyId: randomUUID() } });
    assert.throws(() => initializeCanonicalCredentials(w.f.machine, w.f.admission, changed, w.record), /profile-credential-creation-changed/u);
    unchanged(empty); assert.equal(JSON.stringify(FakeKeyringEntry.snapshot()) === JSON.stringify(entries), true);
    w.initialize(); w.ready();
    const settled = snapshot(w.paths), key = w.entry.getPassword();
    assert.throws(w.initialize, /profile-credential-creation-changed/u);
    w.f.admission.release(); assert.throws(w.initialize, /released admission/u);
    unchanged(settled); assert.equal(w.entry.getPassword() === key, true);
  } finally { await other.f.close(); await w.f.close(); }
});
