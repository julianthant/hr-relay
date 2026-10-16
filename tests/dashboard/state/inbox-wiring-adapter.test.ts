// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import { inboxProjection, notificationPolicy, notificationTargetMatches, useInboxWiring, type InboxWiring } from "../../../src/dashboard/state/inbox-wiring-adapter.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { CommandExecutor, type CommandExecutionScope } from "../../../src/dashboard/app/commands/command-executor.js";
import type { DashboardCommandBinding } from "../../../src/dashboard/app/dashboard-app-model.js";
import { NotificationWireSchema, type NotificationWire } from "../../../src/models/dashboard/projection.js";
import { NotificationPublicationWireSchema, type NotificationPublicationWire } from "../../../src/models/dashboard/subscription.js";
import { NotificationCommandRequestSchema, type CommandRequest } from "../../../src/rules/commands/commands.js";
import { FIXTURE_BOOTSTRAP } from "../../support/fixtures/dashboard/fixture-bootstrap.js";
import { FIXTURE_DAY_WIRE } from "../../support/fixtures/dashboard/fixture-queue.js";
import type { DsToast } from "../../../src/dashboard/ds/ui.js";
import { verifyShellCommandEffect } from "../../../src/dashboard/app/commands/command-dispatch.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });
const id = "00000000-0000-4000-8000-000000000111", runId = "00000000-0000-4000-8000-000000000222", failureId = "00000000-0000-4000-8000-000000000333";
const now = "2026-08-03T17:00:00.000Z";
function row(kind = "storage-degraded", overrides: Record<string, unknown> = {}): NotificationWire {
  const triggers: Record<string, string> = { "run-failed": "failed", "subject-mismatch": "failed", "gate-opened": "gate-waiting", "write-parked": "write-parked", "repeating-failure": "repeating", "storage-degraded": "storage", "verified-done": "verified-done" };
  if (kind === "backfill-gap") return NotificationWireSchema.parse({ kind, notificationId: id, actorId: "local-operator", channel: "ping", count: 1, publicationId: "a".repeat(64), severity: "error", title: "Notification history is incomplete", state: "pinned", occurredAt: now, sourceEvent: { state: "available", kind }, ...overrides });
  return NotificationWireSchema.parse({ kind: "notification", notificationId: id, actorId: "local-operator", channel: kind === "verified-done" ? "inbox" : "ping", count: 1, publicationId: "a".repeat(64), severity: "warning", title: kind === "verified-done" ? "Run completed" : "Notification", state: "unread", readState: "unread", trigger: triggers[kind], revision: 1, occurredAt: now,
    context: { state: "available", subject: "Exact subject", workflow: "Person Lookup" }, sourceEvent: { state: "available", kind },
    link: kind === "storage-degraded" ? { kind: "storage" } : ["run-failed", "subject-mismatch", "repeating-failure"].includes(kind) ? { kind: "failure", runId, failureId } : { kind: "run", runId }, ...overrides });
}
function publication(notification: NotificationWire, n = 1) { return NotificationPublicationWireSchema.parse({ sourceId: String(n).repeat(64), actorId: notification.actorId, durable: "created", notification }); }
async function harness(enabled = true, initiallyFailed = false) {
  let rows: readonly NotificationWire[] = [row()], lose = false, refuseTarget = false;
  let snapshotWait: Promise<void> | undefined, postWait: Promise<void> | undefined, failReads = initiallyFailed;
  const requests: string[] = [];
  const commands: CommandRequest[] = [], toasts: Omit<DsToast, "id">[] = [], listeners: ((publication: NotificationPublicationWire) => void)[] = [];
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => {
    const path = new URL(url).pathname; requests.push(path);
    if (path.endsWith("/target")) {
      const linked = rows.find(row => row.notificationId === path.split("/").at(-2));
      if (refuseTarget || linked?.kind !== "notification" || linked.link === undefined) return Response.json({ kind: "refused", reason: "run-unavailable" });
      return Response.json(linked.link.kind === "storage" ? { kind: "storage" } : { ...linked.link, day: "2026-08-03" });
    }
    if (path.endsWith("/status")) return Response.json({ state: "ready", pending: 0 });
    if (path.endsWith("/notifications")) { await snapshotWait; if (failReads) throw new Error("inbox read failed"); return Response.json(rows); }
    if (path.endsWith("/commands")) {
      const body = init?.body; if (typeof body !== "string") throw new Error("command body must be JSON text");
      const command = NotificationCommandRequestSchema.parse(JSON.parse(body)); commands.push(command);
      await postWait;
      rows = rows.map(item => item.kind !== "notification" || item.notificationId !== command.target.notificationId ? item : NotificationWireSchema.parse({ ...item, revision: item.revision + 1,
        readState: command.type === "notification-read" ? "read" : command.type === "notification-unread" ? "unread" : item.readState,
        state: command.type === "notification-snooze" ? "snoozed" : command.type === "notification-unsnooze" ? item.readState : command.type === "notification-read" ? "read" : command.type === "notification-unread" ? "unread" : item.state,
        snoozedUntil: command.type === "notification-snooze" ? "2026-08-03T18:00:00.000Z" : undefined }));
      if (lose) { lose = false; throw new Error("response lost after commit"); }
      return Response.json({ state: "applied", commandId: command.commandId, affectedTargets: [{ family: "notification", notificationId: command.target.notificationId }] });
    }
    throw new Error(`unexpected ${path}`);
  } });
  const epoch = { client, bootstrap: FIXTURE_BOOTSTRAP }, dayRequest = {};
  const scope = { client, authority: epoch, actorId: "local-operator", dayRequest };
  let activeScope: CommandExecutionScope = scope;
  const executor = new CommandExecutor(() => activeScope);
  const binding: DashboardCommandBinding = { executor, scope, feedback() {}, authority: { epoch, nowIso: now, today: "2026-08-03", day: "2026-08-03", catalog: [], selection: { route: { start: false }, workflowId: "" },
    dayState: { request: dayRequest, day: { state: "loaded", value: FIXTURE_DAY_WIRE }, connection: { state: "live" }, refresh() {}, subscribePublications: listener => { listeners.push(listener); return () => { listeners.splice(listeners.indexOf(listener), 1); }; } } } };
  let value: InboxWiring | undefined;
  function Probe({ served, currentBinding, currentClient }: { served: boolean; currentBinding: DashboardCommandBinding; currentClient: typeof client }) { value = useInboxWiring({ client: currentClient, enabled: served, binding: currentBinding, toast: input => { toasts.push(input); return "toast"; }, openInbox() {} }); return null; }
  root = createRoot(document.createElement("div"));
  const render = async (served = enabled, currentBinding = binding, currentClient = client) => { activeScope = currentBinding.scope; await act(async () => { root?.render(createElement(Probe, { served, currentBinding, currentClient })); await new Promise(resolve => setTimeout(resolve, 0)); }); };
  await render();
  return { client, binding, requests, commands, toasts, listeners, render, get value() { assert(value); return value; }, setRows: (next: readonly NotificationWire[]) => { rows = next; }, lose: () => { lose = true; }, refuseTarget: () => { refuseTarget = true; },
    holdReads: () => { let release = () => {}; snapshotWait = new Promise<void>(resolve => { release = resolve; }); return release; },
    holdCommands: () => { let release = () => {}; postWait = new Promise<void>(resolve => { release = resolve; }); return release; },
    failReads: () => { failReads = true; } };
}
it("defines all eight source policies with exact target kinds and honest gap/missing-source notice", () => {
  const kinds = ["run-failed", "subject-mismatch", "gate-opened", "write-parked", "repeating-failure", "storage-degraded", "verified-done", "backfill-gap"];
  assert.deepEqual(kinds.map(kind => notificationPolicy(row(kind))?.tone), ["danger", "danger", "warning", "warning", "danger", "warning", "positive", "warning"]);
  assert.equal(inboxProjection([row("backfill-gap")], now).state.state, "ready");
  assert.match(inboxProjection([row("backfill-gap")], now).notice, /history is incomplete/);
  assert.match(inboxProjection([row("run-failed", { sourceEvent: { state: "unavailable" } })], now).notice, /source evidence is unavailable/);
  assert(notificationTargetMatches(row(), { kind: "storage" }));
  assert.equal(notificationTargetMatches(row(), { kind: "run", runId: FIXTURE_DAY_WIRE.queueSurfaces[0].runId, day: "2026-08-03" }), false);
});
it("confirms read, unread, snooze and unsnooze only through matching shared readback", async () => {
  const h = await harness();
  for (const action of ["read", "unread", "snooze", "unsnooze"] as const) { await act(async () => { assert(await h.value.control(id, action)); }); }
  assert.deepEqual(h.commands.map(command => command.type), ["notification-read", "notification-unread", "notification-snooze", "notification-unsnooze"]);
  for (const command of h.commands) { assert.equal(command.requestedBy, "local-operator"); assert.equal("payload" in command, false); }
  assert.equal(h.toasts.length, 0);
});
it("retains uncertain command identity without automatic or repeated control retry", async () => {
  const h = await harness(); h.lose();
  await act(async () => { assert.equal(await h.value.control(id, "read"), false); });
  const original = h.binding.executor.retainedAttempts()[0]; assert.equal(original.outcome?.kind, "uncertain");
  await act(async () => { assert.equal(await h.value.control(id, "read"), false); });
  assert.equal(h.commands.length, 1); assert.equal(h.binding.executor.retainedAttempts()[0].request.commandId, original.request.commandId);
});
it("toasts only explicit committed publications, suppressing snooze, replay, gaps, missing source and stale scope", async () => {
  const h = await harness(); assert.equal(h.toasts.length, 0);
  const emit = async (value: NotificationPublicationWire) => { await act(async () => { h.listeners[0](value); await new Promise(resolve => setTimeout(resolve, 0)); }); };
  await emit(publication(row())); assert.equal(h.toasts.length, 1); assert.equal(h.toasts[0].tone, "warning");
  await emit(publication(row())); assert.equal(h.toasts.length, 1);
  await emit(publication(row("storage-degraded", { state: "snoozed", snoozedUntil: "2026-08-03T18:00:00Z" }), 2));
  await emit(publication(row("backfill-gap"), 3));
  await emit(publication(row("run-failed", { sourceEvent: { state: "unavailable" } }), 4));
  assert.equal(h.toasts.length, 1);
  const old = h.listeners[0];
  await h.render(true, { ...h.binding, scope: { ...h.binding.scope, dayRequest: {} } });
  await act(async () => old(publication(row(), 5))); assert.equal(h.toasts.length, 1);
});
it("keeps successful Ping values and refuses a stale target without marking it read", async () => {
  const h = await harness(); const completed = row("verified-done"); h.setRows([completed]);
  await act(async () => { h.listeners[0](publication(completed)); await new Promise(resolve => setTimeout(resolve, 0)); });
  assert.equal(h.toasts[0]?.title, "Run completed"); assert.equal(h.toasts[0]?.description, "Exact subject · Person Lookup"); assert.equal(h.toasts[0]?.tone, "success");
  h.refuseTarget(); let refused = "";
  const item = h.value.state.state === "ready" ? h.value.state.items[0] : undefined; assert(item);
  await act(async () => { h.value.open(item, (target, _opened, reject) => { if (target.kind === "refused") reject("Exact refusal"); }, () => assert.fail("must not open"), message => { refused = message; }); await new Promise(resolve => setTimeout(resolve, 0)); });
  assert.equal(refused, "Exact refusal"); assert.equal(h.commands.length, 0);
});
it("refuses foreign actor and wrong revision in shared notification readback", async () => {
  const h = await harness();
  const request = NotificationCommandRequestSchema.parse({ commandId: crypto.randomUUID(), requestedAt: now, requestedBy: "local-operator", source: "dashboard", family: "notification", type: "notification-read", target: { notificationId: id, actorId: "local-operator", expectedVersion: 1 } });
  const reply = { state: "applied" as const, commandId: request.commandId, affectedTargets: [{ family: "notification" as const, notificationId: request.target.notificationId }] };
  for (const next of [row("storage-degraded", { readState: "read", state: "read", revision: 3 }), row("storage-degraded", { actorId: "other-operator", readState: "read", state: "read", revision: 2 })]) {
    h.setRows([next]); assert.equal((await verifyShellCommandEffect(h.client, "2026-08-03", request, reply)).state, "mismatch");
  }
});

