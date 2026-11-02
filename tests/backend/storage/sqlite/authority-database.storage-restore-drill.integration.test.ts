import { createStorageRestoreTestWorld } from "../../../support/helpers/backend/storage-restore-world.js";
import assert from "node:assert/strict";
import { WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";

const { repairAutomatically, attemptingDrillPaths, corrupt, cleanup } = createStorageRestoreTestWorld();


afterEach(cleanup);

describe("corruption → degraded → restore → rebuild, through the CLI", () => {

  it("recovers after actual crashed-holder death without treating durable worker identity as process authority", async () => {
    const { paths, closeDatabase, originalChild, workerLease } = await attemptingDrillPaths(
      undefined, undefined, { crashedHolder: true });
    closeDatabase();
    assert.equal(originalChild.signal, "SIGKILL");
    assert.equal(workerLease.processId, originalChild.pid);
    assert.notEqual(workerLease.lifecycle.state, "stopped");
    corrupt(paths);
    assert.equal(existsSync(join(paths.processLockRoot, "workers")), false);

    const restored = await repairAutomatically(paths);
    assert.equal(restored.exitCode, 0, restored.output);
    paths.renewAfterRestore();
    const readback = AuthorityDatabase.open(paths.admission, { path: paths.authorityPath, busyTimeoutMs: 250, migrationOwner: "crashed-holder-restored-readback" });
    try {
      assert.deepEqual(readback.authority.workerLeases.get(workerLease.workerId), workerLease);
      assert.equal(readback.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)?.status === "attempting", true);
    } finally { readback.close(); }
  });
});
