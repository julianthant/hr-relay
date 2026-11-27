// @vitest-environment jsdom
// The inbox mounted in the app, fed snapshot and rows-only change envelopes through the production day subscription.
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import type { BulkBatchOutcome } from "../../../src/dashboard/app/commands/bulk-dispatch.js";
import { DashboardApp } from "../../../src/dashboard/app/dashboard-app.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { subscribeDashboardDay } from "../../../src/dashboard/client/subscriptions/subscription.js";
import type { DashboardTransport, SseMessage, StreamHandle } from "../../../src/dashboard/client/transport.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { PRODUCT_WORKFLOW_COMPOSITION } from "../../../src/dashboard/app/workflow-sources.js";
import { NotificationWireSchema, type NotificationWire } from "../../../src/models/dashboard/projection.js";
import { NotificationCommandRequestSchema } from "../../../src/rules/commands/commands.js";
import { FIXTURE_DAY_WIRE } from "../../support/helpers/dashboard/mock-world/fixture-queue.js";
import { createFixtureBff } from "../../support/helpers/dashboard/fixture-bff.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); localStorage.clear(); window.history.replaceState(null, "", "/"); });

const NOTIFICATION = NotificationWireSchema.parse({ kind: "notification", notificationId: "00000000-0000-4000-8000-000000000111", actorId: "local-operator", channel: "inbox", count: 1,
  publicationId: "a".repeat(64), trigger: "verified-done", readState: "unread", state: "unread", severity: "info", title: "Run completed", occurredAt: "2026-08-03T17:00:00Z", revision: 1,
  context: { state: "available", subject: "Served subject", workflow: "Person Lookup" }, sourceEvent: { state: "available", kind: "verified-done" },
  link: { kind: "run", runId: FIXTURE_DAY_WIRE.queueSurfaces[0].runId } });
const READY = { state: "available", value: { state: "ready", pending: 0 } } as const;
const UNAVAILABLE = { state: "unavailable", error: { state: "error", code: "DASHBOARD_READ_FAILED", message: "Relay could not load this.", retryable: true } } as const;
const statusRow = (value: typeof READY | typeof UNAVAILABLE) => ({ model: "notification-status", key: "local-operator", value });
const listRow = (value: readonly NotificationWire[]) => ({ model: "notification-list", key: "local-operator", value: { state: "available", value } });
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });

