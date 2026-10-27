import { createNotificationCompositionTestWorld } from "../../../../support/helpers/backend/notification-composition-world.js";
import { describe, expect, it } from "vitest";
import { createTrustNotifications } from "../../../../../src/backend/app/composition/dashboard/notifications.js";
import { sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { runRecordOf } from "../../../../support/helpers/backend/dashboard-harness.js";

const { fixture, seedRun } = createNotificationCompositionTestWorld();

describe("canonical notification producers", () => {
  it("publishes gate and write occurrences once across observation restarts", async () => {
    const f = await fixture();
    try {
      seedRun(f, runRecordOf({ seed: 1, lifecycle: { state: "parked-gate", gateId: "confirm", parkedAt: f.clock.now().toISOString(), resumeAt: "collect" } }));
      const composition = () => createTrustNotifications({ database: f.db, clock: f.clock, ids: sequentialIdFactory("b"), reader: f.reader });
      await composition().observer.observe();
      const row = f.inbox.list("local-operator")[0]; f.inbox.markRead(row.notificationId, 1);
      await composition().observer.observe(); expect(f.inbox.get(row.notificationId)?.status).toBe("read"); expect(f.inbox.get(row.notificationId)?.count).toBe(1);
    } finally { await f.close(); }
  });
});
