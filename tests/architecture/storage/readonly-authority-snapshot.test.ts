import { testProcessImport } from "../../support/compiled-process.js";
import assert from "node:assert/strict";
import { z } from "zod";
import { once } from "node:events";
import fs, { appendFileSync, copyFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import childProcesses, { spawnSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { it, vi } from "vitest";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { inspectAuthorityBackupReadOnly } from "../../../src/backend/storage/sqlite/backup-inspection.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";
import { doctorAuthorityStorage } from "../../../src/backend/storage/sqlite/storage-doctor.js";
import { fileStatus } from "../../../src/backend/storage/file-identity.js";
import { withOperationProof } from "../../../src/backend/storage/configuration/credential-safe-file.js";
import { AuthoritySourceClosureUnprovedError, hasUnprovedSourceClosure } from "../../../src/backend/storage/source-closure.js";
import { AuthoritySourceChangedError, createReadonlyAuthoritySnapshot, isAuthoritySourceChanged, openReadOnlyDatabase, withActiveAuthorityObservation, withReadonlyAuthoritySnapshot } from "../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";

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
  const fixture = await createBoundProfileFixture(), { workspace, path, admission } = fixture;
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
    try { await fixture.close(); } catch (error) { failures.push(error); }
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
  const child = spawnSync(process.execPath, ["--import", testProcessImport(), "--input-type=module", "-e", script, String(snapshotEnabled)],
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
      || !dirname(args[3]).startsWith(join(realpathSync(tmpdir()), "relay-readonly-authority-"))) {
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

function readPair(snapshotPath: string): { a: number; b: number; quick: string } {
  const reader = new DatabaseSync(snapshotPath, { readOnly: true });
  try {
    const a = reader.prepare("SELECT g FROM a").get();
    const b = reader.prepare("SELECT g FROM b").get();
    const quick = reader.prepare("PRAGMA quick_check(1)").get();
    assert.ok(a && typeof a.g === "number" && b && typeof b.g === "number" && quick && typeof quick.quick_check === "string");
    return { a: a.g, b: b.g, quick: quick.quick_check };
  } finally { reader.close(); }
}

it("with an owner open, a doctor pass leaves live authority names and bytes unchanged, and child scripts do not open sqlite", async () => {
  const source = readFileSync(new URL("../../../src/backend/storage/sqlite/readonly-authority-snapshot.ts", import.meta.url), "utf8");
  const scripts = [...source.matchAll(/Script = `([\s\S]*?)`;/gu)];
  assert.ok(scripts.length >= 1);
  for (const script of scripts) {
    const body = script[1] ?? "";
    assert.equal(body.includes("node:sqlite"), false);
    assert.equal(body.includes("DatabaseSync"), false);
    assert.equal(body.includes("backup("), false);
  }
  const fixture = await createBoundProfileFixture(), { workspace, path, admission } = fixture;
  const credentials = boundProfileCredentials(admission);
  const failures: unknown[] = [];
  try {
    const database = AuthorityDatabase.open(admission, { path, busyTimeoutMs: 250, migrationOwner: "owner-image-bytes" },
      undefined, undefined, undefined, undefined, credentials);
    try {
      const before = inventory(admission.stateRoot);
      await doctorAuthorityStorage(admission, { stateRootTrustAnchor: workspace, stateRoot: admission.stateRoot,
        authorityPath: path, backupDirectory: join(admission.stateRoot, "backups", "authority"), busyTimeoutMs: 250 }, undefined, credentials, database);
      const after = inventory(admission.stateRoot);
      assert.deepEqual(after.map(file => file.name), before.map(file => file.name));
      for (const name of ["state.db", "state.db-wal"]) {
        const original = before.find(file => file.name === name);
        const current = after.find(file => file.name === name);
        assert.equal(original === undefined, current === undefined, name);
        if (original !== undefined && current !== undefined) assert.ok(original.bytes.equals(current.bytes), `${name} changed`);
      }
    } finally { database.close(); }
  } catch (error) { failures.push(error); } finally {
    try { await fixture.close(); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, "owner image byte fixture failed");
});

it("captures at least 50 owner images while another process commits paired updates", async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "owner-image-pair-"));
  const path = join(directory, "state.db");
  const owner = new DatabaseSync(path);
  const writer = childProcesses.spawn(process.execPath, ["--import", testProcessImport(), "--input-type=module", "-e", `
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync(process.argv[1]);
    db.exec("PRAGMA busy_timeout=2000");
    let stop = false;
    process.stdin.on("end", () => { stop = true; });
    process.stdin.resume();
    let n = 0;
    while (!stop) {
      db.exec("BEGIN IMMEDIATE; UPDATE a SET g=g+1; UPDATE b SET g=g+1; COMMIT");
      n += 1;
      await new Promise(resolve => setImmediate(resolve));
    }
    db.close();
    process.stdout.write(String(n));
  `, path], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  writer.stdout?.setEncoding("utf8");
  writer.stdout?.on("data", chunk => { stdout += chunk; });
  let stderr = "";
  writer.stderr?.setEncoding("utf8");
  writer.stderr?.on("data", chunk => { stderr += chunk; });
  try {
    owner.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=2000; CREATE TABLE a(g INTEGER); CREATE TABLE b(g INTEGER); INSERT INTO a VALUES(0); INSERT INTO b VALUES(0)");
    const stats = fileStatus(path);
    const imageOwner = { serializeCommittedImage: () => owner.isTransaction ? (() => { throw new Error("authority-image-inside-transaction"); })()
      : { identity: { device: stats.dev, inode: stats.ino }, image: owner.serialize() } };
    await new Promise(resolve => setImmediate(resolve));
    let last = -1;
    const captures = 50;
    for (let index = 0; index < captures; index += 1) {
      await withActiveAuthorityObservation(path, imageOwner, async () => {
        const snapshot = createReadonlyAuthoritySnapshot(path);
        const pair = readPair(snapshot.path);
        assert.equal(pair.a, pair.b);
        assert.equal(pair.quick, "ok");
        assert.ok(pair.a >= last);
        last = pair.a;
      });
    }
    writer.stdin?.end();
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      writer.once("error", reject);
      writer.once("exit", code => resolve(code));
    });
    assert.equal(exitCode, 0, stderr);
    const commits = Number(stdout);
    assert.ok(commits > captures, `writer commits ${String(commits)} did not exceed ${String(captures)} captures`);
  } finally {
    if (writer.exitCode === null) writer.kill();
    try { owner.close(); } catch { /* closed with the fixture */ }
    rmSync(directory, { recursive: true, force: true });
  }
});

