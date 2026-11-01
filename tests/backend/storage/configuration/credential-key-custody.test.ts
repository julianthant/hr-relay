import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { it } from "vitest";
import { createCredentialKeyCustody, CredentialKeyCustodyError, type CredentialSecretStore } from "../../../../src/backend/storage/configuration/credential-key-custody.js";
import { credentialKeychainTestEnvironment, FakeKeyringEntry } from "../../../support/helpers/credential-keychain-fake.js";

function fixture() {
  const entries = new Map<string, string>();
  const store: CredentialSecretStore = { get: account => entries.get(account) ?? null,
    set: (account, secret) => { entries.set(account, secret); }, delete: account => { entries.delete(account); } };
  const identity = { installationId: randomUUID(), profileId: randomUUID(), keyId: randomUUID() };
  return { entries, store, identity, custody: createCredentialKeyCustody(store) };
}

it("proves an uninitialized native account is absent without changing an existing key", () => {
  const f = fixture();
  f.custody.assertAbsent(f.identity);
  assert.equal(f.entries.size, 0);
  const metadata = f.custody.create(f.identity, () => {}), before = [...f.entries];
  assert.throws(() => f.custody.assertAbsent(f.identity), { code: "CREDENTIAL_KEYCHAIN_MISMATCH" });
  assert.deepEqual([...f.entries], before);
  f.custody.delete(metadata);
  f.custody.assertAbsent(f.identity);
});

it("creates and reads exactly 32 random bytes under the installation/profile account, without a secret in metadata", () => {
  const f = fixture(), metadata = f.custody.create(f.identity, () => {});
  assert.deepEqual([...f.entries.keys()], [`${f.identity.installationId}:${f.identity.profileId}`]);
  const key = f.custody.read(metadata);
  assert.equal(Buffer.from(key.key, "base64").length, 32);
  assert.equal(JSON.stringify(metadata).includes(key.key), false);
  assert.equal("key" in metadata, false);
  assert.equal(key.keyId, f.identity.keyId);
  assert.throws(() => f.custody.create(f.identity, () => {}), { code: "CREDENTIAL_KEYCHAIN_MISMATCH" });
});

it("refuses missing, foreign and substituted entries without generating a replacement", () => {
  const f = fixture(), metadata = f.custody.create(f.identity, () => {}), original = f.custody.read(metadata).key;
  f.entries.clear();
  assert.throws(() => f.custody.read(metadata), { code: "CREDENTIAL_KEYCHAIN_MISSING" });
  assert.equal(f.entries.size, 0);
  f.entries.set(`${f.identity.installationId}:${f.identity.profileId}`, Buffer.alloc(32, 7).toString("base64"));
  assert.throws(() => f.custody.read(metadata), { code: "CREDENTIAL_KEYCHAIN_MISMATCH" });
  assert.throws(() => f.custody.read({ ...metadata, installationId: randomUUID() }), { code: "CREDENTIAL_KEYCHAIN_MISSING" });
  f.entries.set(`${f.identity.installationId}:${f.identity.profileId}`, original.slice(1));
  assert.throws(() => f.custody.read(metadata), { code: "CREDENTIAL_KEYCHAIN_MISMATCH" });
});

it("deletes only the bound entry and verifies absence, including repeated deletion", () => {
  const f = fixture(), metadata = f.custody.create(f.identity, () => {}), other = { ...f.identity, profileId: randomUUID() };
  f.custody.create(other, () => {});
  f.custody.delete(metadata); f.custody.delete(metadata);
  assert.equal(f.entries.size, 1);
  assert.throws(() => f.custody.read(metadata), { code: "CREDENTIAL_KEYCHAIN_MISSING" });
});

it("redacts OS errors and refuses unproved mutation readbacks", () => {
  const f = fixture(), secretError = new Error("synthetic-secret-must-not-escape");
  const unavailable = createCredentialKeyCustody({ ...f.store, get: () => { throw secretError; } });
  assert.throws(() => unavailable.create(f.identity, () => {}), (error: unknown) => error instanceof CredentialKeyCustodyError
    && error.code === "CREDENTIAL_KEYCHAIN_UNAVAILABLE" && !String(error).includes(secretError.message) && error.cause === undefined);
  assert.throws(() => createCredentialKeyCustody({ ...f.store, set: () => { throw secretError; } }).create(f.identity, () => {}), { code: "CREDENTIAL_KEYCHAIN_UNCERTAIN" });
  const metadata = f.custody.create(f.identity, () => {});
  assert.throws(() => createCredentialKeyCustody({ ...f.store, delete: () => undefined }).delete(metadata), { code: "CREDENTIAL_KEYCHAIN_UNCERTAIN" });
});

it("passes only the fake keychain into a child with a stripped environment", () => {
  const account = randomUUID(), entry = new FakeKeyringEntry("Relay", account);
  entry.setPassword("synthetic-child-key");
  try {
    const child = spawnSync(process.execPath, ["--input-type=module", "--eval",
      'import { Entry } from "@napi-rs/keyring"; process.stdout.write(new Entry("Relay", process.argv[1]).getPassword() === "synthetic-child-key" ? "matched" : "mismatch");', account],
    { encoding: "utf8", env: credentialKeychainTestEnvironment({}) });
    assert.equal(child.error, undefined); assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, "matched");
  } finally { entry.deletePassword(); }
});
