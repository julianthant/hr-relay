import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, readFileSync, renameSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { composeProfileRuntime, composeSelectedProfileStorage, initializeRegisteredPersonStores } from "../../../../src/backend/app/composition/storage-compose.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { AuthorityDatabase, AuthoritySchemaVersionError } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { readStartupFile } from "../../../../src/backend/storage/sqlite/startup-file-proof.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { testProcessImport } from "../../../support/compiled-process.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { runRecordOf } from "../../../support/helpers/backend/dashboard-harness.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function scansRuns(work: () => void): boolean {
  const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
  try {
    work();
    return prepare.mock.calls.some(([sql]) => sql === "SELECT * FROM runs ORDER BY id");
  } finally { prepare.mockRestore(); }
}

async function store() {
  const profile = await createBoundProfileFixture();
  cleanups.push(() => profile.close());
  const open = () => AuthorityDatabase.open(profile.admission, {
    path: profile.path, busyTimeoutMs: 250, migrationOwner: "startup-checkpoint",
  }, undefined, undefined, undefined, undefined, boundProfileCredentials(profile.admission));
  const run = runRecordOf({ seed: 1, workflow: "person-lookup" });
  const writer = open();
  try {
    writer.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    writer.authority.runs.enqueue(run);
  } finally { writer.close(); }
  const reopen = () => {
    const db = open();
    try { expect(db.authority.runs.get(run.envelope.runId)?.envelope.runId).toBe(run.envelope.runId); }
    finally { db.close(); }
  };
  const edit = (sql: string) => {
    const raw = new DatabaseSync(profile.path);
    try { raw.exec(sql); } finally { raw.close(); }
  };
  return { open, reopen, edit, profile };
}

it("checks the writer's changed rows and skips already checked rows on the first and subsequent reopens", async () => {
  const f = await store();
  const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
  try {
    const db = f.open();
    try {
      const sql = prepare.mock.calls.map(([statement]) => statement);
      expect(sql).toContain("SELECT * FROM runs WHERE id=?");
      expect(sql).not.toContain("SELECT * FROM runs ORDER BY id");
    } finally { db.close(); }
  } finally { prepare.mockRestore(); }
  expect(scansRuns(f.reopen)).toBe(false);
});

it.each([
  ["an outside commit", "UPDATE runs SET id=id"],
  ["a change-log gap", "DELETE FROM authority_changes WHERE seq=(SELECT max(seq) FROM authority_changes)"],
  ["a schema cookie change", "CREATE TABLE transient_scope(id); DROP TABLE transient_scope"],
])("falls back to full inspection after %s", async (_reason, sql) => {
  const f = await store();
  f.reopen();
  expect(scansRuns(f.reopen)).toBe(false);
  f.edit(sql);
  expect(scansRuns(f.reopen)).toBe(true);
});

it("fully inspects a byte-identical replacement file", async () => {
  const f = await store();
  f.reopen();
  expect(scansRuns(f.reopen)).toBe(false);
  copyFileSync(f.profile.path, f.profile.path + ".copy");
  renameSync(f.profile.path + ".copy", f.profile.path);
  expect(scansRuns(f.reopen)).toBe(true);
});

it("requires full inspection while the previous writer has not proved close", async () => {
  const f = await store();
  f.reopen();
  const writer = f.open();
  try { expect(scansRuns(f.reopen)).toBe(true); }
  finally { writer.close(); }
  expect(scansRuns(f.reopen)).toBe(false);
});

it("closes after an attestation failure and fully inspects the next open", async () => {
  const f = await store();
  f.reopen();
  expect(scansRuns(f.reopen)).toBe(false);
  const writer = f.open();
  const serialize = vi.spyOn(DatabaseSync.prototype, "serialize").mockImplementation(() => { throw new Error("injected image read failure"); });
  try { writer.close(); } finally { serialize.mockRestore(); }
  expect(scansRuns(f.reopen)).toBe(true);
});

it("does not certify an outside commit made while the writable owner is open", async () => {
  const f = await store();
  f.reopen();
  expect(scansRuns(f.reopen)).toBe(false);
  const writer = f.open();
  try {
    f.edit("UPDATE runs SET id=id");
    writer.authority.runs.enqueue(runRecordOf({ seed: 2 }));
  } finally { writer.close(); }
  expect(scansRuns(f.reopen)).toBe(true);
});

