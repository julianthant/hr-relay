import { IdleSessionSchedule, IDLE_REFRESH_MS } from "../../../../src/dashboard/surfaces/sessions/session-idle-model.js";
import { servedFixtureSources as previewFixtureSources } from "../../../parity/helpers/workflow-composition.js";
import { ERROR_CATALOG } from "../../../../src/models/failures/error-catalog.js";
import { DashboardClientError } from "../../../../src/dashboard/client/errors.js";
import { WORKER_STOP_REASON_LABEL } from "../../../../src/dashboard/surfaces/sessions/session-panel-model.js";
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import { SessionPanel } from "../../../../src/dashboard/surfaces/sessions/session-panel.js";
import assert from "node:assert/strict";
import { it } from "vitest";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { CommandExecutor, type CommandExecutionScope } from "../../../../src/dashboard/app/commands/command-executor.js";
import { createSessionPreviewPort, sessionCommandApplication, type SessionCommandBinding, type SessionPreviewRequest } from "../../../../src/dashboard/surfaces/sessions/session-preview-command-model.js";
import { sessionsFromDay, sessionWorkerAuthorityKey } from "../../../../src/dashboard/surfaces/sessions/sessions-view-model.js";
import { CommandRequestSchema, CommandResultSchema, type CommandRequest } from "../../../../src/rules/commands/commands.js";
import { DashboardDayWireSchema, type DashboardDayWire } from "../../../../src/models/dashboard/projection.js";
import { WorkerControlRecordSchema } from "../../../../src/models/run/worker-control.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { FIXTURE_DAY_WIRE, FIXTURE_NOW, uuidOf } from "../../../parity/helpers/fixture-day.js";

