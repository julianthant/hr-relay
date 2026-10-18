import { ItemAttemptHistoryResponseSchema } from "../../../../src/models/dashboard/item-attempt-history.js";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { CommandExecutor, type CommandExecutionScope, type CommandOutcome } from "../../../../src/dashboard/app/commands/command-executor.js";
import type { DashboardCommandBinding } from "../../../../src/dashboard/app/dashboard-app-model.js";
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";
import { StartPlanWireSchema } from "../../../../src/models/dashboard/start-plan.js";
import { createRunLaunchService } from "../../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import { DashboardDayWireSchema, QueueSurfaceWireSchema, type QueueSurfaceWire } from "../../../../src/models/dashboard/projection.js";
import { CommandResultSchema } from "../../../../src/rules/commands/commands.js";
import { launchHarness } from "../../../support/fixtures/run-launch-fixtures.js";

const disposers: (() => void)[] = [];
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); });
function setup(enqueue: Parameters<typeof launchHarness>[0] = "reject-active", overrides: Partial<DashboardClient> = {}) {
  const h = launchHarness(enqueue); disposers.push(h.dispose);
  const client: DashboardClient = { ...h.client, ...overrides };
  let active: CommandExecutionScope | undefined = { ...h.binding.scope, client };
  const executor = new CommandExecutor(() => active);
  const binding: DashboardCommandBinding = { ...h.binding, executor, scope: active };
  const launch = createRunLaunchService(client, "local-operator", { uuid: () => h.ids.uuid(), now: () => h.clock.now().toISOString() });
  return { h, client, binding, launch, replaceScope: (scope: CommandExecutionScope | undefined) => { active = scope; } };
}

const OTHER_PLAN = "b0000000-0000-4000-8000-000000009999";
const OTHER_RUN = "c0000000-0000-4000-8000-000000009999";

const planIdentityError = (error: unknown) => {
  assert.ok(error instanceof Error);
  assert.equal(error.name, "RUN_LAUNCH_PLAN_IDENTITY_MISMATCH");
  assert.equal(error.message, "The supplied data does not match the expected contract.");
  return true;
};

