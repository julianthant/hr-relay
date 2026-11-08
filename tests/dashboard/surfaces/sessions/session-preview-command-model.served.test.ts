import { IdleSessionSchedule, IDLE_REFRESH_MS } from "../../../../src/dashboard/surfaces/sessions/session-idle-model.js";
import { servedFixtureSources as previewFixtureSources } from "../../../parity/helpers/workflow-composition.js";
import { ERROR_CATALOG } from "../../../../src/models/failures/error-catalog.js";
import { DashboardClientError } from "../../../../src/dashboard/client/errors.js";
import { WORKER_STOP_REASON_LABEL } from "../../../../src/dashboard/surfaces/sessions/session-panel-model.js";
// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { ToastProvider } from "../../../../src/dashboard/ds/ui.js";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import { SessionPanel } from "../../../../src/dashboard/surfaces/sessions/session-panel.js";
import assert from "node:assert/strict";
import { it } from "vitest";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { CommandExecutor, type CommandExecutionScope } from "../../../../src/dashboard/app/commands/command-executor.js";
import { createSessionPreviewPort, sessionCommandEffect, type SessionCommandBinding, type SessionPreviewRequest } from "../../../../src/dashboard/surfaces/sessions/session-preview-command-model.js";
import { sessionsFromDay, sessionWorkerAuthorityKey } from "../../../../src/dashboard/surfaces/sessions/sessions-view-model.js";
import { CommandRequestSchema, CommandResultSchema, type CommandRequest } from "../../../../src/rules/commands/commands.js";
import { DashboardDayWireSchema, type DashboardDayWire } from "../../../../src/models/dashboard/projection.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { FIXTURE_DAY_WIRE, FIXTURE_NOW, uuidOf } from "../../../parity/helpers/fixture-day.js";

function SessionPanelWithToasts(props: ComponentProps<typeof SessionPanel>) {
  return createElement(ToastProvider, null, createElement(SessionPanel, props));
}

const catalog = buildWorkflowCatalog([], true, previewFixtureSources([]));
const now = FIXTURE_NOW;
const LIFETIME = uuidOf(7001), NEXT_LIFETIME = uuidOf(7002);
function basis(lifetimeId: string | null, version = 0) {
  return { basis: { state: "present", value: { lifetimeId, version } } } as const;
}
function dayWith(count = 1): DashboardDayWire {
  const base = FIXTURE_DAY_WIRE;
  assert.equal(base.workerAuthority.state, "present");
  if (base.workerAuthority.state !== "present") throw new Error("fixture authority");
  return DashboardDayWireSchema.parse({ ...base, workerPools: count === 0 ? [] : [{ workflowId: "person-lookup", desiredWorkers: count, version: 1, plannedBy: "local-operator", plannedAt: now }],
    workerAuthority: { state: "present", members: base.workerAuthority.members.slice(0, count).map(slot => ({ ...slot, paused: false })) },
    workerCards: base.workerCards.slice(0, count).map(card => ({ ...card, state: "idle", directive: "run", browsers: [], currentRun: { state: "absent", reason: "no current run" },
      controls: basis(LIFETIME) })) });
}
function applied(command: CommandRequest) {
  const affectedTargets = command.family === "worker-browser" && command.type === "plan-worker-count" ? [{ family: "worker-pool", workflowId: command.target.workflowId }]
    : "workerId" in command.target ? [{ family: "worker-browser", workerId: command.target.workerId }] : [];
  return CommandResultSchema.parse({ state: "applied", commandId: command.commandId, affectedTargets });
}
/** The served day after the pool carried out `command`, as the member fence shows it. */
function effectOf(day: DashboardDayWire, command: CommandRequest): DashboardDayWire {
  assert(command.family === "worker-browser");
  if (command.type === "plan-worker-count") {
    const base = FIXTURE_DAY_WIRE; assert(base.workerAuthority.state === "present");
    const desired = command.payload.desiredWorkers;
    return DashboardDayWireSchema.parse({ ...day, workerAuthority: { state: "present", members: base.workerAuthority.members.slice(0, desired) },
      workerCards: base.workerCards.slice(0, desired).map(card => ({ ...card, directive: "run", controls: basis(LIFETIME) })),
      workerPools: [{ workflowId: command.target.workflowId, desiredWorkers: desired, version: command.target.expectedVersion + 1, plannedBy: "local-operator", plannedAt: now }] });
  }
  if (command.type === "remove-worker") return DashboardDayWireSchema.parse({ ...day, workerPools: day.workerPools.map(pool => ({ ...pool, desiredWorkers: pool.desiredWorkers - 1, version: pool.version + 1 })),
    workerAuthority: { state: "present", members: [] }, workerCards: [] });
  const workerId = command.type === "spawn-worker" ? command.payload.workerId : command.target.workerId;
  return DashboardDayWireSchema.parse({ ...day, workerCards: day.workerCards.map(card => card.workerId !== workerId ? card
    : command.type === "pause-worker" ? { ...card, directive: "pause" } : command.type === "resume-worker" ? { ...card, directive: "run" }
    : command.type === "stop-worker" || command.type === "retry-worker" ? { ...card, controls: basis(NEXT_LIFETIME) } : card) });
}
function harness(initial = dayWith()) {
  let day = initial; const sent: CommandRequest[] = []; const gets: string[] = []; let audit: unknown = { state: "unavailable" }; let auditFor: ((commandId: string) => unknown) | undefined;
  let effect: (command: CommandRequest) => unknown = command => { day = effectOf(day, command); return applied(command); };
  const client = createDashboardClient({ baseUrl: "http://sessions.test", fetchImpl: async (url, init) => {
    if (init?.method === "POST") { assert.equal(typeof init.body, "string");
      if (typeof init.body !== "string") throw new Error("JSON body missing");
      const command = CommandRequestSchema.parse(JSON.parse(init.body)); sent.push(command); return Response.json(await effect(command)); }
    if (String(url).includes("/api/v1/worker-commands/")) return Response.json(auditFor ? auditFor(String(url).split("/").pop() ?? "") : audit);
    gets.push(String(url)); return Response.json(day);
  } });
  let scope: CommandExecutionScope = { actorId: "local-operator", client, authority: {}, dayRequest: {} };
  const executor = new CommandExecutor(() => scope);
  const binding = (): SessionCommandBinding => ({ client, executor, scope, day: day.day, nowIso: now,
    dayState: { subscribePublications: () => { throw new Error("fixture publications are not served"); }, request: scope.dayRequest, day: { state: "loaded", value: day }, connection: { state: "connecting" }, refresh() {} } });
  const port = createSessionPreviewPort(() => ({ binding: binding(), catalog }));
  return { port, client, executor, sent, gets, binding, day: () => day, setDay: (next: DashboardDayWire) => { day = next; },
    effect: (next: typeof effect) => { effect = next; }, audit: (next: unknown) => { audit = next; auditFor = undefined; }, auditBy: (next: (commandId: string) => unknown) => { auditFor = next; }, scope: () => scope, setScope: (next: CommandExecutionScope) => { scope = next; } };
}

