import { dashboardLifetimeLock } from "../../support/helpers/backend/dashboard-lifetime.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { it, vi } from "vitest";

vi.mock("../../../src/backend/runtime/workers/worker-supervisor.js", { spy: true });
vi.mock("../../../src/backend/runs/commands/command-kernel.js", { spy: true });
import { PositiveIntSchema } from "../../../src/rules/identity/ids.js";
import * as kernels from "../../../src/backend/runs/commands/command-kernel.js";
import * as supervisors from "../../../src/backend/runtime/workers/worker-supervisor.js";
import { composeDashboardRuntime } from "../../../src/backend/app/composition/dashboard/compose.js";
import { RuntimeCustodyUncertainError, composeProfileRuntime } from "../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";
import { healthyRuntimePreflightRunners } from "../../support/fixtures/preflight-seams.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { CommandRequestSchema, CommandResultSchema } from "../../../src/rules/commands/commands.js";
import { SETTINGS_SCHEMA_HASH, deriveRawSettingsPatchFingerprint } from "../../../src/models/config/settings.js";

it.each(["unchanged", "revoked", "expired", "manifest"] as const)("checks %s authority at the genuine supervisor after awaited preflight and never redispatches a failed effect", async change => {
  const f = await createBoundProfileFixture(), clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(f.workspace, name));
  const runtime = composeProfileRuntime({ admission: f.machine, clock, hostFacts: { primaryDisplay: null }, processLockRoot: join(f.workspace, rebuildRuntimeIsolation.processLockRoot) });
  const active = runtime.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
  assert.equal(active.state, "active"); if (active.state !== "active") throw new Error("active profile required");
  let release!: () => void, entered!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  let reviseManifest: (() => void) | undefined;
  const actualKernel = (await vi.importActual<typeof import("../../../src/backend/runs/commands/command-kernel.js")>("../../../src/backend/runs/commands/command-kernel.js")).createCommandKernel;
  const kernelProbe = vi.spyOn(kernels, "createCommandKernel").mockImplementation(input => {
    const kernel = { ...actualKernel(input) }, manifest = kernel.assistantManifest.bind(kernel);
    reviseManifest = () => { kernel.assistantManifest = () => ({ ...manifest(), revision: PositiveIntSchema.parse(2) }); };
    return kernel;
  });
  const actualSupervisor = (await vi.importActual<typeof import("../../../src/backend/runtime/workers/worker-supervisor.js")>("../../../src/backend/runtime/workers/worker-supervisor.js")).createDashboardWorkerProcessSupervisor;
  let ownedSupervisor: ReturnType<typeof actualSupervisor> | undefined;
  const probe = vi.spyOn(supervisors, "createDashboardWorkerProcessSupervisor").mockImplementation(input => {
    ownedSupervisor = actualSupervisor({
      ...input, prepareAdmission: async request => {
        await input.prepareAdmission?.(request);
        if (request.command === "spawn-worker") { entered(); await barrier; }
      },
    });
    return ownedSupervisor;
  });
  let context: ReturnType<typeof runtime.selectedContext> | undefined;
  let spawns = 0, dashboard: Awaited<ReturnType<typeof composeDashboardRuntime>> | undefined;
  let execution: Promise<unknown> | undefined;
  const failures: unknown[] = [];
  try {
    dashboard = await composeDashboardRuntime({ lifetimeLock: await dashboardLifetimeLock(), admission: f.machine, profile: { runtime, token: active.token }, repoRoot: f.workspace,
      clock, isolation: rebuildRuntimeIsolation, backendPortOverride: 0, frontendPortOverride: 0, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners,
      workerProcess: { spawn: () => { spawns++; throw new Error("unexpected child effect"); } } });
    context = runtime.selectedContext(active.token);
    const currentContext = context, authorization = dashboard.assistantAuthorization; assert.ok(authorization);
    const envelope = () => ({ commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface" });
    const origin = `http://127.0.0.1:${String(dashboard.port)}`;
    const post = async (request: unknown) => {
      const response = await fetch(`${origin}/api/v1/commands`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(request) });
      return CommandResultSchema.parse(await response.json());
    };
    const grant = async (mode: "without-asking" | "every-action") => {
      const patch = {};
      return post({ ...envelope(), family: "settings", type: "apply-settings", target: { expectedRevision: currentContext.settings.read().record.revision },
        payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveRawSettingsPatchFingerprint(patch), patch,
          assistantPermission: { expectedPolicyRevision: currentContext.database.authority.assistantAuthorization.grant()?.policy.revision ?? 0, mode } } });
    };
    assert.equal(currentContext.database.withAuthorityReadSnapshot(() => currentContext.database.authority.assistantAuthorization.grant()), undefined);
    assert.equal((await grant("without-asking")).state, "applied");
    assert.equal((await post({ ...envelope(), family: "worker-browser", type: "plan-worker-count", target: { workflowId: "person-lookup", expectedVersion: 0 }, payload: { desiredWorkers: 1 } })).state, "applied");
    const slot = currentContext.database.authority.workerSlots.list("person-lookup")[0]; assert.ok(slot);
    const command = CommandRequestSchema.parse({ ...envelope(), family: "worker-browser", type: "spawn-worker",
      target: { workflowId: "person-lookup", expectedVersion: currentContext.database.authority.workerPools.get("person-lookup")?.version }, payload: { workerId: slot.workerId } });
    const chat = authorization.createChat(), proposal = authorization.prepare(chat, command);
    execution = authorization.consumeAsync(chat, proposal.id);
    const observed = execution.then(() => ({ state: "succeeded" as const, error: undefined }), (error: unknown) => ({ state: "failed" as const, error }));
    await Promise.race([waiting, observed.then(() => { throw new Error("assistant preflight prerequisite failed before barrier"); })]);
    assert.equal(currentContext.database.authority.assistantAuthorization.action(proposal.id)?.state, "claimed");
    const claimedGeneration = currentContext.database.getMeta().authorityGeneration;
    await assert.rejects(authorization.consumeAsync(chat, proposal.id), /not-consumable/u);
    assert.equal(currentContext.database.getMeta().authorityGeneration, claimedGeneration);
    const foreign = await fetch(`${origin}/api/v1/commands`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ ...command, payload: { workerId: "person-lookup-worker-2" } }) });
    assert.equal(foreign.status, 409);
    assert.equal(currentContext.database.authority.assistantAuthorization.action(proposal.id)?.state, "claimed");
    if (change === "revoked") assert.equal((await grant("every-action")).state, "applied");
    if (change === "expired") clock.advanceWall(60_001);
    if (change === "manifest") { assert.ok(reviseManifest); reviseManifest(); }
    release();
    const outcome = await observed;
    assert.equal(outcome.state, "failed");
    assert.ok(outcome.error instanceof Error);
    assert.match(outcome.error.message, change === "unchanged" ? /unexpected child effect/u
      : change === "expired" ? /assistant-effect-not-authorized/u : /assistant-effect-binding-stale/u);
    assert.equal(spawns, change === "unchanged" ? 1 : 0);
    assert.equal(currentContext.database.authority.assistantAuthorization.action(proposal.id)?.state, "unknown");
    assert.equal(currentContext.database.authority.commandAudits.findByCommand(command.commandId), undefined);
    await assert.rejects(authorization.consumeAsync(chat, proposal.id));
    assert.throws(() => authorization.assertEffect(command.commandId), /custody-unproved/u);
    const replay = await fetch(`${origin}/api/v1/commands`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(command) });
    assert.equal(replay.ok, false);
    assert.equal(currentContext.database.authority.assistantAuthorization.action(proposal.id)?.state, "unknown");
    assert.equal(spawns, change === "unchanged" ? 1 : 0);
  } catch (error) { failures.push(error); }
  finally {
    release();
    await execution?.catch(() => undefined);
    try { probe.mockRestore(); } catch (error) { failures.push(error); }
    try { kernelProbe.mockRestore(); } catch (error) { failures.push(error); }
    const assertClosureRefusal = (error: unknown, message: string): Error => {
      assert.ok(error instanceof RuntimeCustodyUncertainError);
      assert.equal(error.code, "RUNTIME_CUSTODY_UNCERTAIN");
      assert.equal(error.errors.length, 1);
      const cause: unknown = error.errors[0];
      assert.ok(cause instanceof Error);
      assert.equal(cause.constructor, Error);
      assert.equal(cause.message, message);
      assert.equal(error.cause, cause);
      return cause;
    };
    try {
      assert.ok(dashboard);
      await assert.rejects(dashboard.stop(), error => {
        assert.ok(error instanceof RuntimeCustodyUncertainError);
        assert.equal(error.code, "RUNTIME_CUSTODY_UNCERTAIN");
        assert.equal(error.errors.length, 2);
        const primary: unknown = error.errors[0];
        assert.ok(primary instanceof Error);
        assert.equal(primary.constructor, Error);
        assert.equal(primary.message, "profile-worker-lifetime-unavailable");
        assert.equal(error.cause, primary);
        assert.equal(assertClosureRefusal(error.errors[1], "profile-worker-lifetime-unavailable"), primary);
        assert.ok(context);
        context.admission.assertLive();
        f.machine.assertLive();
        const custody = context.database.readProfileResourceCustody();
        assert.equal(custody.slots.length, 1);
        assert.equal(custody.slots[0]?.retiredAt, null);
        assert.equal(custody.leases.length, 0);
        assert.equal(custody.slots[0]?.reservationCommandId, custody.reservations[0]?.reservationCommandId);
        return true;
      });
    } catch (error) { failures.push(error); }
    try {
      await assert.rejects(runtime.close(), error => { assertClosureRefusal(error, "profile-resource-closure-unproved"); return true; });
    } catch (error) { failures.push(error); }
    try {
      assert.ok(ownedSupervisor);
      assert.deepEqual(ownedSupervisor.close(), []);
    } catch (error) { failures.push(error); }
    try { await context?.account.close(); } catch (error) { failures.push(error); }
    try { context?.database.close(); } catch (error) { failures.push(error); }
    try { await f.close(); } catch (error) { failures.push(error); }
  }
  if (failures.length > 0) throw new AggregateError(failures, "assistant composition assertions or cleanup failed");
});
