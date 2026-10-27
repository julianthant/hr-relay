import { createStorageRestoreTestWorld } from "../../../support/helpers/backend/storage-restore-world.js";
import assert from "node:assert/strict";
import {readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { acquireRuntimeProcessLock, observeRuntimeLockSnapshot } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";

const {CLOCK, composeStorageCommand, drillPaths, open, seedRealShapedAuthority, takeBackup, corrupt, pretendAliveIdentity, deadPid, cleanup } = createStorageRestoreTestWorld();


afterEach(cleanup);

describe("corruption → degraded → restore → rebuild, through the CLI", () => {

  it("observes a crashed holder as stopped rather than bricking recovery", async () => {
    const paths = await drillPaths();
    const database = open(paths);
    seedRealShapedAuthority(database,paths);
    const manifestPath = await takeBackup(database, paths);
    database.close();
    corrupt(paths);

    // A worker that died without releasing: the file still says `held`, but
    // the pid is gone. Refusing here forever would make a crash unrecoverable.
    acquireRuntimeProcessLock(
      {
        processLockRoot: paths.processLockRoot,
        name: "workers",
        workerId: "person-lookup-worker-1",
        pid: deadPid(),
      },
      CLOCK,
      { observeProcessIdentity: pretendAliveIdentity },
    );
    const snapshot = observeRuntimeLockSnapshot(
      { processLockRoot: paths.processLockRoot, sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(paths.authorityPath) },
      CLOCK,
    );
    assert.equal(snapshot.processLocks.workers.state, "stopped");
    // The lock FILE is untouched by the observation — nothing rewrites another
    // process's record to make a restore possible.
    assert.equal(readdirSync(join(paths.processLockRoot, "workers")).length, 1);

    const restored = await composeStorageCommand(
      rebuildRuntimeIsolation,
      ["restore", "--from", manifestPath],
      CLOCK,
      paths.repoRoot,
    );
    assert.equal(restored.exitCode, 0, restored.output);
  });
});
