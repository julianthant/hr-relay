import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, vi } from "vitest";
import { readProcessCustodyFile, writeGeocodeRuntimeFileExclusive, readGeocodeRuntimeFile, removeOwnedGeocodeRuntimeFile } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";

vi.mock("../../../../src/backend/storage/private-path.js", async load => {
  const original = await load<typeof import("../../../../src/backend/storage/private-path.js")>();
  return { ...original, privatePathRejects: original.posixPrivatePathRejects, fsyncPath() {} };
});

it("retains exact high Windows claim identities and refuses adjacent IDs and sub-millisecond replacements", () => {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "claims-exact-")));
  const lstat = fs.lstatSync, fstat = fs.fstatSync;
  let inode = 21_110_623_253_370_483n, modifiedDelta = 0n;
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  vi.spyOn(fs, "lstatSync").mockImplementation((path, options) => {
    const value = lstat(path, options);
    if (value !== undefined) { assert.equal(typeof value.ino, "bigint"); value.ino = inode; }
    return value;
  });
  vi.spyOn(fs, "fstatSync").mockImplementation((fd, options) => {
    const value = fstat(fd, options); assert.equal(typeof value.ino, "bigint"); value.ino = inode; assert.ok("mtimeNs" in value); value.mtimeNs += modifiedDelta; return value;
  });
  syncBuiltinESMExports();
  try {
    const custody = writeGeocodeRuntimeFileExclusive(root, "fixture.channel.json", "exact");
    assert.equal(custody.ino, 21_110_623_253_370_483n);
    const retained = readProcessCustodyFile(join(root, "geocode-claims", "fixture.channel.json"));
    assert.equal(retained.witness.inode, "21110623253370483");
    assert.equal(retained.bytes.toString("utf8"), "exact");
    assert.equal(readGeocodeRuntimeFile(root, "fixture.channel.json").text, "exact");
    modifiedDelta = 100n;
    assert.throws(() => removeOwnedGeocodeRuntimeFile(root, "fixture.channel.json", custody), /geocode-file-custody-lost/u);
    modifiedDelta = 0n;
    inode++;
    assert.throws(() => removeOwnedGeocodeRuntimeFile(root, "fixture.channel.json", custody), /geocode-file-custody-lost/u);
    assert.equal(fs.readFileSync(join(root, "geocode-claims", "fixture.channel.json"), "utf8"), "exact");
    inode--;
    removeOwnedGeocodeRuntimeFile(root, "fixture.channel.json", custody);
    assert.equal(fs.existsSync(join(root, "geocode-claims", "fixture.channel.json")), false);
  } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); fs.rmSync(root, { recursive: true }); }
});
