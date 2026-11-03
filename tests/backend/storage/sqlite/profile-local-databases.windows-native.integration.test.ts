import assert from "node:assert/strict";
import children from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it, vi } from "vitest";
import { assertLiveProfileDatabaseBinding } from "../../../../src/backend/storage/sqlite/profile-local-databases.js";
import { createReadonlyAuthoritySnapshot } from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { AUTHORITY_APPLICATION_ID, CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { createWindowsPrivateFixture, setWindowsFixtureAcl } from "../../../support/helpers/windows-private-path-fixture.js";

function databaseFixture() {
  const fixture = createWindowsPrivateFixture(), path = join(fixture.root, "authority.sqlite");
  const binding = { installationId: randomUUID(), profileId: randomUUID() };
  const database = new DatabaseSync(path);
  try {
    database.exec(`PRAGMA user_version=${CURRENT_AUTHORITY_SCHEMA_VERSION}; PRAGMA application_id=${AUTHORITY_APPLICATION_ID};
      CREATE TABLE database_states(id INTEGER PRIMARY KEY, installation_id TEXT, profile_id TEXT)`);
    database.prepare("INSERT INTO database_states VALUES(1, ?, ?)").run(binding.installationId, binding.profileId);
  } finally { database.close(); }
  return { ...fixture, path, binding };
}

describe.skipIf(process.platform !== "win32")("isolated SQLite observers use native private-path policy", () => {
  it("loads the shared native policy in both actual observer children", () => {
    const f = databaseFixture();
    try {
      const before = readFileSync(f.path);
      assert.doesNotThrow(() => assertLiveProfileDatabaseBinding(f.path, f.binding));
      const snapshot = createReadonlyAuthoritySnapshot(f.path);
      try {
        assert.ok(readFileSync(snapshot.path).equals(before));
        snapshot.assertUnchanged();
      } finally { snapshot.dispose(); }
      assert.ok(readFileSync(f.path).equals(before));
    } finally { f.close(); }
  });

  for (const observer of ["binding", "snapshot"] as const) {
    it(`refuses newly broad access inside the ${observer} child`, () => {
      const f = databaseFixture(), spawn = children.spawnSync;
      let changed = false;
      vi.spyOn(children, "spawnSync").mockImplementation((command, args, options) => {
        assert.ok(Array.isArray(args));
        assert.equal(args[0], "--input-type=module");
        assert.equal(args[3], "--import=tsx");
        setWindowsFixtureAcl(f.root, true); changed = true;
        return spawn(command, args, options);
      });
      syncBuiltinESMExports();
      try {
        const before = readFileSync(f.path);
        assert.throws(() => observer === "binding"
          ? assertLiveProfileDatabaseBinding(f.path, f.binding) : createReadonlyAuthoritySnapshot(f.path),
        /profile-database-identity-invalid|authority-readonly-source-unsafe|Windows storage/u);
        assert.equal(changed, true);
        assert.ok(readFileSync(f.path).equals(before));
      } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); f.close(); }
    });
  }
});
