import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, it, vi } from "vitest";
import { z } from "zod";

const native = vi.hoisted(() => ({ version: "", load: vi.fn(), move: vi.fn() }));
// The bridge must accept exactly the koffi release the package installs.
native.version = z.looseObject({ dependencies: z.looseObject({ koffi: z.string().regex(/^\d+\.\d+\.\d+$/u) }) })
  .parse(JSON.parse(readFileSync("package.json", "utf8"))).dependencies.koffi;
vi.mock("node:module", async load => ({ ...await load<typeof import("node:module")>(),
  createRequire: () => (name: string) => { assert.equal(name, "koffi"); return native; },
}));
const platform = Object.getOwnPropertyDescriptor(process, "platform");
afterEach(() => { if (platform !== undefined) Object.defineProperty(process, "platform", platform); vi.resetAllMocks(); });

it("binds the pinned native exclusive-rename API and refuses a nonzero result", async () => {
  vi.resetModules(); Object.defineProperty(process, "platform", { configurable: true, value: "darwin" });
  const bind = vi.fn().mockReturnValue(native.move); native.load.mockReturnValue({ func: bind }); native.move.mockReturnValue(0);
  const { movePrivateDirectoryExclusive } = await import("../../../src/backend/storage/private-path.js");
  movePrivateDirectoryExclusive("/owned/source", "/owned/target");
  assert.deepEqual(native.load.mock.calls, [["/usr/lib/libSystem.B.dylib"]]);
  assert.deepEqual(bind.mock.calls, [["int renamex_np(const char *source, const char *target, unsigned int flags)"]]);
  assert.deepEqual(native.move.mock.calls, [["/owned/source", "/owned/target", 4]]);
  native.move.mockReturnValue(-1);
  assert.throws(() => movePrivateDirectoryExclusive("/owned/source", "/owned/target"), /private-directory-exclusive-move-refused/u);
  assert.equal(native.load.mock.calls.length, 1);
});

it("refuses an unsupported platform before loading a native bridge", async () => {
  vi.resetModules(); Object.defineProperty(process, "platform", { configurable: true, value: "linux" });
  const { movePrivateDirectoryExclusive } = await import("../../../src/backend/storage/private-path.js");
  assert.throws(() => movePrivateDirectoryExclusive("/owned/source", "/owned/target"), /private-directory-exclusive-move-unavailable/u);
  assert.equal(native.load.mock.calls.length, 0);
});
