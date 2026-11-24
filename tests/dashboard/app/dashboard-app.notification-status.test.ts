// @vitest-environment jsdom
// The inbox mounted in the app, fed snapshot and rows-only change envelopes through the production day subscription.
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
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
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });

/** The app on `?day=`, its day stream answered by envelopes the test pushes; every other read is the fixture BFF's. */
async function mount(day: string = FIXTURE_DAY_WIRE.day, { refuseCommands = false } = {}) {
  const { app } = createFixtureBff();
  const opened: { day: string; push: (envelope: unknown) => void }[] = [];
  const commands: string[] = [];
  /** The row the server lists; an accepted mark-read moves it to read at the next revision, as the readback reads it. */
  let served: NotificationWire = NOTIFICATION;
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/api/v1/notifications") return Response.json([served]);
    if (path === "/api/v1/commands") {
      const body = init?.body; if (typeof body !== "string") throw new Error("command body must be JSON text");
      const command = NotificationCommandRequestSchema.parse(JSON.parse(body)); commands.push(command.type);
      if (refuseCommands) return Response.json({ state: "error", code: "DASHBOARD_READ_FAILED", message: "Relay could not load this.", retryable: false }, { status: 409 });
      if (command.type === "notification-read" && served.kind === "notification") served = NotificationWireSchema.parse({ ...served, readState: "read", state: "read", revision: served.revision + 1 });
      return Response.json({ state: "applied", commandId: command.commandId, affectedTargets: [{ family: "notification", notificationId: NOTIFICATION.notificationId }] });
    }
    return app.request(url, init);
  } });
  const subscribeDay: typeof client.subscribeDay = input => {
    const transport = {
      openStream(_path: string, options: Readonly<{ onMessage: (message: SseMessage) => void }>): StreamHandle {
        opened.push({ day: input.day, push: envelope => options.onMessage({ data: JSON.stringify(envelope) }) });
        return Object.freeze({ done: new Promise<void>(() => undefined), close: () => undefined });
      },
    } as unknown as DashboardTransport;
    return subscribeDashboardDay({ ...input, transport });
  };
  window.history.replaceState(null, "", `/?day=${day}`);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root?.render(createElement(DashboardClientProvider, { client: { ...client, subscribeDay },
    children: createElement(DashboardApp, { workflowComposition: () => PRODUCT_WORKFLOW_COMPOSITION }) })); });
  await settle();
  const stream = () => { const last = opened.at(-1); assert(last, "the app opened no day stream"); return last; };
  /** hello, the snapshot with the status row the server read, then `health: live`. */
  const greet = async (status: typeof READY | typeof UNAVAILABLE) => {
    const { day: streamed, push } = stream();
    await act(async () => {
      push({ type: "hello", wireVersion: 1, descriptorHash: FIXTURE_DAY_WIRE.descriptorHash, projectionGeneration: FIXTURE_DAY_WIRE.projectionGeneration, cursor: "pc:1" });
      push({ type: "snapshot", topic: "dashboard-day", cursor: "pc:1", position: 0, rows: [statusRow(status)],
        payload: { ...FIXTURE_DAY_WIRE, day: streamed, snapshotCursor: "pc:1", notifications: [NOTIFICATION] } });
      push({ type: "health", state: "live" });
    });
    await settle();
  };
  let cursor = 1;
  /** A rows-only change carrying the status row, as the hub sends when the status moves or its retry reads it. */
  const change = async (status: typeof READY | typeof UNAVAILABLE) => {
    const after = `pc:${cursor}`; cursor += 1;
    await act(async () => { stream().push({ type: "change", topic: "dashboard-day", cursor: `pc:${cursor}`, after, position: 0, rows: [statusRow(status)] }); });
    await settle();
  };
  const openBell = async () => {
    const bell = host.querySelector<HTMLButtonElement>('button[aria-label^="Notifications,"]'); assert(bell, host.querySelector('button[aria-label^="Notifications"]')?.getAttribute("aria-label") ?? "no bell");
    await act(async () => bell.click()); await settle();
  };
  const control = (label: string) => { const found = host.querySelector<HTMLButtonElement>(`li.notification-row button[aria-label="${label}"]`); assert(found, label); return found; };
  const listed = () => [...host.querySelectorAll(".notification-item-title")].map(title => title.textContent);
  const notice = () => host.querySelector(".notification-notice")?.textContent ?? "";
  return { host, opened, commands, greet, change, openBell, control, listed, notice };
}

