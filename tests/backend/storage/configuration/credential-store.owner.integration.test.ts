import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync, linkSync, symlinkSync, unlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readPrivateFile } from "../../../../src/backend/storage/configuration/credential-safe-file.js";
import { it } from "vitest";
import { assertCredentialStoreOwner } from "../../../../src/backend/storage/configuration/credential-store.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

it("checks current credential ownership, root permissions and released authority in order", async () => {
  const profile = await createBoundProfileFixture();
  try {
    const owner = profile.admission;
    const store = boundProfileCredentials(owner);
    assert.doesNotThrow(() => assertCredentialStoreOwner(store, owner));
    const sibling = profile.machine.admitProfile(owner.profileBinding.profileId);
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
  } finally { await profile.close(); }
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
