import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from "../../../../src/backend/storage/source-closure.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, vi } from "vitest";
import { clearOperationProofSlots, revalidateOperationProof, outermostOperationProof, withOperationProof, readPrivateFile, PrivateFileReadTransitionError, removeExactPath, unpublishedDraftAbortMembership, withPrivateFileLock, type PrivateFileLock } from "../../../../src/backend/storage/configuration/credential-safe-file.js";

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

for (const label of ["protected.json", "lock"] as const) for (const change of ["mode", "uid", "nlink"] as const) {
  it(`refuses ${label} ${change} changed after the descriptor read`, () => {
    const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "safe-post-read-")), path = join(root, "private");
    fs.writeFileSync(path, "private fixture", { mode: 0o600 });
    const read = fs.readFileSync, lstat = fs.lstatSync;
    let descriptorRead = false, changed = false;
    vi.spyOn(fs, "readFileSync").mockImplementation((source, options) => {
      const bytes = read(source, options);
      if (typeof source === "number") descriptorRead = true;
      return bytes;
    });
    vi.spyOn(fs, "lstatSync").mockImplementation((source, options) => {
      const status = lstat(source, options);
      if (source === path && status !== undefined && descriptorRead) {
        status[change] = Number(status[change]) + (change === "mode" ? 0o040 : 1); changed = true;
      }
      return status;
    });
    syncBuiltinESMExports();
    try {
      assert.throws(() => readPrivateFile(path, { label, maxBytes: 64 }), /moved while it was read/u);
      assert.equal(changed, true); assert.equal(read(path, "utf8"), "private fixture");
    } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); fs.rmSync(root, { recursive: true }); }
  });
}

for (const boundary of ["before-open", "before-final-path-stat"] as const) it(`types a safe ${boundary} file identity transition`, () => {
  const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "safe-read-transition-")), path = join(root, "private");
  fs.writeFileSync(path, "private fixture", { mode: 0o600 });
  const lstat = fs.lstatSync, open = fs.openSync;
  let pathReads = 0, descriptor: number | undefined;
  vi.spyOn(fs, "lstatSync").mockImplementation((source, options) => {
    const status = lstat(source, options);
    if (source === path && ++pathReads === (boundary === "before-open" ? 1 : 2)) { assert.ok(status); status.ino++; }
    return status;
  });
  vi.spyOn(fs, "openSync").mockImplementation((...args: Parameters<typeof open>) => {
    const opened = open(...args);
    if (String(args[0]) === path) descriptor = opened;
    return opened;
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => readPrivateFile(path, { label: "protected.json", maxBytes: 64 }), error =>
      error instanceof PrivateFileReadTransitionError && /moved while it was read/u.test(error.message));
    assert.ok(descriptor !== undefined);
    const fd = descriptor;
    assert.throws(() => fs.fstatSync(fd), (error: unknown) => error instanceof Error && "code" in error && error.code === "EBADF");
    assert.equal(fs.readFileSync(path, "utf8"), "private fixture");
  } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); fs.rmSync(root, { recursive: true }); }
});

it("keeps an unsafe live path out of the identity-transition refusal", () => {
  const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "safe-read-unsafe-transition-")), path = join(root, "private");
  fs.writeFileSync(path, "private fixture", { mode: 0o600 });
  const lstat = fs.lstatSync;
  let pathReads = 0;
  vi.spyOn(fs, "lstatSync").mockImplementation((source, options) => {
    const status = lstat(source, options);
    if (source === path && ++pathReads === 2) { assert.ok(status); status.ino++; status.mode = (Number(status.mode) & ~0o7777) | 0o644; }
    return status;
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => readPrivateFile(path, { label: "protected.json", maxBytes: 64 }), error =>
      error instanceof Error && !(error instanceof PrivateFileReadTransitionError) && /moved while it was read/u.test(error.message));
    assert.equal(fs.readFileSync(path, "utf8"), "private fixture");
  } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); fs.rmSync(root, { recursive: true }); }
});

