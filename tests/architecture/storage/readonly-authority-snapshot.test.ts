import assert from "node:assert/strict";
import { z } from "zod";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import childProcesses, { spawnSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { it, vi } from "vitest";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { inspectAuthorityBackupReadOnly } from "../../../src/backend/storage/sqlite/backup-inspection.js";
import { createReadonlyAuthoritySnapshot } from "../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";
import { doctorAuthorityStorage } from "../../../src/backend/storage/sqlite/storage-doctor.js";

function inventory(directory: string) {
  const child = spawnSync(process.execPath, ["--input-type=commonjs", "-e", `
    const { readdirSync, readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const directory = process.argv[1];
    process.stdout.write(JSON.stringify(readdirSync(directory).sort().filter(name => name.startsWith("state.db"))
      .map(name => ({ name, bytes: readFileSync(join(directory, name)).toString("base64") }))));
  `, directory], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  const files = z.array(z.object({ name: z.string(), bytes: z.string() }).strict()).parse(JSON.parse(child.stdout));
  return files.map(file => ({ name: file.name, bytes: Buffer.from(file.bytes, "base64") }));
}

it.each([false, true])("inspects committed WAL: %s without creating or changing source companions", async liveWal => {
  const fixture = createBoundProfileFixture(), { workspace, path, admission } = fixture;
  const credentials = boundProfileCredentials(admission);
  let writer: DatabaseSync | undefined;
  const failures: unknown[] = [];
  try {
    const database = AuthorityDatabase.open(admission, { path, busyTimeoutMs: 250, migrationOwner: "readonly-snapshot-test" },
      undefined, undefined, undefined, undefined, credentials);
    database.close();
    const baseline = AuthorityDatabase.inspectExistingReadOnly(admission, path).authorityGeneration;
    if (liveWal) {
      writer = new DatabaseSync(path);
      writer.exec("PRAGMA wal_autocheckpoint=0; UPDATE database_states SET authority_generation=authority_generation+1,search_generation=search_generation+1 WHERE id=1");
      assert.ok(existsSync(`${path}-wal`));
    } else {
      assert.equal(existsSync(`${path}-wal`), false);
      assert.equal(existsSync(`${path}-shm`), false);
    }
    const before = inventory(admission.stateRoot);
    const expectedGeneration = baseline + (liveWal ? 1 : 0);
    assert.equal(AuthorityDatabase.inspectExistingReadOnly(admission, path).authorityGeneration, expectedGeneration);
    assert.equal(AuthorityDatabase.inspectAuthorityReadIdentityReadOnly(admission, path).authorityGeneration, expectedGeneration);
    assert.equal(AuthorityDatabase.inspectTimelineReadOnly(admission, path).authorityGeneration, expectedGeneration);
    assert.equal(AuthorityDatabase.inspectSpanRunAuthorityReadOnly(admission, path, []).authorityGeneration, expectedGeneration);
    assert.equal(inspectAuthorityBackupReadOnly(admission, path).authorityGeneration, expectedGeneration);
    await doctorAuthorityStorage(admission, { stateRootTrustAnchor: workspace, stateRoot: admission.stateRoot,
      authorityPath: path, backupDirectory: join(admission.stateRoot, "backups", "authority"), busyTimeoutMs: 250 }, undefined, credentials);
    const after = inventory(admission.stateRoot);
    assert.deepEqual(after.map(file => file.name), before.map(file => file.name));
    for (const [index, file] of after.entries()) {
      const original = before[index]; assert.ok(original);
      assert.ok(file.bytes.equals(original.bytes), `${file.name} changed`);
    }
  } catch (error) { failures.push(error); } finally {
    try { writer?.close(); } catch (error) { failures.push(error); }
    try { fixture.close(); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, "readonly authority fixture failed");
});

it("refuses unsafe companions and detects changed original source identity", () => {
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

it.each([false, true])("retains live SQLite locks across isolated snapshot disposal: %s", snapshotEnabled => {
  const script = `
    import assert from "node:assert/strict";
    import childProcesses, { spawnSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
    import { mkdtempSync, lstatSync, rmSync } from "node:fs";
    import { tmpdir } from "node:os";
    import { join } from "node:path";
    import { DatabaseSync } from "node:sqlite";
    import { createReadonlyAuthoritySnapshot } from "./src/backend/storage/sqlite/readonly-authority-snapshot.ts";
    const directory = mkdtempSync(join(tmpdir(), "readonly-lock-test-"));
    const path = join(directory, "source.sqlite");
    const writer = new DatabaseSync(path);
    try {
      writer.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE proof(value); INSERT INTO proof VALUES(7); BEGIN IMMEDIATE");
      const before = lstatSync(path + "-shm", { bigint: true });
      if (process.argv[1] === "true") {
        const snapshot = createReadonlyAuthoritySnapshot(path);
        snapshot.assertUnchanged();
        snapshot.dispose();
      }
      const peer = spawnSync(process.execPath, ["--input-type=module", "-e", \`
        import { DatabaseSync } from "node:sqlite";
        const database = new DatabaseSync(process.argv[1]);
        try {
          database.exec("BEGIN IMMEDIATE");
          database.exec("ROLLBACK");
          process.stdout.write("acquired");
        } catch (error) {
          if (error.errcode !== 5) throw error;
          process.stdout.write("busy");
        } finally { database.close(); }
      \`, path], { encoding: "utf8" });
      assert.equal(peer.status, 0, peer.stderr);
      assert.equal(peer.stdout, "busy", "live writer WAL lock was released");
      const after = lstatSync(path + "-shm", { bigint: true });
      assert.equal(after.ino, before.ino);
      assert.equal(after.size, before.size);
      assert.equal(writer.prepare("SELECT value FROM proof").get().value, 7);
    } finally {
      writer.exec("ROLLBACK");
      writer.close();
      rmSync(directory, { recursive: true, force: true });
    }
  `;
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, String(snapshotEnabled)],
    { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(child.signal, null, child.stderr);
  assert.equal(child.status, 0, child.stderr);
});

it("refuses an abruptly terminated copy and removes its private directory without source effects", () => {
  const workspace = mkdtempSync(join(realpathSync(tmpdir()), "readonly-copy-failure-test-"));
  const path = join(workspace, "source.sqlite");
  const database = new DatabaseSync(path); database.exec("CREATE TABLE proof(value)"); database.close();
  const before = readFileSync(path);
  let directory: string | undefined;
  const actualSpawn = childProcesses.spawnSync;
  const copier = vi.spyOn(childProcesses, "spawnSync").mockImplementation((command, args, options) => {
    if (command !== process.execPath || !Array.isArray(args) || typeof args[3] !== "string"
      || !dirname(args[3]).startsWith(join(tmpdir(), "relay-readonly-authority-"))) {
      return actualSpawn(command, args, options);
    }
    assert.ok(Array.isArray(args));
    const destination: unknown = args[3]; assert.ok(typeof destination === "string");
    assert.equal(destination, join(dirname(destination), "authority.sqlite"));
    directory = dirname(destination);
    assert.ok(existsSync(directory));
    writeFileSync(destination, "partial copy");
    return { pid: 0, output: [], stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), status: null, signal: "SIGTERM" };
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => createReadonlyAuthoritySnapshot(path), /authority-readonly-snapshot-copy-failed/u);
    assert.ok(directory);
    assert.equal(existsSync(directory), false);
    assert.ok(readFileSync(path).equals(before));
  } finally {
    copier.mockRestore(); syncBuiltinESMExports();
    rmSync(workspace, { recursive: true, force: true });
  }
});
