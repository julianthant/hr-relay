import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from "../../../../src/backend/storage/source-closure.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, vi } from "vitest";
import { readPrivateFile, withPrivateFileLock, type PrivateFileLock } from "../../../../src/backend/storage/configuration/credential-safe-file.js";

for (const label of ["authority database", "managed data"] as const) {
  it(`reads retained 0644 ${label} bytes without changing mode or identity`, () => {
    const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "safe-file-")), path = join(root, "retained");
    try {
      fs.writeFileSync(path, "retained bytes", { mode: 0o600 }); fs.chmodSync(path, 0o644);
      const before = fs.statSync(path), value = readPrivateFile(path, { label, maxBytes: 64 });
      assert.ok(value); assert.equal(value.bytes.toString(), "retained bytes");
      assert.deepEqual(value.identity, { device: before.dev, inode: before.ino });
      assert.equal(value.stat.mode, before.mode);
      assert.equal(fs.statSync(path).mode, before.mode); assert.equal(fs.statSync(path).ino, before.ino);
    } finally { fs.rmSync(root, { recursive: true }); }
  });

  for (const unsafe of ["writable", "symlink", "hardlink", "foreign-owner", "foreign-descriptor-owner"] as const) {
    it(`refuses ${unsafe} ${label} without changing its source bytes`, () => {
      const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "safe-file-")), source = join(root, "retained"), alias = join(root, "alias");
      fs.writeFileSync(source, "retained bytes", { mode: 0o600 }); fs.chmodSync(source, 0o644);
      const before = fs.statSync(source);
      let path = source;
      if (unsafe === "writable") fs.chmodSync(source, 0o664);
      if (unsafe === "symlink") { fs.symlinkSync(source, alias); path = alias; }
      if (unsafe === "hardlink") fs.linkSync(source, alias);
      const lstat = fs.lstatSync, fstat = fs.fstatSync;
      if (unsafe === "foreign-owner") vi.spyOn(fs, "lstatSync").mockImplementation((target, options) => {
        const status = lstat(target, options);
        if (status !== undefined && target === source) status.uid = (process.getuid?.() ?? 1000) + 1;
        return status;
      });
      if (unsafe === "foreign-descriptor-owner") vi.spyOn(fs, "fstatSync").mockImplementation((descriptor, options) => {
        const status = fstat(descriptor, options); status.uid = (process.getuid?.() ?? 1000) + 1; return status;
      });
      syncBuiltinESMExports();
      try {
        assert.throws(() => readPrivateFile(path, { label, maxBytes: 64 }), /permissions or identity/u);
        assert.equal(fs.readFileSync(source, "utf8"), "retained bytes");
        assert.equal(fs.statSync(source).ino, before.ino);
        assert.equal(fs.statSync(source).mode & 0o7777, unsafe === "writable" ? 0o664 : 0o644);
      } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); fs.rmSync(root, { recursive: true }); }
    });
  }
}

for (const label of ["protected.json", "lock", "ChatGPT", "Duo credential", "erasure journal"] as const) {
  it(`keeps ${label} strict 0600 despite ordinary-data support`, () => {
    const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "safe-file-")), path = join(root, "private");
    try {
      fs.writeFileSync(path, "private fixture", { mode: 0o600 });
      assert.equal(readPrivateFile(path, { label, maxBytes: 64 })?.bytes.toString(), "private fixture");
      fs.chmodSync(path, 0o644);
      assert.throws(() => readPrivateFile(path, { label, maxBytes: 64 }), /permissions|private regular file/u);
      assert.equal(fs.statSync(path).mode & 0o7777, 0o644);
    } finally { fs.rmSync(root, { recursive: true }); }
  });
}

it("retains distinct synchronous locks and expires the exact held witness", () => {
  const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "safe-lock-"));
  let retained: PrivateFileLock | undefined;
  try {
    fs.chmodSync(root, 0o700);
    withPrivateFileLock(root, ".profile-ops.lock", outer => {
      retained = outer;
      outer.assertHeld();
      const record: unknown = JSON.parse(fs.readFileSync(join(root, ".profile-ops.lock"), "utf8"));
      assert.deepEqual(Object.keys(record ?? {}), ["nonce"]);
      withPrivateFileLock(root, ".profile-registry.lock", inner => { outer.assertHeld(); inner.assertHeld(); });
      assert.equal(fs.existsSync(join(root, ".profile-registry.lock")), false);
      outer.assertHeld();
    });
    assert.ok(retained);
    const expired = retained;
    assert.throws(() => expired.assertHeld(), /operation has ended/u);
    assert.deepEqual(fs.readdirSync(root), []);
  } finally { fs.rmSync(root, { recursive: true }); }
});

it("refuses an exact-byte replacement before entering a private mutex", () => {
  const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "safe-lock-identity-"));
  const path = join(root, ".installation-mutation.lock"), original = join(root, "retained-original");
  const open = fs.openSync, close = fs.closeSync;
  let descriptor: number | undefined, replaced = false, entered = 0;
  try {
    fs.chmodSync(root, 0o700);
    vi.spyOn(fs, "openSync").mockImplementation((target, flags, mode) => {
      const fd = open(target, flags, mode);
      if (target === path && typeof flags === "number" && (flags & fs.constants.O_EXCL) !== 0) descriptor = fd;
      return fd;
    });
    vi.spyOn(fs, "closeSync").mockImplementation(fd => {
      close(fd);
      if (fd === descriptor && !replaced) {
        replaced = true;
        fs.renameSync(path, original);
        fs.writeFileSync(path, fs.readFileSync(original), { mode: 0o600, flag: "wx" });
      }
    });
    syncBuiltinESMExports();
    assert.throws(() => withPrivateFileLock(root, ".installation-mutation.lock", () => { entered++; }), error => {
      assert.ok(error instanceof AggregateError);
      const primary: unknown = error.errors[0]; assert.ok(primary instanceof Error);
      assert.match(String(primary.cause), /identity changed after creation/u);
      assert.match(String(error.errors[1]), /changed during cleanup/u);
      return true;
    });
    assert.equal(replaced, true); assert.equal(entered, 0);
    assert.deepEqual(fs.readFileSync(path), fs.readFileSync(original));
    assert.notEqual(fs.statSync(path).ino, fs.statSync(original).ino);
    assert.equal(fs.statSync(path).mode & 0o777, 0o600);
  } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); fs.rmSync(root, { recursive: true }); }
});

