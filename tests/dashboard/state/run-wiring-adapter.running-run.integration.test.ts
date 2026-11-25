// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, it, vi } from "vitest";
import { descriptorSetHash } from "../../../src/backend/app/registries/workflow-registry.js";
import { createOperatorProjection } from "../../../src/backend/app/composition/dashboard/queue.js";
import { createOperatorRunDetail } from "../../../src/backend/app/composition/dashboard/run-detail.js";
import { RunRecordService } from "../../../src/backend/runs/lifecycle/run-record-service.js";
import { readRunDetail } from "../../../src/backend/runs/queries/run-detail.js";
import { readRunSection } from "../../../src/backend/runs/queries/run-sections.js";
import { createReceiptService } from "../../../src/backend/runs/trust/receipt-service.js";
import { executeClaimedRun } from "../../../src/backend/runtime/execution/run-executor.js";
import { createNoteTimelineWriter } from "../../../src/backend/storage/events/note-timeline-writer.js";
import { createTimelineEmitter } from "../../../src/backend/storage/events/timeline-emitter.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import { runQueuedSpanEvent } from "../../../src/backend/runs/commands/run-queued-span.js";
import { ucpathDriver } from "../../../src/backend/systems/ucpath/driver-declaration.js";
import { TooltipProvider } from "../../../src/dashboard/ds/ui.js";
import { CommandExecutor } from "../../../src/dashboard/app/commands/command-executor.js";
import type { DashboardCommandBinding } from "../../../src/dashboard/app/dashboard-app-model.js";
import { createRowStore, type DashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider, DashboardCommandBindingProvider } from "../../../src/dashboard/state/client-context.js";
import { LogSample } from "../../../src/dashboard/surfaces/run-detail/logs/log-sample.js";
import type { QueueSurfaceWire } from "../../../src/models/dashboard/projection.js";
import { SearchPersonOrg } from "../../../src/models/systems/ucpath/search-person-org.js";
import { ActorIdSchema, LOCAL_OPERATOR_ACTOR_ID } from "../../../src/rules/identity/ids.js";
import { defineTask } from "../../../src/workflow-kit/task.js";
import { FIXTURE_DAY_WIRE } from "../../support/helpers/dashboard/mock-world/fixture-queue.js";
import { createRunExecutorTestWorld, registryWithUcpathSearch } from "../../support/helpers/backend/run-executor-world.js";
import { serveRunPanel } from "../../support/helpers/dashboard/serve-run-panel.js";
import { happySessionHarness, personLookupQueuedRun } from "../../support/helpers/phase1f-executor-harness.js";
import { personLookupModule } from "../../support/helpers/registered-workflows.js";

const world = createRunExecutorTestWorld();
let root: Root | undefined;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0)); vi.stubGlobal("cancelAnimationFrame", clearTimeout); vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.unstubAllGlobals(); finish(); await execution; execution = undefined; await world.cleanup(); });

// The task holds its step open, so the run stays running while the Logs panel reads it.
let entered: () => void = () => undefined;
let finish: () => void = () => undefined;
let execution: ReturnType<typeof executeClaimedRun> | undefined;
const holding = defineTask(ucpathDriver, SearchPersonOrg, {
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    const output = await ctx.driver.searchPersonOrg(input);
    ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    entered();
    await new Promise<void>(resolve => { finish = resolve; });
    throw Object.assign(new Error("held step released"), { name: "TimeoutError" });
  },
});

