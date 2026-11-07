import { createNotificationInbox } from "../../../../src/backend/runs/notifications/inbox.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { NOW } from "../../fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";
import { openBoundDatabaseFixture, createBoundProfileFixture, type BoundProfileStorageFixture } from "../admission-fixture.js";





export function createNotificationBackfillTestWorld(profileFixture: () => Promise<BoundProfileStorageFixture> = createBoundProfileFixture) {
  const disposers: (() => void | Promise<void>)[] = [];

  async function world() {
    const clock = manualClock(new Date(NOW));
    const opened = await openBoundDatabaseFixture("backfill-gap-test", clock, undefined, undefined, undefined, undefined, profileFixture);
    disposers.push(async () => await opened.close());
    const database = opened.database;
    const inbox = createNotificationInbox({
      authority: database,
      clock,
      ids: sequentialIdFactory("b"),
      actorId: LOCAL_OPERATOR_ACTOR_ID,
    });
    return { database, inbox };
  }
  const cleanup = async () => {
    for (const dispose of disposers.splice(0)) await dispose();
  };
  return { disposers, world, cleanup };
}
