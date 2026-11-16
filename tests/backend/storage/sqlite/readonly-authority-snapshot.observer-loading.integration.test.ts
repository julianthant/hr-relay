// @vitest-environment jsdom
import assert from "node:assert/strict";
import children from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it, vi } from "vitest";

const observed = vi.hoisted(() => ({ children: [] as Array<{ args: readonly string[]; status: number | null; stderr: string }> }));
vi.mock("../../../../src/backend/storage/windows-observer-policy.js", () => ({
  windowsObserverPolicyPrelude() { throw new Error("POSIX-observer-touched-Windows-asset"); },
}));

describe.skipIf(process.platform === "win32")("POSIX observers imported through jsdom", () => {
  for (const observer of ["snapshot", "binding"] as const) {
    it(`runs the ${observer} child with plain CommonJS from a scratch cwd`, async () => {
      const root = mkdtempSync(join(realpathSync(tmpdir()), "relay-observer-loading-")), path = join(root, "source.sqlite");
      const binding = { installationId: randomUUID(), profileId: randomUUID() };
      const spawn = children.spawnSync;
      vi.spyOn(children, "spawnSync").mockImplementation((command, args, options) => {
        const result = spawn(command, args, { ...options, cwd: root });
        observed.children.push({ args: args ?? [], status: result.status, stderr: String(result.stderr) });
        return result;
      });
      syncBuiltinESMExports();
      vi.resetModules();
      const { AUTHORITY_APPLICATION_ID, CURRENT_AUTHORITY_SCHEMA_VERSION } = await import("../../../../src/backend/storage/sqlite/migrations.js");
      const database = new DatabaseSync(path);
      try {
        database.exec(`PRAGMA user_version=${CURRENT_AUTHORITY_SCHEMA_VERSION}; PRAGMA application_id=${AUTHORITY_APPLICATION_ID};
          CREATE TABLE database_states(id INTEGER PRIMARY KEY, installation_id TEXT, profile_id TEXT)`);
        database.prepare("INSERT INTO database_states VALUES(1, ?, ?)").run(binding.installationId, binding.profileId);
      } finally { database.close(); }
      observed.children.length = 0;
      try {
        const before = readFileSync(path);
        if (observer === "snapshot") {
          const { createReadonlyAuthoritySnapshot } = await import("../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js");
          const snapshot = createReadonlyAuthoritySnapshot(path);
          try { assert.ok(readFileSync(snapshot.path).equals(before)); snapshot.assertUnchanged(); }
          finally { snapshot.dispose(); }
        } else {
          const { assertLiveProfileDatabaseBinding } = await import("../../../../src/backend/storage/sqlite/profile-local-databases.js");
          assertLiveProfileDatabaseBinding(path, binding);
        }
        assert.equal(observed.children.length, 1);
        const child = observed.children[0]; assert.ok(child);
        assert.equal(child.status, 0, child.stderr);
        assert.deepEqual(child.args.slice(0, 2), ["--input-type=commonjs", "-e"]);
        const script = child.args[2]; assert.ok(script);
        assert.match(script, /require\("node:fs"\)/u);
        assert.doesNotMatch(script, /tsx|await import|windows-observer-policy/u);
        assert.ok(readFileSync(path).equals(before));
      } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); rmSync(root, { recursive: true }); }
    });
  }
});
