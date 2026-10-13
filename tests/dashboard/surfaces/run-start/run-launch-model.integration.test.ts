import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { CommandExecutor, type CommandExecutionScope, type CommandOutcome } from "../../../../src/dashboard/app/commands/command-executor.js";
import type { DashboardCommandBinding } from "../../../../src/dashboard/app/dashboard-app-model.js";
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";
import { createRunLaunchService } from "../../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import { DashboardDayWireSchema, type QueueSurfaceWire } from "../../../../src/models/dashboard/projection.js";
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

describe("Start enqueue verification through the actual command and day transports", () => {
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
        return DashboardDayWireSchema.parse({ ...snapshot, queueSurfaces: snapshot.queueSurfaces.map(change) });
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
});
