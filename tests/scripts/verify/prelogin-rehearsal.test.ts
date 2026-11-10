import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { assertCopyInsideTmp, occupiedReservedPorts, rebindControlWorkspace, rehearsalControlFiles } from "../../../scripts/verify/prelogin-rehearsal.js";

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

  it("accepts a copy under the temp root and refuses any other path", () => {
    const root = realpathSync(tmpdir());
    const copy = mkdtempSync(join(root, "prelogin-guard-"));
    try { assertCopyInsideTmp(copy, root); }
    finally { rmSync(copy, { recursive: true, force: true }); }
    assert.throws(() => assertCopyInsideTmp(repositoryRoot, root), /prelogin-copy-outside-tmp/u);
    assert.throws(() => assertCopyInsideTmp(root, root), /prelogin-copy-outside-tmp/u);
  });
});
