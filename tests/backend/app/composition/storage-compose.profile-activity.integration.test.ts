import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { copyFileSync } from "node:fs";
import { it } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { composeDashboardRuntime } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { composeProfileRuntime, composeProfileActivity, composeSelectedProfileStorage } from "../../../../src/backend/app/composition/storage-compose.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { CommandResultSchema, WorkerBrowserCommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { admitWorkerPoolRoster, admitDirectWorker } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { acquireRuntimeProcessLock, bindWorkerProcessAdmission } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../src/models/config/settings.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { WorkerChildEvidenceSchema } from "../../../../src/backend/runtime/workers/worker-supervisor.js";
import { systemClock, manualClock } from "../../../../src/rules/time/clock.js";
import { healthyRuntimePreflightRunners } from "../../../support/fixtures/preflight-seams.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

function fixture() {
  const f = createBoundProfileFixture();
  const clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  const context = composeSelectedProfileStorage({ machineAdmission: f.machine, admission: f.admission, credentials: boundProfileCredentials(f.admission), clock, hostFacts: { primaryDisplay: null } });
  const lifecycle = new RunRecordService({ database: context.database, clock, ids: { uuid: randomUUID }, publishQueued: () => { throw new Error("activity proof cannot enqueue"); } });
  const processLockRoot = join(f.workspace, "process-locks");
  const supervisor = { memberEvidence: () => undefined, drainOwnedChildren: async () => undefined };
  const input = { admission: f.admission, database: context.database, clock, processLockRoot, lifecycle, supervisor };
  return { ...f, context, input, async cleanup() { await context.account.close(); context.database.close(); f.close(); } };
}

it("observes actual empty canonical owners and awaits synthetic drain scheduling without certifying real browser closure", async () => {
  const f = fixture();
  let settle: (() => void) | undefined;
  const completion = new Promise<void>(resolve => { settle = resolve; });
  try {
    const activity = composeProfileActivity({ ...f.input, supervisor: { ...f.input.supervisor, drainOwnedChildren: () => completion } });
    const profileId = f.admission.profileBinding.profileId;
    assert.equal(activity.hasUnquiescedWork(profileId), false);
    assert.throws(() => activity.hasUnquiescedWork(randomUUID()), /owner-mismatch/u);
    activity.requestCancellation(profileId);
    assert.equal(activity.hasUnquiescedWork(profileId), true);
    assert.ok(settle); settle();
    await completion;
    assert.equal(activity.hasUnquiescedWork(profileId), false);
  } finally { settle?.(); await f.cleanup(); }
});

it("refuses unknown OS identity and a missing process close acknowledgement after a genuine record positive", async () => {
  const f = fixture();
  const record = acquireRuntimeProcessLock({ processLockRoot: f.input.processLockRoot, name: "workers", pid: process.pid,
    admission: { kind: "unbound-worker", authorityPath: f.path } }, f.input.clock);
  try {
    const profileId = f.admission.profileBinding.profileId;
    assert.equal(composeProfileActivity(f.input).hasUnquiescedWork(profileId), true);
    const unknown = composeProfileActivity({ ...f.input, observeProcessIdentity: () => { throw new Error("synthetic process identity unavailable"); } });
    assert.throws(() => unknown.hasUnquiescedWork(profileId), /identity unavailable/u);
    const missingAck = composeProfileActivity({ ...f.input, observeProcessIdentity: () => ({ state: "gone" }) });
    assert.throws(() => missingAck.hasUnquiescedWork(profileId), /closure-unproved/u);
  } finally { record.release(); await f.cleanup(); }
});

