// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import { foldRows, inboxProjection, notificationDay, notificationPolicy, notificationTargetMatches, useInboxWiring, type InboxWiring } from "../../../src/dashboard/state/inbox-wiring-adapter.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { CommandExecutor, type CommandExecutionScope } from "../../../src/dashboard/app/commands/command-executor.js";
import type { DashboardCommandBinding } from "../../../src/dashboard/app/dashboard-app-model.js";
import { notificationWireOf, NotificationWireSchema, type NotificationWire } from "../../../src/models/dashboard/projection.js";
import { NotificationRecordSchema } from "../../../src/models/notifications/notifications.js";
import { projectNotificationTrigger } from "../../../src/rules/notifications/notification-triggers.js";
import { NotificationTargetSchema } from "../../../src/models/notifications/notification-target.js";
import { ActorIdSchema, CommandIdSchema, FailureIdSchema, ProjectionCursorSchema, RunIdSchema } from "../../../src/rules/identity/ids.js";
import { NotificationPublicationWireSchema, type NotificationArrival } from "../../../src/models/dashboard/subscription.js";
import { WireErrorSchema } from "../../../src/models/dashboard/primitives.js";
import type { NotificationTarget } from "../../../src/models/notifications/notification-target.js";
import { NotificationCommandRequestSchema, CommandResultSchema, type CommandRequest } from "../../../src/rules/commands/commands.js";
import { FIXTURE_BOOTSTRAP } from "../../support/fixtures/dashboard/fixture-bootstrap.js";
import { FIXTURE_DAY_WIRE } from "../../support/fixtures/dashboard/fixture-queue.js";
import { verifyShellCommandEffect } from "../../../src/dashboard/app/commands/command-dispatch.js";
import { createRowStore } from "../../../src/dashboard/client/index.js";

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
const commandId = "00000000-0000-4000-8000-000000000444";
function commandRow(sourceKind: "command-refused" | "command-unknown" | "bulk-incomplete", overrides: Record<string, unknown> = {}): NotificationWire {
  const link = sourceKind === "bulk-incomplete" ? { kind: "bulk-result", bulkCommandId: commandId } : { kind: sourceKind === "command-unknown" ? "recovery" : "command-result", commandId };
  return NotificationWireSchema.parse({ kind: "command", notificationId: id, actorId: "local-operator", channel: "ping", count: 1, publicationId: "c".repeat(64), severity: sourceKind === "command-unknown" ? "error" : "warning", title: "Command notice", summary: "Served summary.", state: "unread", readState: "unread", revision: 1, occurredAt: now, priority: true,
    context: { state: "available", subject: "Exact subject", workflow: "Person Lookup" }, sourceEvent: { state: "available", kind: sourceKind }, link, ...overrides });
}
/** What the server resolves for a row's link, as `GET /notifications/{id}/target` would. */
function targetOf(notification: NotificationWire, refused = false): NotificationTarget {
  if (refused || notification.kind !== "notification" || notification.link === undefined) return { kind: "refused", reason: "run-unavailable" };
  return NotificationTargetSchema.parse(notification.link.kind === "storage" ? { kind: "storage" } : { ...notification.link, day: "2026-08-03" });
}
function publication(notification: NotificationWire, n = 1, listed: NotificationWire = notification, target: NotificationTarget = targetOf(notification)): NotificationArrival {
  // The harness stamps the cursor of the snapshot the stream holds when it delivers the arrival.
  return { publication: NotificationPublicationWireSchema.parse({ sourceId: String(n).repeat(64), actorId: notification.actorId, durable: "created", notification }), listed, target,
    snapshotCursor: FIXTURE_DAY_WIRE.snapshotCursor };
}
const ERROR = WireErrorSchema.parse({ state: "error", code: "DASHBOARD_READ_FAILED", message: "Relay could not load this.", retryable: true });
async function harness(enabled = true, initiallyFailed = false, statusDelivered = true) {
  let rows: readonly NotificationWire[] = [row()], lose = false, refuseTarget = false;
  let postWait: Promise<void> | undefined;
  const requests: string[] = [];
  const commands: CommandRequest[] = [], listeners: ((arrival: NotificationArrival) => void)[] = [];
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => {
    const path = new URL(url).pathname; requests.push(path);
    if (path.endsWith("/target")) {
      const linked = rows.find(row => row.notificationId === path.split("/").at(-2));
      return Response.json(linked === undefined ? { kind: "refused", reason: "run-unavailable" } : targetOf(linked, refuseTarget));
    }
    if (path.endsWith("/collection")) return Response.json({ actorId: "local-operator",
      members: [...rows].sort((a, b) => a.notificationId < b.notificationId ? -1 : 1).map(row => ({ notificationId: row.notificationId, expectedVersion: row.kind === "notification" ? row.revision : 1 })),
      matchingCount: rows.filter(row => row.kind === "notification" && row.readState === "unread").length });
    if (path.endsWith("/notifications")) return Response.json(rows);
    if (path.endsWith("/commands")) {
      const body = init?.body; if (typeof body !== "string") throw new Error("command body must be JSON text");
      const command = NotificationCommandRequestSchema.parse(JSON.parse(body)); commands.push(command);
      await postWait;
      const target = command.target;
      const affected = rows.filter(item => item.kind === "notification" && ("members" in target ? target.members.some(member => member.notificationId === item.notificationId) && item.readState === "unread" : item.notificationId === target.notificationId));
      rows = rows.map(item => item.kind !== "notification" || !affected.some(row => row.notificationId === item.notificationId) ? item : NotificationWireSchema.parse({ ...item, revision: item.revision + 1,
        readState: command.type === "notification-read" || command.type === "notification-read-all" ? "read" : command.type === "notification-unread" ? "unread" : item.readState,
        state: command.type === "notification-snooze" ? "snoozed" : command.type === "notification-unsnooze" ? item.readState : command.type === "notification-read" || command.type === "notification-read-all" ? "read" : command.type === "notification-unread" ? "unread" : item.state,
        snoozedUntil: command.type === "notification-snooze" ? "2026-08-03T18:00:00.000Z" : undefined }));
      if (lose) { lose = false; throw new Error("response lost after commit"); }
      return Response.json({ state: "applied", commandId: command.commandId, affectedTargets: affected.map(row => ({ family: "notification", notificationId: row.notificationId })) });
    }
    throw new Error(`unexpected ${path}`);
  } });
  const epoch = { client, bootstrap: FIXTURE_BOOTSTRAP }, dayRequest = {};
  // The day the stream holds carries the inbox rows; the status row arrives on the same stream.
  const store = createRowStore();
  const status = (value: { state: "available"; value: { state: "ready" | "failed"; code?: "NOTIFICATION_OBSERVATION_FAILED"; pending: number } } | { state: "unavailable"; error: typeof ERROR }) =>
    act(async () => { store.apply([{ model: "notification-status", key: ActorIdSchema.parse("local-operator"), value }]); });
  if (enabled && statusDelivered) await status(initiallyFailed ? { state: "unavailable", error: ERROR } : { state: "available", value: { state: "ready", pending: 0 } });
  let dayServed = rows, dayRows = dayServed, refreshes = 0, snapshots = 1;
  let day = { state: "loaded" as const, value: { ...FIXTURE_DAY_WIRE, notifications: [...dayRows] } };
  const scope = { client, authority: epoch, actorId: "local-operator", dayRequest };
  let activeScope: CommandExecutionScope = scope;
  const executor = new CommandExecutor(() => activeScope);
  const binding: DashboardCommandBinding = { executor, scope, feedback() {}, authority: { epoch, now: () => now, today: "2026-08-03", day: "2026-08-03", catalog: [], selection: { route: { start: false }, workflowId: "" },
    dayState: { rows: store, request: dayRequest, get day() { if (dayRows !== dayServed) { dayRows = dayServed; day = { state: "loaded", value: { ...FIXTURE_DAY_WIRE, snapshotCursor: ProjectionCursorSchema.parse(`pc:${snapshots += 1}`), notifications: [...dayServed] } }; } return day; },
      connection: { state: "live" }, refresh() { refreshes += 1; }, subscribePublications: listener => { listeners.push(listener); return () => { listeners.splice(listeners.indexOf(listener), 1); }; } } } };
  let value: InboxWiring | undefined;
  function Probe({ served, currentBinding, currentClient }: { served: boolean; currentBinding: DashboardCommandBinding; currentClient: typeof client }) { value = useInboxWiring({ client: currentClient, enabled: served, binding: currentBinding }); return null; }
  root = createRoot(document.createElement("div"));
  const render = async (served = enabled, currentBinding = binding, currentClient = client) => { activeScope = currentBinding.scope; await act(async () => { root?.render(createElement(Probe, { served, currentBinding, currentClient })); await new Promise(resolve => setTimeout(resolve, 0)); }); };
  await render();
  /** Each subscriber, delivering an arrival on the snapshot the stream holds now: a day the harness next serves is a new snapshot. */
  const publishers = () => listeners.map(listener => (arrival: NotificationArrival) => listener({ ...arrival, snapshotCursor: binding.authority.dayState.day.state === "loaded"
    ? binding.authority.dayState.day.value.snapshotCursor : FIXTURE_DAY_WIRE.snapshotCursor }));
  return { client, binding, requests, commands, get listeners() { return publishers(); }, render, status, get refreshes() { return refreshes; }, get value() { assert(value); return value; },
    /** The rows the server serves, and the day the stream next delivers. */
    setRows: (next: readonly NotificationWire[]) => { rows = next; dayServed = next; },
    /** A day snapshot the stream delivers without changing what the server serves, such as one frozen before a command. */
    serveDay: (next: readonly NotificationWire[]) => { dayServed = next; }, lose: () => { lose = true; }, refuseTarget: () => { refuseTarget = true; },
    holdCommands: () => { let release = () => {}; postWait = new Promise<void>(resolve => { release = resolve; }); return release; } };
}
it("defines all eight source policies with exact target kinds and honest gap/missing-source notice", () => {
  const kinds = ["run-failed", "subject-mismatch", "gate-opened", "write-parked", "repeating-failure", "storage-degraded", "verified-done", "backfill-gap"];
  assert.deepEqual(kinds.map(kind => notificationPolicy(row(kind))?.tone), ["danger", "danger", "warning", "warning", "danger", "warning", "positive", "warning"]);
  assert.equal(inboxProjection([row("backfill-gap")], now).state.state, "ready");
  assert.match(inboxProjection([row("backfill-gap")], now).notice, /history is incomplete/);
  const unsourced = row("run-failed", { sourceEvent: { state: "unavailable" } });
  assert.equal(inboxProjection([unsourced], now).notice, "", "a missing source adds no inline panel");
  assert.equal(notificationPolicy(unsourced), undefined);
  assert(notificationTargetMatches(row(), { kind: "storage" }));
  assert.equal(notificationTargetMatches(row(), { kind: "run", runId: FIXTURE_DAY_WIRE.queueSurfaces[0].runId, day: "2026-08-03" }), false);
  const host = RunIdSchema.parse("00000000-0000-4000-8000-000000000999");
  const linkedRunId = RunIdSchema.parse(runId);
  assert(notificationTargetMatches(row("gate-opened"), { kind: "run", runId: host, day: "2026-08-03", linkedRunId }), "a delegated run opens its host run");
  assert(notificationTargetMatches(row("run-failed"), { kind: "run", runId: host, day: "2026-08-03", linkedRunId }));
  assert.equal(notificationTargetMatches(row("gate-opened"), { kind: "run", runId: host, day: "2026-08-03" }), false, "a host run that names no linked run is another run");
  assert.equal(notificationTargetMatches(row("gate-opened"), { kind: "run", runId: linkedRunId, day: "2026-08-03", linkedRunId: host }), false);
  assert.equal(notificationTargetMatches(row("gate-opened"), { kind: "failure", runId: host, failureId: FailureIdSchema.parse(failureId), day: "2026-08-03" }), false);
});
it("shows retained failed-run workflow and reason without unavailable text or an inferred source policy", () => {
  const summary = "UCPath could not be reached.";
  const retained = row("run-failed", { title: "Run failed", summary,
    context: { state: "workflow-only", workflow: "Onboarding" }, sourceEvent: { state: "unavailable" } });
  const projection = inboxProjection([retained], now);
  assert(projection.state.state === "ready");
  const item = projection.state.items[0];
  assert.equal(item.workflow, "Onboarding");
  assert.equal(item.subject, "");
  assert.equal(item.detail, summary);
  assert.equal(projection.notice, "");
  assert.equal(notificationPolicy(retained), undefined);

  const unavailable = inboxProjection([retained, row("run-failed", { notificationId: failureId, summary, context: { state: "unavailable" } })], now);
  assert(unavailable.state.state === "ready");
  assert.equal(unavailable.state.items[1].subject, "");
  assert.equal(unavailable.state.items[1].detail, summary);
  assert.equal(unavailable.notice, "");
});
it("folds a failure repeated across runs into one item per workflow, person and failure text, with its repeating notice", () => {
  const other = "00000000-0000-4000-8000-000000000555";
  const failed = (n: string, at: string, extra: Record<string, unknown> = {}) => row("run-failed", { notificationId: n, title: "Run failed", summary: "UCPath could not be reached.", occurredAt: at, ...extra });
  const rows = [failed("00000000-0000-4000-8000-0000000000a1", "2026-08-03T15:00:00.000Z"), failed("00000000-0000-4000-8000-0000000000a2", "2026-08-03T16:30:00.000Z", { readState: "read", state: "read" }),
    failed("00000000-0000-4000-8000-0000000000a3", "2026-08-03T16:00:00.000Z", { link: { kind: "failure", runId: other, failureId } }),
    row("repeating-failure", { notificationId: "00000000-0000-4000-8000-0000000000a4", title: "Repeating failure", occurredAt: "2026-08-03T16:45:00.000Z", link: { kind: "failure", runId: other, failureId } }),
    failed("00000000-0000-4000-8000-0000000000a5", "2026-08-03T15:30:00.000Z", { context: { state: "available", subject: "Another person", workflow: "Person Lookup" } }),
    failed("00000000-0000-4000-8000-0000000000a6", "2026-08-03T15:15:00.000Z", { summary: "Kuali could not be reached." }),
    row("gate-opened", { notificationId: "00000000-0000-4000-8000-0000000000a7", title: "Run waiting", occurredAt: "2026-08-03T14:30:00.000Z" }),
    row("gate-opened", { notificationId: "00000000-0000-4000-8000-0000000000a8", title: "Run waiting", occurredAt: "2026-08-03T14:15:00.000Z", link: { kind: "run", runId: other } }),
    row("storage-degraded", { notificationId: "00000000-0000-4000-8000-0000000000b1", occurredAt: "2026-08-03T14:00:00.000Z" }), row("storage-degraded", { notificationId: "00000000-0000-4000-8000-0000000000b2", occurredAt: "2026-08-03T13:00:00.000Z", count: 5 })];
  const projection = inboxProjection(rows, now);
  assert(projection.state.state === "ready");
  assert.deepEqual(projection.state.items.map(item => [item.id, item.title, item.count, item.age, item.read]), [
    ["00000000-0000-4000-8000-0000000000a2", "Run failed", 3, "30 min ago", false],
    ["00000000-0000-4000-8000-0000000000a5", "Run failed", undefined, "1 hr ago", false],
    ["00000000-0000-4000-8000-0000000000a6", "Run failed", undefined, "1 hr ago", false],
    ["00000000-0000-4000-8000-0000000000a7", "Run waiting", undefined, "2 hr ago", false],
    ["00000000-0000-4000-8000-0000000000a8", "Run waiting", undefined, "2 hr ago", false],
    ["00000000-0000-4000-8000-0000000000b1", "Notification", 6, "3 hr ago", false]]);
  assert.deepEqual(foldRows(rows)[0].map(entry => entry.notificationId.slice(-2)), ["a2", "a4", "a3", "a1"]);
});
it("marks an item read through every unread row it stands for, across runs", async () => {
  const other = "00000000-0000-4000-8000-000000000555", newer = "00000000-0000-4000-8000-0000000000d2", older = "00000000-0000-4000-8000-0000000000d1", repeating = "00000000-0000-4000-8000-0000000000d3";
  const rows = [row("run-failed", { notificationId: older, title: "Run failed", occurredAt: "2026-08-03T16:00:00.000Z" }),
    row("run-failed", { notificationId: newer, title: "Run failed", occurredAt: "2026-08-03T16:30:00.000Z", link: { kind: "failure", runId: other, failureId } }),
    row("repeating-failure", { notificationId: repeating, title: "Repeating failure", occurredAt: "2026-08-03T16:20:00.000Z" })];
  const h = await harness(); h.setRows(rows);
  await act(async () => { h.listeners[0](publication(rows[1])); await new Promise(resolve => setTimeout(resolve, 0)); });
  assert(h.value.state.state === "ready");
  assert.deepEqual(h.value.state.items.map(item => [item.id, item.count, item.read]), [[newer, 2, false]]);
  await act(async () => { assert(await h.value.control(newer, "read")); });
  assert.deepEqual(h.commands.map(command => "notificationId" in command.target ? command.target.notificationId : ""), [newer, repeating, older]);
  assert(h.value.state.state === "ready");
  assert.deepEqual(h.value.state.items.map(item => [item.id, item.read]), [[newer, true]]);
});
it("keeps a folded item unread while any repeat is unread, and marking it read confirms every unread repeat", async () => {
  const older = "00000000-0000-4000-8000-0000000000c1", newer = "00000000-0000-4000-8000-0000000000c2";
  const repeats = [row("storage-degraded", { notificationId: older, occurredAt: "2026-08-03T16:00:00.000Z" }),
    row("storage-degraded", { notificationId: newer, occurredAt: "2026-08-03T16:30:00.000Z", readState: "read", state: "read" })];
  const folded = inboxProjection(repeats, now);
  assert(folded.state.state === "ready");
  assert.deepEqual(folded.state.items.map(item => [item.id, item.read]), [[newer, false]]);
  assert.equal(folded.needsYou, 1);
  const h = await harness(); h.setRows(repeats);
  await act(async () => { h.listeners[0](publication(repeats[1])); await new Promise(resolve => setTimeout(resolve, 0)); });
  await act(async () => { assert(await h.value.control(newer, "read")); });
  assert.deepEqual(h.commands.map(command => "notificationId" in command.target ? command.target.notificationId : ""), [newer, older]);
});
it("withholds raw subject-mismatch summaries when source evidence is unavailable", () => {
  const projected = projectNotificationTrigger({ kind: "subject-mismatch", runId, workflowId: "person-lookup", failureId, failureFingerprint: "f".repeat(64) });
  const record = NotificationRecordSchema.parse({ ...projected, notificationId: id, actorId: "local-operator", status: "unread", snooze: { state: "not-snoozed" },
    count: 1, version: 1, lastSeenAt: now, createdAt: now, updatedAt: now });
  assert(record.summary.includes(runId));
  for (const state of ["available", "unavailable"] as const) {
    const source = state === "available" ? { state, kind: "subject-mismatch" } : { state };
    const wire = notificationWireOf(record, Date.parse(now), { state: "workflow-only", workflow: "Person Lookup" }, source);
    const projection = inboxProjection([wire], now);
    assert(projection.state.state === "ready");
    const item = projection.state.items[0];
    assert.equal(item.workflow, "Person Lookup");
    assert.equal(item.detail, state === "available"
      ? "The subject identity did not match."
      : "");
    assert.equal(projection.notice, "");
    assert.equal(item.detail.includes(runId), false);
    if (state === "unavailable") assert.equal(notificationPolicy(wire), undefined);
  }
});
it("confirms read, unread, snooze and unsnooze only through matching shared readback", async () => {
  const h = await harness();
  for (const action of ["read", "unread", "snooze", "unsnooze"] as const) { await act(async () => { assert(await h.value.control(id, action)); }); }
  assert.deepEqual(h.commands.map(command => command.type), ["notification-read", "notification-unread", "notification-snooze", "notification-unsnooze"]);
  for (const command of h.commands) { assert.equal(command.requestedBy, "local-operator"); assert.equal("payload" in command, false); }
});
it("retains uncertain command identity without automatic or repeated control retry", async () => {
  const h = await harness(); h.lose();
  await act(async () => { assert.equal(await h.value.control(id, "read"), false); });
  const original = h.binding.executor.retainedAttempts()[0]; assert.equal(original.outcome?.kind, "uncertain");
  await act(async () => { assert.equal(await h.value.control(id, "read"), false); });
  assert.equal(h.commands.length, 1); assert.equal(h.binding.executor.retainedAttempts()[0].request.commandId, original.request.commandId);
});
it("marks a deleted run on its own item, opens nothing and leaves it unread", async () => {
  const h = await harness(); const completed = row("verified-done"); h.setRows([completed]);
  await act(async () => { h.listeners[0](publication(completed)); await new Promise(resolve => setTimeout(resolve, 0)); });
  h.refuseTarget();
  const item = h.value.state.state === "ready" ? h.value.state.items[0] : undefined; assert(item);
  assert.equal(item.gone, undefined);
  await act(async () => { h.value.open(item, () => assert.fail("must not navigate"), () => assert.fail("must not open"), () => assert.fail("a deleted run is item state, not a refusal")); await new Promise(resolve => setTimeout(resolve, 0)); });
  assert(h.value.state.state === "ready");
  assert.deepEqual(h.value.state.items.map(entry => [entry.id, entry.gone, entry.read]), [[item.id, true, false]]);
  assert.equal(h.commands.length, 0);
});
it("checks the carried target of a published notice that has no source policy and says so when it is refused", async () => {
  const h = await harness(); const bare = row("run-failed", { title: "Run failed", context: { state: "unavailable" }, sourceEvent: { state: "unavailable" } });
  assert.equal(notificationPolicy(bare), undefined);
  await act(async () => { h.listeners[0](publication(bare, 1, bare, targetOf(bare, true))); await new Promise(resolve => setTimeout(resolve, 0)); });
  assert.deepEqual(h.requests, [], "the target rides the publication");
  assert.match(h.value.notice, /This notification’s target is gone\. Refresh the inbox\./u);
});
it("refuses foreign actor and wrong revision in shared notification readback", async () => {
  const h = await harness();
  const request = NotificationCommandRequestSchema.parse({ commandId: crypto.randomUUID(), requestedAt: now, requestedBy: "local-operator", source: "dashboard", family: "notification", type: "notification-read", target: { notificationId: id, actorId: "local-operator", expectedVersion: 1 } });
  const reply = CommandResultSchema.parse({ state: "applied", commandId: request.commandId, affectedTargets: [{ family: "notification", notificationId: id }] });
  for (const next of [row("storage-degraded", { readState: "read", state: "read", revision: 3 }), row("storage-degraded", { actorId: "other-operator", readState: "read", state: "read", revision: 2 })]) {
    h.setRows([next]); assert.equal((await verifyShellCommandEffect(h.client, "2026-08-03", request, reply)).state, "mismatch");
  }
});

