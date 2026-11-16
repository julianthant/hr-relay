import { randomUUID } from "node:crypto";
import { CanonicalCredentialHeadSchema, createCanonicalCredentials } from "../../../src/backend/storage/configuration/canonical-credential-store.js";
import { DuoCredentialRecordSchema } from "../../../src/models/config/duo-credential-store.js";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, it } from "vitest";
import { AuthorityDatabase, createProfileFixtureSet, type BoundProfileStorageFixture } from "./admission-fixture.js";
import { CONFIG_SNAPSHOT } from "../fixtures/phase1c-contract-fixtures.js";

const pools: ReturnType<typeof createProfileFixtureSet>[] = [];
const profiles: BoundProfileStorageFixture[] = [];
afterEach(async () => {
  for (const profile of profiles.splice(0).reverse()) await profile.close();
  for (const pool of pools.splice(0).reverse()) await pool.close();
});
function pool() {
  const value = createProfileFixtureSet();
  pools.push(value);
  return value;
}
async function borrow(owner: ReturnType<typeof pool>) {
  const profile = await owner.create();
  profiles.push(profile);
  return profile;
}
function runtime(profile: BoundProfileStorageFixture) {
  return AuthorityDatabase.open({ path: profile.path, busyTimeoutMs: 250, migrationOwner: "fresh-profile-test" });
}

it("creates a fresh bound profile without retaining a prior borrower's database writes", async () => {
  const owner = pool(), first = await borrow(owner);
  const database = runtime(first);
  try { database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT); }
  finally { database.close(); }
  const firstBinding = first.admission.profileBinding;
  await first.close();
  const second = await borrow(owner);
  assert.notEqual(second.stateRoot, first.stateRoot);
  assert.notEqual(second.admission.profileBinding.installationId, firstBinding.installationId);
  assert.notEqual(second.admission.profileBinding.profileId, firstBinding.profileId);
  assert.notEqual(second.admission, first.admission);
  assert.throws(() => first.admission.assertLive());
  second.admission.assertProfileRuntime();
  if (process.platform !== "win32") {
    assert.equal(statSync(second.stateRoot).mode & 0o777, 0o700);
    assert.equal(statSync(join(second.stateRoot, "credentials")).mode & 0o777, 0o700);
    assert.equal(statSync(join(second.stateRoot, "credentials", "protected.json")).mode & 0o777, 0o600);
  }
  const restored = runtime(second);
  try { assert.equal(restored.authority.runtimeConfig.get(), undefined); }
  finally { restored.close(); }
});

it("keeps simultaneous borrowers in separate profiles and refuses to close a held pool", async () => {
  const owner = pool(), first = await borrow(owner), second = await borrow(owner);
  assert.notEqual(first.workspace, second.workspace);
  assert.notEqual(first.stateRoot, second.stateRoot);
  const database = runtime(first);
  try { database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT); }
  finally { database.close(); }
  const other = runtime(second);
  try { assert.equal(other.authority.runtimeConfig.get(), undefined); }
  finally { other.close(); }
  await assert.rejects(owner.close(), /fixture-profile-still-held/u);
  await first.close();
  second.admission.assertProfileRuntime();
});

it("isolates canonical native key binding and durable counters across genuine fixture identities", async () => {
  const owner = pool(), first = await borrow(owner), second = await borrow(owner);
  const context = (profile: BoundProfileStorageFixture) => {
    const machine = profile.admission.readInstallationContext(); assert.ok(machine);
    return join(machine.locator.stateRoot, "machine", "credential-keys", `${profile.admission.profileBinding.profileId}.json`);
  };
  const firstPath = context(first), secondPath = context(second), secondBytes = readFileSync(secondPath),
    a = CanonicalCredentialHeadSchema.parse(JSON.parse(readFileSync(firstPath, "utf8"))),
    b = CanonicalCredentialHeadSchema.parse(JSON.parse(secondBytes.toString("utf8")));
  assert.equal(a.state, "active"); assert.equal(b.state, "active");
  assert.notEqual(a.installationId, b.installationId); assert.notEqual(a.profileId, b.profileId);
  assert.notEqual(a.key.keyId, b.key.keyId); assert.notEqual(a.key.keyDigest, b.key.keyDigest);
  const firstOwner = createCanonicalCredentials(first.admission), record = firstOwner.readRecord("duo"); assert.ok(record);
  const credential = DuoCredentialRecordSchema.parse(record.value).credentials.find(row => row.state === "ready"); assert.ok(credential);
  firstOwner.reserveDuoCounter(credential.credentialId, randomUUID());
  assert.deepEqual(readFileSync(secondPath), secondBytes);
  const secondOwner = createCanonicalCredentials(second.admission);
  assert.throws(() => secondOwner.reserveDuoCounter(credential.credentialId, randomUUID()), { code: "CREDENTIAL_UNAVAILABLE" });
  assert.deepEqual(readFileSync(secondPath), secondBytes);
  await first.close(); assert.throws(() => firstOwner.assertCurrent());
  secondOwner.assertCurrent(); assert.deepEqual(readFileSync(secondPath), secondBytes);
});
