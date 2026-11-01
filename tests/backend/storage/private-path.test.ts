import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { it, vi } from "vitest";
import { fsyncPath, privatePathRejects, replacePrivateFile, writePrivateStage, type PrivacyRule } from "../../../src/backend/storage/private-path.js";
import { AuthoritySourceClosureUnprovedError } from "../../../src/backend/storage/source-closure.js";

function stat(mode: number, uid: number | bigint = process.getuid?.() ?? 1000, symlink = false) {
  return { mode, uid, dev: 1, ino: 1, isSymbolicLink: () => symlink };
}

const rules: readonly PrivacyRule[] = ["owner", "ancestor", "group-write", "directory-0700", "file-0600", "file-0400", "private", "private-read-write", "owner-write-only"];

it("accepts root-owned readable ancestors and sticky shared temporary directories", () => {
  assert.equal(privatePathRejects("/fixture", stat(0o755, 0), "ancestor"), false);
  assert.equal(privatePathRejects("/fixture", stat(0o1777, 0), "ancestor"), false);
  assert.equal(privatePathRejects("/fixture", stat(0o777, 0), "ancestor"), true);
  assert.equal(privatePathRejects("/fixture", stat(0o755, (process.getuid?.() ?? 1000) + 1), "ancestor"), true);
});

it("keeps readable managed data distinct from exact private leaves", () => {
  assert.equal(privatePathRejects("/fixture", stat(0o644), "group-write"), false);
  assert.equal(privatePathRejects("/fixture", stat(0o664), "group-write"), true);
  assert.equal(privatePathRejects("/fixture", stat(0o600), "file-0600"), false);
  assert.equal(privatePathRejects("/fixture", stat(0o644), "file-0600"), true);
  assert.equal(privatePathRejects("/fixture", stat(0o4600), "file-0600"), true);
  assert.equal(privatePathRejects("/fixture", stat(0o700), "directory-0700"), false);
  assert.equal(privatePathRejects("/fixture", stat(0o1700), "directory-0700"), true);
  assert.equal(privatePathRejects("/fixture", stat(0o755), "directory-0700"), true);
  assert.equal(privatePathRejects("/fixture", stat(0o755), "owner-write-only"), false);
  assert.equal(privatePathRejects("/fixture", stat(0o555), "owner-write-only"), true);
  assert.equal(privatePathRejects("/fixture", stat(0o775), "owner-write-only"), true);
  assert.equal(privatePathRejects("/fixture", stat(0o777), "owner"), false);
  assert.equal(privatePathRejects("/fixture", stat(0o400), "file-0400"), false);
  assert.equal(privatePathRejects("/fixture", stat(0o600), "file-0400"), true);
  assert.equal(privatePathRejects("/fixture", stat(0o400), "private"), false);
  assert.equal(privatePathRejects("/fixture", stat(0o640), "private"), true);
  assert.equal(privatePathRejects("/fixture", stat(0o600), "private-read-write"), false);
  assert.equal(privatePathRejects("/fixture", stat(0o700), "private-read-write"), false);
  assert.equal(privatePathRejects("/fixture", stat(0o400), "private-read-write"), true);
  assert.equal(privatePathRejects("/fixture", stat(0o660), "private-read-write"), true);
});

it("stages exclusively and replaces exact bytes while retaining unknown files", () => {
  const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "private-stage-"));
  const stage = join(root, "stage"), target = join(root, "target"), unknown = join(root, "unknown");
  try {
    fs.writeFileSync(target, "old bytes", { mode: 0o600 });
    fs.writeFileSync(unknown, "retain", { mode: 0o600 });
    writePrivateStage(stage, Buffer.from("new bytes"));
    assert.equal(fs.statSync(stage).mode & 0o7777, 0o600);
    assert.throws(() => writePrivateStage(stage, Buffer.from("overwrite")), (error: NodeJS.ErrnoException) => error.code === "EEXIST");
    assert.equal(fs.readFileSync(stage, "utf8"), "new bytes");
    assert.equal(fs.readFileSync(target, "utf8"), "old bytes");
    replacePrivateFile(stage, target);
    fsyncPath(root);
    assert.equal(fs.existsSync(stage), false);
    assert.equal(fs.readFileSync(target, "utf8"), "new bytes");
    assert.equal(fs.readFileSync(unknown, "utf8"), "retain");
  } finally { fs.rmSync(root, { recursive: true }); }
});