it("refuses an owner image inside a transaction and the doctor reports a copy failure", async () => {
  const fixture = await createBoundProfileFixture(), { workspace, path, admission } = fixture;
  const credentials = boundProfileCredentials(admission);
  const failures: unknown[] = [];
  try {
    const database = AuthorityDatabase.open(admission, { path, busyTimeoutMs: 250, migrationOwner: "owner-image-transaction" },
      undefined, undefined, undefined, undefined, credentials);
    try {
      database.withAuthorityTransaction(() => {
        assert.throws(() => database.serializeCommittedImage(), /authority-image-inside-transaction/u);
      });
      vi.spyOn(database, "serializeCommittedImage").mockImplementation(() => { throw new Error("authority-image-inside-transaction"); });
      const report = await doctorAuthorityStorage(admission, { stateRootTrustAnchor: workspace, stateRoot: admission.stateRoot,
        authorityPath: path, backupDirectory: join(admission.stateRoot, "backups", "authority"), busyTimeoutMs: 250 }, undefined, credentials, database);
      if (report.authority.state !== "degraded") throw new Error("owner-image-copy-failure-unreported");
      assert.match(report.authority.cause.summary, /authority-readonly-snapshot-copy-failed/u);
    } finally { database.close(); }
  } catch (error) { failures.push(error); } finally {
    vi.restoreAllMocks();
    try { await fixture.close(); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, "owner image transaction fixture failed");
});

it("reads the file now at the path when another database replaced it after the owner opened", async () => {
  const fixture = await createBoundProfileFixture(), { path, admission } = fixture;
  const credentials = boundProfileCredentials(admission);
  const failures: unknown[] = [];
  try {
    const database = AuthorityDatabase.open(admission, { path, busyTimeoutMs: 250, migrationOwner: "owner-image-rename" },
      undefined, undefined, undefined, undefined, credentials);
    try {
      const checkpoint = new DatabaseSync(path);
      try { checkpoint.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } finally { checkpoint.close(); }
      const replacement = `${path}.replacement`;
      copyFileSync(path, replacement);
      const other = new DatabaseSync(replacement);
      let bumped = 0;
      try {
        other.exec("UPDATE database_states SET authority_generation=authority_generation+50, search_generation=NULL, search_state='invalid' WHERE id=1");
        const row = other.prepare("SELECT authority_generation AS g FROM database_states WHERE id=1").get();
        assert.ok(row && typeof row.g === "number");
        bumped = row.g;
      } finally { other.close(); }
      renameSync(replacement, path);
      await withActiveAuthorityObservation(path, database, async () => {
        const snapshot = createReadonlyAuthoritySnapshot(path);
        const reader = openReadOnlyDatabase(snapshot.path, 250);
        try {
          const row = reader.prepare("SELECT authority_generation AS g FROM database_states WHERE id=1").get();
          assert.ok(row && typeof row.g === "number");
          assert.equal(row.g, bumped);
        } finally { reader.close(); }
      });
    } finally { database.close(); }
  } catch (error) { failures.push(error); } finally {
    try { await fixture.close(); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, "owner image rename fixture failed");
});

it("still rejects a backup that changes during its read inside an owner scope", async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "owner-image-backup-"));
  const path = join(directory, "state.db");
  const backup = join(directory, "backup.sqlite");
  const owner = new DatabaseSync(path);
  const copy = new DatabaseSync(backup);
  try {
    owner.exec("PRAGMA journal_mode=WAL; CREATE TABLE a(g INTEGER); INSERT INTO a VALUES(1)");
    copy.exec("CREATE TABLE proof(value); INSERT INTO proof VALUES(1)");
    const stats = fileStatus(path);
    const imageOwner = { serializeCommittedImage: () => ({ identity: { device: stats.dev, inode: stats.ino }, image: owner.serialize() }) };
    let changed = false;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const prepare = DatabaseSync.prototype.prepare;
    vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function changeBackup(this: DatabaseSync, ...args: Parameters<DatabaseSync["prepare"]>) {
      if (!changed && String(args[0]).includes("FROM proof")) {
        changed = true;
        appendFileSync(backup, "changed");
      }
      return prepare.apply(this, args);
    });
    await withActiveAuthorityObservation(path, imageOwner, async () => {
      assert.throws(() => withReadonlyAuthoritySnapshot(backup, database => database.prepare("SELECT value FROM proof").get()),
        (error: unknown) => error instanceof AuthoritySourceChangedError || isAuthoritySourceChanged(error));
    });
    assert.equal(changed, true);
  } finally {
    vi.restoreAllMocks();
    try { owner.close(); } catch { /* already closed */ }
    try { copy.close(); } catch { /* already closed */ }
    rmSync(directory, { recursive: true, force: true });
  }
});

