import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { it, vi } from "vitest";
import { readProfileDatabaseBinding } from "../../../../src/backend/storage/sqlite/profile-local-databases.js";
import * as snapshots from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { AUTHORITY_APPLICATION_ID, CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";

vi.mock("../../../../src/backend/storage/private-path.js", async load => {
  const original = await load<typeof import("../../../../src/backend/storage/private-path.js")>();
  return { ...original, privatePathRejects(path: string, stat: Parameters<typeof original.privatePathRejects>[1], rule: Parameters<typeof original.privatePathRejects>[2]) {
    if (process.platform === "win32") assert.equal(typeof stat.ino, "bigint");
    return original.posixPrivatePathRejects(path, stat, rule);
  } };
});

for (const changed of [false, true]) it(`reads source and snapshot with exact Windows IDs; changed=${changed}`, () => {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "binding-exact-"))), path = join(root, "state.db");
  const binding = { installationId: randomUUID(), profileId: randomUUID() };
  const database = new DatabaseSync(path);
  database.exec(`PRAGMA user_version=${CURRENT_AUTHORITY_SCHEMA_VERSION}; PRAGMA application_id=${AUTHORITY_APPLICATION_ID};
    CREATE TABLE database_states(id INTEGER PRIMARY KEY, installation_id TEXT, profile_id TEXT)`);
  database.prepare("INSERT INTO database_states VALUES(1, ?, ?)").run(binding.installationId, binding.profileId);
  database.close(); fs.chmodSync(path, 0o600);
  const host = process.platform, snapshot = snapshots.createReadonlyAuthoritySnapshot(path), lstat = fs.lstatSync;
  const platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  let reads = 0;
  vi.spyOn(fs, "lstatSync").mockImplementation((file, options) => {
    const info = lstat(file, options);
    if (process.platform === "win32" && (file === path || file === snapshot.path) && info !== undefined && typeof info.ino === "bigint") {
      info.ino = 21_110_623_253_370_483n;
      if (file === path && ++reads > 1 && changed) info.ino++;
    }
    return info;
  });
  syncBuiltinESMExports();
  vi.spyOn(snapshots, "createReadonlyAuthoritySnapshot").mockReturnValue({ ...snapshot,
    assertUnchanged() { platform.mockReturnValue(host); try { snapshot.assertUnchanged(); } finally { platform.mockReturnValue("win32"); } },
    dispose() { platform.mockReturnValue(host); try { snapshot.dispose(); } finally { platform.mockReturnValue("win32"); } },
  });
  try {
    if (changed) assert.throws(() => readProfileDatabaseBinding(path), /profile-database-identity-changed|profile-database-binding-read-failed/u);
    else assert.deepEqual(readProfileDatabaseBinding(path), { state: "bound", schemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, binding });
    assert.ok(reads > 1);
  } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); snapshot.dispose(); fs.rmSync(root, { recursive: true }); }
});
