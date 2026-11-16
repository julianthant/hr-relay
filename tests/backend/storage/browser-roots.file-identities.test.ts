import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, vi } from "vitest";
import { assertPrivateProfilePath } from "../../../src/backend/storage/browser-roots.js";

vi.mock("../../../src/backend/storage/private-path.js", async load => {
  const original = await load<typeof import("../../../src/backend/storage/private-path.js")>();
  return { ...original, privatePathRejects: original.posixPrivatePathRejects };
});

it("admits a private browser path with an exact high Windows file ID", () => {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "browser-exact-"))), child = join(root, "profile");
  fs.mkdirSync(child, { mode: 0o700 });
  const actual = fs.lstatSync;
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  vi.spyOn(fs, "lstatSync").mockImplementation((path, options) => {
    const value = actual(path, options);
    assert.equal(typeof value?.ino, "bigint");
    if (value !== undefined) value.ino = 21_110_623_253_370_483n;
    return value;
  });
  syncBuiltinESMExports();
  try { assert.doesNotThrow(() => assertPrivateProfilePath(root, child)); }
  finally { vi.restoreAllMocks(); syncBuiltinESMExports(); fs.rmSync(root, { recursive: true }); }
});
