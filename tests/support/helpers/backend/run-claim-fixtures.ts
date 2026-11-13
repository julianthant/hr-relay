import { admitFixtureSlot, testWorkerLifetime } from "../../fixtures/run-lifecycle-fixtures.js";

import { createBoundProfileFixture, type BoundProfileStorageFixture } from "../admission-fixture.js";



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
  profileFixture: () => Promise<BoundProfileStorageFixture> = createBoundProfileFixture,
) {
  const profiles: BoundProfileStorageFixture[] = [];
  async function openDatabase(): Promise<AuthorityDatabase> {
    const profile = await profileFixture(); profiles.push(profile);
    const root = profile.stateRoot; roots.push(root);
    const database = AuthorityDatabase.open(
      { path: profile.path, busyTimeoutMs: 250, migrationOwner: "unit-test" },
      CLOCK,
    );
    database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    for (const poolIndex of [1, 2]) database.withAuthorityTransaction(repositories => {
      admitFixtureSlot(repositories, WORKFLOW_ID, poolIndex, NOW);
    });
    databases.push(database);
    return database;
  }

  function claimLifetime(database: AuthorityDatabase, poolIndex: number) {
    const member = database.authority.workerSlots.list(WORKFLOW_ID).find(slot => slot.poolIndex === poolIndex && slot.retiredAt === null);
    if (member === undefined) throw new Error("claim fixture requires its actual admitted member");
    return testWorkerLifetime(database, WORKFLOW_ID, poolIndex);
  }

  function claimOne(database: AuthorityDatabase, now = NOW) {
    claimLifetime(database, 1);
    const outcome = database.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId: WORKER_ID, now });
    if (outcome.state !== "claimed") throw new Error(`expected a claim, got ${outcome.state}`);
    return outcome.run;
  }
  const cleanup = async () => {
    for (const database of databases.splice(0)) database.close();
    for (const profile of profiles.splice(0)) await profile.close();
    roots.splice(0);
  };
  return { openDatabase, claimOne, claimLifetime, cleanup };
}

export function heldClaim<T extends object>(run: { readonly lifecycle: object }, lifecycle: T) {
  const fields = run.lifecycle;
  if (!("workerLifetime" in fields) || fields.workerLifetime === undefined) return lifecycle;
  return { ...lifecycle };
}