it("serves all six phases from exact current rows, omits unsupported timelines and never invents subject", () => {
  const base = dayWith();
  for (const state of ["running", "starting", "idle", "waiting", "paused", "failed"] as const) {
    const day = DashboardDayWireSchema.parse({ ...base, workerCards: [{ ...base.workerCards[0], state, ...(state === "failed" ? { endedAt: now, stopReason: "crashed" } : {}) }] });
    const view = sessionsFromDay(day, catalog, now); assert.equal(view.state, "ready");
    if (view.state !== "ready") throw new Error("expected ready");
    assert.equal(view.workers[0].state, state); assert.equal(view.workers[0].subject, undefined); assert.equal(view.workers[0].timeline, undefined);
  }
  const row = base.queueSurfaces[0];
  const day = DashboardDayWireSchema.parse({ ...base, workerCards: [{ ...base.workerCards[0], currentRun: { state: "present", runId: row.runId, traceId: row.traceId } }], queueSurfaces: [{ ...row, pipeline: [{ id: "actual", label: "Actual skipped step", state: "skipped" }] }] });
  const view = sessionsFromDay(day, catalog, now); assert.equal(view.state, "ready");
  if (view.state !== "ready") throw new Error("expected ready");
  assert.equal(view.workers[0].subject, row.title); assert.equal(view.workers[0].timeline, undefined); assert.match(view.workers[0].timelineUnavailable!, /unavailable/);
  assert.equal(sessionsFromDay({ ...day, workerAuthority: { state: "unavailable", reason: "authority missing", members: [] } }, catalog, now).state, "unavailable");
});

it("uses canonical client transport and confirms the command's own applied reply once its served effect appears, without POST replay", async () => {
  const h = harness(); const request: SessionPreviewRequest = { id: uuidOf(8100), target: h.day().workerCards[0].workerId, action: "pause", authorityKey: sessionWorkerAuthorityKey(h.day().workerCards[0]) };
  h.effect(command => applied(command));
  assert.equal((await h.port.send(request)).state, "uncertain");
  assert.equal(h.sent.length, 1); assert.equal(h.gets.length, 1, "one readback of the applied reply");
  const command = h.sent[0]; const original = structuredClone(command);
  assert.equal((await h.port.check(request)).state, "uncertain", "no served effect yet");
  h.setDay(DashboardDayWireSchema.parse({ ...effectOf(h.day(), command), workerCards: effectOf(h.day(), command).workerCards.map(card => ({ ...card, state: "running" })) }));
  const result = await h.port.check(request); assert.equal(result.state, "confirmed"); assert.equal(result.data?.state, "ready");
  if (result.data?.state !== "ready") throw new Error("expected current data");
  assert.equal(result.data.workers[0].state, "running", "the latest served phase wins");
  assert.deepEqual(h.sent, [original]); assert(h.gets.length > 0); assert(h.gets.every(url => url.includes("/api/v1/dashboard?day=")));
  assert.equal((await h.port.send({ ...request, id: uuidOf(8101), authorityKey: sessionWorkerAuthorityKey(h.day().workerCards[0]) })).state, "confirmed", "next request reaches transport after exact Check releases lock");
  assert.equal(h.sent.length, 2);
});

it("never confirms a pending reply from a served effect that another command could have caused", async () => {
  const h = harness(); const request: SessionPreviewRequest = { id: uuidOf(8110), target: h.day().workerCards[0].workerId, action: "pause" };
  h.effect(command => ({ state: "pending", commandId: command.commandId }));
  assert.equal((await h.port.send(request)).state, "uncertain");
  const command = h.sent[0];
  h.setDay(DashboardDayWireSchema.parse({ ...h.day(), workerCards: h.day().workerCards.map(card => ({ ...card, directive: "pause" })) }));
  assert.equal(sessionCommandEffect(h.day(), command), true, "an unrelated pause shows the same directive");
  assert.equal((await h.port.check(request)).state, "uncertain"); assert.equal(h.sent.length, 1);
});

it.each(["actor", "client", "request"])("retains original uncertain attempt across %s replacement and A to B to A", async kind => {
  const h = harness(); let release!: (value: unknown) => void;
  h.effect(() => new Promise(resolve => { release = resolve; }));
  const request: SessionPreviewRequest = { id: uuidOf(8200), target: h.day().workerCards[0].workerId, action: "pause" };
  const pending = h.port.send(request); await Promise.resolve();
  const original = h.scope();
  h.setScope({ ...original, ...(kind === "actor" ? { actorId: "other" } : kind === "client" ? { client: harness().client } : { dayRequest: {} }) });
  h.setScope({ ...original, dayRequest: {} });
  release(applied(h.sent[0])); assert.equal((await pending).state, "uncertain");
  assert.equal(h.sent.length, 1);
});