it("shows a running run's logs while worker heartbeats move its revision, and keeps them until the stream's next panel", async () => {
  const running = new Promise<void>(resolve => { entered = resolve; });
  const h = await world.executorHarness({ stores: registryWithUcpathSearch(holding), sessions: happySessionHarness() });
  const { database, clock, stateRoot } = h.authority;
  const claimed = world.enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
  createTimelineEmitter({ repository: database.authority.timelineEvents, clock }).emit(runQueuedSpanEvent({ run: claimed.run, actorId: LOCAL_OPERATOR_ACTOR_ID, title: personLookupModule.descriptor.label }));
  execution = executeClaimedRun({ ...h.deps, taskNotes: createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock }) }, { ...claimed, signal: world.SIGNAL });
  await running;

  const runReader = new RunRecordService({ database, clock, ids: { uuid: () => "eeeeeeee-0001-4000-8000-000000000002" }, publishQueued: () => {} });
  const descriptors = { resolve: (workflow: string) => workflow === personLookupModule.descriptor.id ? personLookupModule.descriptor : undefined };
  const projection = createOperatorProjection({ database, stateRoot, clock, reader: runReader, appVersion: "0.1.0",
    descriptorSetHash: descriptorSetHash([personLookupModule.descriptor.contractFingerprint]), ledger: createTransactionHistory(database.authority), descriptors });
  const deps = createOperatorRunDetail({ database, stateRoot, projection, runReader,
    trust: createReceiptService({ database, runReader, descriptors: [personLookupModule.descriptor] }), canonical: { database, reader: runReader, descriptors } });
  const runId = claimed.run.envelope.runId;
  const currentRow = (): QueueSurfaceWire => {
    projection.ingestFromTimeline();
    const queued = projection.runFold(runId)?.queued?.ts;
    assert.ok(queued !== undefined, "the run was queued");
    const row = [-1, 0, 1].map(offset => new Date(Date.parse(queued) + offset * 86_400_000).toISOString().slice(0, 10))
      .flatMap(day => projection.buildDashboardDayWire(day).queueSurfaces).find(candidate => candidate.runId === runId);
    assert.ok(row, "the running run is on its day's queue");
    assert.equal(row.status, "running");
    return row;
  };
  // A live worker renews its claim every few seconds; each renewal is a new run revision.
  const heartbeat = () => {
    const renewed = database.authority.runs.renewClaim({ runId, claim: claimed.claim, now: clock.now().toISOString() });
    assert.equal(renewed.state, "renewed");
  };
  // The stream's panel is read by the server, never by the page: the page's own client must see no run reads.
  const server = { runDetail: (id: string, signal?: AbortSignal) => readRunDetail(deps, id, signal),
    runSection: (id: string, section: string, cursor?: string, signal?: AbortSignal) => readRunSection(deps, id, section, cursor, signal) };
  const pageReads: string[] = [];
  const client = { artifactUrl: (id: string) => `/artifacts/${id}`,
    runDetail: async (id: string) => { pageReads.push(`detail ${id}`); throw new Error("the page does not read run detail"); },
    runSection: async (id: string, section: string) => { pageReads.push(`${section} ${id}`); throw new Error("the page does not read run sections"); } } as unknown as DashboardClient;
  const rows = createRowStore();
  const stream = () => serveRunPanel(rows, server, runId);

  let refreshed = 0;
  const scope = Object.freeze({ actorId: ActorIdSchema.parse("local-operator"), client, authority: {}, dayRequest: {} });
  const binding = { scope, executor: new CommandExecutor(() => scope), feedback: () => undefined,
    authority: { epoch: scope.authority, catalog: [], now: () => clock.now().toISOString(), today: "2026-08-03", day: "2026-08-03",
      dayState: { rows, subscribePublications: () => () => undefined, request: scope.dayRequest, day: { state: "loaded" as const, value: FIXTURE_DAY_WIRE }, connection: { state: "live" as const }, refresh: () => { refreshed++; } },
      selection: { route: { start: false }, workflowId: personLookupModule.descriptor.id } } } as unknown as DashboardCommandBinding;
  function Panel({ row }: { row: QueueSurfaceWire }) {
    return createElement(TooltipProvider, null, createElement(DashboardClientProvider, { client, children: createElement(DashboardCommandBindingProvider, { binding,
      children: createElement(LogSample, { selection: { row, workflowLabel: "Person Lookup" } }) }) }));
  }
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const frame = async () => { await act(async () => { root?.render(createElement(Panel, { row: currentRow() })); await new Promise(resolve => setTimeout(resolve, 0)); }); };
  const serve = async () => { await act(async () => { await stream(); await new Promise(resolve => setTimeout(resolve, 0)); }); };
  const skeleton = () => document.querySelector("[aria-label='Loading logs']") !== null;
  const panelText = () => document.querySelector("[aria-label='Selected run logs']")?.textContent ?? "";

  await frame();
  assert.ok(skeleton(), "no panel has streamed yet");
  await serve();
  assert.equal(skeleton(), false, "the streamed panel replaces the skeleton");
  assert.doesNotMatch(panelText(), /Refreshing/u);
  for (let cycle = 0; cycle < 3; cycle++) {
    // A day frame re-serves the row at its new revision before the stream's panel for it arrives.
    heartbeat();
    await frame();
    assert.equal(skeleton(), false, `cycle ${String(cycle)}: the running run keeps its last logs`);
    assert.match(panelText(), /Refreshing.*Search for person.*In progress/u);
    assert.match(panelText(), /Deterministic, Person.*[1-9]\d* actions$/u);
    await serve();
    await frame();
    assert.equal(skeleton(), false, `cycle ${String(cycle)}: the running run's logs stay`);
    assert.doesNotMatch(panelText(), /Refreshing/u);
    assert.match(panelText(), /Search for person.*In progress.*[1-9]\d* actions$/u);
  }
  // A panel ahead of the row is shown without asking the day to catch up.
  heartbeat();
  await serve();
  assert.equal(skeleton(), false);
  assert.doesNotMatch(panelText(), /Refreshing/u);
  assert.match(panelText(), /Search for person.*In progress.*[1-9]\d* actions$/u);
  await frame();
  assert.doesNotMatch(panelText(), /Refreshing/u);
  assert.deepEqual(pageReads, [], "the page sends no run-detail or section reads");
  assert.equal(refreshed, 0, "a panel ahead of the row does not refresh the day");

  finish();
  assert.equal((await execution).state, "failed");
});