it("keeps mock mode disconnected from inbox reads, writes and publications", async () => {
  const h = await harness(false);
  assert.equal(h.requests.length, 0); assert.equal(h.listeners.length, 0);
  assert.equal(await h.value.control(id, "read"), false); assert.equal(h.requests.length, 0);
});

it("delivers two synchronous positive publications and a warning once each without collapsing the batch", async () => {
  const h = await harness();
  const first = row("verified-done"), second = row("verified-done", { count: 2, revision: 2, publicationId: "b".repeat(64) });
  const warning = row("storage-degraded", { notificationId: "00000000-0000-4000-8000-000000000112" });
  h.setRows([second, warning]);
  await act(async () => {
    h.listeners[0](publication(first, 1)); h.listeners[0](publication(second, 2));
    h.listeners[0](publication(warning, 3)); h.listeners[0](publication(first, 1));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  assert.deepEqual(h.toasts.map(toast => toast.tone), ["success", "success", "warning"]);
  assert.deepEqual(h.toasts.slice(0, 2).map(toast => toast.description), ["Exact subject · Person Lookup", "Exact subject · Person Lookup"]);
  assert(h.toasts.every(toast => toast.action?.label === "Open notifications"));
  await h.render(true, { ...h.binding, authority: { ...h.binding.authority, dayState: { ...h.binding.authority.dayState, connection: { state: "reconnecting" } } } });
  await h.render();
  await act(async () => { h.listeners[0](publication(second, 2)); h.listeners[0](publication(warning, 3)); await new Promise(resolve => setTimeout(resolve, 0)); });
  assert.equal(h.toasts.length, 3);
});
it("delivers the closed danger and warning source policies using exact current target identities", async () => {
  const h = await harness();
  const kinds = ["run-failed", "subject-mismatch", "gate-opened", "write-parked", "repeating-failure", "storage-degraded"];
  for (const [index, kind] of kinds.entries()) {
    const next = row(kind); h.setRows([next]);
    await act(async () => { h.listeners[0](publication(next, index + 1)); await new Promise(resolve => setTimeout(resolve, 0)); });
  }
  assert.deepEqual(h.toasts.map(toast => toast.tone), ["danger", "danger", "warning", "warning", "danger", "warning"]);
});

it("read-all uses each exact notification/version and skips the pinned backfill notice", async () => {
  const h = await harness();
  const second = "00000000-0000-4000-8000-000000000112";
  h.setRows([row(), row("storage-degraded", { notificationId: second }), row("backfill-gap", { notificationId: "00000000-0000-4000-8000-000000000113" })]);
  await act(async () => { h.listeners[0](publication(row(), 1)); await new Promise(resolve => setTimeout(resolve, 0)); });
  await act(async () => h.value.readAll());
  assert.deepEqual(h.commands.map(command => command.family === "notification" ? [command.target.notificationId, command.target.expectedVersion] : null), [[id, 1], [second, 1]]);
});

it("retains loaded rows when a refresh fails and isolates actions while pending or failed", async () => {
  const h = await harness();
  const loaded = h.value.state; assert.equal(loaded.state, "ready");
  const release = h.holdReads();
  await act(async () => h.listeners[0](publication(row("storage-degraded", { state: "snoozed", snoozedUntil: "2026-08-03T18:00:00Z" }))));
  assert.deepEqual(h.value.state, loaded);
  const requestCount = h.requests.length;
  const item = loaded.state === "ready" ? loaded.items[0] : undefined; assert(item);
  let opened = false;
  let action: Promise<boolean> | undefined;
  await act(async () => {
    action = h.value.control(id, "read");
    h.value.open(item, () => { opened = true; }, () => {}, () => {});
  });
  try { assert.equal(h.commands.length, 0); assert.equal(h.requests.length, requestCount); assert.equal(opened, false); }
  catch (error) { release(); throw error; }
  assert.equal(await action, false);
  assert(h.value.notice.length > 0);
  h.failReads(); await act(async () => { release(); await new Promise(resolve => setTimeout(resolve, 0)); });
  assert.deepEqual(h.value.state, loaded); assert.match(h.value.notice, /could not load/);
  await act(async () => { assert.equal(await h.value.control(id, "read"), false); });
  assert.equal(h.commands.length, 0);
});

it("keeps an initial inbox read failure unavailable", async () => {
  const h = await harness(true, true);
  assert.equal(h.value.state.state, "unavailable");
  assert.match(h.value.notice, /could not load/);
  assert.equal(await h.value.control(id, "read"), false);
});
for (const replacement of ["actor", "client", "authority"] as const) it(`does not reconcile an old command into a replacement ${replacement}`, async () => {
  const h = await harness(), release = h.holdCommands();
  let result: Promise<boolean> | undefined;
  await act(async () => { result = h.value.control(id, "read"); });
  const client = replacement === "client" ? { ...h.client } : h.client;
  const scope = { ...h.binding.scope, dayRequest: {}, client, ...(replacement === "actor" ? { actorId: "replacement-operator" } : {}), ...(replacement === "authority" ? { authority: {} } : {}) };
  await h.render(true, { ...h.binding, scope }, client);
  const readCount = h.requests.filter(path => path.endsWith("/notifications")).length;
  await act(async () => { release(); await result; await new Promise(resolve => setTimeout(resolve, 0)); });
  assert.equal(h.requests.filter(path => path.endsWith("/notifications")).length, readCount + 1, "only the executor's original readback runs; replacement authority must not refresh");
  assert.equal(h.commands.length, 1); assert.equal(h.toasts.length, 0);
});