it("includes an idle owned lifetime and refuses absent supervisor acknowledgement", async () => {
  const f = fixture();
  let worker: ReturnType<typeof bindWorkerProcessAdmission> | undefined;
  try {
    const profileId = f.admission.profileBinding.profileId;
    assert.equal(composeProfileActivity(f.input).hasUnquiescedWork(profileId), false);
    worker = bindWorkerProcessAdmission({ processLockRoot: f.input.processLockRoot, authorityPath: f.path, pid: process.pid, clock: f.input.clock,
      open: () => f.context.database, close: () => undefined,
      admit: (_database, acquisitionId) => f.context.database.withAuthorityTransaction(repositories => admitDirectWorker(repositories, {
        commandId: randomUUID(), workflow: "person-lookup", poolIndex: 1, expectedPoolVersion: 0, processId: process.pid,
        processAcquisitionId: acquisitionId, authorityPath: f.path, processLockRoot: f.input.processLockRoot, now: f.input.clock.now().toISOString(),
      }, randomUUID()).workerId),
    });
    const started = f.context.database.startOwnedWorker({ workerId: worker.workerId, workflow: "person-lookup", browserSystems: ["crm"],
      processId: process.pid, requestedBy: "local-operator", now: f.input.clock.now().toISOString() }, worker.processLock);
    assert.equal(started.state, "started");
    const custody = f.context.database.readProfileResourceCustody();
    assert.equal(custody.slots.length, 1);
    assert.equal(custody.leases.length, 1);
    assert.throws(() => composeProfileActivity(f.input).hasUnquiescedWork(profileId), /supervisor-custody-unavailable/u);
  } finally { worker?.processLock.release(); await f.cleanup(); }
});


function plan(f: ReturnType<typeof fixture>, settled = true) {
  const now = f.input.clock.now().toISOString();
  const request = WorkerBrowserCommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: now, requestedBy: "local-operator", source: "dashboard",
    family: "worker-browser", type: "plan-worker-count", target: { workflowId: "person-lookup", expectedVersion: 0 }, payload: { desiredWorkers: 1 } });
  if (request.type !== "plan-worker-count") throw new Error("fixture-plan-required");
  const roster = f.context.database.withAuthorityTransaction(repositories => {
    repositories.commands.insert(request);
    const roster = admitWorkerPoolRoster(repositories, request, now);
    repositories.workerControls.admit({ commandId: request.commandId, request, scope: "worker-pool:person-lookup", executorId: randomUUID(),
      admittedAt: now, expiresAt: new Date(f.input.clock.nowMs() + 60_000).toISOString(), basisVersion: 0, phase: { state: "admitted" }, roster });
    return roster;
  });
  if (settled) {
    f.context.database.authority.workerControls.transition(request.commandId, "admitted", { state: "executing", startedAt: now });
    f.context.database.authority.workerControls.transition(request.commandId, "executing", { state: "succeeded", startedAt: now, completedAt: now,
      acknowledgement: { kind: "plan", workerIds: roster.selected.map(slot => slot.workerId), retirements: [] },
      application: { result: { state: "applied", commandId: request.commandId, affectedTargets: [{ family: "worker-pool", workflowId: "person-lookup" }] },
        versionChanges: [], affectedDependencyIds: [] } });
    f.context.database.authority.workerControls.audit(request.commandId, now);
  }
  const slot = roster.selected[0]; assert.ok(slot);
  return { request, slot };
}