it("keeps mock mode disconnected from inbox reads, writes and publications", async () => {
  const h = await harness(false);
  assert.equal(h.requests.length, 0); assert.equal(h.listeners.length, 0);
  assert.equal(await h.value.control(id, "read"), false); assert.equal(h.requests.length, 0);
});

it("read-all binds the complete inbox in one command and preserves the pinned backfill notice", async () => {
  const h = await harness();
  const second = "00000000-0000-4000-8000-000000000112";
  const extra = Array.from({ length: 23 }, (_, index) => row("storage-degraded", { notificationId: `00000000-0000-4000-8000-${String(200 + index).padStart(12, "0")}` }));
  h.setRows([row(), row("storage-degraded", { notificationId: second }), ...extra, row("backfill-gap", { notificationId: "00000000-0000-4000-8000-000000000113" })]);
  await act(async () => { h.listeners[0](publication(row(), 1)); await new Promise(resolve => setTimeout(resolve, 0)); });
  await act(async () => h.value.readAll());
  assert.equal(h.commands.length, 1);
  const command = h.commands[0]; assert.equal(command.family, "notification");
  if (command.family !== "notification" || !("members" in command.target)) throw new Error("collection command required");
  assert.equal(command.type, "notification-read-all"); assert.equal(command.target.matchingCount, 25);
  assert.deepEqual(command.target.members.map(row => [row.notificationId, row.expectedVersion]), [[id, 1], [second, 1], ["00000000-0000-4000-8000-000000000113", 1], ...extra.map(row => [row.notificationId, 1])]);
  assert.equal(h.value.state.state, "ready"); if (h.value.state.state === "ready") assert(h.value.state.items.every(item => item.read));
  assert.match(h.value.notice, /history is incomplete/);
});

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const firstItem = (wiring: InboxWiring) => { assert(wiring.state.state === "ready"); const item = wiring.state.items[0]; assert(item); return item; };

