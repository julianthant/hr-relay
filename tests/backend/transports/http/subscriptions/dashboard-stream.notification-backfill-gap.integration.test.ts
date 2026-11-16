import { createNotificationBackfillTestWorld } from "../../../../support/helpers/backend/notification-backfill-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { createBackfillGapNotifier } from "../../../../../src/backend/runs/notifications/backfill-gap.js";
import { createDashboardStreamHub } from "../../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../../src/rules/identity/ids.js";
import { DAY, makeWorld as makeDashboardWorld, queuedEventOf } from "../../../../support/helpers/backend/dashboard-harness.js";

const { disposers, world, cleanup } = createNotificationBackfillTestWorld();

afterEach(cleanup);

describe("backfill-gap notification", () => {

  it("persists one gap when a requested cursor has fallen outside retained history", async () => {
    const { inbox } = await world();
    const dashboard = await makeDashboardWorld();
    disposers.push(async () => await dashboard.dispose());
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