it("sees later commits on an active-authority read outside the owner scope", async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "owner-image-fresh-"));
  const path = join(directory, "state.db");
  const owner = new DatabaseSync(path);
  const writer = new DatabaseSync(path);
  try {
    owner.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=2000; CREATE TABLE a(g INTEGER); CREATE TABLE b(g INTEGER); INSERT INTO a VALUES(0); INSERT INTO b VALUES(0)");
    writer.exec("PRAGMA busy_timeout=2000");
    const stats = fileStatus(path);
    const imageOwner = { serializeCommittedImage: () => ({ identity: { device: stats.dev, inode: stats.ino }, image: owner.serialize() }) };
    const read = () => {
      const snapshot = createReadonlyAuthoritySnapshot(path);
      try { return readPair(snapshot.path).a; } finally { snapshot.dispose(); }
    };
    await withActiveAuthorityObservation(path, imageOwner, async () => { assert.equal(read(), 0); });
    writer.exec("BEGIN IMMEDIATE; UPDATE a SET g=g+1; UPDATE b SET g=g+1; COMMIT");
    assert.equal(read(), 1);
  } finally {
    try { writer.close(); } catch { /* already closed */ }
    try { owner.close(); } catch { /* already closed */ }
    rmSync(directory, { recursive: true, force: true });
  }
});

