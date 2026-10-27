import { servedFixtureSources as previewFixtureSources } from "../../../parity/helpers/workflow-composition.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { workerCardOf } from "../../../../src/backend/runs/projections/worker-cards.js";
import { createWorkerBrowserControl } from "../../../../src/backend/runtime/workers/worker-browser-control.js";
import { WorkerSessionManager } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { IdleSessionSchedule, IDLE_REFRESH_MS } from "../../../../src/dashboard/surfaces/sessions/session-idle-model.js";
import { sessionsFromDay } from "../../../../src/dashboard/surfaces/sessions/sessions-view-model.js";
import type { SessionPreviewRequest } from "../../../../src/dashboard/surfaces/sessions/session-preview-command-model.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { DashboardDayWireSchema } from "../../../../src/models/dashboard/projection.js";
import { BrowserSessionIdSchema, FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { createDashboardPoolTestWorld } from "../../../support/helpers/backend/dashboard-pool-world.js";
import { fixtureDuoCeremonyGates } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { FIXTURE_DAY_WIRE } from "../../../parity/helpers/fixture-day.js";

const world = createDashboardPoolTestWorld();
afterEach(world.cleanup);

it("rearms idle refresh from genuine native admission, browser settlement and current worker card for two cycles", async () => {
  const schedule = new IdleSessionSchedule();
  let refresh: SessionPreviewRequest | undefined;
  const signal = new AbortController().signal;
  const h = await world.openControlHarness({ interceptPool: pool => ({ ...pool, refreshPoolBrowser: async context => {
    h.database.authority.workerControls.transition(context.command.commandId, "admitted", { state: "ready" });
    assert(refresh);
    schedule.sync(view(), elapsed(), { [world.WORKER_1]: { request: refresh, state: "uncertain", message: "awaiting native evidence" } });
    await createWorkerBrowserControl({ database: h.database, workerId: world.WORKER_1, leaseGeneration: 1, clock: h.clock, signal })(sessions);
    return { state: "accepted" };
  } }) });
  await world.spawnPoolWorker(h);
  h.database.authority.workerLeases.reportLifecycle({ workerId: world.WORKER_1, leaseGeneration: 1,
    lifecycle: { state: "idle", startedAt: world.NOW, heartbeatAt: world.NOW }, now: world.NOW });
  const fingerprint = FingerprintSchema.parse("a".repeat(64));
  let refreshes = 0;
  const sessions = new WorkerSessionManager({ workerId: world.WORKER_1, workflowId: world.WORKFLOW, stores: taskStoreRegistry, clock: h.clock, scheduler: h.scheduler,
    acquireDeadlineMs: 1000, duoCeremony: await fixtureDuoCeremonyGates(h.clock), onObservation: value => h.database.authority.workerControls.observe({ ...value, leaseGeneration: 1 }),
    factory: { open: async input => {
      const sessionId = BrowserSessionIdSchema.parse(randomUUID());
      return { sessionId, system: input.system, instance: input.instance, configFingerprint: fingerprint, signInFingerprint: fingerprint,
        profileRevision: 1, browserMode: "headed", acceptDownloads: false, exclusive: false, driver: { system: input.system },
        authentication: { authenticate: async () => "already-authenticated" }, reset: async () => { refreshes += 1; },
        close: async () => ({ sessionId, system: input.system, pagesClosed: true, contextClosed: true }) };
    } } });
  const elapsed = () => h.clock.nowMs() - Date.parse(world.NOW);
  const view = () => {
    const lease = h.database.authority.workerLeases.get(world.WORKER_1); assert(lease);
    const member = h.database.authority.workerSlots.get(world.WORKER_1); assert(member);
    const card = workerCardOf({ lease, member, ownerAlive: true, fold: undefined, resolveRun: () => undefined, owned: true,
      operations: h.database.authority.workerControls.list(), observations: h.database.authority.workerControls.browsers(world.WORKER_1) });
    return sessionsFromDay(DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, workerAuthority: { state: "present", members: [member] }, workerCards: [card] }), buildWorkflowCatalog([], true, previewFixtureSources([])), h.clock.now().toISOString());
  };
  try {
    sessions.bindRunConfigFingerprint(fingerprint, "headed");
    try {
      for (const system of world.BROWSER_SYSTEMS) await sessions.withDriver({ system, session: "reuse-worker", access: "read" }, "prod", signal, async () => undefined);
    }
    finally { sessions.releaseRunConfigFingerprint(); }
    const warmResets = refreshes;
    schedule.sync(view(), elapsed());
    for (let cycle = 0; cycle < 2; cycle += 1) {
      h.clock.advanceWall(IDLE_REFRESH_MS);
      refresh = schedule.due(elapsed(), () => false)[0]; assert(refresh?.action === "refresh");
      assert.equal(refresh.browserIds.length, world.BROWSER_SYSTEMS.length);
      for (const [index, browserSessionId] of refresh.browserIds.entries()) {
        const commandId: string | undefined = refresh.nativeCommandIds?.[index]; assert(commandId);
        const lease = h.database.authority.workerLeases.get(world.WORKER_1); assert(lease);
        const result = await h.kernel.executeWorkerPool({ ...world.envelope(h, commandId), type: "refresh-browser",
          target: { workerId: world.WORKER_1, browserSessionId, expectedVersion: lease.version, controlBasis: world.servedControlBasis(h.database, world.WORKER_1) } });
        assert.equal(result.state, "applied");
        const native = h.database.authority.workerControls.get(commandId); assert(native?.auditedAt); assert.equal(native.phase.state, "succeeded");
      }
      schedule.confirm(refresh, elapsed(), view());
      assert.deepEqual(schedule.view(elapsed())[world.WORKER_1], { remainingMs: IDLE_REFRESH_MS, waiting: false }, "native refresh must survive projection and rearm its retained idle countdown");
      assert.deepEqual(schedule.due(elapsed() + IDLE_REFRESH_MS - 1, () => false), []);
    }
    assert.equal(refreshes - warmResets, 2 * world.BROWSER_SYSTEMS.length);
  } finally { await sessions.closeAll("worker-stop"); h.children[0]?.emitExit(0, null); }
});
