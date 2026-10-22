import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, linkSync, lstatSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import * as childProcesses from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { it, vi } from "vitest";
import { composeStorageCommand } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { assertLiveProfileDatabaseBinding, readProfileDatabaseBinding } from "../../../../src/backend/storage/sqlite/profile-local-databases.js";
import * as readonlySnapshots from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

vi.mock("node:child_process", { spy: true });
const actualSpawn = (await vi.importActual<typeof import("node:child_process")>("node:child_process")).spawnSync;

it("preserves the exact stopped-backup source witness after pending profile initialization", async () => {
  const f = createBoundProfileFixture({ pending: true }), clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  copyFileSync("package.json", join(f.workspace, "package.json"));
  try {
    const input = (args: readonly string[]) => composeStorageCommand(rebuildRuntimeIsolation, args, clock, f.workspace, f.admission);
    assert.equal((await input(["upgrade", "--plan", "--json"])).exitCode, 0);
    assert.equal((await input(["upgrade", "--json"])).exitCode, 0);
    AuthorityDatabase.inspectStoppedUpgrade(f.admission, f.path, join(f.workspace, rebuildRuntimeIsolation.processLockRoot), clock);
    const database = new DatabaseSync(f.path, { readOnly: true });
    try { assert.deepEqual(database.prepare("SELECT * FROM settings").all(), []); }
    finally { database.close(); }
    const witness = () => ["", "-wal", "-shm", "-journal"].map(suffix => {
      const stat = lstatSync(`${f.path}${suffix}`, { throwIfNoEntry: false });
      return stat === undefined ? null : [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs];
    });
    const before = witness();
    assert.equal(readProfileDatabaseBinding(f.path).state, "bound");
    assert.deepEqual(witness(), before);
    const backup = await input(["backup", "--json"]);
    assert.equal(backup.exitCode, 0, backup.output);
    assert.deepEqual(witness(), before);
  } finally { f.close(); }
});

it("refuses a source sidecar change during the shared binding read", () => {
  const f = createBoundProfileFixture(), createSnapshot = readonlySnapshots.createReadonlyAuthoritySnapshot;
  let changed = false;
  const snapshots = vi.spyOn(readonlySnapshots, "createReadonlyAuthoritySnapshot").mockImplementation(path => {
    const snapshot = createSnapshot(path);
    return { ...snapshot, assertUnchanged: () => {
      if (!changed && path === f.path) { changed = true; writeFileSync(`${path}-shm`, "synthetic changed sidecar", { flag: "a", mode: 0o600 }); }
      snapshot.assertUnchanged();
    } };
  });
  try {
    assert.throws(() => readProfileDatabaseBinding(f.path), /authority-readonly-source-changed/u);
    assert.equal(changed, true);
  } finally { snapshots.mockRestore(); f.close(); }
});


