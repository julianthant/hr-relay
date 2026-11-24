/** Live-update smoke: the requests the dashboard makes after one server event. Each live-update ticket lowers the counts it covers. */
import type { Page, TestInfo } from "@playwright/test";
import { DashboardStreamEnvelopeSchema, type DashboardStreamEnvelope } from "../../src/models/dashboard/subscription.js";
import type { DashboardPage } from "../support/helpers/dashboard/smoke/dashboard-page.js";
import type { SeededServer } from "../support/helpers/dashboard/served-fixtures/seeded-bff.js";
import { SEEDED_DAY, SEEDED_NOW } from "../support/helpers/dashboard/served-fixtures/seeded-bff.js";
import { seededRequestOver, startScriptedRun } from "../support/helpers/dashboard/served-fixtures/seeded-scripted-executor.js";
import { test as scriptedTest } from "../support/helpers/dashboard/smoke/scripted-run-fixtures.js";
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
async function quiet(page: Page, seen: readonly string[], windowMs = QUIET_MS): Promise<void> {
  for (let count = -1; count !== seen.length;) {
    count = seen.length;
    await page.waitForTimeout(windowMs);
  }
}

type RunEvent = "run starting" | "run starting, its row not yet reconciled" | "step finishing" | "gate parking";
type View = "queue only" | "that run open" | "another run open";

/** The status a queue row shows for a run parked at a gate. */
const PARKED = "Review";

const seededRun = (key: string) => (server: SeededServer): string => {
  const runId = server.runIds[key];
  if (runId === undefined) throw new Error(`Missing seeded run: ${key}`);
  return runId;
};
/** `run` answers the run the event will move, before the page opens; `fire` is the event. */
/** `shows` is the status the row must show before requests are counted. */
const EVENTS: Record<RunEvent, { shows?: string; run(server: SeededServer): string; fire(server: SeededServer): string }> = {
  "run starting": { run: seededRun("queuedRun"), fire: server => server.drive.startQueuedRun() },
  "run starting, its row not yet reconciled": { run: seededRun("queuedRun"), fire: server => server.drive.startQueuedRunAheadOfItsRow() },
  "step finishing": { run: seededRun("runningRun"), fire: server => server.drive.finishRunningStep() },
  // Person Lookup declares no gate: its running run takes the parked-gate lifecycle at a task node.
  "gate parking": { shows: PARKED, run: seededRun("runningRun"), fire: server => server.drive.parkRunningRunAtGate() },
};

const STREAM = "GET /events/v1";

/** Requests in the quiet window after the event, sorted. The run panel reads from the stream, so every cell is none. */
const NONE: Record<View, readonly string[]> = { "queue only": [], "that run open": [], "another run open": [] };
const BASELINE: Record<RunEvent, Partial<Record<View, readonly string[]>>> = {
  "run starting": NONE,
  // The panel may be ahead of its row; it is shown and the day is not read again.
  "run starting, its row not yet reconciled": NONE,
  "step finishing": NONE,
  "gate parking": NONE,
};

async function openView(dashboard: DashboardPage, view: View, eventRun: string): Promise<void> {
  await dashboard.open();
  if (view === "that run open") await dashboard.openRun(eventRun);
  if (view === "another run open") await dashboard.openRun(dashboard.runId("doneRun"));
}