for (const mode of ["nonce", "general-lock", "unsafe-mode", "hardlink"] as const)
  it(`keeps a real in-place ${mode} publication read a refusal and closes its descriptor`, () => {
    const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "safe-nonce-transition-")), path = join(root, "nonce"), alias = join(root, "alias");
    fs.writeFileSync(path, "", { mode: 0o600 });
    const read = fs.readFileSync, open = fs.openSync, nonce = JSON.stringify({ nonce: "11111111-1111-4111-8111-111111111111" });
    let descriptor: number | undefined, published = false;
    vi.spyOn(fs, "openSync").mockImplementation((...args: Parameters<typeof open>) => {
      const result = open(...args); if (String(args[0]) === path) descriptor = result; return result;
    });
    vi.spyOn(fs, "readFileSync").mockImplementation((source, options) => {
      const bytes = read(source, options);
      if (typeof source === "number" && source === descriptor && !published) {
        published = true; fs.writeFileSync(path, nonce);
        if (mode === "unsafe-mode") fs.chmodSync(path, 0o644);
        if (mode === "hardlink") fs.linkSync(path, alias);
      }
      return bytes;
    });
    syncBuiltinESMExports();
    try {
      assert.throws(() => readPrivateFile(path, { label: mode === "general-lock" ? "lock" : "nonce lock", maxBytes: 4096 }), error =>
        error instanceof Error && (mode === "nonce" ? error instanceof PrivateFileReadTransitionError : !(error instanceof PrivateFileReadTransitionError)));
      assert.equal(published, true); assert.ok(descriptor !== undefined);
      const fd = descriptor;
      assert.throws(() => fs.fstatSync(fd), error => error instanceof Error && "code" in error && error.code === "EBADF");
      assert.equal(read(path, "utf8"), nonce);
      if (mode === "unsafe-mode") assert.equal(fs.lstatSync(path).mode & 0o777, 0o644);
      if (mode === "hardlink") assert.equal(fs.lstatSync(path).nlink, 2);
    } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); fs.rmSync(root, { recursive: true }); }
  });

it("refuses a protected.json owned by someone else without modifying it", () => {
  const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "safe-owner-")), path = join(root, "protected.json");
  fs.writeFileSync(path, "private fixture", { mode: 0o600 });
  try {
    assert.equal(readPrivateFile(path, { label: "protected.json", maxBytes: 64 })?.bytes.toString(), "private fixture");
    const lstat = fs.lstatSync;
    vi.spyOn(fs, "lstatSync").mockImplementation((target, options) => {
      const status = lstat(target, options);
      if (status !== undefined && target === path) status.uid = (process.getuid?.() ?? 1000) + 1;
      return status;
    });
    syncBuiltinESMExports();
    assert.throws(() => readPrivateFile(path, { label: "protected.json", maxBytes: 64 }), /permissions or identity|private regular file/u);
    assert.equal(fs.statSync(path).mode & 0o7777, 0o600);
    assert.equal(fs.readFileSync(path, "utf8"), "private fixture");
  } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); fs.rmSync(root, { recursive: true }); }
});

it("removes only the exact owned file", () => {
  const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "safe-remove-")), path = join(root, "file");
  try {
    fs.writeFileSync(path, "retained fixture", { mode: 0o600 });
    const info = fs.lstatSync(path), identity = { device: info.dev, inode: info.ino };
    assert.throws(() => removeExactPath(path, { ...identity, inode: identity.inode + 1 }, false, "exact-path-changed"), /exact-path-changed/u);
    const link = join(root, "link");
    fs.symlinkSync(path, link);
    assert.throws(() => removeExactPath(link, identity, false, "exact-path-changed"), /exact-path-changed/u);
    assert.equal(fs.readFileSync(path, "utf8"), "retained fixture");
    assert.equal(removeExactPath(path, identity, false, "exact-path-changed"), true);
    assert.equal(fs.existsSync(path), false);
    assert.equal(removeExactPath(path, identity, true, "exact-path-changed"), false);
    assert.throws(() => removeExactPath(path, identity, false, "exact-path-changed"), /exact-path-changed/u);
  } finally { fs.rmSync(root, { recursive: true }); }
});

it("records exact draft members and refuses missing or writable members without cleanup", () => {
  const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "safe-draft-")), draft = join(root, "draft"), note = join(draft, "note");
  try {
    assert.throws(() => unpublishedDraftAbortMembership(draft), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
    fs.mkdirSync(draft, { mode: 0o700 });
    fs.writeFileSync(note, "retained fixture", { mode: 0o600 });
    const info = fs.lstatSync(note), recorded = unpublishedDraftAbortMembership(draft);
    assert.deepEqual(recorded.map(entry => entry.path), ["", "note"]);
    assert.deepEqual(recorded[1], { path: "note", directory: false, device: info.dev, inode: info.ino,
      size: info.size, mode: info.mode, modified: info.mtimeMs, changed: info.ctimeMs });
    fs.chmodSync(note, 0o666);
    assert.throws(() => unpublishedDraftAbortMembership(draft), /profile-draft-abort-membership-unsafe/u);
    assert.equal(fs.readFileSync(note, "utf8"), "retained fixture");
  } finally { fs.rmSync(root, { recursive: true }); }
});

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

