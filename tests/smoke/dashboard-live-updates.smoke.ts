/** Live-update smoke: the requests the dashboard makes after one server event. Each live-update ticket lowers the counts it covers. */
import type { Page } from "@playwright/test";
import type { DashboardPage } from "../support/helpers/dashboard/smoke/dashboard-page.js";
import type { SeededServer } from "../support/helpers/dashboard/served-fixtures/seeded-bff.js";
import { expect, test } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";

/** The once-a-second lifecycle poll is not caused by an event and is counted apart. */
const LIFECYCLE_POLL = "/api/v1/application-lifecycle";
const QUIET_MS = 1_000;

/** Every API and stream request the page starts, as `METHOD path` with ids replaced. */
function watchRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", request => {
    const { pathname } = new URL(request.url());
    if (!pathname.startsWith("/api/") && !pathname.startsWith("/events/")) return;
    if (pathname === LIFECYCLE_POLL) return;
    seen.push(`${request.method()} ${pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu, "{id}")}`);
  });
  return seen;
}

/** Resolves once no request has started for a full quiet window. */
async function quiet(page: Page, seen: readonly string[]): Promise<void> {
  for (let count = -1; count !== seen.length;) {
    count = seen.length;
    await page.waitForTimeout(QUIET_MS);
  }
}

type RunEvent = "run starting" | "run starting, its row not yet reconciled" | "step finishing" | "gate parking";
type View = "queue only" | "that run open" | "another run open";

const DRIVE: Record<RunEvent, (server: SeededServer) => string> = {
  "run starting": server => server.drive.startQueuedRun(),
  "run starting, its row not yet reconciled": server => server.drive.startQueuedRunAheadOfItsRow(),
  "step finishing": server => server.drive.finishRunningStep(),
  "gate parking": server => server.drive.parkRunningRunAtGate(),
};
const EVENT_RUN: Record<RunEvent, string> = { "run starting": "queuedRun", "run starting, its row not yet reconciled": "queuedRun", "step finishing": "runningRun", "gate parking": "runningRun" };

const RUN = "GET /api/v1/runs/{id}";
const LOGS = "GET /api/v1/runs/{id}/logs";
const STREAM = "GET /events/v1";

/** Requests in the quiet window after the event, sorted. The design's target for every cell is none. */
const BASELINE: Record<RunEvent, Record<View, readonly string[]>> = {
  "run starting": {
    "queue only": [],
    "that run open": [RUN, LOGS],
    "another run open": [RUN, LOGS],
  },
  // The detail read is ahead of the held row, so the day stream is reopened and every view reads again.
  "run starting, its row not yet reconciled": {
    "queue only": [],
    "that run open": [RUN, RUN, LOGS, LOGS, STREAM, "GET /api/v1/notifications", "GET /api/v1/notifications", "GET /api/v1/notifications/status", "GET /api/v1/notifications/status", "GET /api/v1/settings/editable"],
    "another run open": [RUN, LOGS],
  },
  "step finishing": {
    "queue only": [],
    "that run open": [RUN, LOGS],
    "another run open": [],
  },
  "gate parking": {
    "queue only": [],
    "that run open": [RUN, LOGS, "GET /api/v1/runs/{id}/identity-gate"],
    "another run open": [RUN, LOGS],
  },
};

async function openView(dashboard: DashboardPage, view: View, eventRun: string): Promise<void> {
  await dashboard.open();
  if (view === "that run open") await dashboard.openRun(dashboard.runId(eventRun));
  if (view === "another run open") await dashboard.openRun(dashboard.runId("doneRun"));
}

for (const event of Object.keys(BASELINE) as RunEvent[]) {
  for (const view of Object.keys(BASELINE[event]) as View[]) {
    test(`${event}, ${view}: requests after the event`, async ({ dashboard, page, seeded }) => {
      const seen = watchRequests(page);
      await openView(dashboard, view, EVENT_RUN[event]);
      await quiet(page, seen);
      const row = page.locator(`[data-demo-row-id="${dashboard.runId(EVENT_RUN[event])}"]`).first();
      const before = await row.textContent();
      seen.length = 0;

      DRIVE[event](seeded);

      await expect.poll(() => row.textContent(), { message: "the queue row shows the event" }).not.toBe(before);
      await quiet(page, seen);
      expect([...seen].sort()).toEqual([...BASELINE[event][view]].sort());
    });
  }
}

test("notification published: requests after the event", async ({ dashboard, page, seeded }) => {
  const seen = watchRequests(page);
  await dashboard.open();
  await quiet(page, seen);
  seen.length = 0;

  await seeded.drive.publishNotification();

  await expect.poll(() => seen.length, { message: "the inbox reads after a publication" }).toBeGreaterThan(0);
  await quiet(page, seen);
  expect([...seen].sort()).toEqual(["GET /api/v1/notifications", "GET /api/v1/notifications/status", "GET /api/v1/notifications/{id}/target"].sort());
});
