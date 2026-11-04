import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it, vi } from "vitest";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";

const policy = vi.hoisted(() => ({ paths: new Set<string>(), refuse: false, exact: false, observations: 0 }));
vi.mock("../../../../src/backend/storage/private-path.js", async load => {
  const original = await load<typeof import("../../../../src/backend/storage/private-path.js")>();
  const host = process.platform;
  return { ...original, privatePathRejects(path: string, stat: Parameters<typeof original.privatePathRejects>[1], rule: Parameters<typeof original.privatePathRejects>[2]) {
    if (policy.paths.has(path) && rule === "group-write") {
      policy.observations++;
      if (policy.exact) { assert.equal(typeof stat.dev, "bigint"); assert.equal(typeof stat.ino, "bigint"); }
      if (policy.refuse) return true;
    }
    return host === "win32" ? original.privatePathRejects(path, stat, rule) : original.posixPrivatePathRejects(path, stat, rule);
  } };
});
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks(); syncBuiltinESMExports(); policy.paths.clear(); policy.refuse = false; policy.exact = false; policy.observations = 0;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function directory() {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "admission-exact-roots-"))); roots.push(root); return root;
}
function windows(...paths: string[]) {
  for (const path of paths) policy.paths.add(path);
  policy.exact = true; vi.spyOn(process, "platform", "get").mockReturnValue("win32");
}
it("revalidates genuine active installation roots with actual Windows bigint observations", async () => {
  const f = await createBoundProfileFixture();
  try {
    windows(f.machine.stateRoot, f.machine.artifactRoot);
    f.machine.assertStorageRootsSafe();
    assert.ok(policy.observations >= 2);
    policy.refuse = true;
    assert.throws(() => f.machine.assertStorageRootsSafe(), /storage root ownership changed/u);
  } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); policy.paths.clear(); policy.exact = false; await f.close(); }
});
it("admits synthetic directories and an existing database with exact Windows identities", () => {
  const root = directory(), database = join(root, "state.db"); fs.writeFileSync(database, "synthetic database", { mode: 0o600 });
  windows(root, database);
  const actual = fs.lstatSync;
  const stat = vi.spyOn(fs, "lstatSync").mockImplementation((path, options) => {
    const value = actual(path, { bigint: true, throwIfNoEntry: false });
    if (policy.paths.has(String(path))) {
      assert.equal(typeof options === "object" && options.bigint, true);
      if (value !== undefined) value.ino = 21_110_623_253_370_482n;
    }
    return value;
  });
  syncBuiltinESMExports();
  const admission = RuntimeAdmission.syntheticFixture(database);
  try { admission.assertStorageRootsSafe(); assert.ok(policy.observations >= 3); assert.ok(stat.mock.calls.length > 0); }
  finally { admission.release(); }
});
it("preserves synthetic root policy and installation-overlap refusals", () => {
  const root = directory(); windows(root); policy.refuse = true;
  assert.throws(() => RuntimeAdmission.syntheticFixture(join(root, "state.db")), /unsafe synthetic fixture ancestor/u);
  policy.refuse = false; fs.mkdirSync(join(root, ".tracker", "control"), { recursive: true, mode: 0o700 });
  assert.throws(() => RuntimeAdmission.syntheticFixture(join(root, "state.db")), /fixture overlaps installation witness/u);
});
it("refuses a non-directory synthetic ancestor before admission", () => {
  const root = directory(), file = join(root, "file"); fs.writeFileSync(file, "synthetic", { mode: 0o600 }); windows(file);
  assert.throws(() => RuntimeAdmission.syntheticRoots(file, root), /unsafe synthetic fixture ancestor/u);
});
for (const invalid of ["policy", "hardlink", "symlink"] as const) it(`refuses an existing synthetic database with ${invalid} metadata`, () => {
  const root = directory(), database = join(root, "state.db"), target = join(root, "target");
  fs.writeFileSync(target, "synthetic database", { mode: 0o600 });
  if (invalid === "symlink") fs.symlinkSync(target, database);
  else if (invalid === "hardlink") fs.linkSync(target, database);
  else fs.writeFileSync(database, "synthetic database", { mode: 0o600 });
  windows(database); policy.refuse = invalid === "policy";
  assert.throws(() => RuntimeAdmission.syntheticFixture(database), /unsafe synthetic fixture database/u);
  assert.equal(fs.readFileSync(target, "utf8"), "synthetic database");
});
it.skipIf(process.platform === "win32")("retains POSIX synthetic observation signatures", () => {
  const root = directory(), database = join(root, "state.db"); fs.writeFileSync(database, "synthetic database", { mode: 0o600 });
  const stat = vi.spyOn(fs, "lstatSync"); syncBuiltinESMExports();
  const admission = RuntimeAdmission.syntheticFixture(database);
  try {
    assert.ok(stat.mock.calls.length > 0);
    for (const [, options] of stat.mock.calls) assert.deepEqual(options, { throwIfNoEntry: false });
  } finally { admission.release(); }
});