it("shows a first status that could not be read with the day's rows, controls off, and recovers when the retry delivers it", async () => {
  const h = await harness(true, true);
  assert.equal(h.value.state.state, "ready", "the rows come from the day, not the failed read");
  assert.match(h.value.notice, /could not load/);
  let opened = false;
  await act(async () => {
    assert.equal(await h.value.control(id, "read"), false);
    await h.value.readAll();
    h.value.open(firstItem(h.value), () => { opened = true; }, () => {}, () => {});
    await tick();
  });
  assert.equal(h.commands.length, 0); assert.equal(opened, false); assert.deepEqual(h.requests, []);

  await h.status({ state: "available", value: { state: "ready", pending: 0 } });

  assert.doesNotMatch(h.value.notice, /could not load/);
  await act(async () => { assert(await h.value.control(id, "read")); });
  assert.deepEqual(h.commands.map(command => command.type), ["notification-read"]);
});

it("keeps the rows display-only when a status update cannot be read, then takes the retried status", async () => {
  const h = await harness();
  const loaded = h.value.state;
  await h.status({ state: "unavailable", error: ERROR });
  assert.deepEqual(h.value.state, loaded);
  assert.match(h.value.notice, /could not load/);
  await act(async () => { assert.equal(await h.value.control(id, "read"), false); });
  assert.equal(h.commands.length, 0);

  await h.status({ state: "available", value: { state: "failed", code: "NOTIFICATION_OBSERVATION_FAILED", pending: 1 } });

  assert.doesNotMatch(h.value.notice, /could not load/);
  assert(h.value.notice.length > 0, "the observer's own failure is still shown");
  await act(async () => { assert(await h.value.control(id, "read")); });
  assert.equal(h.commands.length, 1);
});

