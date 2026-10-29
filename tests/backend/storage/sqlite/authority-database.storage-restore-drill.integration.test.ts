import { createStorageRestoreTestWorld } from "../../../support/helpers/backend/storage-restore-world.js";
import assert from "node:assert/strict";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { observeRuntimeLockSnapshot } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";

const {CLOCK, composeStorageCommand, attemptingDrillPaths, corrupt, cleanup } = createStorageRestoreTestWorld();


afterEach(cleanup);

describe("corruption → degraded → restore → rebuild, through the CLI", () => {

  it("observes a crashed holder as stopped rather than bricking recovery", async () => {
    const { paths, closeDatabase, manifestPath, originalChild, workerLock } = await attemptingDrillPaths(
      undefined, undefined, { crashedHolder: true });
    closeDatabase();
    assert.equal(originalChild.signal, "SIGKILL"); assert.ok(workerLock);
    assert.equal(workerLock.pid, originalChild.pid); assert.equal(workerLock.releasedAt, null);
    corrupt(paths);

    const lockPath = join(paths.processLockRoot, "workers", `${workerLock.acquisitionId}.lock.json`);
    const captureLock = () => {
      const stat = lstatSync(lockPath);
      return { bytes: readFileSync(lockPath), device: stat.dev, inode: stat.ino, mode: stat.mode, owner: stat.uid,
        links: stat.nlink, size: stat.size, modifiedAt: stat.mtimeMs, changedAt: stat.ctimeMs };
    };
    const lockBefore = captureLock();
    const snapshot = observeRuntimeLockSnapshot(
      { processLockRoot: paths.processLockRoot, sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(paths.authorityPath) },
      CLOCK,
    );
    assert.equal(snapshot.processLocks.workers.state, "stopped");
    assert.equal(readdirSync(join(paths.processLockRoot, "workers")).length, 1);
    assert.deepEqual(captureLock(), lockBefore);

    const restored = await composeStorageCommand(
      rebuildRuntimeIsolation,
      ["restore", "--from", manifestPath],
      CLOCK,
      paths.repoRoot,
    );
    assert.equal(restored.exitCode, 0, restored.output);
  });
});
