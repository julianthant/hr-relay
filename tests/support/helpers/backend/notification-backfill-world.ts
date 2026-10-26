import { createNotificationInbox } from "../../../../src/backend/runs/notifications/inbox.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { NOW } from "../../fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";
import { openBoundDatabaseFixture } from "../admission-fixture.js";





export function createNotificationBackfillTestWorld() {
  const disposers: (() => void)[] = [];

  function world() {
    const clock = manualClock(new Date(NOW));
    const opened = openBoundDatabaseFixture("backfill-gap-test", clock);
    disposers.push(() => opened.close());
    const database = opened.database;
    const inbox = createNotificationInbox({
      authority: database,
      clock,
      ids: sequentialIdFactory("b"),
      actorId: LOCAL_OPERATOR_ACTOR_ID,
    });
    return { database, inbox };
  }
  const cleanup = () => {
    for (const dispose of disposers.splice(0)) dispose();
  };
  return { disposers, world, cleanup };
}
