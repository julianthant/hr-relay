import assert from "node:assert/strict";
import { chmodSync } from "node:fs";
import { it } from "vitest";
import { assertCredentialStoreOwner } from "../../../../src/backend/storage/configuration/credential-store.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

it("checks current credential ownership, root permissions and released authority in order", () => {
  const profile = createBoundProfileFixture();
  try {
    const owner = profile.admission;
    const store = boundProfileCredentials(owner);
    assert.doesNotThrow(() => assertCredentialStoreOwner(store, owner));
    const sibling = profile.machine.admitProfile(createProfileRegistry(profile.machine).storageClaim(owner.profileBinding.profileId));
    try {
      assert.throws(() => assertCredentialStoreOwner(store, sibling), /credential-store-owner-mismatch/u);
      assert.throws(() => assertCredentialStoreOwner(store, profile.machine), /credential-store-owner-mismatch/u);
    } finally { sibling.release(); }
    try {
      chmodSync(profile.stateRoot, 0o720);
      assert.throws(() => assertCredentialStoreOwner(store, owner), /credential ancestor is group\/world-writable without sticky protection/u);
    } finally { chmodSync(profile.stateRoot, 0o700); }
    assert.doesNotThrow(() => assertCredentialStoreOwner(store, owner));
    owner.release();
    assert.throws(() => assertCredentialStoreOwner(store, owner), /missing or released admission/u);
    assert.throws(() => assertCredentialStoreOwner({ ...store }, owner), /missing or released admission/u);
  } finally { profile.close(); }
});
