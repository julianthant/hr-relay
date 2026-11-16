import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync, linkSync, symlinkSync, unlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readPrivateFile } from "../../../../src/backend/storage/configuration/credential-safe-file.js";
import { it } from "vitest";
import { createCredentialStore, assertCredentialStoreOwner } from "../../../../src/backend/storage/configuration/credential-store.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

it("revalidates genuine person/root authority and released admission", async () => {
  const profile = await createBoundProfileFixture(), foreign = await createBoundProfileFixture();
  try {
    const owner = profile.admission, store = createCredentialStore({ admission: owner, stateRoot: profile.stateRoot });
    const before = store.read(), sibling = profile.machine.admitProfile(owner.profileBinding.profileId);
    try {
      assert.deepEqual(createCredentialStore({ admission: sibling, stateRoot: sibling.stateRoot }).read(), before);
      assert.throws(() => createCredentialStore({ admission: foreign.admission, stateRoot: profile.stateRoot }));
      assert.throws(() => createCredentialStore({ admission: profile.machine, stateRoot: profile.stateRoot }));
    } finally { sibling.release(); }
    try {
      chmodSync(profile.stateRoot, 0o720);
      assert.throws(() => store.read(), { code: "CREDENTIAL_UNAVAILABLE" });
    } finally { chmodSync(profile.stateRoot, 0o700); }
    assert.deepEqual(store.read(), before);
    owner.release();
    assert.throws(() => store.read(), { code: "CREDENTIAL_UNAVAILABLE" });
    assert.throws(() => store.ownsCommandId("11111111-1111-4111-8111-111111111111"), /missing or released admission/u);
  } finally { await foreign.close(); await profile.close(); }
});

it("requires one private regular authority database for a file witness", () => {
  const root = mkdtempSync(join(tmpdir(), "authority-file-witness-"));
  const path = join(root, "state.db"), alias = join(root, "alias");
  try {
    writeFileSync(path, "synthetic authority", { mode: 0o600 });
    const options = { label: "authority database" as const, maxBytes: 1024 };
    assert.equal(readPrivateFile(path, options)?.bytes.toString(), "synthetic authority");
    chmodSync(path, 0o644);
    assert.equal(readPrivateFile(path, options)?.bytes.toString(), "synthetic authority");
    for (const label of ["protected.json", "lock", "ChatGPT", "Duo credential", "erasure journal"] as const) {
      assert.throws(() => readPrivateFile(path, { label, maxBytes: 1024 }), /permissions or identity are invalid/u);
    }
    chmodSync(path, 0o664);
    assert.throws(() => readPrivateFile(path, options), /authority database permissions or identity are invalid/u);
    chmodSync(path, 0o666);
    assert.throws(() => readPrivateFile(path, options), /authority database permissions or identity are invalid/u);
    chmodSync(path, 0o600);
    linkSync(path, alias);
    assert.throws(() => readPrivateFile(path, options), /authority database permissions or identity are invalid/u);
    unlinkSync(alias);
    symlinkSync(path, alias);
    assert.throws(() => readPrivateFile(alias, options), /authority database permissions or identity are invalid/u);
    assert.equal(readPrivateFile(path, options)?.bytes.toString(), "synthetic authority");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("custody checks accept only the exact factory/admission association without reading protected payloads", async () => {
  const profile = await createBoundProfileFixture();
  const owner = profile.admission, store = createCredentialStore({ admission: owner, stateRoot: profile.stateRoot }), sibling = profile.machine.admitProfile(owner.profileBinding.profileId);
  try {
    const path = join(profile.stateRoot, "credentials", "protected.json"); writeFileSync(path, "synthetic malformed ciphertext", { mode: 0o600 });
    assert.doesNotThrow(() => assertCredentialStoreOwner(store, owner));
    assert.throws(() => store.read(), { code: "CREDENTIAL_UNAVAILABLE" });
    assert.throws(() => assertCredentialStoreOwner({ ...store }, owner), /credential-store-owner-mismatch/u);
    assert.throws(() => assertCredentialStoreOwner(store, sibling), /credential-store-owner-mismatch/u);
    assert.throws(() => assertCredentialStoreOwner(store, profile.machine), /credential-store-owner-mismatch/u);
    owner.release();
    assert.throws(() => assertCredentialStoreOwner(store, owner), /missing or released admission/u);
    assert.throws(() => assertCredentialStoreOwner({ ...store }, owner), /missing or released admission/u);
  } finally { sibling.release(); await profile.close(); }
});
