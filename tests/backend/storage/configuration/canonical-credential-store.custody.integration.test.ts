import { runCredentialSourceRetentionCase } from "../../../support/helpers/credential-source-retention.js";
import assert from "node:assert/strict";
import nativeFs, { chmodSync, linkSync, lstatSync, readFileSync, unlinkSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { it, vi } from "vitest";
import { createCanonicalCredentials } from "../../../../src/backend/storage/configuration/canonical-credential-store.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

for (const kind of ["protected", "writer"] as const) for (const change of ["mode", "links", "owner"] as const) {
  it(`refuses ${kind} ${change} mutation after its descriptor read without publishing`, async () => {
    const f = await createBoundProfileFixture();
    const store = createCanonicalCredentials(f.admission), profileId = f.admission.profileBinding.profileId;
    const protectedPath = join(f.stateRoot, "credentials", "protected.json"),
      path = kind === "protected" ? protectedPath : join(f.machine.stateRoot, "machine", "credential-keys", `.${profileId}.writer.lock`), alias = `${path}.test-hardlink`;
    const before = readFileSync(protectedPath), originalStat = nativeFs.fstatSync;
    let fired = false, reads = 0;
    const stat = vi.spyOn(nativeFs, "fstatSync").mockImplementation((descriptor, options) => {
      const result = originalStat(descriptor, options), current = nativeFs.lstatSync(path, { throwIfNoEntry: false });
      if (!fired && current !== undefined && result.dev === current.dev && result.ino === current.ino && ++reads === 2) {
        fired = true;
        if (change === "mode") chmodSync(path, 0o640);
        else if (change === "links") linkSync(path, alias);
        else Object.defineProperty(result, "uid", { value: Number(result.uid) + 1 });
      }
      return result;
    });
    syncBuiltinESMExports();
    try {
      if (kind === "protected") assert.throws(() => store.readRecord("protected"), { code: "CREDENTIAL_UNAVAILABLE" });
      else assert.throws(() => store.replaceRecord("duo", null, { credentials: [] }), { code: "CREDENTIAL_UNAVAILABLE" });
      assert.equal(fired, true); assert.deepEqual(readFileSync(protectedPath), before);
    } finally {
      stat.mockRestore(); syncBuiltinESMExports();
      if (fired && change === "mode" && nativeFs.existsSync(path)) chmodSync(path, 0o600);
      if (fired && change === "links") unlinkSync(alias);
      if (kind === "writer" && nativeFs.existsSync(path)) unlinkSync(path);
      await f.close();
    }
  });
}

it("retains the actual writer descriptor and owner when native close fails after record replacement", async () => {
  await runCredentialSourceRetentionCase("writer-close");
});

it("preserves a substituted stage and original source when exact stage inode publication is refused", async () => {
  const f = await createBoundProfileFixture(), store = createCanonicalCredentials(f.admission);
  const path = join(f.stateRoot, "credentials", "protected.json"), directory = join(f.stateRoot, "credentials"),
    originalBytes = readFileSync(path), current = store.readRecord("protected"); assert.ok(current);
  const parent = lstatSync(directory), sync = nativeFs.fsyncSync;
  let stage: string | undefined, displaced: string | undefined, replacement: Buffer | undefined;
  const fsync = vi.spyOn(nativeFs, "fsyncSync").mockImplementation(descriptor => {
    const opened = nativeFs.fstatSync(descriptor);
    if (stage === undefined && opened.dev === parent.dev && opened.ino === parent.ino) {
      const name = nativeFs.readdirSync(directory).find(name => name.endsWith(".canonical.tmp"));
      if (name !== undefined) {
        stage = join(directory, name); displaced = join(f.workspace, "exact-owned-stage.test");
        replacement = readFileSync(stage); nativeFs.renameSync(stage, displaced);
        nativeFs.writeFileSync(stage, replacement, { mode: 0o600, flag: "wx" });
      }
    }
    sync(descriptor);
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => store.replaceRecord("protected", current.revision, current.value), { code: "CREDENTIAL_UNCERTAIN" });
    assert.ok(stage); assert.ok(displaced); assert.ok(replacement);
    assert.deepEqual(readFileSync(path), originalBytes);
    assert.deepEqual(readFileSync(stage), replacement); assert.deepEqual(readFileSync(displaced), replacement);
    assert.notEqual(lstatSync(stage).ino, lstatSync(displaced).ino);
  } finally { fsync.mockRestore(); syncBuiltinESMExports(); }
  if (stage !== undefined) unlinkSync(stage);
  if (displaced !== undefined) unlinkSync(displaced);
  await f.close();
});