async function stoppedPlanFixture(mode: "plan" | "direct" = "plan") {
  const f = fixture();
  let planned: { slot: ReturnType<typeof plan>["slot"]; request: { commandId: string } } | undefined = mode === "plan" ? plan(f) : undefined;
  const child = spawn(process.execPath, ["-e", "process.stdout.write('ready'); process.stdin.resume(); process.stdin.on('end', () => process.exit(0))"],
    { stdio: ["pipe", "pipe", "pipe"] });
  let held: ReturnType<typeof bindWorkerProcessAdmission> | undefined;
  try {
    await once(child.stdout, "data"); assert.ok(child.pid);
    held = bindWorkerProcessAdmission({ processLockRoot: f.input.processLockRoot, authorityPath: f.path, pid: child.pid, clock: f.input.clock,
      open: () => f.context.database, close: () => undefined, admit: (_database, acquisitionId) => {
        if (planned !== undefined) return planned.slot.workerId;
        assert.ok(child.pid);
        const commandId = randomUUID();
        const slot = f.context.database.withAuthorityTransaction(repositories => admitDirectWorker(repositories, {
          commandId, workflow: "person-lookup", poolIndex: 1, expectedPoolVersion: 0, processId: child.pid,
          processAcquisitionId: acquisitionId, authorityPath: f.path, processLockRoot: f.input.processLockRoot, now: f.input.clock.now().toISOString(),
        }, randomUUID()));
        planned = { slot, request: { commandId } };
        return slot.workerId;
      } });
    const now = f.input.clock.now().toISOString();
    assert.equal(f.context.database.startOwnedWorker({ workerId: held.workerId, workflow: "person-lookup", browserSystems: [], processId: child.pid,
      requestedBy: "local-operator", now }, held.processLock).state, "started");
    assert.equal(f.context.database.authority.workerLeases.reportLifecycle({ workerId: held.workerId, leaseGeneration: 1,
      lifecycle: { state: "stopped", startedAt: now, stoppedAt: now, reason: "operator" }, now }).state, "applied");
    held.processLock.release(); held = undefined;
    const exit = once(child, "exit"); child.stdin.end();
    assert.deepEqual(await exit, [0, null]);
    const evidence = WorkerChildEvidenceSchema.parse({ state: "exited", pid: child.pid, outcome: "stopped", exitCode: 0, signal: null,
      at: now, reportedBy: "os", observedStop: [] });
    const input = { ...f.input, supervisor: { ...f.input.supervisor, memberEvidence: () => evidence } };
    assert.ok(planned); return { f, planned, input };
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) { const exit = once(child, "exit"); child.kill("SIGKILL"); await exit; }
    held?.processLock.release(); await f.cleanup(); throw error;
  }
}

it("accepts authenticated settled plan provenance only after a real owned process stops", async () => {
  const { f, planned, input } = await stoppedPlanFixture();
  try {
    const activity = composeProfileActivity(input), profileId = f.admission.profileBinding.profileId;
    assert.equal(f.context.database.authority.workerSlots.get(planned.slot.workerId)?.reservationCommandId, planned.request.commandId);
    assert.equal(activity.hasUnquiescedWork(profileId), false);
    activity.requestCancellation(profileId); await activity.awaitCancellation();
    assert.equal(activity.hasUnquiescedWork(profileId), false);
    assert.equal(f.context.database.authority.workerSlots.get(planned.slot.workerId)?.reservationCommandId, planned.request.commandId);
  } finally { await f.cleanup(); }
});

it.each(["unfinished", "refused", "missing", "foreign", "revision"] as const)("does not certify plan reservation with %s authority", async mutation => {
  const { f, planned, input } = await stoppedPlanFixture();
  try {
    const raw = new DatabaseSync(f.path);
    try {
      if (mutation === "missing") raw.prepare("DELETE FROM worker_controls WHERE command_id=?").run(planned.request.commandId);
      else if (mutation === "revision") {
        const slot = { ...planned.slot, membershipRevision: planned.slot.membershipRevision + 1 };
        raw.prepare("UPDATE worker_slots SET membership_revision=?,payload_json=? WHERE id=?").run(slot.membershipRevision, canonicalJsonStringify(slot), slot.workerId);
      } else {
        const current = f.context.database.authority.workerControls.get(planned.request.commandId); assert.ok(current);
        const { auditedAt: _auditedAt, ...unaudited } = current;
        const changed = mutation === "unfinished" ? { ...unaudited, phase: { state: "executing", startedAt: current.admittedAt } }
          : mutation === "refused" ? { ...current, phase: { state: "refused", completedAt: current.admittedAt, message: "fixture refusal" } }
            : { ...current, roster: { ...current.roster, selected: current.roster?.selected.map(slot => ({ ...slot, createdAt: "2026-10-20T12:00:00.000Z" })) } };
        raw.prepare("UPDATE worker_controls SET phase=?,audited_at=?,payload_json=? WHERE command_id=?")
          .run(changed.phase.state, mutation === "unfinished" ? null : current.auditedAt ?? null, canonicalJsonStringify(changed), planned.request.commandId);
      }
    } finally { raw.close(); }
    const inspect = () => composeProfileActivity(input).hasUnquiescedWork(f.admission.profileBinding.profileId);
    if (mutation === "unfinished") assert.equal(inspect(), true);
    else assert.throws(inspect, /profile-worker-reservation-(?:authority-unavailable|lineage-unavailable|refused)/u);
  } finally { await f.cleanup(); }
});