/** The app on `?day=`, its day stream answered by envelopes the test pushes; every other read is the fixture BFF's. */
async function mount(day: string = FIXTURE_DAY_WIRE.day, bulkOutcome?: BulkBatchOutcome, others: readonly NotificationWire[] = []) {
  const { app } = createFixtureBff();
  const opened: { day: string; lastEventId: string | undefined; push: (envelope: unknown) => void; end: () => void }[] = [];
  const commands: string[] = [];
  const requested: string[] = [];
  /** The row the server can deliver on the stream after accepting a command. */
  let served: NotificationWire | undefined = NOTIFICATION;
  let rest = [...others];
  const cleared: string[] = [];
  const listedByServer = () => [...(served === undefined ? [] : [served]), ...rest];
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => {
    const path = new URL(url).pathname;
    requested.push(path);
    if (path === "/api/v1/notifications") return Response.json(listedByServer());
    if (path === `/api/v1/notifications/${NOTIFICATION.notificationId}/target`) return Response.json({ kind: "run", runId: FIXTURE_DAY_WIRE.queueSurfaces[0].runId, day: FIXTURE_DAY_WIRE.day });
    if (path === "/api/v1/commands") {
      const body = init?.body; if (typeof body !== "string") throw new Error("command body must be JSON text");
      const command = NotificationCommandRequestSchema.parse(JSON.parse(body)); commands.push(command.type);
      if (command.type === "notification-read" && served?.kind === "notification") served = NotificationWireSchema.parse({ ...served, readState: "read", state: "read", revision: served.revision + 1 });
      const members = "members" in command.target ? command.target.members : [command.target];
      if (command.type === "notification-clear") {
        const ids = members.map(({ notificationId }) => notificationId); cleared.push(...ids);
        if (ids.includes(NOTIFICATION.notificationId)) served = undefined;
        rest = rest.filter(row => !ids.includes(row.notificationId));
      }
      return Response.json({ state: "applied", commandId: command.commandId, affectedTargets: members.map(({ notificationId }) => ({ family: "notification", notificationId })),
        notificationReceipt: { actorId: command.target.actorId, changes: members.map(({ notificationId, expectedVersion }) => ({ notificationId, revision: expectedVersion + 1 })) } });
    }
    return app.request(url, init);
  } });
  const subscribeDay: typeof client.subscribeDay = input => {
    const transport = {
      openStream(_path: string, options: Readonly<{ lastEventId?: string; onMessage: (message: SseMessage) => void }>): StreamHandle {
        let end = () => {};
        const done = new Promise<void>(resolve => { end = resolve; });
        opened.push({ day: input.day, lastEventId: options.lastEventId, push: envelope => options.onMessage({ data: JSON.stringify(envelope) }), end });
        return Object.freeze({ done, close: () => undefined });
      },
    } as unknown as DashboardTransport;
    return subscribeDashboardDay({ ...input, transport, reconnectDelayMs: 0 });
  };
  window.history.replaceState(null, "", `/?day=${day}`);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root?.render(createElement(DashboardClientProvider, { client: { ...client, subscribeDay },
    children: createElement(DashboardApp, { workflowComposition: () => bulkOutcome === undefined ? PRODUCT_WORKFLOW_COMPOSITION : { ...PRODUCT_WORKFLOW_COMPOSITION, harness: { bulkOutcome } } }) })); });
  await settle();
  const stream = () => { const last = opened.at(-1); assert(last, "the app opened no day stream"); return last; };
  /** hello, the snapshot with the status row the server read, then `health: live`. */
  const greet = async (status: typeof READY | typeof UNAVAILABLE) => {
    const { day: streamed, push } = stream();
    await act(async () => {
      push({ type: "hello", wireVersion: 1, descriptorHash: FIXTURE_DAY_WIRE.descriptorHash, projectionGeneration: FIXTURE_DAY_WIRE.projectionGeneration, cursor: "pc:1" });
      push({ type: "snapshot", topic: "dashboard-day", cursor: "pc:1", position: 0, rows: [statusRow(status), listRow([NOTIFICATION, ...others])],
        payload: { ...FIXTURE_DAY_WIRE, day: streamed, snapshotCursor: "pc:1" } });
      push({ type: "health", state: "live" });
    });
    await settle();
  };
  /** The stream ends and one resumes from the held cursor: hello then live, with its handoff change still waiting on a panel read. */
  const resume = async () => {
    const before = opened.length;
    await act(async () => { stream().end(); });
    await settle();
    assert.equal(opened.length, before + 1, "the stream reopens");
    assert.equal(stream().lastEventId, `pc:${cursor}`);
    await act(async () => {
      stream().push({ type: "hello", wireVersion: 1, descriptorHash: FIXTURE_DAY_WIRE.descriptorHash, projectionGeneration: FIXTURE_DAY_WIRE.projectionGeneration, cursor: `pc:${cursor}` });
      stream().push({ type: "health", state: "live" });
    });
    await settle();
  };
  let cursor = 1;
  /** A rows-only change carrying the status row, as the hub sends when the status moves or its retry reads it. */
  const change = async (status: typeof READY | typeof UNAVAILABLE, handoff = false, rows = listedByServer()) => {
    const after = `pc:${cursor}`; cursor += 1;
    await act(async () => { stream().push({ type: "change", topic: "dashboard-day", cursor: `pc:${cursor}`, after, position: 0,
      rows: [statusRow(status), ...(handoff ? [listRow(rows)] : [])] }); });
    await settle();
  };
  const openBell = async () => {
    const bell = host.querySelector<HTMLButtonElement>('button[aria-label^="Notifications,"]'); assert(bell, host.querySelector('button[aria-label^="Notifications"]')?.getAttribute("aria-label") ?? "no bell");
    await act(async () => bell.click()); await settle();
  };
  /** A snapshot at a new cursor and then a publication of `row`, delivered together so React renders them in one batch. */
  const snapshotThenPublication = async (row: NotificationWire) => {
    const { day: streamed, push } = stream();
    const snapshotAt = `pc:${cursor + 1}`, publishedAt = `pc:${cursor + 2}`; cursor += 2;
    await act(async () => {
      push({ type: "snapshot", topic: "dashboard-day", cursor: snapshotAt, position: 0, rows: [statusRow(READY)],
        payload: { ...FIXTURE_DAY_WIRE, day: streamed, snapshotCursor: snapshotAt } });
      push({ type: "notification-publication", cursor: publishedAt, day: streamed, descriptorHash: FIXTURE_DAY_WIRE.descriptorHash, projectionGeneration: FIXTURE_DAY_WIRE.projectionGeneration,
        publication: { sourceId: "b".repeat(64), actorId: row.actorId, durable: "created", notification: row }, listed: row,
        target: { kind: "run", runId: FIXTURE_DAY_WIRE.queueSurfaces[0].runId, day: streamed } });
    });
    await settle();
  };
  const open = () => { const found = document.querySelector<HTMLButtonElement>("li.notice-row button.notice-main"); assert(found, "open"); return found; };
  const control = (label: string) => { const found = document.querySelector<HTMLButtonElement>(`li.notice-row button[aria-label="${label}"]`); assert(found, label); return found; };
  const listed = () => [...document.querySelectorAll(".notice-title")].map(title => title.textContent);
  const notice = () => document.querySelector(".notice-status")?.textContent ?? "";
  const targetReads = () => requested.filter(path => path.endsWith("/target")).length;
  return { host, opened, commands, cleared, requested, greet, change, resume, snapshotThenPublication, openBell, open, control, listed, notice, targetReads };
}

