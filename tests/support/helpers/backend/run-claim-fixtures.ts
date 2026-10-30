import { randomUUID } from "node:crypto";
import { admitDirectWorker } from "../../../../src/backend/storage/sqlite/worker-slots.js";

import { createBoundProfileFixture } from "../admission-fixture.js";



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
  const profiles: Awaited<ReturnType<typeof createBoundProfileFixture>>[] = [];
  async function openDatabase(): Promise<AuthorityDatabase> {
    const profile = await createBoundProfileFixture(); profiles.push(profile);
    const root = profile.stateRoot; roots.push(root);
    const database = AuthorityDatabase.open(
      { path: profile.path, busyTimeoutMs: 250, migrationOwner: "unit-test" },
      CLOCK,
    );
    database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    for (const poolIndex of [1, 2]) database.withAuthorityTransaction(repositories => {
      admitDirectWorker(repositories, { commandId: randomUUID(), workflow: WORKFLOW_ID, poolIndex,
    expectedPoolVersion: repositories.workerPools.get(WORKFLOW_ID)?.version ?? 0, processId: WORKER_START_REQUEST.processId,
    now: NOW }, randomUUID());
    });
    databases.push(database);
    return database;
  }

  function claimOne(database: AuthorityDatabase, now = NOW) {
    const outcome = database.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId: WORKER_ID, now });
    if (outcome.state !== "claimed") throw new Error(`expected a claim, got ${outcome.state}`);
    return outcome.run;
  }
  const cleanup = async () => {
    for (const database of databases.splice(0)) database.close();
    for (const profile of profiles.splice(0)) await profile.close();
    roots.splice(0);
  };
  return { openDatabase, claimOne, cleanup };
}
