import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it, vi } from "vitest";
import { stageFastDuoExtension } from "../../../../src/backend/runtime/browser/fast-duo-extension.js";

const policy = vi.hoisted(() => ({ refuse: false }));
vi.mock("../../../../src/backend/storage/private-path.js", async load => ({
  ...await load<typeof import("../../../../src/backend/storage/private-path.js")>(),
  privatePathRejects(_path: string, stat: fs.Stats | fs.BigIntStats) {
    assert.equal(typeof stat.ino, process.platform === "win32" ? "bigint" : "number");
    return policy.refuse;
  },
}));
const high = 21_110_623_253_370_482n;
const actualLstat = fs.lstatSync, actualFstat = fs.fstatSync, actualRead = fs.readFileSync, actualClose = fs.closeSync;
let root: string | undefined;
afterEach(() => {
  vi.restoreAllMocks(); syncBuiltinESMExports(); policy.refuse = false;
  if (root !== undefined) fs.rmSync(root, { recursive: true, force: true }); root = undefined;
});
function fixture() {
  root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "duo-stage-identities-")));
  const source = join(root, "source"), destination = join(root, "extension");
  fs.cpSync(fs.realpathSync("fast-duo"), source, { recursive: true });
  return { source, destination, stage: () => stageFastDuoExtension(source, destination, "workflow") };
}
function windows(change?: (stat: fs.BigIntStats, kind: "fd" | "path", count: number) => void) {
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  let descriptors = 0, paths = 0;
  vi.spyOn(fs, "fstatSync").mockImplementation((descriptor, options) => {
    assert.equal(options?.bigint, true, "Windows descriptor observation must request bigint");
    const status = actualFstat(descriptor, { bigint: true }); status.ino = high; change?.(status, "fd", ++descriptors); return status;
  });
  vi.spyOn(fs, "lstatSync").mockImplementation((path, options) => {
    assert.equal(typeof options === "object" && options.bigint, true, "Windows path observation must request bigint");
    const status = actualLstat(path, { bigint: true }); status.ino = high; change?.(status, "path", ++paths); return status;
  });
  syncBuiltinESMExports();
}
it("stages the real allowlisted extension using exact high Windows identities", () => {
  const f = fixture(); windows(); const close = vi.spyOn(fs, "closeSync"); syncBuiltinESMExports();
  f.stage();
  assert.equal(fs.readFileSync(join(f.destination, "manifest.json"), "utf8"), fs.readFileSync(join(f.source, "workflow-manifest.json"), "utf8"));
  assert.equal(fs.existsSync(join(f.destination, "src", "relay-background.js")), false);
  assert.equal(close.mock.calls.length, 24);
});
for (const boundary of ["after", "checked", "path"] as const) it(`refuses a Windows identity collision at the ${boundary} observation`, () => {
  const f = fixture(); assert.equal(Number(high), Number(high - 1n));
  windows((status, kind, count) => { if (boundary === "path" ? kind === "path" && count === 1 : kind === "fd" && count === (boundary === "after" ? 2 : 3)) status.ino = high - 1n; });
  const close = vi.spyOn(fs, "closeSync"); syncBuiltinESMExports();
  assert.throws(f.stage, /extension files are unavailable or unsafe/u);
  assert.equal(close.mock.calls.length, 2); assert.equal(fs.existsSync(join(f.destination, "manifest.json")), false);
});
it("refuses a Windows second hardlink observed only by the after descriptor stat", () => {
  const f = fixture(); windows((status, kind, count) => { if (kind === "fd" && count === 2) status.nlink = 2n; });
  const close = vi.spyOn(fs, "closeSync"); syncBuiltinESMExports();
  assert.throws(f.stage, /extension files are unavailable or unsafe/u);
  assert.equal(close.mock.calls.length, 2); assert.equal(fs.existsSync(join(f.destination, "manifest.json")), false);
});
it.skipIf(process.platform === "win32")("refuses a real POSIX transient hardlink captured by the after descriptor stat", () => {
  const f = fixture(), source = join(f.source, "workflow-manifest.json"), link = join(root!, "transient-link");
  let observations = 0;
  vi.spyOn(fs, "fstatSync").mockImplementation(descriptor => {
    if (++observations !== 2) return actualFstat(descriptor);
    fs.linkSync(source, link);
    const after = actualFstat(descriptor); assert.equal(after.nlink, 2);
    fs.unlinkSync(link); assert.equal(actualLstat(source).nlink, 1);
    return after;
  });
  const close = vi.spyOn(fs, "closeSync"); syncBuiltinESMExports();
  assert.throws(f.stage, /extension files are unavailable or unsafe/u);
  assert.equal(close.mock.calls.length, 2); assert.equal(fs.existsSync(join(f.destination, "manifest.json")), false);
});
for (const field of ["mtimeNs", "ctimeNs"] as const) it(`refuses a Windows ${field}-only descriptor mutation`, () => {
  const f = fixture(); windows((status, kind, count) => { if (kind === "fd" && count === 2) status[field]++; });
  assert.throws(f.stage, /extension files are unavailable or unsafe/u);
  assert.equal(fs.existsSync(join(f.destination, "manifest.json")), false);
});
it("keeps the second-handle byte hash check and closes both Windows descriptors on refusal", () => {
  const f = fixture(); windows(); const close = vi.spyOn(fs, "closeSync");
  vi.spyOn(fs, "readFileSync").mockImplementationOnce(path => actualRead(path)).mockImplementationOnce(() => Buffer.from("different bytes"));
  syncBuiltinESMExports(); assert.throws(f.stage, /extension files are unavailable or unsafe/u);
  assert.equal(close.mock.calls.length, 2); assert.equal(fs.existsSync(join(f.destination, "manifest.json")), false);
});
it("preserves Windows privacy refusals before reading source bytes", () => {
  const f = fixture(); windows(); policy.refuse = true;
  const read = vi.spyOn(fs, "readFileSync"), close = vi.spyOn(fs, "closeSync"); syncBuiltinESMExports();
  assert.throws(f.stage, /extension files are unavailable or unsafe/u);
  assert.equal(read.mock.calls.length, 0); assert.equal(close.mock.calls.length, 1);
});
it("propagates a checked Windows close failure instead of reporting staging success", () => {
  const f = fixture(); windows(); const failure = new Error("synthetic close failure"); let retained: number | undefined;
  vi.spyOn(fs, "closeSync").mockImplementationOnce(descriptor => { retained = descriptor; throw failure; }); syncBuiltinESMExports();
  try { assert.throws(f.stage, error => error === failure); assert.equal(fs.existsSync(join(f.destination, "manifest.json")), false); }
  finally { if (retained !== undefined) actualClose(retained); }
});
it.skipIf(process.platform === "win32")("retains the POSIX staging observation signatures and descriptor count", () => {
  const f = fixture(), paths = vi.spyOn(fs, "lstatSync"), descriptors = vi.spyOn(fs, "fstatSync"), close = vi.spyOn(fs, "closeSync"); syncBuiltinESMExports();
  f.stage();
  assert.equal(paths.mock.calls.length, 8); assert.equal(descriptors.mock.calls.length, 24); assert.equal(close.mock.calls.length, 24);
  for (const [, options] of [...paths.mock.calls, ...descriptors.mock.calls]) assert.equal(options, undefined);
});
