import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, vi } from "vitest";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { readTestDataLocalConfig } from "../../../../src/backend/storage/configuration/test-data-local.js";

vi.mock("../../../../src/backend/storage/private-path.js", async load => {
  const original = await load<typeof import("../../../../src/backend/storage/private-path.js")>();
  return { ...original, privatePathRejects(path: string, stat: Parameters<typeof original.privatePathRejects>[1], rule: Parameters<typeof original.privatePathRejects>[2]) {
    assert.equal(typeof stat.ino, "bigint"); assert.ok(BigInt(stat.ino) > 2n ** 53n);
    return original.posixPrivatePathRejects(path, stat, rule);
  } };
});

it.skipIf(process.platform !== "linux")("reads private test inputs with an exact high descriptor identity", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "test-input-exact-"))), path = join(root, "input.json");
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, inputs: {}, files: {} }), { mode: 0o600 });
  const fstat = fs.fstatSync;
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  vi.spyOn(fs, "fstatSync").mockImplementation((fd, options) => {
    const info = fstat(fd, options); assert.equal(typeof info.ino, "bigint"); info.ino = 21_110_623_253_370_483n; return info;
  });
  syncBuiltinESMExports();
  try { assert.equal(readTestDataLocalConfig(path).state, "valid"); }
  finally { vi.restoreAllMocks(); syncBuiltinESMExports(); rmSync(root, { recursive: true }); }
});