describe("Start enqueue verification through the actual command and day transports", () => {
  it("binds plan previews to the current actor and submitted options without losing partial refusals", async () => {
    const w = setup();
    const request = { workflowId: w.h.descriptor.id, submissions: [{ eid: "10812345" }], dryRun: true,
      browserMode: "headless", captureBrowserScreenshots: false, priority: "interactive" };
    const plan = await w.launch.preview(request);
    assert.equal(plan.planned.length, 1);
    for (const change of [{ plannedBy: "another-operator" }, { workflowId: "another-workflow" }, { dryRun: false }, { browserMode: "headed" }]) {
      w.client.submitStartPlan = async () => StartPlanWireSchema.parse({ ...plan, ...change });
      await assert.rejects(() => w.launch.preview(request), planIdentityError);
    }
    const refusal = { entry: 2, code: "input-invalid" as const, message: "Second input refused" };
    w.client.submitStartPlan = async () => ({ ...plan, refused: [refusal] });
    const partial = await w.launch.preview({ ...request, submissions: [{ eid: "10812345" }, {}] });
    assert.equal(partial.planned.length, 1); assert.deepEqual(partial.refused, [refusal]);
    assert.throws(() => w.launch.prepareFinal({ ...plan, plannedBy: "another-operator" }), planIdentityError);
  });
  for (const [name, change] of [
    ["missing session origin", (row: QueueSurfaceWire) => ({ ...row, session: { state: "present", sessionId: row.session.state === "present" ? row.session.sessionId : OTHER_RUN } })],
    ["another start plan", (row: QueueSurfaceWire) => ({ ...row, session: { state: "present", sessionId: OTHER_RUN, origin: { kind: "start-plan", startPlanId: OTHER_PLAN, actorId: "local-operator" } } })],
    ["another actor", (row: QueueSurfaceWire) => ({ ...row, actorId: "other-operator" })],
    ["another config", (row: QueueSurfaceWire) => ({ ...row, configFingerprint: "f".repeat(64) })],
    ["another descriptor", (row: QueueSurfaceWire) => ({ ...row, descriptorHash: "f".repeat(64) })],
    ["another rehearsal flag", (row: QueueSurfaceWire) => ({ ...row, dryRun: false })],
    ["unrelated lineage", (row: QueueSurfaceWire) => ({ ...row, lineage: { state: "child", parentRunId: OTHER_RUN }, containment: "linked" })],
  ] as const) {
    it(`retains uncertainty for ${name} without publishing enqueue success`, async () => {
      const w = setup();
      w.client.dashboardDay = async day => {
        const snapshot = await w.h.client.dashboardDay(day);
        return DashboardDayWireSchema.parse({ ...snapshot, queueSurfaces: snapshot.queueSurfaces.map(row => QueueSurfaceWireSchema.parse(change(row))) });
      };
      const plan = w.h.proposal(undefined, undefined, true);
      const published: CommandOutcome[] = [];
      const outcome = await w.launch.submit(w.launch.prepareFinal(plan), w.binding, plan, next => published.push(next));
      assert.equal(outcome.kind, "uncertain"); assert.equal(published.length, 1); assert.equal(published[0].kind, "uncertain");
      assert.equal(w.h.queueRoots.length, 1); assert.equal(w.binding.executor.retainedAttempts()[0].outcome?.kind, "uncertain");
    });
  }
  for (const name of ["wrong run", "wrong plan", "no created run", "duplicate run"] as const) {
    it(`refuses an applied acknowledgment naming ${name}`, async () => {
      const w = setup();
      w.client.executeCommand = async input => {
        const reply = await w.h.client.executeCommand(input);
        assert.ok(reply.state === "applied");
        const target = reply.affectedTargets.find(target => target.family === "run"); assert.ok(target);
        return CommandResultSchema.parse({ ...reply, affectedTargets: name === "no created run" ? reply.affectedTargets.filter(target => target.family !== "run")
          : name === "duplicate run" ? [...reply.affectedTargets, target]
          : reply.affectedTargets.map(target => name === "wrong run" && target.family === "run" ? { ...target, runId: OTHER_RUN }
            : name === "wrong plan" && target.family === "start" ? { ...target, startPlanId: OTHER_PLAN } : target) });
      };
      const plan = w.h.proposal();
      assert.equal((await w.launch.submit(w.launch.prepareFinal(plan), w.binding, plan)).kind, "uncertain");
      assert.equal(w.h.queueRoots.length, 1);
    });
  }
  for (const name of ["missing", "failed"] as const) {
    it(`retains the original command after ${name} readback and replays exact bytes`, async () => {
      const w = setup(); let broken = true;
      w.client.dashboardDay = async day => {
        if (broken && name === "failed") throw new Error("readback diagnostic detail");
        const snapshot = await w.h.client.dashboardDay(day);
        return broken ? { ...snapshot, queueSurfaces: [] } : snapshot;
      };
      const plan = w.h.proposal(); const command = w.launch.prepareFinal(plan);
      assert.equal((await w.launch.submit(command, w.binding, plan)).kind, "uncertain");
      const original = w.binding.executor.retainedAttempts()[0].body;
      broken = false; assert.equal((await w.launch.submit(command, w.binding)).kind, "confirmed");
      assert.deepEqual(w.h.finalCommands[1], w.h.finalCommands[0]);
      assert.equal(w.binding.executor.retainedAttempts()[0].body, original); assert.equal(w.h.queueRoots.length, 1);
      assert.throws(() => w.launch.submit({ ...command, requestedAt: "2026-07-31T18:00:00.000Z" }, w.binding), /divergent/u);
    });
  }
  it("accepts only the reviewed supersede targets and retains no-plan replay with unprovable prior runs", async () => {
    const w = setup("supersede-active"); w.h.start(w.h.proposal());
    const plan = w.h.proposal(); const command = w.launch.prepareFinal(plan);
    assert.equal((await w.launch.submit(command, w.binding, plan)).kind, "confirmed");
    assert.equal(w.h.queueRoots.length, 2);
    assert.equal((await w.launch.submit(command, w.binding)).kind, "uncertain");
    assert.equal(w.h.queueRoots.length, 2);
  });
  for (const replacement of ["client", "actor", "authority", "day ABA"] as const) {
    it(`keeps a late applied reply from publishing after ${replacement} replacement`, async () => {
      const w = setup(); let release: (() => void) | undefined; let committed: (() => void) | undefined;
      const pending = new Promise<void>(resolve => { release = resolve; });
      const dispatched = new Promise<void>(resolve => { committed = resolve; });
      w.client.executeCommand = async input => { const result = await w.h.client.executeCommand(input); assert.ok(committed); committed(); await pending; return result; };
      const plan = w.h.proposal(); const published: CommandOutcome[] = [];
      const result = w.launch.submit(w.launch.prepareFinal(plan), w.binding, plan, next => published.push(next));
      await dispatched; assert.equal(w.h.queueRoots.length, 1);
      if (replacement === "day ABA") w.replaceScope({ ...w.binding.scope, dayRequest: {} });
      w.replaceScope({ ...w.binding.scope, ...(replacement === "client" ? { client: { ...w.client } }
        : replacement === "actor" ? { actorId: "other-operator" } : replacement === "authority" ? { authority: {} } : { dayRequest: {} }) });
      assert.ok(release); release(); assert.equal((await result).kind, "confirmed"); assert.deepEqual(published, []);
    });
  }
  it("does not allow another actor to replay the retained command", async () => {
    const w = setup(); w.h.loseResponse();
    const command = w.launch.prepareFinal(w.h.proposal());
    assert.equal((await w.launch.submit(command, w.binding)).kind, "uncertain");
    const scope = { ...w.binding.scope, actorId: "other-operator" }; w.replaceScope(scope);
    const outcome = await w.launch.submit(command, { ...w.binding, scope });
    assert.equal(outcome.kind, "refused"); assert.equal(outcome.kind === "refused" ? outcome.reason : undefined, "actor-mismatch");
    assert.equal(w.h.finalCommands.length, 1);
  });
  it("requires an explicit served clock when preparing final commands", () => {
    const w = setup(); assert.throws(() => createRunLaunchService(w.client, "local-operator").prepareFinal(w.h.proposal()), /AUTHORITY_UNAVAILABLE/u);
    assert.equal(w.h.finalCommands.length, 0);
  });
  for (const lostReply of [false, true]) {
    it(`confirms the actual enqueue partition across midnight${lostReply ? " after lost-ack exact replay" : ""}`, async () => {
      const w = setup(); w.h.clock.setWall(new Date("2026-08-01T06:59:59.000Z"));
      const plan = w.h.proposal(); const command = w.launch.prepareFinal(plan);
      assert.equal(command.requestedAt, "2026-08-01T06:59:59.000Z");
      w.h.clock.advanceWall(2_000); assert.ok(Date.parse(plan.expiresAt) > w.h.clock.nowMs());
      const queriedDays: string[] = [];
      w.client.dashboardDay = async day => { queriedDays.push(day); return w.h.client.dashboardDay(day); };
      if (lostReply) w.h.loseResponse();
      const initial = await w.launch.submit(command, w.binding, plan);
      assert.equal(initial.kind, lostReply ? "uncertain" : "confirmed");
      if (lostReply) {
        assert.equal((await w.launch.submit(command, w.binding)).kind, "confirmed");
        assert.deepEqual(w.h.finalCommands[1], w.h.finalCommands[0]);
      }
      assert.deepEqual(queriedDays, ["2026-08-01"]); assert.equal(w.h.queueRoots.length, 1);
      assert.equal(w.h.finalCommands.length, lostReply ? 2 : 1);
    });
  }
  it("resolves reviewed supersede targets on their own prior partition", async () => {
    const w = setup("supersede-active"); w.h.clock.setWall(new Date("2026-08-01T06:59:59.000Z"));
    w.h.start(w.h.proposal()); const plan = w.h.proposal(); const command = w.launch.prepareFinal(plan);
    w.h.clock.advanceWall(2_000); const queriedDays: string[] = [];
    w.client.dashboardDay = async day => { queriedDays.push(day); return w.h.client.dashboardDay(day); };
    assert.equal((await w.launch.submit(command, w.binding, plan)).kind, "confirmed");
    assert.deepEqual(queriedDays.sort(), ["2026-07-31", "2026-08-01"]);
    assert.equal(w.h.queueRoots.length, 2);
  });

  it("finds the acknowledged selected run beyond the first history page", async () => {
    const w = setup();
    for (let index = 0; index < 50; index += 1) {
      const run = w.h.start(w.h.proposal());
      requireLifecycleApplied(w.h.lifecycle.transition({ commandId: w.h.ids.uuid(), runId: run.envelope.runId,
        expectedVersion: run.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: w.h.clock.now().toISOString() } }));
    }
    const cursors: (string | undefined)[] = [];
    w.client.itemAttemptHistory = async (runId, options) => { cursors.push(options?.cursor); return w.h.client.itemAttemptHistory(runId, options); };
    const plan = w.h.proposal(); assert.equal((await w.launch.submit(w.launch.prepareFinal(plan), w.binding, plan)).kind, "confirmed");
    assert.equal(cursors.length, 2); assert.equal(cursors[0], undefined); assert.equal(typeof cursors[1], "string");
    assert.equal(w.h.queueRoots.length, 51);
  });
  for (const failure of ["unavailable", "stale", "wrong selected revision", "wrong partition"] as const) {
    it(`retains uncertainty for ${failure} history without guessing another partition`, async () => {
      const w = setup(); const queriedDays: string[] = [];
      w.client.dashboardDay = async day => { queriedDays.push(day); return w.h.client.dashboardDay(day); };
      w.client.itemAttemptHistory = async (runId, options) => {
        const history = await w.h.client.itemAttemptHistory(runId, options);
        assert.ok(history.state === "available" && history.selected.state === "present");
        if (failure === "unavailable") return ItemAttemptHistoryResponseSchema.parse({ schemaVersion: 1, state: "unavailable", selected: history.selected, reason: "item-identity-unknown" });
        if (failure === "stale") return ItemAttemptHistoryResponseSchema.parse({ schemaVersion: 1, state: "stale", selectedRunId: runId, reason: "authority-changed" });
        return ItemAttemptHistoryResponseSchema.parse({ ...history, page: { ...history.page, entries: history.page.entries.map(entry => entry.disposition !== "live" ? entry
          : { ...entry, ...(failure === "wrong selected revision" ? { rowRevision: entry.rowRevision + 1 } : { partitionDay: "2026-07-30" }) }) } });
      };
      const plan = w.h.proposal(); assert.equal((await w.launch.submit(w.launch.prepareFinal(plan), w.binding, plan)).kind, "uncertain");
      assert.deepEqual(queriedDays, failure === "wrong partition" ? ["2026-07-30"] : []);
      assert.equal(w.h.queueRoots.length, 1);
    });
  }

  it("does not accept matching runs moved into each other's partition snapshots", async () => {
    const w = setup("supersede-active"); w.h.clock.setWall(new Date("2026-08-01T06:59:59.000Z"));
    w.h.start(w.h.proposal()); const plan = w.h.proposal(); const command = w.launch.prepareFinal(plan);
    w.h.clock.advanceWall(2_000); const queriedDays: string[] = [];
    w.client.dashboardDay = async day => {
      queriedDays.push(day);
      const snapshot = await w.h.client.dashboardDay(day);
      const other = await w.h.client.dashboardDay(day === "2026-07-31" ? "2026-08-01" : "2026-07-31");
      return DashboardDayWireSchema.parse({ ...snapshot, queueSurfaces: other.queueSurfaces });
    };
    assert.equal((await w.launch.submit(command, w.binding, plan)).kind, "uncertain");
    assert.deepEqual(queriedDays.sort(), ["2026-07-31", "2026-08-01"]);
    assert.equal(w.h.queueRoots.length, 2);
    assert.equal(w.binding.executor.retainedAttempts()[0].outcome?.kind, "uncertain");
  });

});