it("shows a first snapshot whose status could not be read as display-only rows, then restores the controls when a change delivers it", async () => {
  const m = await mount();
  await m.greet(UNAVAILABLE);
  await m.openBell();
  assert.deepEqual(m.listed(), ["Run completed"], "the day's rows show while the status is unavailable");
  assert.match(m.notice(), /could not load/u);
  assert.equal(m.control("Mark as read").disabled, true);
  assert.equal(m.control("Dismiss").disabled, true);

  await m.change(READY);

  assert.doesNotMatch(m.notice(), /could not load/u);
  assert.equal(m.control("Mark as read").disabled, false);
  assert.equal(m.control("Dismiss").disabled, false);
  await act(async () => m.control("Mark as read").click()); await m.change(READY);
  assert.deepEqual(m.commands, ["notification-read"]);
});

it("turns the controls off when a status update cannot be read, and back on when the retried status arrives", async () => {
  const m = await mount();
  await m.greet(READY);
  await m.openBell();
  assert.equal(m.control("Mark as read").disabled, false);

  await m.change(UNAVAILABLE);

  assert.deepEqual(m.listed(), ["Run completed"], "the held rows stay");
  assert.match(m.notice(), /could not load/u);
  assert.equal(m.control("Mark as read").disabled, true);
  assert.equal(m.control("Dismiss").disabled, true);
  assert.deepEqual(m.commands, []);

  await m.change(READY);

  assert.doesNotMatch(m.notice(), /could not load/u);
  assert.equal(m.control("Mark as read").disabled, false);
});

it("keeps a dismissed row in the list when its mark-read is refused", async () => {
  const m = await mount(FIXTURE_DAY_WIRE.day, { refuseCommands: true });
  await m.greet(READY);
  await m.openBell();
  await act(async () => m.control("Dismiss").click()); await m.change(READY);
  assert.deepEqual(m.commands, ["notification-read"]);
  assert.deepEqual(m.listed(), ["Run completed"], "Dismiss hides a row only once its mark-read is accepted");
});

for (const link of ["2099-01-01", "not-a-date"]) it(`loads the inbox from today's stream on a cold link to ${link}`, async () => {
  const m = await mount(link);
  assert.equal(m.opened.length, 1, "the queue date opens no stream, the inbox opens one");
  assert.notEqual(m.opened[0]?.day, link);
  await m.greet(READY);
  await m.openBell();
  assert.deepEqual(m.listed(), ["Run completed"]);
  assert.equal(m.control("Mark as read").disabled, false);

  await act(async () => m.control("Mark as read").click()); await settle();

  assert.deepEqual(m.commands, ["notification-read"]);
  assert.equal(m.control("Mark as unread").disabled, false, "the accepted mark-read's readback shows the row as read");
  assert.doesNotMatch(m.notice(), /could not|replaced/iu);
});

for (const link of ["2099-01-01", "not-a-date"]) it(`dismisses a row through today's stream on a cold link to ${link}`, async () => {
  const m = await mount(link);
  await m.greet(READY);
  await m.openBell();

  await act(async () => m.control("Dismiss").click()); await settle();

  assert.deepEqual(m.commands, ["notification-read"]);
  assert.deepEqual(m.listed(), [], "Dismiss hides the row once its mark-read is accepted");
});