it("keeps nested owner scopes on their own images", async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "owner-image-nested-"));
  const path = join(directory, "state.db");
  const owner = new DatabaseSync(path);
  const writer = new DatabaseSync(path);
  try {
    owner.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=2000; CREATE TABLE a(g INTEGER); CREATE TABLE b(g INTEGER); INSERT INTO a VALUES(0); INSERT INTO b VALUES(0)");
    writer.exec("PRAGMA busy_timeout=2000");
    const stats = fileStatus(path);
    const imageOwner = { serializeCommittedImage: () => ({ identity: { device: stats.dev, inode: stats.ino }, image: owner.serialize() }) };
    const read = () => readPair(createReadonlyAuthoritySnapshot(path).path).a;
    await withActiveAuthorityObservation(path, imageOwner, async () => {
      const outer = read();
      writer.exec("BEGIN IMMEDIATE; UPDATE a SET g=g+1; UPDATE b SET g=g+1; COMMIT");
      await withActiveAuthorityObservation(path, imageOwner, async () => { assert.equal(read(), outer + 1); });
      assert.equal(read(), outer);
    });
  } finally {
    try { writer.close(); } catch { /* already closed */ }
    try { owner.close(); } catch { /* already closed */ }
    rmSync(directory, { recursive: true, force: true });
  }
});

it("removes the owner image directory when the scope exits and a later proof read sees new state", async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "owner-image-proof-"));
  const path = join(directory, "state.db");
  const owner = new DatabaseSync(path);
  const writer = new DatabaseSync(path);
  try {
    owner.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=2000; CREATE TABLE a(g INTEGER); CREATE TABLE b(g INTEGER); INSERT INTO a VALUES(0); INSERT INTO b VALUES(0)");
    writer.exec("PRAGMA busy_timeout=2000");
    const stats = fileStatus(path);
    const imageOwner = { serializeCommittedImage: () => ({ identity: { device: stats.dev, inode: stats.ino }, image: owner.serialize() }) };
    let imageDirectory: string | undefined;
    let pinned = -1;
    await withOperationProof(async () => {
      await withActiveAuthorityObservation(path, imageOwner, async () => {
        const snapshot = createReadonlyAuthoritySnapshot(path);
        imageDirectory = dirname(snapshot.path);
        pinned = readPair(snapshot.path).a;
        writer.exec("BEGIN IMMEDIATE; UPDATE a SET g=g+3; UPDATE b SET g=g+3; COMMIT");
        assert.equal(readPair(createReadonlyAuthoritySnapshot(path).path).a, pinned);
      });
      assert.ok(imageDirectory);
      assert.equal(existsSync(imageDirectory), false);
      const later = createReadonlyAuthoritySnapshot(path);
      try { assert.equal(readPair(later.path).a, pinned + 3); } finally { later.dispose(); }
    });
  } finally {
    try { writer.close(); } catch { /* already closed */ }
    try { owner.close(); } catch { /* already closed */ }
    rmSync(directory, { recursive: true, force: true });
  }
});

