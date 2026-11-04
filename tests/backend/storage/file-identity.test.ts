import assert from "node:assert/strict";
import fs from "node:fs";
import promises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, vi } from "vitest";
import { fileStatus, descriptorStatus, asyncFileStatus, asyncDescriptorStatus, fileIdentityObservation, sameDirectory } from "../../../src/backend/storage/file-identity.js";

it("compares exact decimal observations without rounding adjacent NTFS IDs", () => {
  const id = 21_110_623_253_370_483n;
  assert.deepEqual(fileIdentityObservation({ device: 4n, inode: id }), { device: "4", inode: "21110623253370483" });
  assert.equal(sameDirectory({ device: 4n, inode: id }, { device: "4", inode: "21110623253370483" }), true);
  assert.equal(sameDirectory({ device: 4n, inode: id + 1n }, { device: "4", inode: "21110623253370483" }), false);
  assert.equal(sameDirectory({ device: 4n, inode: id }, { device: 4, inode: Number(id) }), false);
  assert.equal(sameDirectory({ device: 4n, inode: 17n }, { device: 4, inode: 17 }), true);
  assert.deepEqual(fileIdentityObservation({ device: 4, inode: 17 }), { device: 4, inode: 17 });
});

for (const platform of ["win32", "linux"] as const) it(`keeps synchronous and asynchronous metadata exact on ${platform}`, async () => {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "metadata-exact-"))), path = join(root, "file");
  fs.writeFileSync(path, "fixture", { mode: 0o600 });
  const fd = fs.openSync(path, "r"), handle = await promises.open(path, "r");
  const lstat = fs.lstatSync, fstat = fs.fstatSync, asyncStat = promises.lstat, handleStat = handle.stat.bind(handle);
  const high = 21_110_623_253_370_483n, expected = platform === "win32" ? high : Number(high);
  vi.spyOn(process, "platform", "get").mockReturnValue(platform);
  vi.spyOn(fs, "lstatSync").mockImplementation((file, options) => {
    const info = lstat(file, options); if (info !== undefined) info.ino = expected; return info;
  });
  vi.spyOn(fs, "fstatSync").mockImplementation((descriptor, options) => { const info = fstat(descriptor, options); info.ino = expected; return info; });
  vi.spyOn(promises, "lstat").mockImplementation(async (file, options) => { const info = await asyncStat(file, options); info.ino = expected; return info; });
  vi.spyOn(handle, "stat").mockImplementation(async options => { const info = await handleStat(options); info.ino = expected; return info; });
  syncBuiltinESMExports();
  try {
    for (const info of [fileStatus(path), descriptorStatus(fd), await asyncFileStatus(path), await asyncDescriptorStatus(handle)]) {
      assert.equal(info.ino, expected); assert.equal(typeof info.dev, platform === "win32" ? "bigint" : "number");
    }
    assert.equal(fileStatus(join(root, "absent"), true), undefined);
  } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); fs.closeSync(fd); await handle.close(); fs.rmSync(root, { recursive: true }); }
});
