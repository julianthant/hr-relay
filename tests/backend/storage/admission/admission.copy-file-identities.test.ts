import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, vi } from "vitest";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";

vi.mock("../../../../src/backend/storage/private-path.js", async load => {
  const original = await load<typeof import("../../../../src/backend/storage/private-path.js")>();
  return { ...original, privatePathRejects: original.posixPrivatePathRejects };
});

it("verifies a database copy with exact high Windows path and descriptor identities", () => {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "copy-exact-"))), path = join(root, "copy.db");
  const bytes = Buffer.from("synthetic read-only authority copy"); fs.writeFileSync(path, bytes, { mode: 0o600 });
  const admission = RuntimeAdmission.syntheticFixture(join(root, "state.db"));
  const lstat = fs.lstatSync, fstat = fs.fstatSync;
  let changed = false, descriptors = 0;
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  vi.spyOn(fs, "lstatSync").mockImplementation((file, options) => {
    const info = lstat(file, options);
    if (file === path && info !== undefined && typeof info.ino === "bigint") info.ino = 21_110_623_253_370_483n;
    return info;
  });
  vi.spyOn(fs, "fstatSync").mockImplementation((fd, options) => {
    const info = fstat(fd, options); assert.equal(typeof info.ino, "bigint"); descriptors++;
    info.ino = changed ? 21_110_623_253_370_484n : 21_110_623_253_370_483n; return info;
  });
  syncBuiltinESMExports();
  try {
    const copy = admission.verifiedReadOnlyCopy(path, createHash("sha256").update(bytes).digest("hex"));
    try {
      copy.assertReadable(); assert.ok(descriptors >= 4);
      changed = true; assert.throws(() => copy.assertReadable(), /inspected copy changed during open/u);
      assert.ok(fs.readFileSync(path).equals(bytes));
    } finally { changed = false; copy.release(); }
  } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); admission.release(); fs.rmSync(root, { recursive: true }); }
});
