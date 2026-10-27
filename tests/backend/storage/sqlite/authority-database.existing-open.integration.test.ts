import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, it, vi } from "vitest";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import { COMMAND_FIXTURES, UUID_1 } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const boundary = vi.hoisted(() => ({
  beforeOpen: undefined as ((location: string | Buffer | URL) => void) | undefined,
  temporaryRoot: undefined as string | undefined,
}));
vi.mock("node:sqlite", async importOriginal => {
  const actual = await importOriginal<typeof import("node:sqlite")>();
  return { ...actual, DatabaseSync: class extends actual.DatabaseSync {
    constructor(...args: ConstructorParameters<typeof actual.DatabaseSync>) {
      boundary.beforeOpen?.(args[0]);
      super(...args);
    }
  } };
});
vi.mock("node:os", async importOriginal => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, tmpdir: () => boundary.temporaryRoot ?? actual.tmpdir() };
});
afterEach(() => { boundary.beforeOpen = undefined; boundary.temporaryRoot = undefined; });

function open(fixture: Awaited<ReturnType<typeof createBoundProfileFixture>>) {
  return AuthorityDatabase.open(fixture.admission, { path: fixture.path, busyTimeoutMs: 250, migrationOwner: "existing-open-test" },
    undefined, undefined, undefined, undefined, boundProfileCredentials(fixture.admission));
}
function assertAbsent(path: string) {
  for (const suffix of ["", "-wal", "-shm"]) assert.equal(existsSync(`${path}${suffix}`), false);
}
function companions(path: string) {
  return ["-wal", "-shm"].map(suffix => {
    const file = `${path}${suffix}`;
    if (!existsSync(file)) return { suffix, captured: undefined };
    const identity = lstatSync(file);
    return { suffix, captured: { identity, bytes: readFileSync(file) } };
  });
}
function assertNoCreation(path: string, before: ReturnType<typeof companions>) {
  assert.equal(existsSync(path), false);
  for (const { suffix, captured } of before) {
    const file = `${path}${suffix}`;
    assert.equal(existsSync(file), captured !== undefined);
    if (captured === undefined) continue;
    const identity = lstatSync(file);
    for (const key of ["dev", "ino", "mode", "nlink", "size"] as const) assert.equal(identity[key], captured.identity[key]);
    assert.equal(readFileSync(file).equals(captured.bytes), true);
  }
}

it("creates a genuine pending profile only through initializeProfile and refuses a second initialization", async () => {
  const f = await createBoundProfileFixture({ pending: true });
  try {
    assertAbsent(f.path);
    assert.throws(() => AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "existing-open-test" }), /profile-bound-authority-required/u);
    AuthorityDatabase.initializeProfile(f.admission);
    assert.equal(existsSync(f.path), true);
    assert.throws(() => AuthorityDatabase.initializeProfile(f.admission), /profile-database-initialization-already-exists/u);
    await f.finish();
    const database = open(f);
    try { assert.equal(database.getMeta().profileId, f.admission.profileBinding.profileId); }
    finally { database.close(); }
  } finally { await f.close(); }
});

it("refuses a removed main database without creating main, WAL or SHM from an already issued ordinary claim", async () => {
  const f = await createBoundProfileFixture();
  try {
    const retainedCompanions = companions(f.path);
    unlinkSync(f.path);
    const before = readdirSync(f.stateRoot).sort();
    assert.throws(() => open(f), /profile-database-binding-required/u);
    assertNoCreation(f.path, retainedCompanions);
    assert.deepEqual(readdirSync(f.stateRoot).sort(), before);
  } finally { await f.close(); }
});

it("uses the native existing-only open when the main disappears after preliminary filesystem checks", async () => {
  const f = await createBoundProfileFixture();
  try {
    const retainedCompanions = companions(f.path);
    const before = readdirSync(f.stateRoot).filter(name => name !== "state.db").sort();
    let crossed = false;
    boundary.beforeOpen = location => {
      const path = location instanceof URL ? fileURLToPath(location) : typeof location === "string" && location.startsWith("file:")
        ? fileURLToPath(location) : location.toString();
      if (path !== f.path) return;
      const uri = new URL(location.toString());
      assert.equal(uri.protocol, "file:");
      assert.deepEqual([...uri.searchParams], [["mode", "rw"]]);
      assert.equal(fileURLToPath(uri), f.path);
      boundary.beforeOpen = undefined;
      crossed = true;
      unlinkSync(f.path);
    };
    assert.throws(() => open(f), error => error instanceof Error && "code" in error && error.code === "ERR_SQLITE_ERROR"
      && "errcode" in error && error.errcode === 14);
    assert.equal(crossed, true);
    assertNoCreation(f.path, retainedCompanions);
    assert.deepEqual(readdirSync(f.stateRoot).sort(), before);
  } finally { boundary.beforeOpen = undefined; await f.close(); }
});

it("keeps existing writable WAL and canonical binding at a URI-sensitive filesystem path", async () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "authority-uri-")));
  const special = join(parent, "literal % ? #");
  mkdirSync(special, { mode: 0o700 });
  boundary.temporaryRoot = special;
  let f: Awaited<ReturnType<typeof createBoundProfileFixture>> | undefined;
  try {
    f = await createBoundProfileFixture();
    boundary.temporaryRoot = undefined;
    assert.ok(f.path.startsWith(`${special}/`));
    const database = open(f);
    const generation = database.getMeta().authorityGeneration;
    try {
      database.authority.commands.insert(COMMAND_FIXTURES[0]);
      assert.equal(database.getMeta().authorityGeneration, generation + 1);
      assert.equal(database.inspectSchema().pragmas.journalMode, "wal");
      assert.equal(existsSync(`${f.path}-wal`), true);
      const second = open(f);
      try {
        assert.deepEqual(second.authority.commands.get(UUID_1), COMMAND_FIXTURES[0]);
        assert.equal(second.getMeta().profileId, f.admission.profileBinding.profileId);
        assert.equal(second.getMeta().authorityGeneration, generation + 1);
      } finally { second.close(); }
    } finally { database.close(); }
    const reopened = open(f);
    try { assert.deepEqual(reopened.authority.commands.get(UUID_1), COMMAND_FIXTURES[0]); }
    finally { reopened.close(); }
  } finally { boundary.temporaryRoot = undefined; await f?.close(); rmSync(parent, { recursive: true, force: true }); }
});
