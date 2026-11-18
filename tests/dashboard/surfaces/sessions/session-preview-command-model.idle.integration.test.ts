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
import { sessionsSample } from "../../../../src/dashboard/surfaces/sessions/sessions-fixture.js";
import { sessionWorkerAuthorityKey } from "../../../../src/dashboard/surfaces/sessions/sessions-view-model.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { DashboardDayWireSchema, type DashboardDayWire } from "../../../../src/models/dashboard/projection.js";
import { CommandRequestSchema, CommandResultSchema } from "../../../../src/rules/commands/commands.js";
import { FIXTURE_DAY_WIRE, FIXTURE_NOW, uuidOf } from "../../../mocks/helpers/fixture-day.js";
import { servedFixtureSources } from "../../../mocks/helpers/workflow-composition.js";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("clears the idle countdown when the audit proves a refresh whose reply was lost", async () => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const requests: SessionPreviewRequest[] = [];
  const port: SessionPreviewCommandPort = {
    send: async request => { requests.push(request); return { id: request.id, state: "uncertain", message: "Lost acknowledgment" }; },
    check: async request => ({ id: request.id, state: "uncertain", message: "unused" }),
    audited: async request => ({ id: request.id, state: "confirmed" }),
  };
  let commands: ReturnType<typeof useSessionPreviewCommands> | undefined;
  const initial = sessionsSample("active");
  function Harness() { commands = useSessionPreviewCommands(initial, [], port); return null; }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => vi.advanceTimersByTimeAsync(IDLE_REFRESH_MS));
    assert.equal(requests.length, 1);
    assert.equal(commands?.operations["sample-worker-4"].state, "confirmed");
    assert.deepEqual(commands?.idleCountdowns["sample-worker-4"], { remainingMs: IDLE_REFRESH_MS, waiting: false });
  } finally { await act(async () => root.unmount()); }
});

it("retains only the latest served day across refreshes", async () => {
  const gc = (() => { setFlagsFromString("--expose-gc"); return runInNewContext("gc") as () => void; })();
  const base = FIXTURE_DAY_WIRE;
  assert(base.workerAuthority.state === "present");
  const basis = { basis: { state: "present", value: { lifetimeId: uuidOf(7001), version: 0 } } } as const;
  let day: DashboardDayWire = DashboardDayWireSchema.parse({ ...base, workerPools: [{ workflowId: "person-lookup", desiredWorkers: 1, version: 1, plannedBy: "local-operator", plannedAt: FIXTURE_NOW }],
    workerAuthority: { state: "present", members: base.workerAuthority.members.slice(0, 1).map(slot => ({ ...slot, paused: false })) },
    workerCards: base.workerCards.slice(0, 1).map(card => ({ ...card, state: "idle", directive: "run", browsers: [], currentRun: { state: "absent", reason: "no current run" }, controls: basis })) });
  const served: WeakRef<DashboardDayWire>[] = [];
  const inner = createDashboardClient({ baseUrl: "http://sessions.test", fetchImpl: async (_url, init) => {
    if (init?.method !== "POST") return Response.json(day);
    const command = CommandRequestSchema.parse(JSON.parse(String(init.body)));
    assert(command.family === "worker-browser" && command.type !== "plan-worker-count" && command.type !== "spawn-worker");
    const directive = command.type === "pause-worker" ? "pause" : "run";
    day = DashboardDayWireSchema.parse({ ...day, workerCards: day.workerCards.map(card => ({ ...card, directive })) });
    return Response.json(CommandResultSchema.parse({ state: "applied", commandId: command.commandId, affectedTargets: [{ family: "worker-browser", workerId: command.target.workerId }] }));
  } });
  const client: DashboardClient = { ...inner, dashboardDay: async requested => { const read = await inner.dashboardDay(requested); served.push(new WeakRef(read)); return read; } };
  const scope: CommandExecutionScope = { actorId: "local-operator", client, authority: {}, dayRequest: {} };
  const executor = new CommandExecutor(() => scope);
  const binding = (): SessionCommandBinding => ({ client, executor, scope, day: base.day, nowIso: FIXTURE_NOW,
    dayState: { subscribePublications: () => { throw new Error("not served"); }, request: scope.dayRequest, day: { state: "loaded", value: day }, connection: { state: "connecting" }, refresh() {} } });
  const port = createSessionPreviewPort(() => ({ binding: binding(), catalog: buildWorkflowCatalog([], true, servedFixtureSources([])) }));
  const control = (action: "pause" | "resume") => port.send({ id: crypto.randomUUID(), target: day.workerCards[0].workerId, action, authorityKey: sessionWorkerAuthorityKey(day.workerCards[0]) });
  for (const action of ["pause", "resume", "pause"] as const) assert.equal((await control(action)).state, "confirmed");
  assert(served.length >= 3, "each refresh read a served day");
  for (let pass = 0; pass < 5; pass++) { gc(); await new Promise(resolve => setTimeout(resolve, 0)); }
  assert.equal(served.filter(read => read.deref() !== undefined).length, 1, "only the latest served day is retained");
});