it("keeps the owner image and refuses admission when a pinned reader's close fails", async () => {
  const fixture = await createBoundProfileFixture({ sharedMachine: true });
  const child = childProcesses.fork(fileURLToPath(new URL("../../support/helpers/owner-image-close-retention.ts", import.meta.url)),
    [String(fixture.lifetime.port), fixture.workspace, fixture.admission.profileBinding.profileId, fixture.path],
    { execArgv: ["--import", testProcessImport()], stdio: ["ignore", "inherit", "inherit", "ipc"] });
  let directory: string | undefined;
  const proved = once(child, "message", { signal: AbortSignal.timeout(20_000) });
  try {
    await fixture.lifetime.share(child);
    const message = z.union([
      z.strictObject({ type: z.literal("proved"), directory: z.string().min(1) }),
      z.strictObject({ type: z.literal("failed"), message: z.string() }),
    ]).parse((await proved)[0]);
    if (message.type === "failed") throw new Error(message.message);
    directory = message.directory;
    assert.equal(existsSync(directory), true);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await once(child, "exit");
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
    await fixture.close();
  }
});

it("rejects with both failures when the owner-scope body throws and image disposal fails", async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "owner-image-dispose-"));
  const path = join(directory, "state.db");
  const owner = new DatabaseSync(path);
  const bodyError = new Error("owner-scope-body-refused");
  const removal = new Error("owner-image-removal-refused");
  const actualRemove = fs.rmSync;
  const remove = vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
    if (typeof target === "string" && target.includes("relay-readonly-authority-")) throw removal;
    return actualRemove.call(fs, target, options);
  });
  syncBuiltinESMExports();
  try {
    owner.exec("PRAGMA journal_mode=WAL; CREATE TABLE a(g INTEGER); INSERT INTO a VALUES(0)");
    const stats = fileStatus(path);
    const imageOwner = { serializeCommittedImage: () => ({ identity: { device: stats.dev, inode: stats.ino }, image: owner.serialize() }) };
    let imageDirectory: string | undefined;
    await assert.rejects(withActiveAuthorityObservation(path, imageOwner, async () => {
      imageDirectory = dirname(createReadonlyAuthoritySnapshot(path).path);
      throw bodyError;
    }), (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.message, "authority-observation-failed");
      assert.equal(error.errors[0], bodyError);
      assert.ok(error.errors[1] instanceof AuthoritySourceClosureUnprovedError);
      assert.equal(hasUnprovedSourceClosure(error.errors[1]), true);
      return true;
    });
    assert.ok(imageDirectory);
    assert.equal(existsSync(imageDirectory), true);
  } finally {
    remove.mockRestore(); syncBuiltinESMExports();
    try { owner.close(); } catch { /* already closed */ }
    rmSync(directory, { recursive: true, force: true });
  }
});

it("a nested scope without an owner sees a later commit while the outer image stays", async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "owner-image-nested-copy-"));
  const path = join(directory, "state.db");
  const owner = new DatabaseSync(path);
  const writer = new DatabaseSync(path);
  try {
    owner.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=2000; CREATE TABLE a(g INTEGER); CREATE TABLE b(g INTEGER); INSERT INTO a VALUES(0); INSERT INTO b VALUES(0)");
    writer.exec("PRAGMA busy_timeout=2000");
    const stats = fileStatus(path);
    const imageOwner = { serializeCommittedImage: () => ({ identity: { device: stats.dev, inode: stats.ino }, image: owner.serialize() }) };
    const read = () => readPair(createReadonlyAuthoritySnapshot(path).path).a;
    await withActiveAuthorityObservation(path, imageOwner, async () => {
      const outer = read();
      writer.exec("BEGIN IMMEDIATE; UPDATE a SET g=g+1; UPDATE b SET g=g+1; COMMIT");
      await withActiveAuthorityObservation(path, undefined, async () => { assert.equal(read(), outer + 1); });
      assert.equal(read(), outer);
    });
  } finally {
    try { writer.close(); } catch { /* already closed */ }
    try { owner.close(); } catch { /* already closed */ }
    rmSync(directory, { recursive: true, force: true });
  }
});
