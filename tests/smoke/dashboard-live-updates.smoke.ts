/** Live-update smoke: the requests the dashboard makes after one server event. Each live-update ticket lowers the counts it covers. */
import type { Page } from "@playwright/test";
import type { DashboardPage } from "../support/helpers/dashboard/smoke/dashboard-page.js";
import type { SeededServer } from "../support/helpers/dashboard/served-fixtures/seeded-bff.js";
import { expect, SEEDED_PREFERENCE_WRITE, test } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";

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

type RunEvent = "run starting" | "run starting, its row not yet reconciled" | "step finishing" | "gate parking" | "declared gate parking";
type View = "queue only" | "that run open" | "another run open";

/** The status a queue row shows for a run parked at a gate. */
const PARKED = "Review";

const seededRun = (key: string) => (server: SeededServer): string => {
  const runId = server.runIds[key];
  if (runId === undefined) throw new Error(`Missing seeded run: ${key}`);
  return runId;
};
/** `run` answers the run the event will move, before the page opens; `fire` is the event. */
/** `workflow` is the queue the run's row is on, when it is not the one the dashboard opens on. `shows` is the status the row must show before requests are counted. */
const EVENTS: Record<RunEvent, { workflow?: string; shows?: string; run(server: SeededServer): string | Promise<string>; fire(server: SeededServer): string | Promise<string> }> = {
  "run starting": { run: seededRun("queuedRun"), fire: server => server.drive.startQueuedRun() },
  "run starting, its row not yet reconciled": { run: seededRun("queuedRun"), fire: server => server.drive.startQueuedRunAheadOfItsRow() },
  "step finishing": { run: seededRun("runningRun"), fire: server => server.drive.finishRunningStep() },
  // Person Lookup declares no gate: its running run takes the parked-gate lifecycle at a task node.
  "gate parking": { shows: PARKED, run: seededRun("runningRun"), fire: server => server.drive.parkRunningRunAtGate() },
  // A Work-Study run held at its first read goes on and its executor parks it at the gate the workflow declares.
  "declared gate parking": { workflow: "Work-Study", shows: PARKED, run: server => server.drive.startDeclaredGateRun(), fire: server => server.drive.parkAtDeclaredGate() },
};

const RUN = "GET /api/v1/runs/{id}";
const LOGS = "GET /api/v1/runs/{id}/logs";
const STREAM = "GET /events/v1";

/** Requests in the quiet window after the event, sorted. The design's target for every cell is none. */
const BASELINE: Record<RunEvent, Partial<Record<View, readonly string[]>>> = {
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
  // The Work-Study queue holds this one run, so there is no other run to hold open beside it.
  "declared gate parking": {
    "queue only": [],
    "that run open": [RUN, LOGS, "GET /api/v1/runs/{id}/identity-gate", "GET /api/v1/runs/{id}/workbook-writes"],
  },
};

async function openView(dashboard: DashboardPage, view: View, eventRun: string, workflow: string | undefined): Promise<void> {
  await dashboard.open();
  if (workflow !== undefined) await dashboard.openWorkflow(workflow);
  if (view === "that run open") await dashboard.openRun(eventRun);
  if (view === "another run open") await dashboard.openRun(dashboard.runId("doneRun"));
}

for (const event of Object.keys(BASELINE) as RunEvent[]) {
  for (const view of Object.keys(BASELINE[event]) as View[]) {
    test(`${event}, ${view}: requests after the event`, async ({ dashboard, failures, page, seeded }) => {
      if (EVENTS[event].workflow !== undefined) failures.allow(SEEDED_PREFERENCE_WRITE, "the seeded backend cannot save the chosen workflow");
      const seen = watchRequests(page);
      const eventRun = await EVENTS[event].run(seeded);
      await openView(dashboard, view, eventRun, EVENTS[event].workflow);
      await quiet(page, seen);
      const row = page.locator(`[data-demo-row-id="${eventRun}"]`).first();
      const before = await row.textContent();
      seen.length = 0;

      await EVENTS[event].fire(seeded);

      await expect.poll(() => row.textContent(), { message: "the queue row shows the event" }).not.toBe(before);
      const { shows } = EVENTS[event];
      if (shows !== undefined) await expect(row, "the queue row shows the run's new status").toContainText(shows);
      await quiet(page, seen);
      expect([...seen].sort()).toEqual([...BASELINE[event][view] ?? []].sort());
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