it("shows the rows as pending with controls off until the stream delivers the status", async () => {
  const h = await harness(true, false, false);
  assert.equal(h.value.state.state, "ready");
  assert.match(h.value.notice, /Refreshing notifications/u);
  await act(async () => { assert.equal(await h.value.control(id, "read"), false); });
  await h.status({ state: "available", value: { state: "ready", pending: 0 } });
  assert.equal(h.value.notice, "");
  await act(async () => { assert(await h.value.control(id, "read")); });
});

it("adds a published row and raises its arrival with no inbox request", async () => {
  const h = await harness();
  const completed = row("verified-done", { notificationId: "00000000-0000-4000-8000-000000000119" });
  const arrivals: string[] = [];
  h.value.onPublication(arrival => arrivals.push(arrival.item.id));
  await act(async () => { h.listeners[0](publication(completed)); await tick(); });
  assert.deepEqual(h.requests, [], "the row, the status and the target all come from the stream");
  assert.deepEqual(arrivals, [completed.notificationId]);
  assert(h.value.state.state === "ready");
  assert.deepEqual(h.value.state.items.map(item => item.id).sort(), [id, completed.notificationId].sort());
  assert.equal(h.value.notice, "");
  await act(async () => { h.listeners[0](publication(completed)); await tick(); });
  assert.deepEqual(arrivals, [completed.notificationId], "a source seen twice is admitted once");
});

