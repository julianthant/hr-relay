import assert from "node:assert/strict";
import { copyFileSync, lstatSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { it, vi } from "vitest";
import { composeStorageCommand } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { readProfileDatabaseBinding } from "../../../../src/backend/storage/sqlite/profile-local-databases.js";
import * as readonlySnapshots from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

it("preserves the exact stopped-backup source witness after pending profile initialization", async () => {
  const f = createBoundProfileFixture({ pending: true }), clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  copyFileSync("package.json", join(f.workspace, "package.json"));
  try {
    const input = (args: readonly string[]) => composeStorageCommand(rebuildRuntimeIsolation, args, clock, f.workspace, f.admission);
    assert.equal((await input(["upgrade", "--plan", "--json"])).exitCode, 0);
    assert.equal((await input(["upgrade", "--json"])).exitCode, 0);
    AuthorityDatabase.inspectStoppedUpgrade(f.admission, f.path, join(f.workspace, rebuildRuntimeIsolation.processLockRoot), clock);
    const database = new DatabaseSync(f.path, { readOnly: true });
    try { assert.deepEqual(database.prepare("SELECT * FROM settings").all(), []); }
    finally { database.close(); }
    const witness = () => ["", "-wal", "-shm", "-journal"].map(suffix => {
      const stat = lstatSync(`${f.path}${suffix}`, { throwIfNoEntry: false });
      return stat === undefined ? null : [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs];
    });
    const before = witness();
    assert.equal(readProfileDatabaseBinding(f.path).state, "bound");
    assert.deepEqual(witness(), before);
    const backup = await input(["backup", "--json"]);
    assert.equal(backup.exitCode, 0, backup.output);
    assert.deepEqual(witness(), before);
  } finally { f.close(); }
});

it("refuses a source sidecar change during the shared binding read", () => {
  const f = createBoundProfileFixture(), createSnapshot = readonlySnapshots.createReadonlyAuthoritySnapshot;
  let changed = false;
  const snapshots = vi.spyOn(readonlySnapshots, "createReadonlyAuthoritySnapshot").mockImplementation(path => {
    const snapshot = createSnapshot(path);
    return { ...snapshot, assertUnchanged: () => {
      if (!changed && path === f.path) { changed = true; writeFileSync(`${path}-shm`, "synthetic changed sidecar", { flag: "a", mode: 0o600 }); }
      snapshot.assertUnchanged();
    } };
  });
  try {
    assert.throws(() => readProfileDatabaseBinding(f.path), /authority-readonly-source-changed/u);
    assert.equal(changed, true);
  } finally { snapshots.mockRestore(); f.close(); }
});
