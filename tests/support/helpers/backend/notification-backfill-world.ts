import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNotificationInbox } from "../../../../src/backend/runs/notifications/inbox.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { NOW } from "../../fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase } from "../synthetic-storage-admission.js";





export function createNotificationBackfillTestWorld() {
  const disposers: (() => void)[] = [];

  function world() {
    const root = mkdtempSync(join(tmpdir(), "hrauto-backfill-gap-"));
    const clock = manualClock(new Date(NOW));
    const database = AuthorityDatabase.open(
      { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "backfill-gap-test" },
      clock,
    );
    disposers.push(() => {
      database.close();
      rmSync(root, { recursive: true, force: true });
    });
    const inbox = createNotificationInbox({
      authority: database,
      clock,
      ids: sequentialIdFactory("b"),
      actorId: LOCAL_OPERATOR_ACTOR_ID,
    });
    return { database, inbox };
  }
  return { disposers, world };
}