it("accepts exact audited direct admission provenance after an actual owned child exits", async () => {
  const { f, planned, input } = await stoppedPlanFixture("direct");
  try {
    assert.ok(f.context.database.authority.lifecycleJournal.findAuditByCommand(planned.request.commandId));
    assert.equal(composeProfileActivity(input).hasUnquiescedWork(f.admission.profileBinding.profileId), false);
  } finally { await f.cleanup(); }
});

it.each(["plan", "direct"] as const)("refuses %s provenance with a forged retirement revision or missing retirement authority", async mode => {
  const { f, planned, input } = await stoppedPlanFixture(mode);
  try {
    const raw = new DatabaseSync(f.path);
    try {
      raw.exec("PRAGMA foreign_keys=OFF");
      const retirementCommandId = randomUUID();
      for (const increment of [2, 1]) {
        const slot = { ...planned.slot, membershipRevision: planned.slot.membershipRevision + increment,
          retiredAt: f.input.clock.now().toISOString(), retirementCommandId };
        raw.prepare("UPDATE worker_slots SET membership_revision=?,retired_at=?,retirement_command_id=?,payload_json=? WHERE id=?")
          .run(slot.membershipRevision, slot.retiredAt, slot.retirementCommandId, canonicalJsonStringify(slot), slot.workerId);
        assert.throws(() => composeProfileActivity(input).hasUnquiescedWork(f.admission.profileBinding.profileId),
          increment === 2 ? /profile-worker-retirement-lineage-unavailable/u : /profile-worker-retirement-authority-unavailable/u);
      }
    } finally { raw.close(); }
  } finally { await f.cleanup(); }
});

it("refuses a missing direct-admission audit instead of treating its retained ID as settled", async () => {
  const { f, planned, input } = await stoppedPlanFixture("direct");
  try {
    const raw = new DatabaseSync(f.path);
    try {
      raw.exec("DROP TRIGGER command_audits_retained");
      raw.prepare("DELETE FROM command_audits WHERE command_id=?").run(planned.request.commandId);
    }
    finally { raw.close(); }
    assert.throws(() => composeProfileActivity(input).hasUnquiescedWork(f.admission.profileBinding.profileId), /profile-worker-reservation-authority-unavailable/u);
  } finally { await f.cleanup(); }
});