it("confirms read and clear from the command replies without requesting the inbox list", async () => {
  const m = await mount();
  await m.greet(READY);
  await m.openBell();

  await act(async () => m.control("Mark as read").click()); await settle();
  assert.equal(m.control("Mark as unread").disabled, false);
  await act(async () => m.control("Clear notification").click()); await settle();
  assert.deepEqual(m.listed(), []);
  assert.deepEqual(m.commands, ["notification-read", "notification-clear"]);
  assert(!m.requested.includes("/api/v1/notifications"));
  assert.doesNotMatch(m.notice(), /could not|replaced|pending/iu);
});

it("clears only the chosen notice through the served command, and a fresh served read keeps it cleared", async () => {
  const second = NotificationWireSchema.parse({ ...NOTIFICATION, notificationId: "00000000-0000-4000-8000-000000000333", publicationId: "d".repeat(64),
    title: "Second run completed", context: { state: "available", subject: "Second subject", workflow: "Person Lookup" } });
  const m = await mount(FIXTURE_DAY_WIRE.day, undefined, [second]);
  await m.greet(READY);
  await m.openBell();
  assert.deepEqual([...m.listed()].sort(), ["Second subject", "Served subject"]);
  const row = [...document.querySelectorAll<HTMLElement>("li.notice-row")].find(found => found.querySelector(".notice-title")?.textContent === "Second subject");
  const clear = row?.querySelector<HTMLButtonElement>('button[aria-label="Clear notification"]');
  assert(clear, "the second notice has Clear");
  await act(async () => clear.click()); await settle();
  assert.deepEqual(m.commands, ["notification-clear"]);
  assert.deepEqual(m.cleared, [second.notificationId], "the command names the chosen notice only");
  assert.deepEqual(m.listed(), ["Served subject"]);
  await m.change(READY, true);
  assert.deepEqual(m.listed(), ["Served subject"], "the server's fresh list keeps it cleared");
});

it("shows another tab's read and clear from actor-keyed stream rows", async () => {
  const m = await mount();
  await m.greet(READY);
  await m.openBell();
  assert.equal(m.control("Mark as read").disabled, false);

  await m.change(READY, true, [NotificationWireSchema.parse({ ...NOTIFICATION, readState: "read", state: "read", revision: 2 })]);
  assert.equal(m.control("Mark as unread").disabled, false);
  await m.change(READY, true, []);
  assert.deepEqual(m.listed(), []);
  assert.deepEqual(m.commands, []);
  assert(!m.requested.includes("/api/v1/notifications"));
});

it("shows a first snapshot whose status could not be read as display-only rows, then restores the controls when a change delivers it", async () => {
  const m = await mount();
  await m.greet(UNAVAILABLE);
  await m.openBell();
  assert.deepEqual(m.listed(), ["Served subject"], "the day's rows show while the status is unavailable");
  assert.match(m.notice(), /could not load/u);
  assert.equal(m.control("Mark as read").disabled, true);
  assert.equal(m.open().disabled, true, "Open cannot act or take focus while the status is unavailable");

  await m.change(READY);

  assert.doesNotMatch(m.notice(), /could not load/u);
  assert.equal(m.control("Mark as read").disabled, false);
  assert.equal(m.open().disabled, false);
  await act(async () => m.control("Mark as read").click()); await m.change(READY);
  assert.deepEqual(m.commands, ["notification-read"]);
  await act(async () => m.open().click()); await settle();
  assert.equal(m.targetReads(), 1, "Open reads the row's target once the status is back");
});