it("replaces a held row by a listed row at or above its revision and keeps a newer held row", async () => {
  const h = await harness();
  const newer = row("storage-degraded", { revision: 3, readState: "read", state: "read" });
  await act(async () => { h.listeners[0](publication(newer, 1)); await tick(); });
  assert.equal(firstItem(h.value).read, true);
  await act(async () => { h.listeners[0](publication(row("storage-degraded", { revision: 2 }), 2)); await tick(); });
  assert.equal(firstItem(h.value).read, true, "an older listed row does not replace the held one");
});

it("keeps a storage group as one row with its count when a member is published", async () => {
  const a = "00000000-0000-4000-8000-0000000000d1", b = "00000000-0000-4000-8000-0000000000d2", c = "00000000-0000-4000-8000-0000000000d3";
  const storage = { context: { state: "storage", concern: "backup" } };
  const group = (members: readonly (readonly [string, number])[], count: number) => row("storage-degraded", { ...storage, notificationId: members[0][0], revision: members[0][1], count,
    group: { concern: "backup", members: members.map(([notificationId, revision]) => ({ notificationId, revision })) } });
  const h = await harness();
  h.setRows([group([[a, 1], [b, 1]], 2)]);
  await h.render();
  const member = row("storage-degraded", { ...storage, notificationId: c, revision: 1 });
  await act(async () => { h.listeners[0](publication(member, 1, group([[c, 1], [a, 1], [b, 1]], 3))); await tick(); });
  assert(h.value.state.state === "ready");
  assert.deepEqual(h.value.state.items.map(item => [item.id, item.count]), [[c, 3]]);
  const folded = row("storage-degraded", { ...storage, notificationId: a, revision: 2, count: 2 });
  await act(async () => { h.listeners[0](publication(folded, 2, group([[c, 1], [a, 2], [b, 1]], 4))); await tick(); });
  assert(h.value.state.state === "ready");
  assert.deepEqual(h.value.state.items.map(item => [item.id, item.count]), [[c, 4]], "a member's fold replaces the group, never adds a row beside it");
  assert.deepEqual(h.requests, []);
});