it.each([0, 1])("adds to a verified roster of %s with one plan that starts the new members", async count => {
  const h = harness(dayWith(count));
  const result = await h.port.send({ id: uuidOf(8300), target: "add", action: "add", workflow: "person-lookup", count: 2, ordinal: 99 });
  assert.equal(result.state, "confirmed"); assert.equal(h.sent.length, 1);
  const plan = h.sent[0]; assert(plan.family === "worker-browser" && plan.type === "plan-worker-count");
  assert.equal(plan.target.expectedVersion, count === 0 ? 0 : 1); assert.equal(plan.payload.desiredWorkers, count + 2);
});

it("refuses missing pool with nonempty roster and keeps a lost Add response locked", async () => {
  const broken = harness({ ...dayWith(), workerPools: [] });
  const request: SessionPreviewRequest = { id: uuidOf(8400), target: "add", action: "add", workflow: "person-lookup", count: 2, ordinal: 5 };
  assert.equal((await broken.port.send(request)).state, "refused"); assert.equal(broken.sent.length, 0);
  const h = harness(dayWith(0)); h.effect(command => ({ state: "pending", commandId: command.commandId }));
  assert.equal((await h.port.send(request)).state, "uncertain");
  assert.equal((await h.port.check(request)).state, "uncertain"); assert.equal(h.sent.length, 1);
  await assert.rejects(h.port.send(request), /ALREADY_SUBMITTED/);
});

it("does not confirm an applied reply whose served effect is absent", async () => {
  const h = harness(); const card = h.day().workerCards[0];
  h.effect(command => applied(command));
  const request: SessionPreviewRequest = { id: uuidOf(8500), target: card.workerId, action: "pause" };
  assert.equal((await h.port.send(request)).state, "uncertain");
  const command = h.sent[0];
  assert.equal(sessionCommandEffect(h.day(), command), false);
  assert.equal((await h.port.check(request)).state, "uncertain"); assert.equal(h.sent.length, 1);
});

it.each(["stop", "retry", "remove"] as const)("confirms %s once the served member fence moves, preserving the newest phase", async action => {
  const h = harness(); let effected: DashboardDayWire | undefined;
  if (action === "retry") h.setDay(DashboardDayWireSchema.parse({ ...h.day(), workerCards: [{ ...h.day().workerCards[0], state: "failed", endedAt: now, stopReason: "crashed" }] }));
  h.effect(command => {
    const next = effectOf(h.day(), command);
    effected = action === "stop" ? DashboardDayWireSchema.parse({ ...next, workerCards: next.workerCards.map(card => ({ ...card, state: "running" })) }) : next;
    return applied(command);
  });
  const request: SessionPreviewRequest = { id: uuidOf(8600), target: h.day().workerCards[0].workerId, action };
  assert.equal((await h.port.send(request)).state, "uncertain", "the applied reply is not yet served");
  assert(effected); h.setDay(effected);
  const result = await h.port.check(request); assert.equal(result.state, "confirmed"); assert.equal(h.sent.length, 1);
  assert.equal(result.data?.state, "ready");
  if (result.data?.state !== "ready") throw new Error("ready");
  assert.equal(result.data.workers.length, action === "remove" ? 0 : 1);
  if (action !== "remove") assert.equal(result.data.workers[0].state, action === "stop" ? "running" : "failed");
});

it("refresh confirms only while the member keeps the lifetime it was sent to", async () => {
  const h = harness(); const card = h.day().workerCards[0];
  h.setDay(DashboardDayWireSchema.parse({ ...h.day(), workerCards: [{ ...card, browsers: [{ sessionId: uuidOf(9000), system: "ucpath", openedAt: now, observation: { state: "present", health: "authenticated", observedAt: now, browserMode: "headed", configFingerprint: "a".repeat(64) } }] }] }));
  h.effect(command => ({ state: "pending", commandId: command.commandId }));
  const request: SessionPreviewRequest = { id: uuidOf(8700), target: card.workerId, action: "refresh", browserIds: [uuidOf(9000)], nativeCommandIds: [uuidOf(8700)], authorityKey: sessionWorkerAuthorityKey(h.day().workerCards[0]) };
  assert.equal((await h.port.send(request)).state, "uncertain");
  const command = h.sent[0]; assert(command.family === "worker-browser" && command.type === "refresh-browser");
  assert.equal(command.target.lifetimeId, LIFETIME);
  const restarted = DashboardDayWireSchema.parse({ ...h.day(), workerCards: h.day().workerCards.map(next => ({ ...next, controls: basis(NEXT_LIFETIME) })) });
  assert.equal(sessionCommandEffect(restarted, command), false);
  assert.equal(sessionCommandEffect(h.day(), command), true);
  assert.equal((await h.port.check(request)).state, "uncertain", "an unchanged card is no proof that a pending refresh ran");
  assert.equal(h.sent.length, 1);
});