it.each(["plan-excess", "remove-worker"] as const)("proves quiescence after canonical %s retirement of the exact origin member", async kind => {
  const f = createBoundProfileFixture({ sharedMachine: true });
  const wall = manualClock(systemClock.now());
  const tick = () => { wall.setWall(new Date(Math.max(systemClock.nowMs(), wall.nowMs() + 1))); return wall.now(); };
  const clock = { ...systemClock, now: tick, nowMs: () => tick().getTime() };
  const children: ReturnType<typeof spawn>[] = [];
  const faults: string[] = [];
  const failures: unknown[] = [];
  let dashboard: Awaited<ReturnType<typeof composeDashboardRuntime>> | undefined;
  const profile = composeProfileRuntime({ admission: f.machine, clock, hostFacts: { primaryDisplay: null },
    processLockRoot: join(f.workspace, rebuildRuntimeIsolation.processLockRoot) });
  try {
    for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(f.workspace, name));
    const active = profile.session.signIn({ email: "fixture@example.edu", password: "disposable-fixture-password", at: systemClock.now().toISOString() });
    assert.equal(active.state, "active");
    if (active.state !== "active") throw new Error("retirement-fixture-sign-in-required");
    dashboard = await composeDashboardRuntime({ admission: f.machine, profile: { runtime: profile, token: active.token },
      clock, isolation: rebuildRuntimeIsolation, repoRoot: f.workspace, env: {}, backendPortOverride: 0, frontendPortOverride: 0,
      preflightRunnerFactory: healthyRuntimePreflightRunners, workerProcess: {
        launch: { command: process.execPath, prefixArgs: ["--import", "tsx", join(process.cwd(), "tests/support/processes/worker-browser-control-cli.ts"), f.workspace],
          environment: {}, cwd: process.cwd() },
        spawn: request => {
          const child = spawn(request.command, [...request.args], { cwd: request.cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
          children.push(child); child.stdout.resume(); child.stderr.resume();
          return { pid: child.pid, kill: signal => child.kill(signal), onExit: listener => { child.on("exit", listener); }, onError: listener => { child.on("error", listener); } };
        }, birth: { pollMs: 25, timeoutMs: 20_000 }, faultSink: line => { faults.push(line); },
      } });
    const database = profile.selectedContext(active.token).database;
    const origin = `http://127.0.0.1:${String(dashboard.port)}`;
    const send = async (input: Record<string, unknown>) => {
      const response = await fetch(`${origin}/api/v1/commands`, { method: "POST", headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ commandId: randomUUID(), requestedAt: systemClock.now().toISOString(), requestedBy: "local-operator", source: "dashboard", ...input }) });
      return CommandResultSchema.parse(await response.json());
    };
    const patch = { "daemon.idleRepollMs": { set: 100 }, "features.duoWebAuthn": { set: false }, "browser.headless": { set: true } };
    assert.equal((await send({ family: "settings", type: "apply-settings", target: { expectedRevision: readSettings(database.authority).revision },
      payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } })).state, "applied");
    assert.equal((await send({ family: "worker-browser", type: "plan-worker-count", target: { workflowId: "person-lookup", expectedVersion: 0 }, payload: { desiredWorkers: 1 } })).state, "applied");
    const originSlot = database.authority.workerSlots.list("person-lookup")[0]; assert.ok(originSlot);
    assert.ok(originSlot.reservationCommandId);
    assert.equal((await send({ family: "worker-browser", type: "spawn-worker", target: { workflowId: "person-lookup", expectedVersion: 1 },
      payload: { workerId: originSlot.workerId } })).state, "applied");
    const lease = database.authority.workerLeases.get(originSlot.workerId); assert.ok(lease?.controlRevision);
    const retirement = await send(kind === "plan-excess"
      ? { family: "worker-browser", type: "plan-worker-count", target: { workflowId: "person-lookup", expectedVersion: 1 }, payload: { desiredWorkers: 0 } }
      : { family: "worker-browser", type: "remove-worker", target: { workflowId: "person-lookup", workerId: originSlot.workerId, expectedVersion: 1,
        membershipRevision: originSlot.membershipRevision, controlBasis: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision } } });
    assert.ok(retirement.state === "applied" || retirement.state === "pending");
    const deadline = systemClock.monotonicMs() + 20_000;
    while (database.authority.workerControls.get(retirement.commandId)?.auditedAt === undefined) {
      if (systemClock.monotonicMs() > deadline) throw new Error("retirement-fixture-settlement-unproved");
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const retired = database.authority.workerSlots.get(originSlot.workerId); assert.ok(retired);
    const control = database.authority.workerControls.get(retirement.commandId); assert.ok(control);
    assert.equal(control.phase.state, "succeeded"); assert.ok(control.auditedAt);
    assert.equal(retired.membershipRevision, originSlot.membershipRevision + 1);
    assert.equal(retired.reservationCommandId, originSlot.reservationCommandId);
    assert.equal(retired.retirementCommandId, retirement.commandId);
    if (control.phase.state !== "succeeded") throw new Error("retirement-fixture-success-required");
    const acknowledgement = control.phase.acknowledgement;
    const proof = acknowledgement.kind === "remove" ? acknowledgement.retirement
      : acknowledgement.kind === "plan" ? acknowledgement.retirements.find(value => value.workerId === retired.workerId) : undefined;
    assert.ok(proof); assert.equal(proof.membershipRevision, originSlot.membershipRevision);
    if (kind === "plan-excess") assert.equal(proof.checkedAt, retired.retiredAt);
    else {
      assert.notEqual(proof.checkedAt, retired.retiredAt);
      assert.equal(retired.retiredAt, control.auditedAt);
      assert.equal(retired.retiredAt, control.phase.completedAt);
      assert.ok(Date.parse(proof.checkedAt) >= Date.parse(control.admittedAt));
      assert.ok(Date.parse(proof.checkedAt) < Date.parse(control.phase.completedAt));
    }
    const activity = composeProfileActivity({ admission: profile.selectedContext(active.token).admission, database,
      processLockRoot: join(f.workspace, rebuildRuntimeIsolation.processLockRoot), clock,
      lifecycle: new RunRecordService({ database, clock, ids: { uuid: randomUUID }, publishQueued: () => { throw new Error("retirement fixture cannot enqueue"); } }),
      supervisor: { memberEvidence: () => { throw new Error("retired member must not require a live supervisor"); }, drainOwnedChildren: async () => { throw new Error("retirement fixture must not request another drain"); } } });
    const profileId = profile.selectedContext(active.token).admission.profileBinding.profileId;
    assert.equal(activity.hasUnquiescedWork(profileId), false);
    if (kind === "remove-worker") {
      const raw = new DatabaseSync(f.path);
      const trigger = raw.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='worker_slots_identity'").get();
      assert.ok(typeof trigger?.sql === "string");
      try {
        raw.exec("DROP TRIGGER worker_slots_identity");
        assert.ok(retired.retiredAt);
        const altered = { ...retired, retiredAt: new Date(Date.parse(retired.retiredAt) + 1).toISOString() };
        raw.prepare("UPDATE worker_slots SET retired_at=?,payload_json=? WHERE id=?")
          .run(altered.retiredAt, canonicalJsonStringify(altered), retired.workerId);
        assert.throws(() => activity.hasUnquiescedWork(profileId), /profile-worker-retirement-lineage-unavailable/u);
      } finally {
        raw.prepare("UPDATE worker_slots SET retired_at=?,payload_json=? WHERE id=?")
          .run(retired.retiredAt, canonicalJsonStringify(retired), retired.workerId);
        raw.exec(trigger.sql); raw.close();
      }
      assert.equal(activity.hasUnquiescedWork(profileId), false);
    }
    assert.deepEqual(faults, []);
    await dashboard.stop(); dashboard = undefined;
  } catch (error) { failures.push(error); }
  finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) {
      try {
        const exit = once(child, "exit");
        assert.ok(child.pid); process.kill(-child.pid, "SIGKILL"); await exit;
      } catch (error) { failures.push(error); }
    }
    try { await dashboard?.stop(); } catch (error) { failures.push(error); }
    try { await profile.close(); } catch (error) { failures.push(error); }
    try { f.close(); } catch (error) { failures.push(error); }
  }
  if (failures.length > 0) throw new AggregateError(failures, "canonical retirement proof failed");
}, 60_000);
