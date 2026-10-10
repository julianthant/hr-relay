import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { inspectAuthorityBackupReadOnly } from "../../../src/backend/storage/sqlite/backup-inspection.js";
import { createReadonlyAuthoritySnapshot } from "../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { doctorAuthorityStorage } from "../../../src/backend/storage/sqlite/storage-doctor.js";

function inventory(directory: string) {
  return readdirSync(directory).sort().filter(name => name.startsWith("state.db"))
    .map(name => ({ name, bytes: readFileSync(join(directory, name)) }));
}

it.each([false, true])("inspects committed WAL: %s without creating or changing source companions", async liveWal => {
  const workspace = mkdtempSync(join(realpathSync(tmpdir()), "readonly-authority-test-"));
  const admission = acquireEntrypointAdmission(workspace, "exclusive");
  const path = join(admission.stateRoot, "state.db");
  let writer: DatabaseSync | undefined;
  try {
    if (liveWal) {
      writer = new DatabaseSync(path);
      writer.exec("PRAGMA wal_autocheckpoint=0; UPDATE database_states SET authority_generation=authority_generation+1,search_generation=search_generation+1 WHERE id=1");
      assert.ok(existsSync(`${path}-wal`));
    } else {
      assert.equal(existsSync(`${path}-wal`), false);
      assert.equal(existsSync(`${path}-shm`), false);
    }
    const before = inventory(admission.stateRoot);
    const expectedGeneration = liveWal ? 1 : 0;
    assert.equal(AuthorityDatabase.inspectExistingReadOnly(admission, path).authorityGeneration, expectedGeneration);
    assert.equal(AuthorityDatabase.inspectAuthorityReadIdentityReadOnly(admission, path).authorityGeneration, expectedGeneration);
    assert.equal(AuthorityDatabase.inspectTimelineReadOnly(admission, path).authorityGeneration, expectedGeneration);
    assert.equal(AuthorityDatabase.inspectSpanRunAuthorityReadOnly(admission, path, []).authorityGeneration, expectedGeneration);
    assert.equal(inspectAuthorityBackupReadOnly(admission, path).authorityGeneration, expectedGeneration);
    await doctorAuthorityStorage(admission, { stateRootTrustAnchor: workspace, stateRoot: admission.stateRoot,
      authorityPath: path, backupDirectory: join(admission.stateRoot, "backups", "authority"), busyTimeoutMs: 250 });
    const after = inventory(admission.stateRoot);
    assert.deepEqual(after.map(file => file.name), before.map(file => file.name));
    for (const [index, file] of after.entries()) {
      const original = before[index]; assert.ok(original);
      assert.ok(file.bytes.equals(original.bytes), `${file.name} changed`);
    }
  } finally {
    writer?.close(); admission.release(); rmSync(workspace, { recursive: true, force: true });
  }
});

it("refuses unsafe companions and detects changes through the held original descriptor", () => {
  const workspace = mkdtempSync(join(realpathSync(tmpdir()), "readonly-source-test-"));
  const path = join(workspace, "source.sqlite");
  const database = new DatabaseSync(path); database.exec("CREATE TABLE proof(value); INSERT INTO proof VALUES(1)"); database.close();
  try {
    symlinkSync(path, `${path}-wal`);
    assert.throws(() => createReadonlyAuthoritySnapshot(path), /authority-readonly-source-unsafe/u);
    rmSync(`${path}-wal`);
    const snapshot = createReadonlyAuthoritySnapshot(path);
    try {
      appendFileSync(path, "changed");
      assert.throws(snapshot.assertUnchanged, /authority-readonly-source-changed/u);
    } finally { snapshot.dispose(); }
    assert.equal(existsSync(snapshot.path), false);
    assert.equal(readFileSync(path).subarray(-7).toString(), "changed");
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});