it("takes a replacement snapshot whose storage group holds more members than a held publication's group", async () => {
  const a = "00000000-0000-4000-8000-0000000000d1", b = "00000000-0000-4000-8000-0000000000d2", c = "00000000-0000-4000-8000-0000000000d3";
  const storage = { context: { state: "storage", concern: "backup" } };
  const group = (members: readonly (readonly [string, number])[], count: number) => row("storage-degraded", { ...storage, notificationId: members[0][0], revision: members[0][1], count,
    group: { concern: "backup", members: members.map(([notificationId, revision]) => ({ notificationId, revision })) } });
  const h = await harness();
  h.setRows([row("storage-degraded", { ...storage, notificationId: a, revision: 1 })]);
  await h.render();
  await act(async () => { h.listeners[0](publication(row("storage-degraded", { ...storage, notificationId: b, revision: 1 }), 1, group([[b, 1], [a, 1]], 2))); await tick(); });
  assert(h.value.state.state === "ready");
  assert.deepEqual(h.value.state.items.map(item => [item.id, item.count]), [[b, 2]]);

  // After a gap or reset the stream sends a new snapshot, frozen after the publication, whose group has grown.
  h.setRows([group([[c, 1], [b, 1], [a, 1]], 3)]);
  await h.render();
  assert(h.value.state.state === "ready");
  assert.deepEqual(h.value.state.items.map(item => [item.id, item.count]), [[c, 3]], "the snapshot's group stands; the held publication never shrinks it");
  assert.deepEqual(h.requests, []);
});