it("preserves the target when replacement refuses a missing stage", () => {
  const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "private-replace-")), target = join(root, "target");
  try {
    fs.writeFileSync(target, "old bytes", { mode: 0o600 });
    assert.throws(() => replacePrivateFile(join(root, "absent"), target), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
    assert.equal(fs.readFileSync(target, "utf8"), "old bytes");
  } finally { fs.rmSync(root, { recursive: true }); }
});

it("retains a flush descriptor and both errors when its close is unproved", () => {
  const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "private-flush-")), path = join(root, "file");
  const close = fs.closeSync, opened: number[] = [];
  const flushFailure = new Error("flush failed"), closeFailure = new Error("close unproved");
  fs.writeFileSync(path, "retained bytes", { mode: 0o600 });
  try {
    vi.spyOn(fs, "fsyncSync").mockImplementation(() => { throw flushFailure; });
    vi.spyOn(fs, "closeSync").mockImplementation(descriptor => { opened.push(descriptor); throw closeFailure; });
    syncBuiltinESMExports();
    assert.throws(() => fsyncPath(path), error => {
      assert.ok(error instanceof AuthoritySourceClosureUnprovedError);
      assert.deepEqual(error.errors, [flushFailure, closeFailure]);
      return true;
    });
    assert.equal(opened.length, 1);
    assert.equal(fs.readFileSync(path, "utf8"), "retained bytes");
  } finally {
    vi.restoreAllMocks(); syncBuiltinESMExports();
    for (const descriptor of opened) close(descriptor);
    fs.rmSync(root, { recursive: true });
  }
});

for (const rule of rules) {
  it(`refuses links and foreign owners for ${rule}`, () => {
    const mode = rule === "file-0400" ? 0o400 : rule === "file-0600" ? 0o600 : 0o700;
    assert.equal(privatePathRejects("/fixture", stat(mode, process.getuid?.() ?? 1000, true), rule), true);
    assert.equal(privatePathRejects("/fixture", stat(mode, (process.getuid?.() ?? 1000) + 1), rule), true);
  });
}

it("checks bigint metadata without narrowing owner identity", () => {
  const uid = BigInt(process.getuid?.() ?? 1000);
  assert.equal(privatePathRejects("/fixture", { mode: 0o600n, dev: 1n, ino: 1n, uid, isSymbolicLink: () => false }, "file-0600"), false);
  assert.equal(privatePathRejects("/fixture", { mode: 0o600n, dev: 1n, ino: 1n, uid: (1n << 64n) + uid, isSymbolicLink: () => false }, "file-0600"), true);
});

it("executes the same privacy policy in a descriptor observer without module dependencies", () => {
  for (const [uid, expected] of [[501, false], [502, true]] as const) {
    const observed: unknown = runInNewContext(`(${privatePathRejects.toString()})("/fixture", {
      mode: 0o600, uid: ${String(uid)}, dev: 1, ino: 1, isSymbolicLink() { return false; }
    }, "file-0600")`, { process: { getuid: () => 501 } });
    assert.equal(observed, expected);
  }
});

it("refuses unavailable ownership evidence", () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "getuid");
  try {
    Object.defineProperty(process, "getuid", { configurable: true, value: undefined });
    for (const rule of rules) assert.equal(privatePathRejects("/fixture", stat(0o600), rule), true);
  } finally {
    if (descriptor === undefined) delete process.getuid;
    else Object.defineProperty(process, "getuid", descriptor);
  }
});