it("retains primary failure and refuses to remove a replaced private mutex", () => {
  const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "safe-lock-"));
  const path = join(root, ".installation-mutation.lock"), primary = new Error("primary operation failure");
  try {
    fs.chmodSync(root, 0o700);
    assert.throws(() => withPrivateFileLock(root, ".installation-mutation.lock", () => {
      fs.renameSync(path, join(root, "retained-original"));
      fs.writeFileSync(path, "replacement", { mode: 0o600, flag: "wx" });
      throw primary;
    }), error => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors[0], primary);
      assert.match(String(error.errors[1]), /private lock changed/u);
      return true;
    });
    assert.equal(fs.readFileSync(path, "utf8"), "replacement");
    assert.equal(fs.existsSync(join(root, "retained-original")), true);
  } finally { fs.rmSync(root, { recursive: true }); }
});

for (const stage of ["unproved-close", "proved-close-and-cleanup-failure"] as const) it(`retains private mutex preparation custody after ${stage}`, () => {
  const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "safe-lock-preparation-"));
  fs.chmodSync(root, 0o700);
  const path = join(root, ".installation-mutation.lock"), primaryError = new Error("mutex preparation failure"), cleanupError = new Error("mutex cleanup failure");
  const open = fs.openSync, close = fs.closeSync, sync = fs.fsyncSync, unlink = fs.unlinkSync;
  let descriptor: number | undefined, identity: ReturnType<typeof fs.fstatSync> | undefined;
  let descriptorClosed = false, closes = 0, entered = 0;
  let primary: { error: unknown } | undefined;
  try {
    vi.spyOn(fs, "openSync").mockImplementation((target, flags, mode) => {
      const fd = open(target, flags, mode);
      if (target === path && typeof flags === "number" && (flags & fs.constants.O_EXCL) !== 0) {
        descriptor = fd; identity = fs.fstatSync(fd);
      }
      return fd;
    });
    vi.spyOn(fs, "fsyncSync").mockImplementation(fd => {
      if (fd === descriptor && stage === "proved-close-and-cleanup-failure") throw primaryError;
      sync(fd);
    });
    vi.spyOn(fs, "closeSync").mockImplementation(fd => {
      if (fd === descriptor && !descriptorClosed) {
        closes++;
        if (stage === "unproved-close") throw primaryError;
        close(fd); descriptorClosed = true; return;
      }
      close(fd);
    });
    vi.spyOn(fs, "unlinkSync").mockImplementation(target => {
      if (target === path && stage === "proved-close-and-cleanup-failure") throw cleanupError;
      unlink(target);
    });
    syncBuiltinESMExports();
    assert.throws(() => withPrivateFileLock(root, ".installation-mutation.lock", () => { entered++; }), error => {
      assert.ok(error instanceof AggregateError);
      if (stage === "unproved-close") {
        assert.ok(error instanceof AuthoritySourceClosureUnprovedError);
        assert.equal(error.errors[0], primaryError);
      } else {
        assert.equal(error instanceof AuthoritySourceClosureUnprovedError, false);
        const cause: unknown = error.errors[0]; assert.ok(cause instanceof Error);
        assert.equal(cause.cause, primaryError); assert.equal(error.errors[1], cleanupError);
      }
      return true;
    });
    assert.equal(entered, 0); assert.equal(closes, 1);
    assert.ok(descriptor !== undefined && identity !== undefined);
    const live = fs.lstatSync(path);
    assert.deepEqual([live.dev, live.ino, live.mode & 0o777], [identity.dev, identity.ino, 0o600]);
    const record: unknown = JSON.parse(fs.readFileSync(path, "utf8"));
    assert.deepEqual(Object.keys(record ?? {}), ["nonce"]);
    if (stage === "unproved-close") {
      assert.equal(descriptorClosed, false);
      assert.equal(fs.fstatSync(descriptor).ino, identity.ino);
    } else {
      assert.equal(descriptorClosed, true);
      const fd = descriptor;
      assert.throws(() => fs.fstatSync(fd), (error: unknown) => error instanceof Error && "code" in error && error.code === "EBADF");
    }
  } catch (error) { primary = { error }; }
  vi.restoreAllMocks(); syncBuiltinESMExports();
  if (descriptor !== undefined && !descriptorClosed) {
    try { close(descriptor); descriptorClosed = true; }
    catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error],
      { descriptor: { descriptor, ...(identity === undefined ? {} : { identity }) }, directory: { path: root } }); }
  }
  try { fs.rmSync(root, { recursive: true }); }
  catch (error) {
    if (primary !== undefined) throw new AggregateError([primary.error, error], "private mutex fixture cleanup failed", { cause: error });
    throw error;
  }
  if (primary !== undefined) throw primary.error;
});