it("turns the controls off when a status update cannot be read, and back on when the retried status arrives", async () => {
  const m = await mount();
  await m.greet(READY);
  await m.openBell();
  assert.equal(m.control("Mark as read").disabled, false);

  await m.change(UNAVAILABLE);

  assert.deepEqual(m.listed(), ["Served subject"], "the held rows stay");
  assert.match(m.notice(), /could not load/u);
  assert.equal(m.control("Mark as read").disabled, true);
  assert.equal(m.open().disabled, true, "Open cannot act or take focus while the status is unavailable");
  const clearAll = () => document.querySelector<HTMLButtonElement>('button[aria-label="Clear all"]');
  assert.equal(m.control("Clear notification").disabled, true);
  assert.equal(clearAll()?.disabled, true, "Clear all has nothing it may clear");
  assert.deepEqual(m.commands, []);

  await m.change(READY);

  assert.equal(m.control("Clear notification").disabled, false);
  assert.equal(clearAll()?.disabled, false);
  assert.doesNotMatch(m.notice(), /could not load/u);
  assert.equal(m.control("Mark as read").disabled, false);
  assert.equal(m.open().disabled, false);
  await act(async () => m.open().click()); await settle();
  assert.equal(m.targetReads(), 1, "Open reads the row's target once the status is back");
});

it("keeps served clears off when a resumed stream is live before its status row, while a local result still clears", async () => {
  const m = await mount(FIXTURE_DAY_WIRE.day, { commandId: "0f3b6d5a-2e5a-4b8f-9a4e-1c2d3e4f5a6b", plan: { verb: "resume", label: "Resume", eligible: [], skipped: [], unavailable: [] },
    subjects: new Map(), response: { state: "refused", code: "policy-refused", message: "Relay is pausing work to quit." } });
  await m.greet(READY);
  await m.openBell();
  const clearAll = () => { const found = document.querySelector<HTMLButtonElement>('button[aria-label="Clear all"]'); assert(found, "clear all"); return found; };
  const clearOf = (title: string) => {
    const rows = [...document.querySelectorAll<HTMLElement>("li.notice-row")].filter(row => row.querySelector(".notice-title")?.textContent === title);
    const found = rows[0]?.querySelector<HTMLButtonElement>('button[aria-label="Clear notification"]'); assert(found, title); return found;
  };
  assert.deepEqual([...m.listed()].sort(), ["Resume: nothing was sent", "Served subject"]);
  assert.equal(clearOf("Served subject").disabled, false);

  await m.resume();

  assert.equal(clearOf("Served subject").disabled, true);
  assert.equal(clearOf("Resume: nothing was sent").disabled, false);
  assert.equal(clearAll().disabled, false, "Clear all still takes the local result");
  await act(async () => clearAll().click()); await settle();
  assert.deepEqual(m.listed(), ["Served subject"], "only the local result is cleared");
  assert.equal(clearAll().disabled, true);
  assert.deepEqual(m.commands, []);

  await m.change(READY);
  assert.equal(clearOf("Served subject").disabled, true, "the held list remains stale");
  await m.change(READY, true);

  assert.equal(clearOf("Served subject").disabled, false);
  assert.equal(clearAll().disabled, false);
});

it("keeps a publication that arrives in the same delivery as the snapshot before it", async () => {
  const m = await mount();
  await m.greet(READY);
  await m.openBell();
  const published = NotificationWireSchema.parse({ ...NOTIFICATION, notificationId: "00000000-0000-4000-8000-000000000222", publicationId: "c".repeat(64),
    title: "Second run completed", context: { state: "available", subject: "Second subject", workflow: "Person Lookup" }, occurredAt: "2026-08-03T17:05:00Z" });

  await m.snapshotThenPublication(published);

  assert.deepEqual(m.listed(), ["Second subject", "Served subject"], "the publication stands over the snapshot the stream accepted before it");
});

for (const link of ["2099-01-01", "not-a-date"]) it(`loads the inbox from today's stream on a cold link to ${link}`, async () => {
  const m = await mount(link);
  assert.equal(m.opened.length, 1, "the queue date opens no stream, the inbox opens one");
  assert.notEqual(m.opened[0]?.day, link);
  await m.greet(READY);
  await m.openBell();
  assert.deepEqual(m.listed(), ["Served subject"]);
  assert.equal(m.control("Mark as read").disabled, false);

  await act(async () => m.control("Mark as read").click()); await settle();

  assert.deepEqual(m.commands, ["notification-read"]);
  assert.equal(m.control("Mark as unread").disabled, false, "the accepted mark-read's readback shows the row as read");
  assert.doesNotMatch(m.notice(), /could not|replaced/iu);
});