it("keeps a confirmed readback over a later day snapshot frozen before the command, and yields once the day catches up", async () => {
  const h = await harness();
  const before = h.value.state.state === "ready" ? h.value.state.items : [];
  await act(async () => { assert(await h.value.control(id, "read")); });
  assert.equal(firstItem(h.value).read, true);
  h.serveDay([row()]);
  await h.render();
  assert.equal(firstItem(h.value).read, true, "a snapshot behind the readback does not undo the confirmed read");
  h.serveDay([row("storage-degraded", { revision: 3, readState: "unread", state: "unread" })]);
  await h.render();
  assert.equal(firstItem(h.value).read, false, "a snapshot ahead of the readback replaces it");
  assert.equal(before.length, 1);
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
  assert.equal(h.commands.length, 1);
});

it("retains a lost collection response and blocks overlapping single-row or collection retries", async () => {
  const h = await harness(); h.lose();
  await act(async () => h.value.readAll());
  const retained = h.binding.executor.retainedAttempts()[0]; assert.equal(retained.outcome?.kind, "uncertain");
  await act(async () => { await h.value.readAll(); assert.equal(await h.value.control(id, "read"), false); });
  assert.equal(h.commands.length, 1);
  assert.equal(h.binding.executor.retainedAttempts()[0].request.commandId, retained.request.commandId);
});
it("does not start read-all while an overlapping single-row response is unknown", async () => {
  const h = await harness(); h.lose();
  await act(async () => h.value.control(id, "read"));
  await act(async () => h.value.readAll());
  assert.equal(h.commands.length, 1); assert.equal(h.commands[0].type, "notification-read");
});

it("requires exact collection readback membership and one version advance for every reported effect", async () => {
  const h = await harness();
  const request = NotificationCommandRequestSchema.parse({ commandId: crypto.randomUUID(), requestedAt: now, requestedBy: "local-operator", source: "dashboard", family: "notification", type: "notification-read-all",
    target: { actorId: "local-operator", members: [{ notificationId: id, expectedVersion: 1 }], matchingCount: 1 } });
  const reply = CommandResultSchema.parse({ state: "applied", commandId: request.commandId, affectedTargets: [{ family: "notification", notificationId: id }] });
  for (const rows of [[], [row()], [row("storage-degraded", { revision: 3, readState: "read", state: "read" })],
    [row("storage-degraded", { revision: 2, readState: "read", state: "read" }), row("storage-degraded", { notificationId: runId })]]) {
    h.setRows(rows); assert.equal((await verifyShellCommandEffect(h.client, "2026-08-03", request, reply)).state, "mismatch");
  }
  h.setRows([row("storage-degraded", { revision: 2, readState: "read", state: "read" })]);
  assert.equal((await verifyShellCommandEffect(h.client, "2026-08-03", request, reply)).state, "matched");
  assert.equal(CommandResultSchema.safeParse({ ...reply, affectedTargets: [] }).success, false);
  assert.equal((await verifyShellCommandEffect(h.client, "2026-08-03", request, CommandResultSchema.parse({ ...reply, affectedTargets: [], noChange: "no-matching-notifications" }))).state, "mismatch");
});

