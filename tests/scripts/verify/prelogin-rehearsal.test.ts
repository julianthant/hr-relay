import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, vi } from "vitest";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { assertCopyInsideTmp, closeThenDelete, copyWorkspace, occupiedReservedPorts, rebindControlWorkspace, rehearsalControlFiles } from "../../../scripts/verify/prelogin-rehearsal.js";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

describe("prelogin rehearsal guards", () => {
  it("refuses an occupied reserved port and accepts them when all three are free", async () => {
    const busy = rebuildRuntimeIsolation.frontendPort;
    const seen: number[] = [];
    assert.deepEqual(await occupiedReservedPorts(async port => { seen.push(port); return port !== busy; }), [busy]);
    assert.deepEqual(seen, [rebuildRuntimeIsolation.backendPort, rebuildRuntimeIsolation.lockPort, rebuildRuntimeIsolation.frontendPort]);
    assert.deepEqual(await occupiedReservedPorts(async () => true), []);
  });

  it("rebinds workspace in the three control files and keeps the other fields", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "rebind-"));
    try {
      const next = join(root, "copy");
      for (const relative of rehearsalControlFiles) {
        const path = join(root, relative);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, `${JSON.stringify({ schemaVersion: 1, installationId: "keep", workspace: "/old", role: "state" })}\n`, { mode: 0o600 });
      }
      rebindControlWorkspace(root, next);
      for (const relative of rehearsalControlFiles) {
        assert.deepEqual(JSON.parse(readFileSync(join(root, relative), "utf8")), {
          schemaVersion: 1, installationId: "keep", workspace: next, role: "state",
        });
      }
      const link = join(root, rehearsalControlFiles[0]);
      rmSync(link);
      symlinkSync(join(root, rehearsalControlFiles[1]), link);
      assert.throws(() => rebindControlWorkspace(root, next), /prelogin-control-symlink/u);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("refuses a control directory that a copied symlink points back at the source", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "rebind-link-"));
    try {
      const source = join(root, "source"), copy = join(root, "copy");
      const sourceFile = join(source, rehearsalControlFiles[0]);
      mkdirSync(dirname(sourceFile), { recursive: true });
      writeFileSync(sourceFile, `${JSON.stringify({ workspace: "/source" })}\n`);
      const before = readFileSync(sourceFile);
      mkdirSync(dirname(dirname(join(copy, rehearsalControlFiles[0]))), { recursive: true });
      symlinkSync(dirname(sourceFile), dirname(join(copy, rehearsalControlFiles[0])));
      assert.throws(() => rebindControlWorkspace(copy, copy), /prelogin-control-outside-copy/u);
      assert.deepEqual(readFileSync(sourceFile), before);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("fails a copy with a closed token and prints none of cp's diagnostics", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "copy-fail-"));
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      assert.throws(() => { copyWorkspace(join(root, "private-sentinel-missing"), join(root, "copy")); }, /^Error: prelogin-copy-failed$/u);
      assert.doesNotMatch(JSON.stringify([...stderr.mock.calls, ...stdout.mock.calls]), /private-sentinel/u);
    } finally {
      stderr.mockRestore(); stdout.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the copy when its storage owners did not close", async () => {
    const lines: string[] = [];
    const remove = vi.fn();
    const ok = await closeThenDelete(() => { throw new Error("authority-source-closure-unproved: detail"); }, () => Promise.resolve(), remove, line => { lines.push(line); });
    assert.equal(ok, false);
    assert.equal(remove.mock.calls.length, 0);
    assert.deepEqual(lines, ["FAIL authority-source-closure-unproved", "KEPT copy closure-unproved"]);
    assert.equal(await closeThenDelete(() => undefined, () => Promise.resolve(), remove, line => { lines.push(line); }), true);
    assert.equal(remove.mock.calls.length, 1);
  });

  it("accepts a copy under the temp root and refuses any other path", () => {
    const root = realpathSync(tmpdir());
    const copy = mkdtempSync(join(root, "prelogin-guard-"));
    try { assertCopyInsideTmp(copy, root); }
    finally { rmSync(copy, { recursive: true, force: true }); }
    assert.throws(() => assertCopyInsideTmp(repositoryRoot, root), /prelogin-copy-outside-tmp/u);
    assert.throws(() => assertCopyInsideTmp(root, root), /prelogin-copy-outside-tmp/u);
  });
});