for (const event of Object.keys(BASELINE) as RunEvent[]) {
  for (const view of Object.keys(BASELINE[event]) as View[]) {
    test(`${event}, ${view}: requests after the event`, async ({ dashboard, page, seeded }) => {
      const seen = watchRequests(page);
      const eventRun = EVENTS[event].run(seeded);
      await openView(dashboard, view, eventRun);
      await quiet(page, seen);
      const row = page.locator(`[data-demo-row-id="${eventRun}"]`).first();
      const before = await row.textContent();
      seen.length = 0;

      EVENTS[event].fire(seeded);

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

// A Work-Study run held at its first read goes on and the executor parks it at the gate the workflow declares.
// The Work-Study queue holds this one run, so there is no other run to hold open beside it.
const DECLARED_GATE_BASELINE: Partial<Record<View, readonly string[]>> = {
  "queue only": [],
  "that run open": [],
};

for (const view of Object.keys(DECLARED_GATE_BASELINE) as View[]) {
  scriptedTest(`declared gate parking, ${view}: requests after the event`, async ({ dashboard, failures, page, seeded }) => {
    failures.allow(SEEDED_PREFERENCE_WRITE, "the seeded backend cannot save the chosen workflow");
    const seen = watchRequests(page);
    await dashboard.open();
    await dashboard.openWorkflow("Work-Study");
    const runId = await startScriptedRun(seededRequestOver(seeded.baseUrl), SEEDED_NOW, "10812345", seeded.scripted.reviewReference());
    const run = await seeded.scripted.drive(runId);
    const row = page.locator(`[data-demo-row-id="${runId}"]`).first();
    await expect(row).toContainText("Running");
    if (view === "that run open") await dashboard.openRun(runId);
    // The failed workflow-preference save reads Settings back up to 1.5 s apart; it must finish before counting.
    await quiet(page, seen, 2_000);
    seen.length = 0;

    expect(await run.advance()).toMatchObject({ at: "settled", outcome: { state: "parked-gate" } });

    await expect(row, "the queue row shows the run's new status").toContainText(PARKED);
    if (view === "that run open") await expect(dashboard.runPanel.getByRole("button", { name: "Continue anyway", exact: true }), "the open panel shows the gate").toBeVisible();
    await quiet(page, seen);
    expect([...seen].sort()).toEqual([...DECLARED_GATE_BASELINE[view] ?? []].sort());
  });
}

/** One envelope a run-topic stream received, with its arrival time. */
interface Received { readonly envelope: DashboardStreamEnvelope; readonly at: number }

/** A second stream that names a run topic, opened with the page's own stream headers. The client does not ask for rows yet. */
async function openRunTopic(headers: Record<string, string>, baseUrl: string, runId: string) {
  const controller = new AbortController();
  const openedAt = performance.now();
  const response = await fetch(`${baseUrl}/events/v1?topics=dashboard-day:${SEEDED_DAY},run:${runId}`, { headers, signal: controller.signal });
  expect(response.status, "the run topic is served").toBe(200);
  const body = response.body;
  if (body === null) throw new Error("the run topic stream has no body");
  const received: Received[] = [];
  void (async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      const reader = body.getReader();
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        buffer += decoder.decode(chunk.value, { stream: true });
        for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
          const data = buffer.slice(0, end).split("\n").filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n");
          buffer = buffer.slice(end + 2);
          if (data !== "") received.push({ envelope: DashboardStreamEnvelopeSchema.parse(JSON.parse(data)), at: performance.now() });
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    }
  })();
  return { openedAt, received, close: () => controller.abort() };
}

/** Resolves once the stream has received nothing for a full quiet window. */
async function streamQuiet(page: Page, received: readonly Received[]): Promise<void> {
  for (let count = -1; count !== received.length;) {
    count = received.length;
    await page.waitForTimeout(QUIET_MS);
  }
}

/** `type` and, for envelopes that carry rows, the panel state of each row. */
function shapeOf({ envelope }: Received): string {
  if (envelope.type !== "change" && envelope.type !== "snapshot") return envelope.type;
  const day = envelope.type === "change" && envelope.day !== undefined ? "+day" : "";
  return `${envelope.type}${day}[${envelope.rows.map(row => row.value.state).join(",")}]`;
}

function recordMs(testInfo: TestInfo, type: string, ms: number): void {
  testInfo.annotations.push({ type, description: `${ms.toFixed(1)} ms` });
  console.log(`${testInfo.title} :: ${type} = ${ms.toFixed(1)} ms`);
}

type TopicView = "that run on the topic" | "another run on the topic";

/** Envelopes a `run:<id>` connection receives after the event. Each row is read by the routes' own queries. */
const TOPIC_BASELINE: Partial<Record<RunEvent, Record<TopicView, readonly string[]>>> = {
  // The start replaces the whole day twice; each snapshot carries the panel.
  "run starting": {
    "that run on the topic": ["snapshot[available]", "snapshot[available]"],
    "another run on the topic": ["snapshot[available]", "snapshot[available]"],
  },
  "step finishing": {
    "that run on the topic": ["change+day[available]"],
    "another run on the topic": ["change+day[]"],
  },
  "gate parking": {
    "that run on the topic": ["change+day[available]", "snapshot[available]"],
    "another run on the topic": ["change+day[]", "snapshot[available]"],
  },
};

for (const event of Object.keys(TOPIC_BASELINE) as RunEvent[]) {
  for (const view of Object.keys(TOPIC_BASELINE[event] ?? {}) as TopicView[]) {
    test(`${event}, ${view}: stream envelopes after the event`, async ({ dashboard, page, seeded }, testInfo) => {
      const eventRun = EVENTS[event].run(seeded);
      const topicRun = view === "that run on the topic" ? eventRun : dashboard.runId("doneRun");
      const pageStream = page.waitForRequest(request => new URL(request.url()).pathname === "/events/v1");
      await dashboard.open();
      const stream = await openRunTopic(await (await pageStream).allHeaders(), seeded.baseUrl, topicRun);
      await expect.poll(() => stream.received.some(({ envelope }) => envelope.type === "snapshot"), { message: "the handoff snapshot arrives" }).toBe(true);
      const snapshot = stream.received.find(({ envelope }) => envelope.type === "snapshot");
      if (snapshot === undefined) throw new Error("no snapshot");
      expect(shapeOf(snapshot), "the handoff snapshot carries the panel").toBe("snapshot[available]");
      recordMs(testInfo, "handoff panel read", snapshot.at - stream.openedAt);
      await streamQuiet(page, stream.received);
      const before = stream.received.length;

      const firedAt = performance.now();
      EVENTS[event].fire(seeded);

      await expect.poll(() => stream.received.length, { message: "the stream carries the event" }).toBeGreaterThan(before);
      await streamQuiet(page, stream.received);
      const after = stream.received.slice(before);
      const withRow = after.find(({ envelope }) => (envelope.type === "change" || envelope.type === "snapshot") && envelope.rows.length > 0);
      if (withRow !== undefined) recordMs(testInfo, "event to panel row", withRow.at - firedAt);
      stream.close();
      expect(after.map(shapeOf)).toEqual(TOPIC_BASELINE[event]?.[view]);
    });
  }
}

test("opening a run: one stream request and no run reads", async ({ dashboard, page, seeded }) => {
  const seen = watchRequests(page);
  await dashboard.open();
  await quiet(page, seen);
  seen.length = 0;

  await dashboard.openRun(seeded.runIds.runningRun ?? "");
  await expect(dashboard.runPanel.getByRole("region", { name: "Run logs" })).toBeVisible();
  await quiet(page, seen);

  expect(seen).toEqual([STREAM]);
});

test("a note-only commit reaches the open panel with no request", async ({ dashboard, page, seeded }) => {
  const runId = seeded.runIds.runningRun ?? "";
  const seen = watchRequests(page);
  await dashboard.open();
  await dashboard.openRun(runId);
  await expect(dashboard.runPanel.getByRole("region", { name: "Run logs" })).toBeVisible();
  await quiet(page, seen);
  seen.length = 0;

  seeded.drive.addRunningNote("A note that moves no queue row");

  await expect(dashboard.runPanel.getByText("A note that moves no queue row")).toBeVisible();
  await quiet(page, seen);
  expect(seen).toEqual([]);
});

test("the open-gate run's refusal shows from the stream, with no run read and no reconnect", async ({ dashboard, page, seeded }) => {
  const seen = watchRequests(page);
  await dashboard.open();
  await quiet(page, seen);
  seen.length = 0;

  await dashboard.openRun(dashboard.runId("openGateRun"));
  await expect(dashboard.runPanel.getByText("These logs don't match this run.", { exact: true })).toBeVisible();
  await quiet(page, seen);
  expect(seen, "opening a run costs its one stream request").toEqual([STREAM]);
  const runningRow = page.locator(`[data-demo-row-id="${seeded.runIds["runningRun"]}"]`).first();
  const before = await runningRow.textContent();
  seen.length = 0;

  seeded.drive.finishRunningStep();
  await expect.poll(() => runningRow.textContent(), { message: "the queue row shows the event" }).not.toBe(before);
  await expect(dashboard.runPanel.getByText("These logs don't match this run.", { exact: true }), "the refusal is still shown").toBeVisible();
  await quiet(page, seen);
  expect(seen, "the queue keeps updating and the refused panel reads nothing").toEqual([]);
});
