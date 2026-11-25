// @vitest-environment jsdom
import assert from "node:assert/strict";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, it, vi } from "vitest";
import { createDashboardClient, type DashboardClient } from "../../../../src/dashboard/client/index.js";
import { CommandExecutor, type CommandExecutionScope } from "../../../../src/dashboard/app/commands/command-executor.js";
import { IDLE_REFRESH_MS } from "../../../../src/dashboard/surfaces/sessions/session-idle-model.js";
import { createSessionPreviewPort, useSessionPreviewCommands, type SessionCommandBinding, type SessionPreviewCommandPort, type SessionPreviewRequest } from "../../../../src/dashboard/surfaces/sessions/session-preview-command-model.js";
import { sessionWorkerAuthorityKey } from "../../../../src/dashboard/surfaces/sessions/sessions-view-model.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { DashboardDayWireSchema, type DashboardDayWire } from "../../../../src/models/dashboard/projection.js";
import { CommandRequestSchema, CommandResultSchema } from "../../../../src/rules/commands/commands.js";
import { FIXTURE_DAY_WIRE, FIXTURE_NOW, uuidOf } from "../../../support/helpers/dashboard/mock-world/fixture-day.js";
import { servedFixtureSources } from "../../../support/helpers/dashboard/mock-world/workflow-composition.js";
import { sessionsSample } from "../../../support/fixtures/dashboard/sessions-sample.js";
import { createRowStore } from "../../../../src/dashboard/client/index.js";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("restarts the idle countdown when the read-back proves a refresh whose reply was lost", async () => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const requests: SessionPreviewRequest[] = [];
  const port: SessionPreviewCommandPort = {
    send: async request => { requests.push(request); return { id: request.id, state: "uncertain", message: "Lost acknowledgment" }; },
    check: async request => ({ id: request.id, state: "confirmed" }),
  };
  let commands: ReturnType<typeof useSessionPreviewCommands> | undefined;
  const initial = sessionsSample("active");
  function Harness() { commands = useSessionPreviewCommands(initial, [], port); return null; }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => vi.advanceTimersByTimeAsync(IDLE_REFRESH_MS));
    for (let step = 0; step < 12; step += 1) await act(async () => vi.advanceTimersByTimeAsync(250));
    assert.equal(requests.length, 1);
    assert.equal(commands?.operations["sample-worker-4"], undefined, "a refresh found by reading back leaves no note");
    const countdown = commands?.idleCountdowns["sample-worker-4"];
    assert.equal(countdown?.waiting, false);
    assert.ok((countdown?.dueAt ?? 0) - Date.now() > IDLE_REFRESH_MS - 3000, "the countdown restarts from the read-back");
  } finally { await act(async () => root.unmount()); }
});

it("sends no idle refresh and shows no countdown for worker cards held from another day", async () => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const requests: SessionPreviewRequest[] = [];
  const port: SessionPreviewCommandPort = {
    send: async request => { requests.push(request); return { id: request.id, state: "confirmed" }; },
    check: async request => ({ id: request.id, state: "confirmed" }),
  };
  let commands: ReturnType<typeof useSessionPreviewCommands> | undefined;
  const loaded = sessionsSample("active");
  assert(loaded.state === "ready");
  const held = { ...loaded, stale: true } as const;
  function Harness() { commands = useSessionPreviewCommands(held, [], port); return null; }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Harness)));
    assert.deepEqual(commands?.idleCountdowns, {});
    await act(async () => vi.advanceTimersByTimeAsync(IDLE_REFRESH_MS + 3000));
    assert.equal(requests.length, 0);
    commands?.control("sample-worker-4", "remove");
    await act(async () => vi.advanceTimersByTimeAsync(250));
    assert.equal(requests.length, 0, "a held card sends no command");
  } finally { await act(async () => root.unmount()); }
});

