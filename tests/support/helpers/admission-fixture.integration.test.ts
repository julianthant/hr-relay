import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, it } from "vitest";
import { AuthorityDatabase, createClonedProfileFixtures, type BoundProfileStorageFixture } from "./admission-fixture.js";
import { CONFIG_SNAPSHOT } from "../fixtures/phase1c-contract-fixtures.js";

const pools: ReturnType<typeof createClonedProfileFixtures>[] = [];
const profiles: BoundProfileStorageFixture[] = [];
afterEach(async () => {
  for (const profile of profiles.splice(0).reverse()) await profile.close();
  for (const pool of pools.splice(0).reverse()) await pool.close();
});
function pool() {
  const value = createClonedProfileFixtures();
  pools.push(value);
  return value;
}
async function borrow(owner: ReturnType<typeof pool>) {
  const profile = await owner.create();
  profiles.push(profile);
  return profile;
}
function runtime(profile: BoundProfileStorageFixture) {
  return AuthorityDatabase.open({ path: profile.path, busyTimeoutMs: 250, migrationOwner: "cloned-profile-test" });
}

it("restores a prepared profile without retaining a prior borrower's database writes", async () => {
  const owner = pool(), first = await borrow(owner);
  const database = runtime(first);
  try { database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT); }
  finally { database.close(); }
  await first.close();
  const second = await borrow(owner);
  assert.equal(second.stateRoot, first.stateRoot);
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
  await assert.rejects(owner.close(), /fixture-clone-still-held/u);
  await first.close();
  second.admission.assertProfileRuntime();
});
