import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it, vi } from "vitest";
import { createPrivateLock, fileIdentityObservation, numericFileIdentity, PrivateFileReadTransitionError, readPrivateFile, removeExactPath, sameDirectory } from "../../../../src/backend/storage/configuration/credential-safe-file.js";
import { profileAuthorityFileWitnesses } from "../../../../src/backend/storage/maintenance/existing-data-backup-files.js";
import { hasUnprovedSourceClosure } from "../../../../src/backend/storage/source-closure.js";

vi.mock("../../../../src/backend/storage/private-path.js", async importOriginal => {
  const original = await importOriginal<typeof import("../../../../src/backend/storage/private-path.js")>();
  return { ...original, fsyncPath: vi.fn(), privatePathRejects: (path: string, stat: Parameters<typeof original.privatePathRejects>[1], rule: Parameters<typeof original.privatePathRejects>[2]) => {
    if (process.platform !== "win32") return original.privatePathRejects(path, stat, rule);
    assert.equal(typeof stat.dev, "bigint", "Windows policy requires an exact filesystem observation");
    assert.equal(typeof stat.ino, "bigint", "Windows policy requires an exact filesystem observation");
    return false;
  } };
});
const high = 21_110_623_253_370_482n;
const actualLstat = fs.lstatSync, actualFstat = fs.fstatSync, actualClose = fs.closeSync;
let root: string | undefined;
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); if (root !== undefined) fs.rmSync(root, { recursive: true, force: true }); root = undefined; });
function fixture() {
  root = fs.mkdtempSync(join(tmpdir(), "exact-private-file-"));
  const path = join(root, "private"); fs.writeFileSync(path, "fixture bytes", { mode: 0o600 }); return path;
}
function windowsObservations(change?: (stat: fs.BigIntStats, kind: "path" | "fd", count: number) => void) {
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  let paths = 0, descriptors = 0;
  vi.spyOn(fs, "lstatSync").mockImplementation((path, options) => {
    assert.equal(typeof options === "object" && options.bigint, true);
    const value = actualLstat(path, { bigint: true, throwIfNoEntry: false });
    if (value !== undefined) { value.ino = high; change?.(value, "path", ++paths); }
    return value;
  });
  vi.spyOn(fs, "fstatSync").mockImplementation((fd, options) => {
    assert.equal(options?.bigint, true);
    const value = actualFstat(fd, { bigint: true }); value.ino = high; change?.(value, "fd", ++descriptors); return value;
  });
  syncBuiltinESMExports();
}
it("reads exact high Windows identities with raw bigint metadata", () => {
  const path = fixture(); windowsObservations();
  const file = readPrivateFile(path, { label: "lock", maxBytes: 64 }); assert.ok(file);
  assert.equal(file.bytes.toString(), "fixture bytes"); assert.equal(file.identity.inode, high);
  assert.equal(file.stat.ino, high); assert.equal(typeof file.stat.size, "bigint");
});
for (const boundary of ["path", "fd", "after"] as const) it(`refuses colliding numeric identities changed at ${boundary}`, () => {
  const path = fixture();
  assert.equal(Number(high), Number(high - 1n));
  windowsObservations((stat, kind, count) => { if ((boundary === "path" && kind === "path" && count === 2) || (boundary === "fd" && kind === "fd" && count === 1) || (boundary === "after" && kind === "fd" && count === 2)) stat.ino = high - 1n; });
  assert.throws(() => readPrivateFile(path, { label: "lock", maxBytes: 64 }), /moved while/u);
});
it("refuses a nanosecond-only descriptor change", () => {
  const path = fixture(); windowsObservations((stat, kind, count) => { if (kind === "fd" && count === 2) stat.mtimeNs++; });
  assert.throws(() => readPrivateFile(path, { label: "lock", maxBytes: 64 }), /moved while/u);
});
it("creates and removes a lock with exact Windows publication and cleanup observations", () => {
  const path = fixture(); fs.unlinkSync(path); windowsObservations();
  assert.equal(createPrivateLock(path, root!, Buffer.from("lock"), () => true), true);
  assert.equal(removeExactPath(path, { device: actualLstat(path, { bigint: true }).dev, inode: high }, false, "changed"), true);
  assert.equal(fs.existsSync(path), false);
});
it("does not unlink a high identity using a rounded numeric witness", () => {
  const path = fixture(); windowsObservations();
  assert.throws(() => removeExactPath(path, { device: actualLstat(path).dev, inode: Number(high) }, false, "changed"), /changed/u);
  assert.equal(fs.readFileSync(path, "utf8"), "fixture bytes");
});
it("retains the exact descriptor owner when checked close fails", () => {
  const path = fixture(); windowsObservations(); let descriptor: number | undefined;
  vi.spyOn(fs, "closeSync").mockImplementation(fd => { descriptor = fd; throw new Error("close-failed"); }); syncBuiltinESMExports();
  try { assert.throws(() => readPrivateFile(path, { label: "lock", maxBytes: 64 }), hasUnprovedSourceClosure); }
  finally { if (descriptor !== undefined) actualClose(descriptor); }
});
it("compares safe mixed numeric identities exactly and refuses rounded ones", () => {
  assert.equal(sameDirectory({ device: 4n, inode: 17n }, { device: 4, inode: 17 }), true);
  assert.equal(sameDirectory({ device: 4n, inode: high }, { device: 4, inode: Number(high) }), false);
});
it.skipIf(process.platform === "win32")("preserves POSIX numeric Stats and the original observation count", () => {
  const path = fixture(), before = actualLstat(path);
  const paths = vi.spyOn(fs, "lstatSync"), descriptors = vi.spyOn(fs, "fstatSync"); syncBuiltinESMExports();
  const file = readPrivateFile(path, { label: "lock", maxBytes: 64 }); assert.ok(file);
  assert.equal(file.stat instanceof fs.Stats, true); assert.equal(file.identity.inode, before.ino);
  assert.equal(paths.mock.calls.length, 2); assert.equal(descriptors.mock.calls.length, 2);
  assert.equal(paths.mock.calls[0]?.[1]?.bigint, undefined); assert.equal(descriptors.mock.calls[0]?.[1], undefined);
});

