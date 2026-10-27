import assert from "node:assert/strict";
import { existsSync,readFileSync,symlinkSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe,it } from "vitest";
import { credentialTrap,storageRecoveryFixture,storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { AuthoritySchemaVersionError } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { inspectAuthorityBackupReadOnly,upgradeStorage } from "../../../support/helpers/synthetic-storage-admission.js";

describe("current stopped authority initialization", () => {
  it.each([7, 29, 31, 38, 46, 47, 48, 49, 56])("refuses noncurrent schema %s before credentials or rewriting bytes", async version => {
    const f = await storageRecoveryFixture(version);
    try {
      credentialTrap(f.root);
      writeFileSync(f.input.environmentFile, "malformed obsolete environment");
      const before = storageTree(f.root);
      for (const plan of [true, false]) await assert.rejects(f.run(plan), error => error instanceof AuthoritySchemaVersionError
        && error.code === "authority-schema-mismatch" && error.schemaVersion === version);
      assert.deepEqual(storageTree(f.root), before);
      assert.equal(existsSync(f.input.processLockRoot), false);
    } finally { await f.dispose(); }
  });
  it("plans without writes, initializes directly, and repeats without changing authority or independent inputs", async () => {
    const f = await storageRecoveryFixture();
    try {
      writeFileSync(f.input.environmentFile, "HRAUTO_DEFAULT_WORKERS=17\nUCPATH_PASSWORD=synthetic-retired-input\n");
      writeFileSync(join(f.root, "settings.json"), "corrupt obsolete input");
      credentialTrap(f.root);
      const before = storageTree(f.root);
      assert.equal((await f.run(true)).state, "planned");
      assert.deepEqual(storageTree(f.root), before);
      assert.equal((await f.run()).state, "initialized");
      assert.equal(inspectAuthorityBackupReadOnly(f.path).schemaVersion, 6);
      const initialized = storageTree(f.root);
      assert.equal((await f.run()).state, "already-upgraded");
      const repeated = storageTree(f.root);
      for (const [path, bytes] of Object.entries(initialized)) assert.equal(repeated[path], bytes);
      const added = Object.keys(repeated).filter(path => !(path in initialized));
      assert.equal(added.length, 1);
      assert.match(added[0] ?? "", /^locks\/restore-admission-history\/[^/]+\.lock\.json$/u);
      assert.equal(existsSync(join(f.input.processLockRoot, "restore-admission.lock.json")), false);
      assert.equal(readFileSync(f.input.environmentFile, "utf8"), "HRAUTO_DEFAULT_WORKERS=17\nUCPATH_PASSWORD=synthetic-retired-input\n");
      assert.equal(readFileSync(join(f.root, "settings.json"), "utf8"), "corrupt obsolete input");
    } finally { await f.dispose(); }
  });
  it("preserves a fresh source after admission fails and admits the exact retry", async () => {
    const f = await storageRecoveryFixture();
    try {
      const before = storageTree(f.root);
      await assert.rejects(upgradeStorage(f.input, f.clock, () => { throw new Error("injected-admission-failure"); }), /injected-admission-failure/u);
      assert.deepEqual(storageTree(f.root), before);
      assert.equal(existsSync(f.path), false);
      assert.equal((await f.run()).state, "initialized");
    } finally { await f.dispose(); }
  });
  it("refuses an aliased database without changing its genuine current source", async () => {
    const f = await storageRecoveryFixture(), source = await storageRecoveryFixture();
    try {
      await source.run();
      symlinkSync(source.path, f.path);
      const before = storageTree(source.root);
      await assert.rejects(f.run(), /source-integrity/u);
      assert.deepEqual(storageTree(source.root), before);
    } finally { await f.dispose(); await source.dispose(); }
  });
});