it.each(["clean close", "crash before close"] as const)("starts a fresh validator with a full inspection after %s", async end => {
  const f = await store();
  const { profileId } = f.profile.admission.profileBinding;
  await f.profile.closeController();
  const child = (action: string) => spawnSync(process.execPath, ["--import", testProcessImport(), "--input-type=module", "-e", `
    import { DatabaseSync } from "node:sqlite";
    import { join } from "node:path";
    import { acquireEntrypointAdmission } from "./src/backend/storage/admission/bootstrap-admission.ts";
    import { RuntimeLifetimeLock } from "./src/backend/storage/admission/lifetime-lock.ts";
    import { AuthorityDatabase } from "./src/backend/storage/sqlite/authority-database.ts";
    import { FakeKeyringEntry } from "./tests/support/helpers/credential-keychain-fake.ts";
    import { Entry } from "@napi-rs/keyring";
    if (Entry !== FakeKeyringEntry) throw new Error("synthetic keychain required");
    const [, workspace, id, action] = process.argv;
    const lifetime = await RuntimeLifetimeLock.acquire(0);
    const machine = acquireEntrypointAdmission(workspace, "exclusive", lifetime);
    const profile = machine.admitProfile(id);
    const open = () => AuthorityDatabase.open(profile, { path: join(profile.stateRoot, "state.db"),
      busyTimeoutMs: 250, migrationOwner: "checkpoint-process" });
    let scans = 0;
    const prepare = DatabaseSync.prototype.prepare;
    DatabaseSync.prototype.prepare = function(sql) {
      if (sql === "SELECT * FROM runs ORDER BY id") scans++;
      return prepare.call(this, sql);
    };
    open().close();
    if (scans === 0) throw new Error("fresh validator reused prior proof");
    scans = 0;
    const db = open();
    if (scans !== 0) throw new Error("second open repeated full inspection");
    if (action === "crash before close") process.exit(79);
    db.close();
    profile.release(); machine.release(); await lifetime.close();
  `, f.profile.workspace, profileId, action], { encoding: "utf8" });
  const first = child(end);
  expect(first.status, first.stderr).toBe(end === "clean close" ? 0 : 79);
  const restart = child("clean close");
  expect(restart.status, restart.stderr).toBe(0);
});

it("carries the registered startup inspection through the second startup pass and first writable open", async () => {
  const f = await store();
  const { profileId } = f.profile.admission.profileBinding;
  await f.profile.closeController();
  const lifetime = await RuntimeLifetimeLock.acquire(0);
  cleanups.push(() => lifetime.close());
  const inspect = () => {
    const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.profile.workspace, lifetime);
    try { return AuthorityDatabase.inspectRegisteredPersonAtStartup(machine, profileId); }
    finally { machine.release(); }
  };
  const first = inspect();
  expect(scansRuns(() => expect(inspect()).toEqual(first))).toBe(false);
  const machine = acquireEntrypointAdmission(f.profile.workspace, "exclusive", lifetime);
  try {
    const profile = machine.admitProfile(profileId);
    try {
      expect(scansRuns(() => AuthorityDatabase.open(profile, { path: f.profile.path, busyTimeoutMs: 250,
        migrationOwner: "startup-resume" }).close())).toBe(false);
      expect(scansRuns(() => AuthorityDatabase.inspectExistingReadOnly(profile, f.profile.path))).toBe(true);
    } finally { profile.release(); }
  } finally { machine.release(); }
});

it("carries inspection through production startup recovery and checks the recovered rows on first Resume", async () => {
  const f = await createBoundProfileFixture();
  cleanups.push(() => f.close());
  const { profileId } = f.admission.profileBinding;
  const clock = manualClock(new Date("2026-11-01T20:00:00Z"));
  const hostFacts = { primaryDisplay: null };
  const initial = composeSelectedProfileStorage({ machineAdmission: f.machine, admission: f.admission,
    credentials: boundProfileCredentials(f.admission), hostFacts, clock });
  const run = runRecordOf({ seed: 1 });
  try {
    const config = initial.database.authority.runtimeConfig.get();
    if (config === undefined) throw new Error("fixture runtime config missing");
    initial.database.authority.runs.enqueue({ ...run, envelope: { ...run.envelope,
      configSnapshotId: config.configSnapshotId, configFingerprint: config.configFingerprint } });
  } finally { await initial.account.close(); initial.database.close(); }
  await f.closeController();
  const lifetime = await RuntimeLifetimeLock.acquire(0);
  cleanups.push(() => lifetime.close());
  const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
  const fullScan = "SELECT * FROM runs ORDER BY id";
  const openRecovery = AuthorityDatabase.openStoppedStartupRecovery.bind(AuthorityDatabase);
  const recoveryScans: boolean[] = [];
  vi.spyOn(AuthorityDatabase, "openStoppedStartupRecovery").mockImplementation((...args) => {
    const start = prepare.mock.calls.length;
    const db = openRecovery(...args);
    recoveryScans.push(prepare.mock.calls.slice(start).some(([sql]) => sql === fullScan));
    return db;
  });
  await initializeRegisteredPersonStores(f.workspace, lifetime, hostFacts, clock);
  expect(recoveryScans).toEqual([false]);
  prepare.mockClear();
  const machine = acquireEntrypointAdmission(f.workspace, "shared", lifetime);
  const runtime = composeProfileRuntime({ admission: machine, clock, hostFacts });
  try {
    const active = runtime.session.resumeSignedInProfile({ at: clock.now().toISOString() });
    expect(active).toMatchObject({ state: "active", profileId });
    if (active.state !== "active") throw new Error("fixture Resume refused");
    const db = runtime.selectedContext(active.token).database;
    const statements = prepare.mock.calls.map(([sql]) => sql);
    expect(statements).toContain("SELECT seq,table_name,row_key,op,keys_json FROM authority_changes WHERE seq>? ORDER BY seq LIMIT ?");
    expect(statements).not.toContain(fullScan);
    expect(db.authority.runs.get(run.envelope.runId)?.lifecycle).toMatchObject({ state: "terminal", outcome: "cancelled" });
  } finally { await runtime.close("shutdown"); machine.release(); }
});