it("keeps numeric persisted witnesses exact or refuses before serialization", () => {
  assert.deepEqual(numericFileIdentity({ device: 4n, inode: 17n }), { device: 4, inode: 17 });
  for (const inode of [high, Number(high)]) assert.throws(() => numericFileIdentity({ device: 4n, inode }), error => {
    assert.equal((error as { code?: string }).code, "WINDOWS_PRIVATE_PATH_REFUSED");
    assert.equal((error as { reason?: string }).reason, "unrepresentable-numeric-file-metadata"); return true;
  });
});
it("serializes ephemeral bigint observations exactly and leaves numeric observations unchanged", () => {
  assert.equal(JSON.stringify(fileIdentityObservation({ device: 4n, inode: high })), '{"device":"4","inode":"21110623253370482"}');
  assert.equal(JSON.stringify(fileIdentityObservation({ device: 4, inode: 17 })), '{"device":4,"inode":17}');
});
it("preserves nonce transition classification for nanosecond-only changes", () => {
  const path = fixture(); windowsObservations((stat, kind, count) => { if (kind === "fd" && count === 2) stat.ctimeNs++; });
  assert.throws(() => readPrivateFile(path, { label: "nonce lock", maxBytes: 64 }), PrivateFileReadTransitionError);
});
it("accepts a safe numeric cleanup witness against an exact observation", () => {
  const path = fixture(); windowsObservations(stat => { stat.dev = 4n; stat.ino = 17n; });
  assert.equal(removeExactPath(path, { device: 4, inode: 17 }, false, "changed"), true);
});
for (const mutation of ["size", "mode", "uid", "nlink", "ctimeNs"] as const) it(`refuses Windows ${mutation} changed during the descriptor read`, () => {
  const path = fixture(); windowsObservations((stat, kind, count) => { if (kind === "fd" && count === 2) stat[mutation]++; });
  assert.throws(() => readPrivateFile(path, { label: "lock", maxBytes: 64 }), /moved while/u);
});
it("refuses a lock whose publication identity changes without deleting the substituted name", () => {
  const path = fixture(); fs.unlinkSync(path);
  windowsObservations((stat, kind) => { if (kind === "path") stat.ino = high - 1n; });
  assert.throws(() => createPrivateLock(path, root!, Buffer.from("lock"), () => true), AggregateError);
  assert.equal(fs.readFileSync(path, "utf8"), "lock");
});

it("refuses an unrepresentable reader identity at the existing authority witness capture boundary", () => {
  fixture(); fs.writeFileSync(join(root!, "state.db"), "synthetic database bytes", { mode: 0o600 }); windowsObservations();
  assert.throws(() => profileAuthorityFileWitnesses(root!), error => {
    assert.equal((error as { reason?: string }).reason, "unrepresentable-numeric-file-metadata"); return true;
  });
  assert.equal(fs.readFileSync(join(root!, "state.db"), "utf8"), "synthetic database bytes");
});
