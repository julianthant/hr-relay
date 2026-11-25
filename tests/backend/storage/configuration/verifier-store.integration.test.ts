import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { createProfileVerifiers } from "../../../../src/backend/storage/configuration/verifier-store.js";

const profileId = "00000000-0000-4000-8000-000000000001";
const email = "operator@example.invalid";
const password = "synthetic fixture password";

function withVerifiers(run: (store: ReturnType<typeof createProfileVerifiers>, machine: string) => void) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "verifier-store-"));
  const machine = join(root, "machine");
  try {
    mkdirSync(machine, { mode: 0o700 });
    writeFileSync(join(machine, "profile-pepper"), Buffer.alloc(32), { mode: 0o600 });
    writeFileSync(join(machine, "profile-verifiers.json"), '{"schemaVersion":1,"profiles":[]}', { mode: 0o600 });
    const store = createProfileVerifiers(root);
    store.save(profileId, email, password);
    assert.deepEqual(store.identify(email), { profileId });
    assert.equal(store.passwordMatches(profileId, password), true);
    run(store, machine);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const fileName of ["profile-pepper", "profile-verifiers.json"] as const) {
  it(`refuses a symlinked ${fileName} during sign-in`, () => {
    withVerifiers((store, machine) => {
      const path = join(machine, fileName);
      const target = join(machine, "original");
      renameSync(path, target);
      symlinkSync(target, path);
      assert.throws(() => store.identify(email), /permissions or identity are invalid/u);
      if (fileName === "profile-verifiers.json") {
        assert.throws(() => store.passwordMatches(profileId, password), /permissions or identity are invalid/u);
      }
    });
  });
}

it("refuses a verifier document that exceeds the private read limit", () => {
  withVerifiers((store, machine) => {
    const path = join(machine, "profile-verifiers.json");
    writeFileSync(path, readFileSync(path, "utf8") + " ".repeat(1_048_576));
    assert.throws(() => store.identify(email), /permissions or identity are invalid/u);
    assert.throws(() => store.passwordMatches(profileId, password), /permissions or identity are invalid/u);
  });
});

it("refuses a missing pepper without creating it during sign-in", () => {
  withVerifiers((store, machine) => {
    const path = join(machine, "profile-pepper");
    rmSync(path);
    assert.throws(() => store.identify(email), /profile pepper is missing/u);
    assert.equal(existsSync(path), false);
  });
});