function servedWorld(count: number, gateReads = 0) {
  const base = FIXTURE_DAY_WIRE;
  assert(base.workerAuthority.state === "present");
  // Commands on one workflow lock each other, so overlapping attempts need distinct workflows.
  const workflows = ["person-lookup", "person-lookup-b"].slice(0, count);
  const ids = workflows.map(workflow => `${workflow}-worker-1`);
  const basis = { basis: { state: "present", value: { lifetimeId: uuidOf(7001), version: 0 } } } as const;
  let day: DashboardDayWire = DashboardDayWireSchema.parse({ ...base, workerPools: workflows.map(workflowId => ({ workflowId, desiredWorkers: 1, version: 1, plannedBy: "local-operator", plannedAt: FIXTURE_NOW })),
    workerAuthority: { state: "present", members: base.workerAuthority.members.slice(0, count).map((slot, index) => ({ ...slot, workerId: ids[index], workflow: workflows[index], ordinal: 1, poolIndex: 1, paused: false })) },
    workerCards: base.workerCards.slice(0, count).map((card, index) => ({ ...card, workerId: ids[index], workflowId: workflows[index], member: { workflowId: workflows[index], workerId: ids[index], ordinal: 1, poolIndex: 1 }, state: "idle", directive: "run", browsers: [], currentRun: { state: "absent", reason: "no current run" }, controls: basis })) });
  const served: WeakRef<DashboardDayWire>[] = [];
  const held: (() => void)[] = [];
  const inner = createDashboardClient({ baseUrl: "http://sessions.test", fetchImpl: async (_url, init) => {
    if (init?.method !== "POST") {
      const snapshot = day;
      // Readbacks wait until `gateReads` of them are pending, then land together.
      if (gateReads > 0) await new Promise<void>(release => { held.push(release); if (held.length === gateReads) for (const next of held.splice(0)) next(); });
      return Response.json(snapshot);
    }
    assert.ok(typeof init.body === "string", "expected a JSON command body");
    const command = CommandRequestSchema.parse(JSON.parse(init.body));
    assert(command.family === "worker-browser" && command.type !== "plan-worker-count" && command.type !== "spawn-worker");
    const directive = command.type === "pause-worker" ? "pause" : "run";
    day = DashboardDayWireSchema.parse({ ...day, workerCards: day.workerCards.map(card => card.workerId === command.target.workerId ? { ...card, directive } : card) });
    return Response.json(CommandResultSchema.parse({ state: "applied", commandId: command.commandId, affectedTargets: [{ family: "worker-browser", workerId: command.target.workerId }] }));
  } });
  const client: DashboardClient = { ...inner, dashboardDay: async requested => { const read = await inner.dashboardDay(requested); served.push(new WeakRef(read)); return read; } };
  const scope: CommandExecutionScope = { actorId: "local-operator", client, authority: {}, dayRequest: {} };
  const executor = new CommandExecutor(() => scope);
  const binding = (): SessionCommandBinding => ({ client, executor, scope, day: base.day, now: () => FIXTURE_NOW,
    dayState: { rows: createRowStore(), subscribePublications: () => { throw new Error("not served"); }, request: scope.dayRequest, day: { state: "loaded", value: day }, connection: { state: "connecting" }, refresh() {} } });
  const port = createSessionPreviewPort(() => ({ binding: binding(), catalog: buildWorkflowCatalog([], servedFixtureSources([])) }));
  const control = (index: number, action: "pause" | "resume") => { const card = day.workerCards[index]; return port.send({ id: crypto.randomUUID(), target: card.workerId, action, authorityKey: sessionWorkerAuthorityKey(card) }); };
  return { control, served };
}

it("confirms each of two overlapping attempts from its own served day", async () => {
  const world = servedWorld(2, 2);
  const results = await Promise.all([world.control(0, "pause"), world.control(1, "pause")]);
  assert.deepEqual(results.map(result => result.state), ["confirmed", "confirmed"]);
  for (const result of results) assert(result.state === "confirmed" && result.data !== undefined, "each confirmation carries its readback");
});

it("retains no served day once the attempts that read it have settled", async () => {
  const gc = (() => { setFlagsFromString("--expose-gc"); return runInNewContext("gc") as () => void; })();
  const world = servedWorld(1);
  for (const action of ["pause", "resume", "pause"] as const) assert.equal((await world.control(0, action)).state, "confirmed");
  assert(world.served.length >= 3, "each refresh read a served day");
  for (let pass = 0; pass < 5; pass++) { gc(); await new Promise(resolve => setTimeout(resolve, 0)); }
  assert.equal(world.served.filter(read => read.deref() !== undefined).length, 0);
});