it.each(["pending", "lost", "applied"] as const)("follows a Remove still in flight across a remount to its %s outcome without resending", async outcome => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const h = harness(); let release!: (value: unknown) => void; let original: CommandRequest | undefined;
  h.effect(command => { original = command; return new Promise((resolve, reject) => { release = value => { if (value instanceof Error) reject(value); else resolve(value); }; }); });
  const host = document.createElement("div"); document.body.append(host); let root = createRoot(host);
  const render = () => root.render(createElement(SessionPanelWithToasts, { catalog, source: "served", binding: h.binding(), open: true, onOpenChange() {} }));
  const text = () => document.body.textContent ?? "";
  try {
    await act(async () => render());
    const remove = [...document.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === "Remove worker"); assert(remove);
    await act(async () => remove.click()); assert.equal(h.sent.length, 1); assert(original);
    await act(async () => root.unmount()); root = createRoot(host);
    await act(async () => render());
    assert.match(text(), /Remove requested/u, "the remounted panel holds the in-flight Remove");
    assert.doesNotMatch(text(), /Check outcome/u);
    await act(async () => { release(outcome === "pending" ? { state: "pending", commandId: original!.commandId } : outcome === "lost" ? new Error("connection reset") : applied(original!)); await Promise.resolve(); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.match(text(), /Check outcome/u, "the settled unknown outcome is checkable on the new mount");
    assert.equal(document.querySelectorAll("article").length, 1);
    h.setDay(effectOf(h.day(), original));
    const check = [...document.querySelectorAll("button")].find(button => (button.getAttribute("aria-label") ?? button.textContent?.trim()) === "Check outcome"); assert(check);
    await act(async () => check.click());
    assert.equal(document.querySelectorAll("article").length, outcome === "applied" ? 0 : 1, outcome === "applied" ? "its own applied reply confirms once served" : "a served removal is no proof for a command with no applied reply");
    assert.equal(h.sent.length, 1);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it("hydrates no retained control for another scope", async () => {
  const h = harness(); let release!: (value: unknown) => void;
  h.effect(() => new Promise(resolve => { release = resolve; }));
  const request: SessionPreviewRequest = { id: uuidOf(8900), target: h.day().workerCards[0].workerId, action: "remove" };
  const sent = h.port.send(request); await Promise.resolve();
  assert.deepEqual(h.port.retained?.().map(operation => [operation.request.id, operation.state]), [[uuidOf(8900), "pending"]]);
  const other = createSessionPreviewPort(() => ({ binding: { ...h.binding(), scope: { ...h.scope(), actorId: "other" } }, catalog }));
  assert.deepEqual(other.retained?.(), []);
  release({ state: "pending", commandId: request.id }); await sent;
});

it("hydrates mounted Remove after remount, retains it through outage and a failed phase, and removes only on readback", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const h = harness(); let original: CommandRequest | undefined;
  h.effect(command => { original = command; return applied(command); });
  const host = document.createElement("div"); document.body.append(host); let root = createRoot(host);
  const render = () => root.render(createElement(SessionPanelWithToasts, { catalog, source: "served", binding: h.binding(), open: true, onOpenChange() {} }));
  const click = async (label: string) => {
    const button = [...document.querySelectorAll("button")].find(button => (button.getAttribute("aria-label") ?? button.textContent?.trim()) === label);
    assert(button, label); await act(async () => button.click());
  };
  try {
    await act(async () => render()); assert.equal(document.querySelectorAll("article").length, 1);
    await click("Remove worker"); assert.equal(h.sent.length, 1); assert(original);
    const pendingDay = h.day();
    await act(async () => root.unmount()); root = createRoot(host);
    await act(async () => render());
    assert.match(document.body.textContent ?? "", /Check outcome/); assert.equal(h.sent.length, 1);
    h.setDay(DashboardDayWireSchema.parse({ ...pendingDay, workerAuthority: { state: "unavailable", reason: "missing member", members: pendingDay.workerAuthority.members }, workerCards: [] }));
    await act(async () => render()); assert.equal(document.querySelectorAll("article").length, 0); assert.match(document.body.textContent ?? "", /Session information is unavailable/); assert.doesNotMatch(document.body.textContent ?? "", /missing member/);
    h.setDay(DashboardDayWireSchema.parse({ ...pendingDay, workerCards: [{ ...pendingDay.workerCards[0], state: "failed", endedAt: now, stopReason: "crashed" }] }));
    await act(async () => render()); assert.match(document.body.textContent ?? "", /Check outcome/);
    const retry = document.querySelector<HTMLButtonElement>('button[aria-label="Retry"]'); assert(retry?.disabled, "same Remove still locks newest failed card");
    h.setDay(effectOf(pendingDay, original));
    await click("Check outcome"); assert.equal(document.querySelectorAll("article").length, 0); assert.equal(h.sent.length, 1);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it("new private port cannot confirm native success when shared executor retains an earlier authority", async () => {
  const h = harness(); const card = h.day().workerCards[0]; const request: SessionPreviewRequest = { id: uuidOf(8800), target: card.workerId, action: "pause" };
  h.effect(command => ({ state: "pending", commandId: command.commandId }));
  await h.port.send(request);
  h.setDay(effectOf(h.day(), h.sent[0]));
  h.setScope({ ...h.scope(), authority: {}, dayRequest: {} });
  const reopened = createSessionPreviewPort(() => ({ binding: h.binding(), catalog }));
  assert.equal((await reopened.check(request)).state, "uncertain");
  assert.equal(h.executor.retainedAttempts()[0].outcome?.kind, "uncertain"); assert.equal(h.sent.length, 1);
});

it("does not accept a plan whose served roster does not match the desired count", () => {
  const day = dayWith(); assert(day.workerAuthority.state === "present");
  const request = CommandRequestSchema.parse({ commandId: uuidOf(8900), family: "worker-browser", type: "plan-worker-count", requestedAt: now, requestedBy: "local-operator", source: "dashboard-sessions", target: { workflowId: "person-lookup", expectedVersion: 0 }, payload: { desiredWorkers: 2 } });
  const short = DashboardDayWireSchema.parse({ ...day, workerPools: [{ ...day.workerPools[0], desiredWorkers: 2, version: 2 }] });
  assert.equal(sessionCommandEffect(short, request), false);
  assert.equal(sessionCommandEffect(effectOf(day, request), request), true);
});

it("does not spawn after a proved plan when current pool authority is missing", async () => {
  const h = harness(dayWith(0));
  h.effect(command => {
    const next = effectOf(h.day(), command);
    h.setDay(DashboardDayWireSchema.parse({ ...next, workerPools: [], workerAuthority: { state: "unavailable", members: next.workerAuthority.members, reason: "pool missing" }, workerCards: [] }));
    return applied(command);
  });
  assert.equal((await h.port.send({ id: uuidOf(8970), target: "add", action: "add", workflow: "person-lookup", count: 2, ordinal: 50 })).state, "uncertain");
  assert.equal(h.sent.length, 1);
});

it("maps unavailable served authority/catalog to fixed text while retaining diagnostics without rendering them", async () => {
  const h = harness(); const privateReason = "private authority detail";
  const unavailable = DashboardDayWireSchema.parse({ ...h.day(), workerAuthority: { state: "unavailable", reason: privateReason, members: h.day().workerAuthority.members }, workerCards: [] });
  const view = sessionsFromDay(unavailable, catalog, now); assert.equal(view.state, "unavailable");
  if (view.state !== "unavailable") throw new Error("unavailable");
  assert.equal(view.reason, ERROR_CATALOG.SESSIONS_UNAVAILABLE.text); assert.equal(view.diagnostic, unavailable.workerAuthority);
  const missing = sessionsFromDay(h.day(), [], now); assert.equal(missing.state, "unavailable");
  if (missing.state !== "unavailable") throw new Error("unavailable");
  assert.equal(missing.reason, ERROR_CATALOG.SESSIONS_UNAVAILABLE.text);
  assert.deepEqual(missing.diagnostic, { code: "SESSION_WORKFLOW_UNREGISTERED", workflowId: "person-lookup" });
  assert.equal(WORKER_STOP_REASON_LABEL.crashed, ERROR_CATALOG.WORKER_CRASHED.text);
  assert.equal(WORKER_STOP_REASON_LABEL.operator, "stopped by you");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const error = new DashboardClientError({ kind: "network", message: "private transport diagnostic" });
  const base = h.binding();
  try {
    await act(async () => root.render(createElement(SessionPanelWithToasts, { catalog, source: "served", open: true, onOpenChange() {}, binding: { ...base, dayState: { ...base.dayState, day: { state: "failed", error } } } })));
    assert.match(document.body.textContent ?? "", /Session information is unavailable/); assert.doesNotMatch(document.body.textContent ?? "", /private transport diagnostic/);
    assert.equal(error.message, "private transport diagnostic");
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it("maps a cached ready card to fixed unavailable when the mounted catalog removes its registration", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const h = harness(); const binding = h.binding();
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(SessionPanelWithToasts, { catalog, source: "served", binding, open: true, onOpenChange() {} })));
    assert.equal(document.querySelectorAll("article").length, 1);
    await act(async () => root.render(createElement(SessionPanelWithToasts, { catalog: [], source: "served", binding, open: true, onOpenChange() {} })));
    assert.equal(document.querySelectorAll("article").length, 0);
    assert.match(document.body.textContent ?? "", /Session information is unavailable/);
    assert.doesNotMatch(document.body.textContent ?? "", /SESSION_WORKFLOW_UNREGISTERED|person-lookup/);
    assert.equal(h.sent.length, 0);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it.each(["present", "unavailable"] as const)("renders starting browser requirements from served %s authority with no observations", async requirementState => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const h = harness();
  const requirements = requirementState === "present" ? { state: "present", systems: ["ucpath", "kuali"] }
    : { state: "unavailable", reason: "Launch-time browser requirements are unavailable" };
  h.setDay(DashboardDayWireSchema.parse({ ...h.day(), workerCards: [{ ...h.day().workerCards[0], state: "starting", browsers: [], browserRequirements: requirements }] }));
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(SessionPanelWithToasts, { catalog, source: "served", binding: h.binding(), open: true, onOpenChange() {} })));
    const article = host.querySelector("article"); assert(article);
    if (requirementState === "present") {
      assert.deepEqual([...article.querySelectorAll("li")].map(item => item.textContent), ["UCPATHOpening", "KUALIOpening"]);
      const view = sessionsFromDay(h.day(), catalog, now); assert(view.state === "ready");
      assert.equal(new Set(view.workers[0].browsers.map(browser => browser.id)).size, 2);
      assert(view.workers[0].browsers.every(browser => browser.state === "starting"));
      assert.equal(h.day().workerCards[0].browsers.length, 0, "required slots never mint physical sessions");
    } else {
      assert.doesNotMatch(article.textContent ?? "", /Launch-time browser requirements are unavailable/);
      assert.match(article.textContent ?? "", /No browser sessions open/);
      assert.equal(article.querySelectorAll("li").length, 0);
    }
    assert.equal(h.sent.length, 0);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it("refreshes only observed physical sessions through required presentation slots and preserves failed and browserless workers", async () => {
  const h = harness(); const card = h.day().workerCards[0];
  const physicalId = uuidOf(9100);
  const observed = { sessionId: physicalId, system: "crm", openedAt: now, observation: { state: "present", health: "authenticated", observedAt: now, browserMode: "headed", configFingerprint: "a".repeat(64) } };
  h.setDay(DashboardDayWireSchema.parse({ ...h.day(), workerCards: [{ ...card, browserRequirements: { state: "present", systems: ["crm", "ucpath"] }, browsers: [observed] }] }));
  const view = sessionsFromDay(h.day(), catalog, now); assert(view.state === "ready");
  assert.deepEqual(view.workers[0].browsers.map(browser => [browser.label, browser.state]), [["CRM", "ready"], ["UCPATH", "unopened"]]);
  const requiredId = view.workers[0].browsers[1].id;
  assert.notEqual(requiredId, physicalId);
  const schedule = new IdleSessionSchedule(); schedule.sync(view, 0);
  const partial = schedule.due(IDLE_REFRESH_MS, () => false)[0]; assert(partial?.action === "refresh");
  assert.deepEqual(partial.browserIds, [physicalId], "only the observed CRM session is refreshed");
  const emptySchedule = new IdleSessionSchedule();
  emptySchedule.sync(sessionsFromDay(DashboardDayWireSchema.parse({ ...h.day(), workerCards: [{ ...h.day().workerCards[0], browsers: [] }] }), catalog, now), 0);
  assert.deepEqual(emptySchedule.due(IDLE_REFRESH_MS, () => false), [], "required-only slots cannot create a refresh");
  const refusal = await h.port.send({ id: uuidOf(9101), target: card.workerId, action: "refresh", browserIds: [requiredId], authorityKey: sessionWorkerAuthorityKey(h.day().workerCards[0]) });
  assert.equal(refusal.state, "refused"); assert.equal(h.sent.length, 0);
  const acknowledged = h.day();
  const acknowledgedView = sessionsFromDay(acknowledged, catalog, now);
  schedule.sync(acknowledgedView, IDLE_REFRESH_MS, { [card.workerId]: { request: partial, state: "uncertain", message: "awaiting readback" } });
  schedule.confirm(partial, IDLE_REFRESH_MS, acknowledgedView);
  assert.deepEqual(schedule.view(IDLE_REFRESH_MS)[card.workerId], { remainingMs: IDLE_REFRESH_MS, waiting: false }, "unopened UCPath does not block exact physical CRM rearm");
  h.setDay(DashboardDayWireSchema.parse({ ...h.day(), workerCards: [{ ...h.day().workerCards[0], browsers: [observed, { ...observed, sessionId: uuidOf(9102), system: "ucpath" }] }] }));
  const complete = new IdleSessionSchedule(); complete.sync(sessionsFromDay(h.day(), catalog, now), 0);
  const request = complete.due(IDLE_REFRESH_MS, () => false)[0]; assert(request?.action === "refresh");
  assert.deepEqual(request.browserIds, [physicalId, uuidOf(9102)].sort());
  assert(!request.browserIds.includes(requiredId));
  for (const state of ["failed", "starting"] as const) {
    const day = DashboardDayWireSchema.parse({ ...h.day(), workerCards: [{ ...card, state, browsers: [], browserRequirements: { state: "present", systems: state === "failed" ? ["ucpath", "kuali"] : [] },
      ...(state === "failed" ? { endedAt: now, stopReason: "crashed" } : {}) }] });
    const view = sessionsFromDay(day, catalog, now); assert(view.state === "ready");
    assert.deepEqual(view.workers[0].browsers, []);
    assert.equal(view.workers[0].problem, state === "failed" ? "Worker stopped unexpectedly." : undefined);
  }
});

it.each(["outside-day", "empty", "skipped", "cancelled"] as const)("keeps the served current-run timeline refusal off the mounted active worker for %s", async scenario => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const h = harness(); const row = h.day().queueSurfaces.find(row => row.workflowId === h.day().workerCards[0].workflowId); assert(row);
  const pipeline = scenario === "empty" ? [] : [{ id: "served-step", label: "Served step", state: scenario === "outside-day" ? "active" : scenario }];
  h.setDay(DashboardDayWireSchema.parse({ ...h.day(), workerCards: [{ ...h.day().workerCards[0], state: "running", currentRun: { state: "present", runId: row.runId, traceId: row.traceId } }],
    queueSurfaces: scenario === "outside-day" ? [] : [{ ...row, pipeline }] }));
  const reason = scenario === "outside-day" ? "Run timeline is not served on this day" : scenario === "empty" ? "No steps are served for this run" : "The current timeline contains states unavailable in this view";
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(SessionPanelWithToasts, { catalog, source: "served", binding: h.binding(), open: true, onOpenChange() {} })));
    const article = host.querySelector("article"); assert(article);
    assert(!article.textContent?.includes(reason), "the served timeline refusal is a data gap, not card text");
    assert.equal((sessionsFromDay(h.day(), catalog, now) as Extract<ReturnType<typeof sessionsFromDay>, { state: "ready" }>).workers[0].timelineUnavailable, reason);
    assert.equal(article.querySelector('[role="progressbar"]'), null);
    assert.equal(h.sent.length, 0);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it("retains valid current-run timelines and ordinary no-run phases without rendering timeline refusal", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const h = harness(); const card = h.day().workerCards[0];
  const row = h.day().queueSurfaces.find(row => row.workflowId === card.workflowId); assert(row);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const render = () => root.render(createElement(SessionPanelWithToasts, { catalog, source: "served", binding: h.binding(), open: true, onOpenChange() {} }));
  try {
    h.setDay(DashboardDayWireSchema.parse({ ...h.day(), workerCards: [{ ...card, state: "running", currentRun: { state: "present", runId: row.runId, traceId: row.traceId } }],
      queueSurfaces: [{ ...row, pipeline: [{ id: "served-active", label: "Served active step", state: "active" }] }] }));
    await act(async () => render()); assert(host.querySelector('[role="progressbar"]'));
    assert.doesNotMatch(host.textContent ?? "", /Run timeline is not served|No steps are served|states unavailable/);
    for (const state of ["idle", "starting", "failed", "running", "waiting", "paused"] as const) {
      h.setDay(DashboardDayWireSchema.parse({ ...h.day(), workerCards: [{ ...card, state, currentRun: { state: "absent", reason: "No current claimed run" },
        ...(state === "failed" ? { endedAt: now, stopReason: "crashed" } : {}) }] }));
      await act(async () => render());
      assert.doesNotMatch(host.textContent ?? "", /No current claimed run|Run timeline is not served|No steps are served|states unavailable/);
      assert.equal(host.querySelector('[role="progressbar"]'), null);
      if (state === "idle") assert.match(host.textContent ?? "", /Ready for the next run/);
      if (state === "starting") assert.match(host.textContent ?? "", /Preparing worker/);
      if (state === "failed") assert(host.textContent?.includes("Worker stopped unexpectedly."));
    }
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it("distinguishes unopened browser requirements from observed unavailable health", async () => {
  const day = dayWith(); const card = day.workerCards[0];
  for (const [state, expected] of [["idle", "unopened"], ["starting", "starting"]] as const) {
    const view = sessionsFromDay(DashboardDayWireSchema.parse({ ...day, workerCards: [{ ...card, state,
      browserRequirements: { state: "present", systems: ["crm", "ucpath"] }, browsers: [] }] }), catalog, now);
    assert(view.state === "ready");
    assert.deepEqual(view.workers[0].browsers.map(browser => [browser.label, browser.state]), [["CRM", expected], ["UCPATH", expected]]);
    assert.equal(view.workers[0].problem, undefined);
  }
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const h = harness(day);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    for (const observation of [undefined, { state: "unavailable", reason: "Browser health was not served" },
      { state: "present", health: "unknown", observedAt: now, browserMode: "headed", configFingerprint: "a".repeat(64) },
      { state: "present", health: "failed", observedAt: now, browserMode: "headed", configFingerprint: "a".repeat(64) }]) {
      h.setDay(DashboardDayWireSchema.parse({ ...day, workerCards: [{ ...card,
        browserRequirements: { state: "present", systems: ["crm", "ucpath"] }, browsers: [{ sessionId: uuidOf(9200), system: "crm", openedAt: now, observation }] }] }));
      const view = sessionsFromDay(h.day(), catalog, now); assert(view.state === "ready");
      assert.deepEqual(view.workers[0].browsers.map(browser => [browser.label, browser.state]), [["CRM", observation?.state === "present" && observation.health === "failed" ? "failed" : "unavailable"], ["UCPATH", "unopened"]]);
      await act(async () => root.render(createElement(SessionPanelWithToasts, { catalog, source: "served", binding: h.binding(), open: true, onOpenChange() {} })));
      assert.deepEqual([...host.querySelectorAll("article li")].map(item => item.textContent), [observation?.state === "present" && observation.health === "failed" ? "CRMFailed" : "CRMUnavailable", "UCPATHNot opened"]);
      assert.match(host.querySelector("article")?.textContent ?? "", /No run assigned.*Ready for the next run/s);
      assert.equal(h.sent.length, 0);
    }
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it("shows Opening during login, In use during a callback, and Closed after a CRM read closes", () => {
  const day = dayWith(); const card = day.workerCards[0];
  for (const [health, state, expected] of [["starting", "waiting", "starting"], ["unknown", "running", "active"]] as const) {
    const view = sessionsFromDay(DashboardDayWireSchema.parse({ ...day, workerCards: [{ ...card, state,
      browserRequirements: { state: "present", systems: ["crm", "ucpath"] },
      browsers: [{ sessionId: uuidOf(9290), system: "ucpath", openedAt: now,
        observation: { state: "present", health, observedAt: now, browserMode: "headed", configFingerprint: "a".repeat(64) } }] }] }), catalog, now);
    assert.ok(view.state === "ready");
    assert.deepEqual(view.workers[0].browsers.map(browser => [browser.label, browser.state]), [["CRM", "unopened"], ["UCPATH", expected]]);
  }
  const closed = sessionsFromDay(DashboardDayWireSchema.parse({ ...day, workerCards: [{ ...card,
    browserRequirements: { state: "present", systems: ["crm", "ucpath"] }, browsers: [], closedBrowserSystems: ["crm"] }] }), catalog, now);
  assert.ok(closed.state === "ready");
  assert.deepEqual(closed.workers[0].browsers.map(browser => [browser.label, browser.state]), [["CRM", "closed"], ["UCPATH", "unopened"]]);
});

it("distinguishes an intentionally stopped worker after restart from a crashed worker", () => {
  const day = dayWith(); const card = day.workerCards[0];
  for (const stopReason of ["operator", "crashed"] as const) {
    const view = sessionsFromDay(DashboardDayWireSchema.parse({ ...day, workerCards: [{ ...card,
      state: "failed", endedAt: now, stopReason, browsers: [] }] }), catalog, now);
    assert.ok(view.state === "ready");
    assert.equal(view.workers[0].state, stopReason === "crashed" ? "failed" : "stopped");
    assert.equal(view.workers[0].problem, { operator: "You stopped this worker.", crashed: "Worker stopped unexpectedly." }[stopReason]);
  }
});

it("shows a crashed worker's catalog failure text and falls back to the generic line without a code", () => {
  const day = dayWith(); const card = day.workerCards[0];
  const problemOf = (failureCode?: "BROWSER_ROOT_UNAVAILABLE") => {
    const view = sessionsFromDay(DashboardDayWireSchema.parse({ ...day, workerCards: [{ ...card, state: "failed", endedAt: now, stopReason: "crashed", browsers: [],
      ...(failureCode === undefined ? {} : { failureCode }) }] }), catalog, now);
    assert.ok(view.state === "ready");
    assert.equal(view.workers[0].state, "failed");
    return view.workers[0].problem;
  };
  assert.equal(problemOf("BROWSER_ROOT_UNAVAILABLE"), ERROR_CATALOG.BROWSER_ROOT_UNAVAILABLE.text);
  assert.equal(problemOf(), "Worker stopped unexpectedly.");
});

it("shows a worker stopped by a Relay shutdown as stopped, not failed", () => {
  const day = dayWith(); const card = day.workerCards[0];
  const view = sessionsFromDay(DashboardDayWireSchema.parse({ ...day, workerCards: [{ ...card, state: "failed", endedAt: now, stopReason: "shutdown", browsers: [] }] }), catalog, now);
  assert.ok(view.state === "ready");
  assert.equal(view.workers[0].state, "stopped");
  assert.equal(view.workers[0].problem, "Relay shut down.");
});

/** A failed card whose Retry reply is lost in transit: the command reached the server, the answer never came back. */
async function lostRetry(options: { audit?: (command: CommandRequest) => unknown; serverEffect?: (h: ReturnType<typeof harness>) => void } = {}) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const h = harness(); const card = h.day().workerCards[0];
  h.setDay(DashboardDayWireSchema.parse({ ...h.day(), workerCards: [{ ...card, state: "failed", endedAt: now, stopReason: "crashed" }] }));
  h.effect(() => { options.serverEffect?.(h); throw new Error("connection reset"); });
  const { audit } = options;
  if (audit) h.auditBy((commandId: string) => { const sent = h.sent.find(command => command.commandId === commandId); return sent ? audit(sent) : { state: "unavailable" }; });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const render = () => act(async () => root.render(createElement(SessionPanelWithToasts, { catalog, source: "served", binding: h.binding(), open: true, onOpenChange() {} })));
  const text = () => document.body.textContent ?? "";
  const retry = () => document.querySelector<HTMLButtonElement>('button[aria-label="Retry"]');
  const toasts = () => [...document.querySelectorAll('[data-slot="toast"]')].filter(toast => (toast.textContent ?? "").includes("Couldn't restart this worker."));
  const checkOutcome = () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => (button.textContent ?? "").includes("Check outcome"));
  await render();
  const button = retry(); assert(button && !button.disabled);
  const dayBeforeClick = h.day(); const getsBeforeClick = h.gets.length;
  await act(async () => button.click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  if (!audit) { assert.match(text(), /Check outcome/); assert(retry()?.disabled, "the uncertain Retry locks the control"); }
  assert.equal(h.sent.length, 1);
  const command = h.sent[0]; assert(command.family === "worker-browser" && command.type === "retry-worker");
  const finish = async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); };
  return { h, card, command, render, text, retry, toasts, checkOutcome, dayBeforeClick, getsBeforeClick, finish };
}
async function publishChange(h: ReturnType<typeof harness>, render: () => Promise<void>) {
  h.setDay(DashboardDayWireSchema.parse({ ...h.day() })); await render();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
const rejected = (command: CommandRequest) => ({ state: "recorded", request: command, result: { state: "rejected", commandId: command.commandId, code: "invalid-state", message: "WORKER_START_FAILED" } });
const anyToasts = () => document.querySelectorAll('[data-slot="toast"]').length;

it("recovers a Retry whose reply was lost from its audited rejection: one toast, controls released, no resend", async () => {
  const { h, render, text, retry, toasts, dayBeforeClick, getsBeforeClick, finish } = await lostRetry({ audit: rejected });
  try {
    assert.equal(h.day(), dayBeforeClick, "the served day was never changed"); assert.equal(h.gets.length, getsBeforeClick, "a rejection needs no day read");
    assert.doesNotMatch(text(), /Check outcome/); assert.equal(retry()?.disabled, false);
    assert.equal(toasts().length, 1); assert.equal(anyToasts(), 1); assert.equal(h.sent.length, 1);
    await render(); await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.equal(h.day(), dayBeforeClick); assert.equal(toasts().length, 1); assert.equal(h.sent.length, 1);
  } finally { await finish(); }
});

it("settles a lost Retry on Check outcome once its audit is recorded, with one toast", async () => {
  const { h, command, text, retry, toasts, checkOutcome, finish } = await lostRetry();
  try {
    h.audit(rejected(command));
    const button = checkOutcome(); assert(button);
    await act(async () => button.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.doesNotMatch(text(), /Check outcome/); assert.equal(retry()?.disabled, false);
    assert.equal(toasts().length, 1); assert.equal(anyToasts(), 1); assert.equal(h.sent.length, 1);
  } finally { await finish(); }
});

it("recovers a lost Retry reply from its audited success without resending", async () => {
  const restart = (h: ReturnType<typeof harness>) => {
    const { endedAt: _endedAt, stopReason: _stopReason, ...running } = h.day().workerCards[0];
    h.setDay(DashboardDayWireSchema.parse({ ...h.day(), workerCards: [{ ...running, state: "idle", controls: basis(NEXT_LIFETIME) }] }));
  };
  const { h, text, retry, finish } = await lostRetry({ serverEffect: restart, audit: command => ({ state: "recorded", request: command, result: applied(command) }) });
  try {
    assert.doesNotMatch(text(), /Check outcome/); assert.equal(retry()?.disabled ?? false, false);
    assert.equal(anyToasts(), 0); assert.equal(h.sent.length, 1);
  } finally { await finish(); }
});

it("keeps a lost Retry unproved while no audit is recorded", async () => {
  const { h, render, text, retry, finish } = await lostRetry();
  try {
    await publishChange(h, render);
    assert.match(text(), /Check outcome/); assert(retry()?.disabled);
    assert.equal(document.querySelectorAll('[data-slot="toast"]').length, 0); assert.equal(h.sent.length, 1);
  } finally { await finish(); }
});

it("does not adopt another command's recorded outcome for a lost Retry", async () => {
  const other = (command: CommandRequest) => {
    const copy = structuredClone(command); assert(copy.family === "worker-browser" && copy.type === "retry-worker");
    copy.target.lifetimeId = uuidOf(7999); return rejected(copy);
  };
  const { h, render, text, retry, finish } = await lostRetry({ audit: other });
  try {
    await publishChange(h, render);
    assert.match(text(), /Check outcome/); assert(retry()?.disabled);
    assert.equal(anyToasts(), 0); assert.equal(h.sent.length, 1);
  } finally { await finish(); }
});
