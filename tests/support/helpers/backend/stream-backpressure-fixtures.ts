

import { BackfillGapObservationSchema } from "../../../../src/backend/runs/notifications/backfill-gap.js";

import {
createDashboardStreamHub,
type DashboardStreamHub
} from "../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";


import { claimEventOf, makeWorld, queuedEventOf, type DashboardWorld } from "./dashboard-harness.js";

export function createStreamBackpressureFixtures(worlds: DashboardWorld[], hubs: DashboardStreamHub[], MAX_PENDING: number) {
  async function harness(): Promise<{ w: DashboardWorld; hub: DashboardStreamHub }> {
    const w = await makeWorld();
    worlds.push(w);
    const hub = createDashboardStreamHub({
      projection: w.projection,
      maxPending: MAX_PENDING,
      backfillGaps: {
        detected: (input: unknown) => Promise.resolve({ published: false as const, gap: BackfillGapObservationSchema.parse(input) }),
      },
    });
    hubs.push(hub);
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    return { w, hub };
  }
  return { harness };
}