const catalog = buildWorkflowCatalog([], true, previewFixtureSources([]));
const now = FIXTURE_NOW;
function dayWith(count = 1): DashboardDayWire {
  const base = FIXTURE_DAY_WIRE;
  assert.equal(base.workerAuthority.state, "present");
  if (base.workerAuthority.state !== "present") throw new Error("fixture authority");
  return DashboardDayWireSchema.parse({ ...base, workerPools: count === 0 ? [] : [{ workflowId: "person-lookup", desiredWorkers: count, version: 1, plannedBy: "local-operator", plannedAt: now }],
    workerAuthority: { state: "present", members: base.workerAuthority.members.slice(0, count).map(slot => ({ ...slot, phase: "idle" })) },
    workerCards: base.workerCards.slice(0, count).map(card => ({ ...card, state: "idle", browsers: [], currentRun: { state: "absent", reason: "no current run" },
      controls: { basis: { state: "present", value: { leaseGeneration: 1, controlRevision: 1 } }, ownership: { state: "owned" } } })), workerOperations: [] });
}
function application(command: CommandRequest) {
  const affectedTargets = command.family === "worker-browser" && command.type === "plan-worker-count" ? [{ family: "worker-pool", workflowId: command.target.workflowId }]
    : command.family === "worker-browser" && command.type === "spawn-worker" ? [{ family: "worker-browser", workerId: command.payload.workerId }]
    : "workerId" in command.target ? [{ family: "worker-browser", workerId: command.target.workerId }] : [];
  return { result: CommandResultSchema.parse({ state: "applied", commandId: command.commandId, affectedTargets }), versionChanges: [], affectedDependencyIds: [] };
}
function succeeded(day: DashboardDayWire, command: CommandRequest, additions: Record<string, unknown> = {}) {
  assert.equal(command.family, "worker-browser");
  return WorkerControlRecordSchema.parse({ commandId: command.commandId, request: command, scope: "worker-pool:person-lookup", executorId: uuidOf(8001), admittedAt: now, expiresAt: "2027-01-01T00:00:00Z", basisVersion: 1, auditedAt: now,
    phase: { state: "succeeded", startedAt: now, completedAt: now, acknowledgement: { kind: "control", ...(command.family === "worker-browser" && command.type === "refresh-browser" ? { browserSessionId: command.target.browserSessionId } : {}) }, application: application(command) }, ...additions });
}
function planned(day: DashboardDayWire, command: Extract<CommandRequest, { type: "plan-worker-count" }>): DashboardDayWire {
  const base = FIXTURE_DAY_WIRE; assert(base.workerAuthority.state === "present");
  const selected = base.workerAuthority.members.slice(0, command.payload.desiredWorkers);
  const beforeVersion = command.target.expectedVersion;
  const record = succeeded(day, command, { basisVersion: beforeVersion,
    roster: { selected, excess: [], beforeVersion, admittedVersion: beforeVersion + 1, afterVersion: beforeVersion + 1 },
    phase: { state: "succeeded", startedAt: now, completedAt: now, acknowledgement: { kind: "plan", workerIds: selected.map(slot => slot.workerId), retirements: [] },
      application: { ...application(command), result: { ...application(command).result, affectedTargets: [{ family: "worker-pool", workflowId: command.target.workflowId }, ...selected.map(slot => ({ family: "worker-browser", workerId: slot.workerId }))] } } } });
  return DashboardDayWireSchema.parse({ ...day, workerAuthority: { state: "present", members: selected }, workerCards: base.workerCards.slice(0, command.payload.desiredWorkers),
    workerPools: [{ workflowId: command.target.workflowId, desiredWorkers: command.payload.desiredWorkers, version: beforeVersion + 1, plannedBy: "local-operator", plannedAt: now }], workerOperations: [record] });
}
function harness(initial = dayWith()) {
  let day = initial; const sent: CommandRequest[] = []; const gets: string[] = [];
  let effect: (command: CommandRequest) => unknown = command => { day = DashboardDayWireSchema.parse({ ...day, workerOperations: [...day.workerOperations, succeeded(day, command)] }); return application(command).result; };
  const client = createDashboardClient({ baseUrl: "http://sessions.test", fetchImpl: async (url, init) => {
    if (init?.method === "POST") { assert.equal(typeof init.body, "string");
      if (typeof init.body !== "string") throw new Error("JSON body missing");
      const command = CommandRequestSchema.parse(JSON.parse(init.body)); sent.push(command); return Response.json(await effect(command)); }
    gets.push(String(url)); return Response.json(day);
  } });
  let scope: CommandExecutionScope = { actorId: "local-operator", client, authority: {}, dayRequest: {} };
  const executor = new CommandExecutor(() => scope);
  const binding = (): SessionCommandBinding => ({ client, executor, scope, day: day.day, nowIso: now,
    dayState: { subscribePublications: () => { throw new Error("fixture publications are not served"); }, request: scope.dayRequest, day: { state: "loaded", value: day }, connection: { state: "connecting" }, refresh() {} } });
  const port = createSessionPreviewPort(() => ({ binding: binding(), catalog }));
  return { port, client, executor, sent, gets, binding, day: () => day, setDay: (next: DashboardDayWire) => { day = next; },
    effect: (next: typeof effect) => { effect = next; }, scope: () => scope, setScope: (next: CommandExecutionScope) => { scope = next; } };
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

it("uses canonical client transport and exact native Check after response loss without POST replay", async () => {
  const h = harness(); const request: SessionPreviewRequest = { id: uuidOf(8100), target: h.day().workerCards[0].workerId, action: "pause", authorityKey: sessionWorkerAuthorityKey(h.day().workerCards[0]) };
  h.effect(command => ({ state: "pending", commandId: command.commandId }));
  assert.equal((await h.port.send(request)).state, "uncertain");
  assert.equal(h.sent.length, 1); assert.equal(h.gets.length, 0);
  const command = h.sent[0]; const original = structuredClone(command);
  h.setDay(DashboardDayWireSchema.parse({ ...h.day(), workerCards: [{ ...h.day().workerCards[0], state: "running" }], workerOperations: [succeeded(h.day(), command)] }));
  const result = await h.port.check(request); assert.equal(result.state, "confirmed"); assert.equal(result.data?.state, "ready");
  if (result.data?.state !== "ready") throw new Error("expected current data");
  assert.equal(result.data.workers[0].state, "running", "historical ack never overwrites latest phase");
  assert.deepEqual(h.sent, [original]); assert(h.gets.length > 0); assert(h.gets.every(url => url.includes("/api/v1/dashboard?day=")));
  assert.equal((await h.port.send({ ...request, id: uuidOf(8101), authorityKey: sessionWorkerAuthorityKey(h.day().workerCards[0]) })).state, "uncertain", "next request reaches transport after exact Check releases lock");
  assert.equal(h.sent.length, 2);
});

it.each(["actor", "client", "request"])("retains original uncertain attempt across %s replacement and A to B to A", async kind => {
  const h = harness(); let release!: (value: unknown) => void;
  h.effect(() => new Promise(resolve => { release = resolve; }));
  const request: SessionPreviewRequest = { id: uuidOf(8200), target: h.day().workerCards[0].workerId, action: "pause" };
  const pending = h.port.send(request); await Promise.resolve();
  const original = h.scope();
  h.setScope({ ...original, ...(kind === "actor" ? { actorId: "other" } : kind === "client" ? { client: harness().client } : { dayRequest: {} }) });
  h.setScope({ ...original, dayRequest: {} });
  release(application(h.sent[0]).result); assert.equal((await pending).state, "uncertain");
  assert.equal(h.sent.length, 1);
});

it.each([0, 1])("adds to verified roster of %s, spawns only new exact selected members", async count => {
  const h = harness(dayWith(count));
  h.effect(command => {
    assert.equal(command.family, "worker-browser");
    if (command.family !== "worker-browser") throw new Error("worker command");
    if (command.type === "plan-worker-count") {
      h.setDay(planned(h.day(), command));
    } else h.setDay(DashboardDayWireSchema.parse({ ...h.day(), workerOperations: [...h.day().workerOperations, succeeded(h.day(), command)] }));
    const native = h.day().workerOperations.find(record => record.commandId === command.commandId);
    assert(native?.phase.state === "succeeded" && native.phase.application !== undefined);
    return native.phase.application.result;
  });
  const result = await h.port.send({ id: uuidOf(8300), target: "add", action: "add", workflow: "person-lookup", count: 2, ordinal: 99 });
  assert.equal(result.state, "confirmed"); assert.equal(h.sent.length, 3);
  assert.deepEqual(h.sent.slice(1).map(command => command.family === "worker-browser" && command.type === "spawn-worker" ? command.payload.workerId : "wrong"), [`person-lookup-worker-${count + 1}`, `person-lookup-worker-${count + 2}`]);
  assert.equal((h.sent[0] as Extract<CommandRequest, { type: "plan-worker-count" }>).target.expectedVersion, count === 0 ? 0 : 1);
});

it("refuses missing pool with nonempty roster and keeps lost compound response locked; Check never starts unsent spawns", async () => {
  const broken = harness({ ...dayWith(), workerPools: [] });
  const request: SessionPreviewRequest = { id: uuidOf(8400), target: "add", action: "add", workflow: "person-lookup", count: 2, ordinal: 5 };
  assert.equal((await broken.port.send(request)).state, "refused"); assert.equal(broken.sent.length, 0);
  const h = harness(dayWith(0)); h.effect(command => ({ state: "pending", commandId: command.commandId }));
  assert.equal((await h.port.send(request)).state, "uncertain");
  assert.equal((await h.port.check(request)).state, "uncertain"); assert.equal(h.sent.length, 1);
  await assert.rejects(h.port.send(request), /ALREADY_SUBMITTED/);
});

it("does not confirm wrong affected target through direct or hydrated native Check", async () => {
  const h = harness(); const card = h.day().workerCards[0];
  const command = CommandRequestSchema.parse({ commandId: uuidOf(8500), family: "worker-browser", type: "pause-worker", requestedAt: now, requestedBy: "local-operator", source: "dashboard-sessions", target: { workerId: card.workerId, expectedVersion: card.leaseVersion, controlBasis: { leaseGeneration: 1, controlRevision: 1 } } });
  const record = succeeded(h.day(), command, { phase: { state: "succeeded", startedAt: now, completedAt: now, acknowledgement: { kind: "control" }, application: { ...application(command), result: { state: "applied", commandId: command.commandId, affectedTargets: [{ family: "worker-browser", workerId: "person-lookup-worker-999" }] } } } });
  h.setDay(DashboardDayWireSchema.parse({ ...h.day(), workerOperations: [record] }));
  assert.throws(() => sessionCommandApplication(h.day(), command), error => error instanceof Error && "code" in error && error.code === "COMMAND_RESULT_IDENTITY_MISMATCH");
  assert.equal((await h.port.check({ id: command.commandId, target: card.workerId, action: "pause" })).state, "uncertain");
  assert.equal(h.sent.length, 0);
});

function lifecycleRecord(day: DashboardDayWire, command: CommandRequest) {
  assert(command.family === "worker-browser" && (command.type === "remove-worker" || command.type === "retry-worker" || command.type === "stop-worker"));
  const card = day.workerCards[0]; const member = card.member;
  const binding = { commandId: command.commandId, member, lifetime: { leaseGeneration: 1, processId: 1234, startedAt: now }, basis: { leaseGeneration: 1, controlRevision: 1 }, reservedControlRevision: 2 };
  const lifecycle = { ...binding, poolVersion: 1, desiredWorkers: 1, operation: command.type === "remove-worker" ? { kind: "remove" } : { kind: "retry", mode: "initialize", systems: [], configSnapshotId: uuidOf(700), configFingerprint: "a".repeat(64), descriptorVersion: 1, contractFingerprint: "b".repeat(64) } };
  const retirement = { workerId: card.workerId, membershipRevision: member.membershipRevision, checkedAt: now, processStopped: true, browsersClosed: true, exclusive: true };
  const acknowledgement = command.type === "stop-worker" ? { kind: "reset", commandId: command.commandId, leaseGeneration: 1, controlRevision: 2, membershipRevision: member.membershipRevision, idleAt: now, closedSessionIds: [], browsersClosed: true, duoReleased: true }
    : command.type === "remove-worker" ? { kind: "remove", retirement, beforePoolVersion: 1, afterPoolVersion: 2, beforeCount: 1, afterCount: 0 }
    : { kind: "retry", oldLeaseGeneration: 1, leaseGeneration: 2, processId: 2345, startedAt: now };
  return succeeded(day, command, { ...(command.type === "stop-worker" ? { reset: { ...binding, work: { kind: "absent" } } } : { lifecycle, ...(command.type === "remove-worker" ? { closure: { observedAt: now, closedSessionIds: [] } } : { readiness: { state: "initializing", leaseGeneration: 2 } }) }),
    phase: { state: "succeeded", startedAt: now, completedAt: now, acknowledgement, application: application(command) } });
}

it.each(["stop", "retry", "remove"] as const)("confirms exact %s immutable milestone while preserving newest actual resource", async action => {
  const h = harness();
  if (action === "retry") h.setDay(DashboardDayWireSchema.parse({ ...h.day(), workerCards: [{ ...h.day().workerCards[0], state: "failed", endedAt: now, stopReason: "crashed", controls: { ...h.day().workerCards[0].controls, ownership: { state: "unavailable", reason: "old owner died" } } }] }));
  h.effect(command => {
    const record = lifecycleRecord(h.day(), command);
    const next = action === "remove" ? { ...h.day(), workerPools: [{ ...h.day().workerPools[0], desiredWorkers: 0, version: 2 }], workerAuthority: { state: "present", members: [] }, workerCards: [], workerOperations: [record] }
      : { ...h.day(), workerCards: [{ ...h.day().workerCards[0], ...(action === "stop" ? { state: "running" } : { state: "failed", endedAt: now, stopReason: "crashed" }) }], workerOperations: [record] };
    h.setDay(DashboardDayWireSchema.parse(next)); return { state: "pending", commandId: command.commandId };
  });
  const request: SessionPreviewRequest = { id: uuidOf(8600), target: h.day().workerCards[0].workerId, action };
  assert.equal((await h.port.send(request)).state, "uncertain");
  const result = await h.port.check(request); assert.equal(result.state, "confirmed"); assert.equal(h.sent.length, 1);
  assert.equal(result.data?.state, "ready");
  if (result.data?.state !== "ready") throw new Error("ready");
  assert.equal(result.data.workers.length, action === "remove" ? 0 : 1);
  if (action !== "remove") assert.equal(result.data.workers[0].state, action === "stop" ? "running" : "failed");
});

it("refresh Check requires exact physical acknowledgment and retains unknown/missing native evidence", async () => {
  const h = harness(); const card = h.day().workerCards[0];
  h.setDay(DashboardDayWireSchema.parse({ ...h.day(), workerCards: [{ ...card, browsers: [{ sessionId: uuidOf(9000), system: "ucpath", openedAt: now, observation: { state: "present", health: "authenticated", observedAt: now, browserMode: "headed", configFingerprint: "a".repeat(64) } }] }] }));
  h.effect(command => ({ state: "pending", commandId: command.commandId }));
  const request: SessionPreviewRequest = { id: uuidOf(8700), target: card.workerId, action: "refresh", browserIds: [uuidOf(9000)], nativeCommandIds: [uuidOf(8700)], authorityKey: sessionWorkerAuthorityKey(h.day().workerCards[0]) };
  assert.equal((await h.port.send(request)).state, "uncertain");
  assert.equal((await h.port.check(request)).state, "uncertain");
  const command = h.sent[0];
  const incorrect = succeeded(h.day(), command, { phase: { state: "succeeded", startedAt: now, completedAt: now, acknowledgement: { kind: "control", browserSessionId: uuidOf(9001) }, application: application(command) } });
  h.setDay(DashboardDayWireSchema.parse({ ...h.day(), workerOperations: [incorrect] }));
  assert.equal((await h.port.check(request)).state, "uncertain");
  h.setDay(DashboardDayWireSchema.parse({ ...h.day(), workerOperations: [succeeded(h.day(), command)] }));
  assert.equal((await h.port.check(request)).state, "confirmed"); assert.equal(h.sent.length, 1);
});

it("hydrates mounted Remove after remount, retains original through outage/new failed phase, and removes only on exact tombstone readback", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const h = harness(); let original: CommandRequest | undefined;
  h.effect(command => {
    original = command;
    const settled = lifecycleRecord(h.day(), command);
    const pending = WorkerControlRecordSchema.parse({ ...settled, auditedAt: undefined, phase: { state: "executing", startedAt: now } });
    h.setDay(DashboardDayWireSchema.parse({ ...h.day(), workerOperations: [pending] }));
    return { state: "pending", commandId: command.commandId };
  });
  const host = document.createElement("div"); document.body.append(host); let root = createRoot(host);
  const render = () => root.render(createElement(SessionPanel, { catalog, source: "served", binding: h.binding(), open: true, onOpenChange() {} }));
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
    h.setDay(DashboardDayWireSchema.parse({ ...pendingDay, workerAuthority: { state: "unavailable", reason: "missing lease", members: pendingDay.workerAuthority.members }, workerCards: [] }));
    await act(async () => render()); assert.equal(document.querySelectorAll("article").length, 0); assert.match(document.body.textContent ?? "", /Session information is unavailable/); assert.doesNotMatch(document.body.textContent ?? "", /missing lease/);
    h.setDay(DashboardDayWireSchema.parse({ ...pendingDay, workerCards: [{ ...pendingDay.workerCards[0], state: "failed", endedAt: now, stopReason: "crashed" }] }));
    await act(async () => render()); assert.match(document.body.textContent ?? "", /Check outcome/);
    const retry = document.querySelector<HTMLButtonElement>('button[aria-label="Retry"]'); assert(retry?.disabled, "same Remove still locks newest failed card");
    const settled = lifecycleRecord(pendingDay, original);
    h.setDay(DashboardDayWireSchema.parse({ ...pendingDay, workerPools: [{ ...pendingDay.workerPools[0], desiredWorkers: 0, version: 2 }], workerAuthority: { state: "present", members: [] }, workerCards: [], workerOperations: [settled] }));
    await click("Check outcome"); assert.equal(document.querySelectorAll("article").length, 0); assert.equal(h.sent.length, 1);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it("new private port cannot confirm native success when shared executor retains an earlier authority", async () => {
  const h = harness(); const card = h.day().workerCards[0]; const request: SessionPreviewRequest = { id: uuidOf(8800), target: card.workerId, action: "pause" };
  h.effect(command => ({ state: "pending", commandId: command.commandId }));
  await h.port.send(request);
  h.setDay(DashboardDayWireSchema.parse({ ...h.day(), workerOperations: [succeeded(h.day(), h.sent[0])] }));
  h.setScope({ ...h.scope(), authority: {}, dayRequest: {} });
  const reopened = createSessionPreviewPort(() => ({ binding: h.binding(), catalog }));
  assert.equal((await reopened.check(request)).state, "uncertain");
  assert.equal(h.executor.retainedAttempts()[0].outcome?.kind, "uncertain"); assert.equal(h.sent.length, 1);
});

it("does not accept generic plan target validation as proof of the admitted member relationship", () => {
  const day = dayWith(); assert(day.workerAuthority.state === "present");
  const request = CommandRequestSchema.parse({ commandId: uuidOf(8900), family: "worker-browser", type: "plan-worker-count", requestedAt: now, requestedBy: "local-operator", source: "dashboard-sessions", target: { workflowId: "person-lookup", expectedVersion: 0 }, payload: { desiredWorkers: 1 } });
  const selected = day.workerAuthority.members;
  const record = succeeded(day, request, { basisVersion: 0, roster: { selected, excess: [], beforeVersion: 0, admittedVersion: 1, afterVersion: 1 },
    phase: { state: "succeeded", startedAt: now, completedAt: now, acknowledgement: { kind: "plan", workerIds: selected.map(slot => slot.workerId), retirements: [] }, application: { ...application(request), result: { state: "applied", commandId: request.commandId, affectedTargets: [{ family: "worker-pool", workflowId: "person-lookup" }, { family: "worker-browser", workerId: "person-lookup-worker-999" }] } } } });
  assert.equal(sessionCommandApplication(DashboardDayWireSchema.parse({ ...day, workerOperations: [record] }), request), undefined);
});

it("hydrates a newer native pending Stop over settled local Pause without unlocking or resubmission", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const h = harness(); h.setDay(DashboardDayWireSchema.parse({ ...h.day(), workerCards: [{ ...h.day().workerCards[0], state: "running" }] }));
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const render = () => root.render(createElement(SessionPanel, { catalog, source: "served", binding: h.binding(), open: true, onOpenChange() {} }));
  try {
    await act(async () => render());
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Pause"]')!.click());
    assert.match(document.body.textContent ?? "", /Pause confirmed/);
    const card = h.day().workerCards[0];
    const command = CommandRequestSchema.parse({ commandId: uuidOf(8950), family: "worker-browser", type: "stop-worker", requestedAt: now, requestedBy: "local-operator", source: "dashboard-another-tab", target: { workerId: card.workerId, membershipRevision: card.member.membershipRevision, expectedVersion: card.leaseVersion, controlBasis: { leaseGeneration: 1, controlRevision: 1 } } });
    const settled = lifecycleRecord(h.day(), command);
    const pending = WorkerControlRecordSchema.parse({ ...settled, auditedAt: undefined, phase: { state: "executing", startedAt: now } });
    h.setDay(DashboardDayWireSchema.parse({ ...h.day(), workerOperations: [...h.day().workerOperations, pending] }));
    await act(async () => render()); assert.match(document.body.textContent ?? "", /Check outcome/); assert.doesNotMatch(document.body.textContent ?? "", /Pause confirmed/);
    assert(document.querySelector<HTMLButtonElement>('button[aria-label="Stop"]')?.disabled); assert.equal(h.sent.length, 1);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it("keeps a partially sent Add uncertain after exact sent outcomes and never creates its unsent spawn on Check", async () => {
  const h = harness(dayWith(0));
  h.effect(command => {
    if (command.type === "plan-worker-count") {
      h.setDay(planned(h.day(), command));
      const record = h.day().workerOperations[0]; assert(record.phase.state === "succeeded"); return record.phase.application!.result;
    }
    return { state: "pending", commandId: command.commandId };
  });
  const request: SessionPreviewRequest = { id: uuidOf(8960), target: "add", action: "add", workflow: "person-lookup", count: 2, ordinal: 50 };
  assert.equal((await h.port.send(request)).state, "uncertain"); assert.equal(h.sent.length, 2);
  const spawned = h.sent[1]; h.setDay(DashboardDayWireSchema.parse({ ...h.day(), workerOperations: [...h.day().workerOperations, succeeded(h.day(), spawned)] }));
  assert.equal((await h.port.check(request)).state, "uncertain"); assert.equal(h.sent.length, 2, "Check never sends the unattempted third command");
});

it("does not spawn after a proved plan when current pool authority is missing", async () => {
  const h = harness(dayWith(0));
  h.effect(command => {
    assert(command.type === "plan-worker-count");
    const next = planned(h.day(), command); const record = next.workerOperations[0]; assert(record.phase.state === "succeeded");
    h.setDay(DashboardDayWireSchema.parse({ ...next, workerPools: [], workerAuthority: { state: "unavailable", members: next.workerAuthority.members, reason: "pool missing" }, workerCards: [] }));
    return record.phase.application!.result;
  });
  assert.equal((await h.port.send({ id: uuidOf(8970), target: "add", action: "add", workflow: "person-lookup", count: 2, ordinal: 50 })).state, "uncertain");
  assert.equal(h.sent.length, 1);
});

it("keeps historical directive Stop success unavailable as reset proof", () => {
  const day = dayWith(); const card = day.workerCards[0];
  const command = CommandRequestSchema.parse({ commandId: uuidOf(8980), family: "worker-browser", type: "stop-worker", requestedAt: now, requestedBy: "local-operator", source: "dashboard", target: { workerId: card.workerId, expectedVersion: 1 } });
  const historical = succeeded(day, command, { phase: { state: "succeeded", startedAt: now, completedAt: now, acknowledgement: { kind: "stop", directiveLeaseVersions: { before: 1, after: 2 } }, application: application(command) } });
  assert.equal(sessionCommandApplication(DashboardDayWireSchema.parse({ ...day, workerOperations: [historical] }), command), undefined);
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
  assert.equal(WORKER_STOP_REASON_LABEL["lease-expired"], ERROR_CATALOG.WORKER_LEASE_EXPIRED.text);
  assert.equal(WORKER_STOP_REASON_LABEL.operator, "stopped by you"); assert.equal(WORKER_STOP_REASON_LABEL.shutdown, "shut down");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const error = new DashboardClientError({ kind: "network", message: "private transport diagnostic" });
  const base = h.binding();
  try {
    await act(async () => root.render(createElement(SessionPanel, { catalog, source: "served", open: true, onOpenChange() {}, binding: { ...base, dayState: { ...base.dayState, day: { state: "failed", error } } } })));
    assert.match(document.body.textContent ?? "", /Session information is unavailable/); assert.doesNotMatch(document.body.textContent ?? "", /private transport diagnostic/);
    assert.equal(error.message, "private transport diagnostic");
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it("maps a cached ready card to fixed unavailable when the mounted catalog removes its registration", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const h = harness(); const binding = h.binding();
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(SessionPanel, { catalog, source: "served", binding, open: true, onOpenChange() {} })));
    assert.equal(document.querySelectorAll("article").length, 1);
    await act(async () => root.render(createElement(SessionPanel, { catalog: [], source: "served", binding, open: true, onOpenChange() {} })));
    assert.equal(document.querySelectorAll("article").length, 0);
    assert.match(document.body.textContent ?? "", /Session information is unavailable/);
    assert.doesNotMatch(document.body.textContent ?? "", /SESSION_WORKFLOW_UNREGISTERED|person-lookup/);
    assert.equal(h.sent.length, 0);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it("compares complete immutable intent and authenticates both actors separately from ingress provenance", () => {
  const day = dayWith();
  const card = day.workerCards[0];
  const request = CommandRequestSchema.parse({ commandId: uuidOf(8990), family: "worker-browser", type: "pause-worker", requestedAt: "2020-01-01T00:00:00.000Z", requestedBy: "local-operator", source: "dashboard-sessions",
    target: { workerId: card.workerId, expectedVersion: 1, controlBasis: { leaseGeneration: 1, controlRevision: 1 } }, reason: "pause for review" });
  const accepted = CommandRequestSchema.parse({ ...request, source: "dashboard", requestedAt: now });
  const record = succeeded(day, accepted);
  const snapshot = DashboardDayWireSchema.parse({ ...day, workerOperations: [record] });
  assert.deepEqual(sessionCommandApplication(snapshot, request), application(request).result);
  for (const change of [
    { commandId: uuidOf(8991) },
    { type: "resume-worker" },
    { target: { ...request.target, workerId: "person-lookup-worker-999" } },
    { target: { ...request.target, expectedVersion: 2 } },
    { target: { ...request.target, controlBasis: { leaseGeneration: 2, controlRevision: 1 } } },
    { target: { ...request.target, controlBasis: { leaseGeneration: 1, controlRevision: 2 } } },
    { reason: "a different reason" },
    { requestedBy: "foreign-actor" },
  ]) assert.equal(sessionCommandApplication(snapshot, CommandRequestSchema.parse({ ...request, ...change })), undefined);
  const foreignRecord = WorkerControlRecordSchema.parse({ ...record, request: { ...accepted, requestedBy: "foreign-actor" } });
  assert.equal(sessionCommandApplication(DashboardDayWireSchema.parse({ ...snapshot, workerOperations: [foreignRecord] }), request), undefined);
  for (const phase of [{ state: "executing", startedAt: now }, { state: "uncertain", startedAt: now, observedAt: now, message: "outcome unknown" }]) {
    const unsettled = WorkerControlRecordSchema.parse({ ...record, auditedAt: undefined, phase });
    assert.equal(sessionCommandApplication(DashboardDayWireSchema.parse({ ...snapshot, workerOperations: [unsettled] }), request), undefined);
  }
  assert.equal(sessionCommandApplication(DashboardDayWireSchema.parse({ ...snapshot, workerOperations: [{ ...record, auditedAt: undefined }] }), request), undefined);
});


it.each(["present", "unavailable"] as const)("renders starting browser requirements from served %s authority with no observations", async requirementState => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const h = harness();
  const requirements = requirementState === "present" ? { state: "present", systems: ["ucpath", "kuali"] }
    : { state: "unavailable", reason: "Launch-time browser requirements are unavailable" };
  h.setDay(DashboardDayWireSchema.parse({ ...h.day(), workerCards: [{ ...h.day().workerCards[0], state: "starting", browsers: [], browserRequirements: requirements }] }));
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(SessionPanel, { catalog, source: "served", binding: h.binding(), open: true, onOpenChange() {} })));
    const article = host.querySelector("article"); assert(article);
    if (requirementState === "present") {
      assert.deepEqual([...article.querySelectorAll("li")].map(item => item.textContent), ["UCPATHOpening", "KUALIOpening"]);
      const view = sessionsFromDay(h.day(), catalog, now); assert(view.state === "ready");
      assert.equal(new Set(view.workers[0].browsers.map(browser => browser.id)).size, 2);
      assert(view.workers[0].browsers.every(browser => browser.state === "starting"));
      assert.equal(h.day().workerCards[0].browsers.length, 0, "required slots never mint physical sessions");
    } else {
      assert.match(article.textContent ?? "", /Launch-time browser requirements are unavailable/);
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
  assert.deepEqual(view.workers[0].browsers.map(browser => [browser.label, browser.state]), [["CRM", "ready"], ["UCPATH", "unavailable"]]);
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
  const acknowledged = DashboardDayWireSchema.parse({ ...h.day(), workerCards: [{ ...h.day().workerCards[0], controls: { ...card.controls,
    basis: { state: "present", value: { leaseGeneration: 1, controlRevision: 2 } }, operation: { commandId: partial.nativeCommandIds?.[0], type: "refresh-browser", state: "succeeded", at: now, unresolved: false, browserSessionId: physicalId } } }] });
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
    assert.equal(view.workers[0].problem, state === "failed" ? WORKER_STOP_REASON_LABEL.crashed : undefined);
  }
});

it.each(["outside-day", "empty", "skipped", "cancelled"] as const)("shows the served current-run timeline refusal for %s on the mounted active worker", async scenario => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const h = harness(); const row = h.day().queueSurfaces.find(row => row.workflowId === h.day().workerCards[0].workflowId); assert(row);
  const pipeline = scenario === "empty" ? [] : [{ id: "served-step", label: "Served step", state: scenario === "outside-day" ? "active" : scenario }];
  h.setDay(DashboardDayWireSchema.parse({ ...h.day(), workerCards: [{ ...h.day().workerCards[0], state: "running", currentRun: { state: "present", runId: row.runId, traceId: row.traceId } }],
    queueSurfaces: scenario === "outside-day" ? [] : [{ ...row, pipeline }] }));
  const reason = scenario === "outside-day" ? "Run timeline is not served on this day" : scenario === "empty" ? "No steps are served for this run" : "The current timeline contains states unavailable in this view";
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(SessionPanel, { catalog, source: "served", binding: h.binding(), open: true, onOpenChange() {} })));
    const article = host.querySelector("article"); assert(article);
    assert(article.textContent?.includes(reason), "the active worker must visibly explain its exact served timeline refusal");
    assert.equal(article.querySelector('[role="progressbar"]'), null);
    assert.equal(h.sent.length, 0);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it("retains valid current-run timelines and ordinary no-run phases without rendering timeline refusal", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const h = harness(); const card = h.day().workerCards[0];
  const row = h.day().queueSurfaces.find(row => row.workflowId === card.workflowId); assert(row);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const render = () => root.render(createElement(SessionPanel, { catalog, source: "served", binding: h.binding(), open: true, onOpenChange() {} }));
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
      if (state === "failed") assert(host.textContent?.includes(WORKER_STOP_REASON_LABEL.crashed));
    }
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
