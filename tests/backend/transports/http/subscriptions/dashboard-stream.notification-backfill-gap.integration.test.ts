
import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import { createBackfillGapNotifier } from "../../../../../src/backend/runs/notifications/backfill-gap.js";
import { createNotificationInbox } from "../../../../../src/backend/runs/notifications/inbox.js";
import { createDashboardStreamHub } from "../../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { NOW } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import {
DAY,
makeWorld as makeDashboardWorld,
queuedEventOf,
} from "../../../../support/helpers/backend/dashboard-harness.js";
import { AuthorityDatabase } from "../../../../support/helpers/synthetic-storage-admission.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

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

describe("backfill-gap notification", () => {

  it("persists one gap when a requested cursor has fallen outside retained history", async () => {
    const { inbox } = world();
    const dashboard = makeDashboardWorld();
    disposers.push(() => dashboard.dispose());
    const hub = createDashboardStreamHub({
      projection: dashboard.projection,
      retention: 1,
      backfillGaps: createBackfillGapNotifier({ inbox }),
    });
    disposers.push(() => hub.close());
    queuedEventOf(dashboard, { seed: 1 });
    const first = await hub.connect({ day: DAY });
    const oldCursor = dashboard.projection.cursor();
    const oldGeneration = dashboard.projection.generation();
    first.close();
    queuedEventOf(dashboard, { seed: 2 });
    queuedEventOf(dashboard, { seed: 3 });

    const expired = await hub.connect({
      day: DAY,
      lastEventId: oldCursor,
      lastProjectionGeneration: oldGeneration,
    });
    expired.close();
    const repeated = await hub.connect({
      day: DAY,
      lastEventId: oldCursor,
      lastProjectionGeneration: oldGeneration,
    });
    repeated.close();
    const clean = await hub.connect({ day: DAY });
    clean.close();

    const rows = inbox.list(LOCAL_OPERATOR_ACTOR_ID);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.trigger, "backfill-gap");
    assert.equal(rows[0]?.count, 1);
  });
});