it("admits the same genuine profile across a real peer's committed WAL change", async () => {
  const f = createBoundProfileFixture(), ready = join(f.workspace, "writer-ready"), commit = join(f.workspace, "commit"),
    committed = join(f.workspace, "committed"), finish = join(f.workspace, "finish");
  let crossed = false;
  const observer = vi.spyOn(childProcesses, "spawnSync").mockImplementation((command, args, options) => {
    if (Array.isArray(args) && typeof args[2] === "string" && args[2].includes("const [path, expected, schema, application]")) {
      writeFileSync(commit, "commit");
      const deadline = performance.now() + 5_000;
      while (!existsSync(committed)) {
        if (performance.now() > deadline) throw new Error("fixture-peer-commit-not-proved");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
      crossed = true;
    }
    return actualSpawn(command, args, options);
  });
  const writer = spawn(process.execPath, ["--input-type=commonjs", "-e", `
    const { DatabaseSync } = require("node:sqlite");
    const { existsSync, writeFileSync } = require("node:fs");
    const [path, ready, commit, committed, finish] = process.argv.slice(1);
    const db = new DatabaseSync(path);
    db.exec("PRAGMA wal_autocheckpoint=0; SELECT authority_generation FROM database_states");
    writeFileSync(ready, "ready");
    const timer = setInterval(() => {
      if (existsSync(commit) && !existsSync(committed)) {
        db.exec("UPDATE database_states SET authority_generation=authority_generation+1,search_generation=search_generation+1 WHERE id=1");
        writeFileSync(committed, "committed");
      }
      if (existsSync(finish)) { clearInterval(timer); db.close(); }
    }, 5);
  `, f.path, ready, commit, committed, finish], { stdio: ["ignore", "ignore", "pipe"] });
  const exited = new Promise<number | null>((resolve, reject) => { writer.once("exit", resolve); writer.once("error", reject); });
  let output = ""; writer.stderr.on("data", chunk => { output += String(chunk); });
  try {
    const deadline = performance.now() + 5_000;
    while (!existsSync(ready)) {
      if (performance.now() > deadline) throw new Error("fixture-peer-ready-not-proved");
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const baselineDatabase = new DatabaseSync(f.path, { readOnly: true });
    let baseline: number;
    try {
      const generation = baselineDatabase.prepare("SELECT authority_generation AS generation FROM database_states WHERE id=1").get()?.generation;
      assert.equal(typeof generation, "number");
      if (typeof generation !== "number") throw new Error("fixture-generation-required");
      baseline = generation;
    } finally { baselineDatabase.close(); }
    const before = lstatSync(`${f.path}-wal`, { bigint: true });
    const child = f.machine.admitProfile(f.machine.issueRegisteredProfileClaim(f.admission.profileBinding.profileId));
    try { child.assertProfileRuntime(); assert.deepEqual(child.profileBinding, f.admission.profileBinding); }
    finally { child.release(); }
    assert.equal(crossed, true);
    assert.notEqual(lstatSync(`${f.path}-wal`, { bigint: true }).mtimeNs, before.mtimeNs);
    const db = new DatabaseSync(f.path, { readOnly: true });
    try { assert.equal(db.prepare("SELECT authority_generation AS generation FROM database_states WHERE id=1").get()?.generation, baseline + 1); }
    finally { db.close(); }
  } finally {
    observer.mockRestore(); writeFileSync(finish, "finish");
    try { assert.equal(await exited, 0, output); }
    finally { f.close(); }
  }
});

it("keeps a caller's actual SQLite writer lock held across live binding observation", () => {
  const f = createBoundProfileFixture(), db = new DatabaseSync(f.path);
  try {
    db.exec("BEGIN IMMEDIATE");
    assertLiveProfileDatabaseBinding(f.path, f.admission.profileBinding);
    const peer = spawnSync(process.execPath, ["--input-type=commonjs", "-e", `
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(process.argv[1], { timeout: 250 });
      try { db.exec("BEGIN IMMEDIATE"); db.exec("ROLLBACK"); process.stdout.write("acquired"); }
      catch (error) { if (error.errcode !== 5) throw error; process.stdout.write("busy"); }
      finally { db.close(); }
    `, f.path], { encoding: "utf8" });
    assert.equal(peer.status, 0, peer.stderr); assert.equal(peer.stdout, "busy");
  } finally { db.exec("ROLLBACK"); db.close(); f.close(); }
});

it("refuses foreign binding and a noncurrent schema at the live boundary", () => {
  const f = createBoundProfileFixture(), foreign = createBoundProfileFixture();
  try {
    assert.throws(() => assertLiveProfileDatabaseBinding(f.path, foreign.admission.profileBinding), /profile-database-binding-mismatch/u);
    const db = new DatabaseSync(f.path);
    try { db.exec(`PRAGMA user_version=${String(CURRENT_AUTHORITY_SCHEMA_VERSION + 1)}`); }
    finally { db.close(); }
    assert.throws(() => assertLiveProfileDatabaseBinding(f.path, f.admission.profileBinding), /profile-database-schema-mismatch/u);
    const application = new DatabaseSync(f.path);
    try { application.exec(`PRAGMA user_version=${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}; PRAGMA application_id=0`); }
    finally { application.close(); }
    assert.throws(() => assertLiveProfileDatabaseBinding(f.path, f.admission.profileBinding), /profile-database-schema-mismatch/u);
  } finally { foreign.close(); f.close(); }
});

it("refuses a replaced main inode even when its copied binding matches", () => {
  const f = createBoundProfileFixture(), replacement = join(f.stateRoot, "replacement.db");
  copyFileSync(f.path, replacement);
  const observer = vi.spyOn(childProcesses, "spawnSync").mockImplementation((command, args, options) => {
    renameSync(replacement, f.path);
    return actualSpawn(command, args, options);
  });
  try { assert.throws(() => assertLiveProfileDatabaseBinding(f.path, f.admission.profileBinding), /profile-database-identity-changed/u); }
  finally { observer.mockRestore(); f.close(); }
});

it.each(["symlink", "hardlink", "public", "journal"] as const)("refuses unsafe live source companions: %s", kind => {
  const f = createBoundProfileFixture(), companion = `${f.path}${kind === "journal" ? "-journal" : "-wal"}`;
  try {
    rmSync(companion, { force: true });
    if (kind === "symlink") symlinkSync(f.path, companion);
    else if (kind === "hardlink") linkSync(f.path, companion);
    else writeFileSync(companion, "unsafe", { mode: kind === "public" ? 0o666 : 0o600 });
    if (kind === "public") chmodSync(companion, 0o666);
    assert.throws(() => assertLiveProfileDatabaseBinding(f.path, f.admission.profileBinding),
      kind === "journal" ? /authority-readonly-source-journal-unsettled/u : /profile-database-identity-invalid/u);
  } finally { rmSync(companion, { force: true }); f.close(); }
});

it("does not issue runtime children from released machines or unissued claims", () => {
  const f = createBoundProfileFixture(), claim = f.machine.issueRegisteredProfileClaim(f.admission.profileBinding.profileId);
  try {
    assert.throws(() => f.machine.admitProfile({ ...claim }), /profile-storage-claim-unissued/u);
    f.admission.release(); f.machine.release();
    assert.throws(() => f.machine.admitProfile(claim), /runtime-admission: missing or released admission/u);
  } finally { f.close(); }
});


it("refuses a missing canonical live database without recreating it or sidecars", () => {
  const f = createBoundProfileFixture(), binding = f.admission.profileBinding;
  try {
    const companions = () => ["-wal", "-shm", "-journal"].map(suffix => existsSync(`${f.path}${suffix}`)
      ? createHash("sha256").update(readFileSync(`${f.path}${suffix}`)).digest("hex") : null);
    const before = companions();
    rmSync(f.path);
    assert.throws(() => assertLiveProfileDatabaseBinding(f.path, binding), /profile-database-binding-required/u);
    assert.equal(existsSync(f.path), false);
    assert.deepEqual(companions(), before);
  } finally { f.close(); }
});


function committedWalFixture(change: "valid" | "schema" | "application" = "valid") {
  const f = createBoundProfileFixture();
  try {
    const database = new DatabaseSync(f.path);
    let baseline: number;
    try {
      const generation = database.prepare("SELECT authority_generation AS generation FROM database_states WHERE id=1").get()?.generation;
      if (typeof generation !== "number") throw new Error("fixture-generation-required");
      baseline = generation;
    } finally { database.close(); }
    assert.equal(existsSync(`${f.path}-wal`), false);
    assert.equal(existsSync(`${f.path}-shm`), false);
    const main = readFileSync(f.path);
    const writer = spawnSync(process.execPath, ["--input-type=commonjs", "-e", `
      const { DatabaseSync } = require("node:sqlite");
      const [path, change, schema] = process.argv.slice(1);
      const database = new DatabaseSync(path);
      database.exec("PRAGMA wal_autocheckpoint=0; BEGIN IMMEDIATE; UPDATE database_states SET authority_generation=authority_generation+1,search_generation=search_generation+1 WHERE id=1");
      if (change === "schema") database.exec("PRAGMA user_version=" + String(Number(schema) + 1));
      if (change === "application") database.exec("PRAGMA application_id=0");
      database.exec("COMMIT");
      // Preserve committed WAL for recovery by exiting without SQLite close/checkpoint.
      process.exit(0);
    `, f.path, change, String(CURRENT_AUTHORITY_SCHEMA_VERSION)], { encoding: "utf8" });
    assert.equal(writer.signal, null); assert.equal(writer.status, 0, writer.stderr);
    assert.ok(existsSync(`${f.path}-wal`)); assert.ok(existsSync(`${f.path}-shm`));
    assert.ok(readFileSync(f.path).equals(main), "writer checkpointed the main database");
    return { f, baseline, main, wal: readFileSync(`${f.path}-wal`) };
  } catch (error) { f.close(); throw error; }
}

it.each(["zero", "truncated", "magic", "version", "page-size", "checksum"] as const)("refuses private malformed WAL header: %s without changing authoritative bytes", mutation => {
  const { f, main, wal } = committedWalFixture(), companion = `${f.path}-wal`;
  try {
    const damaged = mutation === "zero" ? Buffer.alloc(32) : mutation === "truncated" ? wal.subarray(0, 31) : Buffer.from(wal);
    if (mutation === "magic") damaged.writeUInt32BE(0, 0);
    if (mutation === "version") damaged.writeUInt32BE(0, 4);
    if (mutation === "page-size") damaged.writeUInt32BE(513, 8);
    if (mutation === "checksum") damaged[24] = (damaged[24] ?? 0) ^ 1;
    writeFileSync(companion, damaged);
    const names = ["", "-wal", "-shm", "-journal"];
    const snapshot = () => names.filter(name => existsSync(`${f.path}${name}`)).map(name => ({ name,
      digest: createHash("sha256").update(readFileSync(`${f.path}${name}`)).digest("hex") }));
    const before = snapshot();
    assert.deepEqual(before.map(value => value.name), ["", "-wal", "-shm"]);
    assert.throws(() => assertLiveProfileDatabaseBinding(f.path, f.admission.profileBinding), /profile-database-companion-malformed/u);
    assert.deepEqual(snapshot(), before);
    assert.ok(readFileSync(f.path).equals(main));
  } finally { f.close(); }
});

it.each(["valid", "schema", "application"] as const)("rebuilds private uninitialized SHM and retains authoritative WAL-only state: %s", change => {
  const { f, baseline, main, wal } = committedWalFixture(change);
  try {
    writeFileSync(`${f.path}-shm`, Buffer.alloc(32_768));
    assert.equal(readFileSync(`${f.path}-shm`).every(byte => byte === 0), true);
    if (change === "valid") {
      assertLiveProfileDatabaseBinding(f.path, f.admission.profileBinding);
      const observed = spawnSync(process.execPath, ["--input-type=commonjs", "-e", `
        const { DatabaseSync } = require("node:sqlite");
        const database = new DatabaseSync(process.argv[1], { readOnly: true });
        try { process.stdout.write(String(database.prepare("SELECT authority_generation AS generation FROM database_states WHERE id=1").get().generation)); }
        finally { database.close(); }
      `, f.path], { encoding: "utf8" });
      assert.equal(observed.status, 0, observed.stderr); assert.equal(observed.stdout, String(baseline + 1));
    } else assert.throws(() => assertLiveProfileDatabaseBinding(f.path, f.admission.profileBinding), /profile-database-schema-mismatch/u);
    assert.equal(readFileSync(`${f.path}-shm`).some(byte => byte !== 0), true, "SQLite did not rebuild its private coordination cache");
    assert.ok(readFileSync(f.path).equals(main), "live observer changed authoritative main bytes");
    assert.ok(readFileSync(`${f.path}-wal`).equals(wal), "live observer changed authoritative WAL bytes");
  } finally { f.close(); }
});

it("accepts an empty WAL while preserving authoritative main bytes", () => {
  const f = createBoundProfileFixture();
  try {
    const database = new DatabaseSync(f.path);
    try { database.prepare("SELECT authority_generation FROM database_states WHERE id=1").get(); }
    finally { database.close(); }
    const main = readFileSync(f.path);
    writeFileSync(`${f.path}-wal`, Buffer.alloc(0), { mode: 0o600, flag: "wx" });
    assertLiveProfileDatabaseBinding(f.path, f.admission.profileBinding);
    assert.ok(readFileSync(f.path).equals(main));
    assert.equal(readFileSync(`${f.path}-wal`).length, 0);
  } finally { f.close(); }
});