for (const peer of ["mid-create", "release-during-read"] as const) it(`waits for a ${peer} peer without reading its private lock`, () => {
  const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "safe-lock-contender-"));
  const path = join(root, ".installation-mutation.lock");
  const bytes = JSON.stringify({ nonce: "11111111-1111-4111-8111-111111111111" });
  const open = fs.openSync;
  let acquired = false, foreignReads = 0, entered = 0;
  try {
    fs.chmodSync(root, 0o700);
    fs.writeFileSync(path, peer === "mid-create" ? "" : bytes, { mode: 0o600, flag: "wx" });
    vi.spyOn(fs, "openSync").mockImplementation((target, flags, mode) => {
      const descriptor = open(target, flags, mode);
      if (target === path && typeof flags === "number") {
        if ((flags & fs.constants.O_EXCL) !== 0) acquired = true;
        else if (!acquired && (flags & fs.constants.O_NONBLOCK) !== 0) {
          foreignReads++;
          if (peer === "release-during-read") fs.unlinkSync(path);
        }
      }
      return descriptor;
    });
    const wait = vi.spyOn(Atomics, "wait").mockImplementation(() => {
      if (peer === "mid-create") fs.writeFileSync(path, bytes);
      fs.unlinkSync(path);
      return "ok";
    });
    syncBuiltinESMExports();
    withPrivateFileLock(root, ".installation-mutation.lock", held => { held.assertHeld(); entered++; });
    assert.equal(entered, 1); assert.equal(foreignReads, 0);
    assert.equal(wait.mock.calls.length, 1); assert.equal(wait.mock.calls[0]?.[3], 25);
    assert.equal(fs.existsSync(path), false);
  } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); fs.rmSync(root, { recursive: true }); }
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

for (const asynchronous of [false, true]) it(`preserves operation and proof release failures (${asynchronous ? "async" : "sync"})`, async () => {
  const primary = new Error("operation failed"), cleanup = new Error("proof release failed");
  const body = () => {
    const proof = outermostOperationProof();
    assert.ok(proof);
    proof.release.push(() => { throw cleanup; });
    if (asynchronous) return Promise.reject(primary);
    throw primary;
  };
  const check = (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [primary, cleanup]);
    assert.equal(error.cause, cleanup);
    return true;
  };
  if (asynchronous) await assert.rejects(() => withOperationProof(body), check);
  else assert.throws(() => withOperationProof(body), check);
  assert.equal(outermostOperationProof(), undefined);
});

it("retains proof resources when source closure is unproved", () => {
  let releases = 0;
  const failure = retainAuthoritySourceClosure([new Error("source still open")], { database: {} });
  assert.throws(() => withOperationProof(() => {
    const proof = outermostOperationProof();
    assert.ok(proof);
    proof.release.push(() => { releases++; });
    throw failure;
  }), error => error === failure);
  assert.equal(releases, 0);
  assert.equal(outermostOperationProof(), undefined);
});

it("starts a fresh proof when an async descendant outlives its operation", async () => {
  let releases = 0;
  const deferred = withOperationProof(() => {
    const original = outermostOperationProof();
    assert.ok(original);
    original.slots.set("prior", "verified");
    original.witnesses.set("retained", { assertUnchanged() {} });
    original.release.push(() => { releases++; });
    return { pending: new Promise<void>(resolve => { setImmediate(resolve); }).then(() => {
      assert.equal(original.active, false);
      assert.equal(original.slots.size, 0);
      assert.equal(original.witnesses.size, 0);
      assert.equal(outermostOperationProof(), undefined);
      withOperationProof(() => {
        const fresh = outermostOperationProof();
        assert.ok(fresh);
        assert.notEqual(fresh, original);
        assert.equal(fresh.slots.size, 0);
        assert.equal(fresh.witnesses.size, 0);
        fresh.release.push(() => { releases++; });
      });
      assert.equal(outermostOperationProof(), undefined);
    }) };
  });
  assert.equal(releases, 1);
  await deferred.pending;
  assert.equal(releases, 2);
  assert.equal(outermostOperationProof(), undefined);
});

it("clears memos before revalidating retained witnesses and resets both at operation boundaries", () => {
  let checks = 0;
  withOperationProof(() => {
    const proof = outermostOperationProof();
    assert.ok(proof);
    proof.slots.set("memo", true);
    const witness = { assertUnchanged() { assert.equal(proof.slots.size, 0); checks++; } };
    proof.witnesses.set("verified", witness);
    revalidateOperationProof();
    assert.equal(checks, 1);
    assert.equal(proof.witnesses.get("verified"), witness);
    proof.slots.set("memo", true);
    clearOperationProofSlots();
    assert.equal(proof.slots.size, 0);
    assert.equal(proof.witnesses.size, 0);
    const failure = new Error("changed evidence");
    proof.witnesses.set("changed", { assertUnchanged() { throw failure; } });
    assert.throws(revalidateOperationProof, error => error === failure);
  });
  assert.equal(outermostOperationProof(), undefined);
});
