import { randomUUID } from "node:crypto";
import { admitDirectWorker } from "../../../../src/backend/storage/sqlite/worker-slots.js";

import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";


import {
CONFIG_SNAPSHOT,
NOW
} from "../../fixtures/phase1c-contract-fixtures.js";
import {
WORKER_START_REQUEST as BASE_WORKER_START_REQUEST,
WORKFLOW_ID
} from "../../fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase } from "../synthetic-storage-admission.js";

import type { Clock } from "../../../../src/rules/time/clock.js";

export function createRunClaimFixtures(
  CLOCK: Clock,
  roots: string[],
  databases: AuthorityDatabase[],
  WORKER_START_REQUEST: typeof BASE_WORKER_START_REQUEST,
  WORKER_ID: string,
) {
  function openDatabase(): AuthorityDatabase {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-rebuild-runs-"));
    roots.push(root);
    const database = AuthorityDatabase.open(
      { path: join(root, "state.sqlite"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
      CLOCK,
    );
    database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    for (const poolIndex of [1, 2]) database.withAuthorityTransaction(repositories => {
      admitDirectWorker(repositories, { commandId: randomUUID(), workflow: WORKFLOW_ID, poolIndex,
        expectedPoolVersion: repositories.workerPools.get(WORKFLOW_ID)?.version ?? 0, processId: WORKER_START_REQUEST.processId,
        processAcquisitionId: randomUUID(), authorityPath: join(root, "state.sqlite"), processLockRoot: join(root, "locks"), now: NOW }, randomUUID());
    });
    databases.push(database);
    return database;
  }

  function claimOne(database: AuthorityDatabase, now = NOW) {
    const outcome = database.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId: WORKER_ID, now });
    if (outcome.state !== "claimed") throw new Error(`expected a claim, got ${outcome.state}`);
    return outcome.run;
  }
  return { openDatabase, claimOne };
}