it("reuses the inspection after an identical rewrite and fully inspects a byte appended beyond the database pages", async () => {
  const f = await store();
  f.reopen();
  expect(scansRuns(f.reopen)).toBe(false);
  writeFileSync(f.profile.path, readFileSync(f.profile.path));
  expect(scansRuns(f.reopen)).toBe(false);
  appendFileSync(f.profile.path, Buffer.from([1]));
  expect(scansRuns(f.reopen)).toBe(true);
});

it("reuses identical WAL bytes with a new timestamp and fully inspects a changed WAL", async () => {
  const f = await store();
  const reader = new DatabaseSync(f.profile.path);
  try {
    reader.exec("BEGIN; SELECT count(*) FROM runs");
    const writer = f.open();
    try { writer.authority.runs.enqueue(runRecordOf({ seed: 2 })); }
    finally { writer.close(); }
    const wal = f.profile.path + "-wal";
    const before = statSync(wal);
    utimesSync(wal, before.atime, new Date(before.mtimeMs + 10_000));
    expect(statSync(wal).mtimeMs).toBeGreaterThan(before.mtimeMs);
    expect(scansRuns(f.reopen)).toBe(false);
    f.edit("UPDATE runs SET id=id");
    expect(scansRuns(f.reopen)).toBe(true);
  } finally { reader.close(); }
});

it.each(["", "-wal"])("digests every byte of the physical file with suffix '%s'", async suffix => {
  const f = await store();
  const path = f.profile.path + ".digest-fixture";
  const main = Buffer.alloc(140_000, 1), wal = Buffer.alloc(80_000, 2);
  writeFileSync(path, main, { mode: 0o600 });
  writeFileSync(path + "-wal", wal, { mode: 0o600 });
  const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  expect(readStartupFile(path)).toMatchObject({ main: hash(main), wal: hash(wal) });
  const bytes = suffix === "" ? main : wal;
  bytes[bytes.length - 1] ^= 1;
  writeFileSync(path + suffix, bytes);
  expect(readStartupFile(path)).toMatchObject({ main: hash(main), wal: hash(wal) });
});

it("accepts the committed SQLite WAL and rejects a damaged frame or index on a private copy", async () => {
  const f = await store();
  const writer = f.open();
  const copy = f.profile.path + ".wal-check";
  try {
    writer.authority.runs.enqueue(runRecordOf({ seed: 2 }));
    const copied = spawnSync(process.execPath, ["-e", `
      const { copyFileSync } = require("node:fs");
      for (const suffix of ["", "-wal", "-shm"]) copyFileSync(process.argv[1] + suffix, process.argv[2] + suffix);
    `, f.profile.path, copy], { encoding: "utf8" });
    expect(copied.status, copied.stderr).toBe(0);
  } finally { writer.close(); }
  const wal = readFileSync(copy + "-wal");
  expect(readStartupFile(copy, wal.length)).toBeDefined();
  expect(readStartupFile(copy, wal.length - 1)).toBeUndefined();
  const damaged = Buffer.from(wal);
  damaged[damaged.length - 1] ^= 1;
  writeFileSync(copy + "-wal", damaged);
  expect(readStartupFile(copy, wal.length)).toBeUndefined();
  writeFileSync(copy + "-wal", wal);
  const index = readFileSync(copy + "-shm");
  index[48] ^= 1;
  writeFileSync(copy + "-shm", index);
  expect(readStartupFile(copy, wal.length)).toBeUndefined();
});

it("refuses unsupported user_version even with an otherwise valid checkpoint", async () => {
  const f = await store();
  f.reopen();
  expect(scansRuns(f.reopen)).toBe(false);
  f.edit("PRAGMA user_version=65535");
  expect(f.open).toThrow(AuthoritySchemaVersionError);
});

it("runs the full check when the attested writer's suffix has a missing entry", async () => {
  const f = await store();
  const observe = vi.spyOn(DatabaseSync.prototype, "prepare");
  const writer = f.open();
  try {
    const native = observe.mock.contexts.find((db): db is DatabaseSync => db instanceof DatabaseSync && db.location() === f.profile.path);
    if (native === undefined) throw new Error("fixture-writer-handle-missing");
    observe.mockRestore();
    writer.withAuthorityTransaction(() => {
      writer.authority.runs.enqueue(runRecordOf({ seed: 2 }));
      native.exec("DELETE FROM authority_changes WHERE seq=(SELECT max(seq) FROM authority_changes)");
    });
  } finally { observe.mockRestore(); writer.close(); }
  const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
  try {
    f.reopen();
    const sql = prepare.mock.calls.map(([statement]) => statement);
    expect(sql).toContain("SELECT seq,table_name,row_key,op,keys_json FROM authority_changes WHERE seq>? ORDER BY seq LIMIT ?");
    expect(sql).toContain("SELECT * FROM runs ORDER BY id");
  } finally { prepare.mockRestore(); }
});