it("maps command notices with policy tone, served detail and priority, and counts unread danger and warning as needs you", () => {
  const conflict = "This changed before Relay got to it, so nothing was done. Check it and try again.";
  const unknown = commandRow("command-unknown", { summary: "Relay could not confirm whether this finished. Open it to check before trying again." });
  const refused = commandRow("command-refused", { notificationId: "00000000-0000-4000-8000-000000000112", readState: "read", state: "read", priority: false, summary: conflict });
  const bulk = commandRow("bulk-incomplete", { notificationId: "00000000-0000-4000-8000-000000000113", summary: "Some items in this batch were not done. Open it to see each one." });
  const positive = row("verified-done", { notificationId: "00000000-0000-4000-8000-000000000114" });
  const readDanger = row("run-failed", { notificationId: "00000000-0000-4000-8000-000000000115", readState: "read", state: "read" });
  const info = row("storage-degraded", { notificationId: "00000000-0000-4000-8000-000000000116", severity: "info", sourceEvent: { state: "unavailable" } });
  const warning = row("gate-opened", { notificationId: "00000000-0000-4000-8000-000000000117" });
  const projection = inboxProjection([unknown, refused, bulk, positive, readDanger, info, warning], now);
  assert.equal(projection.state.state, "ready");
  if (projection.state.state !== "ready") throw new Error("inbox unavailable");
  const [unknownItem, refusedItem, bulkItem, positiveItem] = projection.state.items;
  assert.equal(unknownItem.tone, "danger");
  assert.equal(unknownItem.priority, true);
  assert.equal(unknownItem.detail, "Relay could not confirm whether this finished. Open it to check before trying again.");
  assert.equal(unknownItem.action, "Open");
  assert.equal(unknownItem.read, false);
  assert.deepEqual(unknownItem.destination, { kind: "refused", reason: "target-unavailable" });
  assert.equal(refusedItem.tone, "warning");
  assert.equal(refusedItem.priority, false);
  assert.equal(refusedItem.detail, conflict);
  assert.equal(refusedItem.read, true);
  assert.equal(bulkItem.tone, "warning");
  assert.equal(bulkItem.priority, true);
  assert.equal(bulkItem.detail, "Some items in this batch were not done. Open it to see each one.");
  assert.equal(bulkItem.action, "Open");
  assert.equal(positiveItem.priority, false);
  assert.equal(projection.needsYou, 3);
  const fallback = inboxProjection([
    commandRow("command-refused", { sourceEvent: { state: "unavailable" }, severity: "error", summary: "Served summary." }),
    commandRow("command-unknown", { notificationId: "00000000-0000-4000-8000-000000000118", sourceEvent: { state: "unavailable" }, severity: "warning", summary: "Served summary." }),
  ], now);
  if (fallback.state.state !== "ready") throw new Error("inbox unavailable");
  assert.equal(fallback.state.items[0].tone, "danger");
  assert.equal(fallback.state.items[1].tone, "warning");
  assert.equal(fallback.state.items[0].detail, "Served summary.");
  assert.equal(notificationPolicy(commandRow("command-refused"))?.detail, "Relay did not do this, so nothing changed.");
  assert.equal(notificationPolicy(commandRow("command-unknown"))?.tone, "danger");
  assert.equal(notificationPolicy(commandRow("bulk-incomplete"))?.tone, "warning");
});

it("matches recovery and command-result targets by command id and bulk results by bulk command id", () => {
  const parsed = CommandIdSchema.parse(commandId);
  const other = CommandIdSchema.parse("00000000-0000-4000-8000-000000000555");
  const request = NotificationCommandRequestSchema.parse({ commandId: parsed, requestedAt: now, requestedBy: "local-operator", source: "dashboard", family: "notification", type: "notification-read", target: { notificationId: id, actorId: "local-operator", expectedVersion: 1 } });
  const result = CommandResultSchema.parse({ state: "rejected", commandId: parsed, code: "policy-refused", message: "Relay did not do this, so nothing changed." });
  const recovery = { kind: "recovery" as const, commandId: parsed, request };
  const commandResult = { kind: "command-result" as const, commandId: parsed, day: "2026-08-03", request, result };
  const bulk = (bulkCommandId: typeof parsed) => NotificationTargetSchema.parse({ kind: "bulk-result", bulkCommandId, type: "retry", requestedCount: 1, results: [], notAttempted: [], days: {} });
  assert.equal(notificationTargetMatches(commandRow("command-unknown"), recovery), true);
  assert.equal(notificationTargetMatches(commandRow("command-unknown"), { ...recovery, commandId: other }), false);
  assert.equal(notificationTargetMatches(commandRow("command-refused"), commandResult), true);
  assert.equal(notificationTargetMatches(commandRow("command-refused"), { ...commandResult, commandId: other }), false);
  assert.equal(notificationTargetMatches(commandRow("bulk-incomplete"), bulk(parsed)), true);
  assert.equal(notificationTargetMatches(commandRow("bulk-incomplete"), bulk(other)), false);
  assert.equal(notificationTargetMatches(commandRow("command-refused"), recovery), false);
  assert.equal(notificationTargetMatches(commandRow("command-unknown"), commandResult), true);
  assert.equal(notificationTargetMatches(commandRow("bulk-incomplete"), recovery), false);
  assert.equal(notificationTargetMatches(row(), recovery), false);
  assert.equal(notificationTargetMatches(commandRow("command-unknown"), { kind: "storage" }), false);
});

it("groups served notices by local day", () => {
  const now = new Date(2026, 10, 11, 15).toISOString();
  const at = (days: number) => new Date(2026, 10, 11 - days, 9).toISOString();
  assert.deepEqual([0, 1, 3, 8].map(days => notificationDay(at(days), now)), ["Today", "Yesterday", "Sunday", "November 3"]);
});
