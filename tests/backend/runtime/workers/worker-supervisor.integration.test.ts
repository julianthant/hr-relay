import { createWorkerSupervisionTestWorld, type Harness } from "../../../support/helpers/backend/worker-supervision-world.js";
import { default as assert } from "node:assert/strict";
import { spawn as spawn_m1, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as join_m1 } from "node:path";
import { it } from "vitest";
import { composeDashboardRuntime, type DashboardRuntime } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { type WorkerProcessSpawner } from "../../../../src/backend/runtime/workers/worker-supervisor.js";
import { createDashboardWorkerProcessSupervisor } from "../../../../src/backend/runtime/workers/worker-supervisor.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { assertWorkerProcessStopped } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { deriveSettingsPatchFingerprint, SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/settings.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { workerPoolMember, WorkerPoolMemberSchema } from "../../../../src/models/run/worker-slot.js";
import { CommandResultSchema } from "../../../../src/rules/commands/commands.js";
import { deriveTraceId } from "../../../../src/rules/identity/identifiers.js";
import { ActorIdSchema, IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { healthyRuntimePreflightRunners } from "../../../support/fixtures/preflight-seams.js";
import { AuthorityDatabase, installationAdmission, releaseAdmissionFixtures } from "../../../support/helpers/admission-fixture.js";
import { foundationFixture, id as id_m0, NOW as NOW_m0 } from "../../../support/helpers/database-foundation/fixtures.js";
import { ManualScheduler, personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";
import { describe, expect } from "vitest";
import { WorkerPoolMemberSchema as WorkerPoolMemberSchema_m2, type WorkerPoolMember } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { workerCliArgv, type WorkerDurableStopReceipt, type WorkerLeaseBirthFact } from "../../../../src/backend/runtime/workers/worker-supervisor.js";
import { PositiveIntSchema } from "../../../../src/rules/identity/ids.js";

{

it.each(["poolIndex", "membershipRevision"] as const)("refuses an altered same-id spawned member %s before stop effects", async field => {
  const fixture = foundationFixture();
  const slot = fixture.db.authority.workerSlots.list("person-lookup")[0];
  assert.ok(slot);
  const member = workerPoolMember(slot);
  const lease = fixture.db.authority.workerLeases.get(member.workerId);
  assert.ok(lease);
  let onExit: ((code: number | null, signal: string | null) => void) | undefined;
  const effects: string[] = [];
  let spawned = false;
  const supervisor = createDashboardWorkerProcessSupervisor({
    launch: { command: process.execPath, prefixArgs: [], cwd: fixture.root, environment: {} },
    spawn: () => { spawned = true; return ({ pid: process.pid, kill: signal => { effects.push(signal); return true; },
      onExit: listener => { onExit = listener; }, onError: () => undefined });
    },
    leases: { observe: () => spawned ? ({ processId: process.pid, startedAt: lease.lifecycle.startedAt }) : undefined },
    gracefulStop: { request: () => { effects.push("graceful-stop"); return { requestedAt: NOW_m0, leaseVersions: { before: 1, after: 2 } }; } },
    clock: fixture.clock, scheduler: new ManualScheduler(fixture.clock, 0), birth: { pollMs: 250, timeoutMs: 10_000 },
    proveRetirement: () => { throw new Error("retirement must not be requested"); },
    onFault: error => { throw error; },
  });
  try {
    await supervisor.execute({ command: "spawn-worker", commandId: id_m0(200), member });
    const before = supervisor.memberEvidence(member);
    const generation = fixture.db.getMeta().authorityGeneration;
    const altered = WorkerPoolMemberSchema.parse({ ...member, [field]: member[field] + 1 });
    await assert.rejects(() => supervisor.execute({ command: "stop-worker", commandId: id_m0(201), member: altered,
      escalation: [{ stage: "graceful-stop-requested", timeoutMs: 120_000 }, { stage: "sigterm-sent", timeoutMs: 30_000 }, { stage: "sigkill-sent" }],
      directive: { commandId: id_m0(201), requestedAt: IsoInstantSchema.parse(NOW_m0), requestedBy: ActorIdSchema.parse("local-operator") },
    }), /worker-control-owned-member-changed/u);
    assert.deepEqual(effects, []);
    assert.deepEqual(supervisor.memberEvidence(member), before);
    assert.deepEqual(fixture.db.authority.workerSlots.get(member.workerId), slot);
    assert.deepEqual(fixture.db.authority.workerLeases.get(member.workerId), lease);
    assert.equal(fixture.db.getMeta().authorityGeneration, generation);
  } finally {
    onExit?.(0, null);
    fixture.dispose();
  }
});
}

{

async function waitFor(test: () => boolean, message: string, diagnostics: () => string) {
  const deadline = systemClock.monotonicMs() + 25_000;
  while (!test()) { if (systemClock.monotonicMs() > deadline) throw new Error(`${message}\n${diagnostics()}`); await new Promise(resolve => setTimeout(resolve, 25)); }
}

it("retires a real worker only after its opened Chromium profile closes, custody releases and the slot directory is deleted", async () => {
  const root = mkdtempSync(join_m1(realpathSync(tmpdir()), "native-profile-retirement-"));
  copyFileSync("package.json", join_m1(root, "package.json"));
  copyFileSync("package-lock.json", join_m1(root, "package-lock.json"));
  const output: string[] = [], children: ChildProcess[] = [], runIds: string[] = [];
  const failures: unknown[] = [];
  let runtime: DashboardRuntime | undefined, database: AuthorityDatabase | undefined;
  const diagnostics = () => output.join("") + JSON.stringify({ runs: runIds.map(id => database?.authority.runs.get(id)), leases: database?.authority.workerLeases.listLive(), browsers: database?.authority.workerControls.browsers("person-lookup-worker-2") });
  const spawnWorker: WorkerProcessSpawner = request => {
    const child = spawn_m1(request.command, [...request.args], { cwd: request.cwd, stdio: ["ignore", "pipe", "pipe"], detached: true });
    children.push(child); child.stdout?.on("data", chunk => output.push(String(chunk))); child.stderr?.on("data", chunk => output.push(String(chunk)));
    return { pid: child.pid, kill: signal => child.kill(signal), onExit: listener => { child.on("exit", listener); }, onError: listener => { child.on("error", listener); } };
  };
  try {
    runtime = await composeDashboardRuntime({ admission: installationAdmission(root), preflightRunnerFactory: healthyRuntimePreflightRunners, isolation: rebuildRuntimeIsolation, backendPortOverride: 0, frontendPortOverride: 0, env: {}, repoRoot: root,
      workerProcess: { launch: { environment: {}, command: process.execPath, prefixArgs: ["--import", "tsx", join_m1(process.cwd(), "tests/support/processes/worker-browser-control-cli.ts"), root], cwd: process.cwd() }, spawn: spawnWorker, birth: { pollMs: 25, timeoutMs: 20_000 }, faultSink: line => output.push(line) } });
    const origin = `http://127.0.0.1:${String(runtime.port)}`, patch = { "daemon.idleRepollMs": { set: 100 } };
    const settings = await fetch(`${origin}/api/v1/commands`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ commandId: randomUUID(), family: "settings", type: "apply-settings", target: { expectedRevision: 1 }, source: "dashboard", requestedBy: "local-operator", requestedAt: systemClock.now().toISOString(), payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } }) });
    assert.equal(CommandResultSchema.parse(await settings.json()).state, "applied");
    const db = AuthorityDatabase.open({ path: join_m1(root, rebuildRuntimeIsolation.stateRoot, "state.db"), busyTimeoutMs: 5000, migrationOwner: "native-retirement-proof" }, systemClock); database = db;
    const post = async (type: string, target: unknown, payload?: unknown) => {
      assert.ok(runtime); const origin = `http://127.0.0.1:${String(runtime.port)}`;
      const response = await fetch(`${origin}/api/v1/commands`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ commandId: randomUUID(), family: "worker-browser", type, target, ...(payload === undefined ? {} : { payload }), source: "dashboard", requestedBy: "local-operator", requestedAt: systemClock.now().toISOString() }) });
      const result = CommandResultSchema.parse(await response.json()); assert.equal(result.state, "applied", JSON.stringify(result) + diagnostics()); return result;
    };
    await post("plan-worker-count", { workflowId: "person-lookup", expectedVersion: 0 }, { desiredWorkers: 2 });
    await post("spawn-worker", { workflowId: "person-lookup", expectedVersion: 1 }, { workerId: "person-lookup-worker-2" });
    const active = db.authority.runtimeConfig.get(); assert.ok(active);
    const runId = randomUUID(), at = systemClock.now().toISOString();
    runIds.push(runId);
    const candidate = RunRecordSchema.parse(personLookupQueuedRun({ runId, itemId: randomUUID(), dryRun: true }));
    const run = RunRecordSchema.parse({ ...candidate, createdAt: at, updatedAt: at, envelope: { ...candidate.envelope, traceId: deriveTraceId("pl", runId, systemClock), enqueuedAt: at, configSnapshotId: active.configSnapshotId, configFingerprint: active.configFingerprint } });
    db.withAuthorityTransaction(repositories => { repositories.runs.enqueue(run); createTimelineEmitter({ repository: repositories.timelineEvents, clock: systemClock }).emit(runQueuedSpanEvent({ run, actorId: ActorIdSchema.parse("local-operator"), title: "Native profile retirement fixture" })); });
    await waitFor(() => db.authority.workerControls.browsers("person-lookup-worker-2").some(browser => browser.health !== "closed"), "opened browser observation missing", diagnostics);
    const slot = db.authority.workerSlots.get("person-lookup-worker-2"); assert.ok(slot);
    const slotDirectory = join_m1(root, rebuildRuntimeIsolation.browserProfileRoot, `w${String(slot.ordinal)}`);
    const opened = db.authority.workerControls.browsers(slot.workerId).filter(browser => browser.health !== "closed");
    assert.ok(opened.length > 0); assert.ok(existsSync(slotDirectory));
    assert.ok(opened.every(browser => {
      assert.ok(browser.profileDirectory);
      const profileDirectory = browser.profileDirectory;
      return profileDirectory.startsWith(slotDirectory + "/");
    }));
    const resizing = post("plan-worker-count", { workflowId: "person-lookup", expectedVersion: 1 }, { desiredWorkers: 1 });
    await waitFor(() => db.authority.workerControls.pending("worker-pool:person-lookup").some(control => control.phase.state === "executing"), "retirement reservation missing", diagnostics);
    assert.ok(existsSync(slotDirectory), "opened profile must remain until close is observed");
    writeFileSync(join_m1(root, "release-drivers"), "fixture released");
    await resizing;
    assert.ok(children.every(child => child.exitCode !== null || child.signalCode !== null));
    assert.ok(db.authority.workerControls.browsers(slot.workerId).every(browser => browser.health === "closed"));
    assertWorkerProcessStopped(join_m1(root, rebuildRuntimeIsolation.processLockRoot), slot.workerId);
    assert.equal(existsSync(slotDirectory), false, "retirement acknowledgement requires deletion of the opened slot profile");
    assert.ok(db.authority.workerSlots.get(slot.workerId)?.retiredAt);
    for (const child of children) { assert.ok(child.pid); assert.deepEqual(JSON.parse(readFileSync(join_m1(root, `cleanup-${String(child.pid)}.json`), "utf8")), { openContexts: 0, failures: 0 }); }
  } catch (error) { failures.push(error); }
  finally {
    writeFileSync(join_m1(root, "release-drivers"), "cleanup released");
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    for (const child of children) try { await waitFor(() => child.exitCode !== null || child.signalCode !== null, "owned child cleanup did not exit", diagnostics); } catch (error) { failures.push(error); if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL"); }
    try { await runtime?.stop(); } catch (error) { failures.push(error); }
    database?.close(); releaseAdmissionFixtures();
    if (failures.length === 0) rmSync(root, { recursive: true, force: true });
  }
  if (failures.length > 0) throw new AggregateError(failures, `native retirement proof failed; retained ${root}\n${output.join("")}`);
}, 90_000);
}

{

const { WORKFLOW, NOW, stopReceipt, openHarness, stopDirective, stopRequest } = createWorkerSupervisionTestWorld();


function member(poolIndex: number): WorkerPoolMember {
  const index = PositiveIntSchema.parse(poolIndex);
  return WorkerPoolMemberSchema_m2.parse({
    workflowId: WORKFLOW,
    poolIndex: index,
    workerId: `${WORKFLOW}-worker-${index}`, ordinal: index, membershipRevision: 1,
  });
}

/* ── spawn: exact argv and birth proof ───────────────────────────────────── */

describe("spawn-worker", () => {

  it("derives the argv tail from the member alone", () => {
    expect(workerCliArgv(member(3), "00000000-0000-4000-8000-000000000003")).toEqual(["worker", "person-lookup", "--pool-index", "3", "--worker-id", "person-lookup-worker-3", "--ordinal", "3", "--membership-revision", "1", "--launch-command-id", "00000000-0000-4000-8000-000000000003"]);
  });

  it("kills the child and rejects when a birth probe throws on a scheduler tick", async () => {
    const harness = openHarness({ publishLeaseOnSpawn: false });
    const target = member(1);
    const expectation = expect(harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target }))
      .rejects.toThrow(/birth probe threw before proving its lease birth: lease store unreadable/);

    harness.observeLease = (): WorkerLeaseBirthFact | undefined => {
      throw new Error("lease store unreadable");
    };
    harness.clock.advanceMonotonic(250);
    const poll = harness.scheduler.pending()[0];
    if (poll === undefined) throw new Error("expected a scheduled birth poll");
    poll.fire();
    // Assert refusal before awaiting rejection so a swallowed catch fails promptly instead of hanging.
    expect(harness.children[0]?.signalsSent).toEqual(["SIGKILL"]);
    expect(harness.scheduler.pending()).toHaveLength(0);
    await expectation;

    // The killed child's real exit still lands as evidence and frees the slot.
    harness.children[0]?.emitExit(null, "SIGKILL");
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({
      state: "exited",
      outcome: "crashed",
      signal: "SIGKILL",
      reportedBy: "os",
    });
  });
});

async function runningHarness(): Promise<{ harness: Harness; target: WorkerPoolMember }> {
  const harness = openHarness();
  const target = member(1);
  await harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target });
  return { harness, target };
}

describe("stop-worker", () => {

  it("refuses a durable requestedAt that is not the command's now, and blocks the member until exit", async () => {
    // Stop-stage instants are bounded by the command instant, not an effect-time clock read.
    const { harness, target } = await runningHarness();
    const durableAt = new Date(Date.parse(NOW) + 1234).toISOString();
    harness.nextGracefulStop = (): WorkerDurableStopReceipt => stopReceipt(durableAt);

    await expect(harness.supervisor.execute(stopRequest(harness, target)))
      .rejects.toThrow(/durable requestedAt 2026-08-26T09:00:01\.234Z that is not the command's now/);
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({
      state: "stop-uncertain",
      cause: expect.stringContaining("landed at 2026-08-26T09:00:01.234Z, not the command's now") as unknown,
    });
    await expect(harness.supervisor.execute(stopRequest(harness, target)))
      .rejects.toThrow(/durable stop directive is UNCERTAIN/);
  });

  it("refuses a stop whose durable request raced the child's exit, preserving the exit evidence", async () => {
    const { harness, target } = await runningHarness();
    harness.nextGracefulStop = async (): Promise<WorkerDurableStopReceipt> => {
      // The child dies while the durable directive is still being requested:
      // the stop must refuse rather than record a stage over a dead child.
      harness.children[0]?.emitExit(1, null);
      return stopReceipt(harness.clock.now().toISOString());
    };

    await expect(harness.supervisor.execute(stopRequest(harness, target)))
      .rejects.toThrow(/graceful stop for person-lookup-worker-1 raced: .*now exited/);
    expect(harness.supervisor.memberEvidence(target)).toEqual({
      state: "exited",
      pid: harness.children[0]?.pid,
      outcome: "crashed",
      exitCode: 1,
      signal: null,
      at: NOW,
      reportedBy: "os",
      observedStop: [],
    });
    expect(harness.scheduler.pending()).toHaveLength(0);
  });

  it("refuses the second of two concurrent stops — the in-flight guard is synchronous", async () => {
    const { harness, target } = await runningHarness();
    harness.nextGracefulStop = async (): Promise<WorkerDurableStopReceipt> => {
      await Promise.resolve();
      return stopReceipt(harness.clock.now().toISOString());
    };

    const first = harness.supervisor.execute(stopRequest(harness, target));
    const second = harness.supervisor.execute(stopRequest(harness, target));

    await expect(second).rejects.toThrow(/a stop is already in flight for person-lookup-worker-1/);
    await expect(first).resolves.toMatchObject({ command: "stop-worker", state: "acknowledged" });
    expect(harness.gracefulRequests).toHaveLength(1);
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({
      state: "stopping",
      observedStop: [{ stage: "graceful-stop-requested", at: NOW }],
    });
  });

  it("marks the record stop-uncertain when the durable stop channel throws — a possibly-landed directive is never masked as running", async () => {
    const { harness, target } = await runningHarness();
    harness.nextGracefulStop = (): WorkerDurableStopReceipt => {
      throw new Error("directive store unavailable");
    };

    // A throw AFTER the durable directive landed is indistinguishable from
    // one before it: the record must not revert to plain "running".
    await expect(harness.supervisor.execute(stopRequest(harness, target)))
      .rejects.toThrow(/is UNCERTAIN: the durable stop channel threw \(directive store unavailable\)/);
    expect(harness.supervisor.memberEvidence(target)).toEqual({
      state: "stop-uncertain",
      pid: harness.children[0]?.pid,
      bornAt: NOW,
      leaseStartedAt: NOW,
      at: NOW,
      cause: "directive store unavailable",
    });

    // A retry does NOT double-write the durable directive…
    harness.nextGracefulStop = (): WorkerDurableStopReceipt =>
      stopReceipt(harness.clock.now().toISOString());
    await expect(harness.supervisor.execute(stopRequest(harness, target)))
      .rejects.toThrow(/stop-worker refused: .*durable stop directive is UNCERTAIN/);
    expect(harness.gracefulRequests).toHaveLength(1);
    // …plan coverage refuses to attest a healthy member over a possibly-landed
    // stop, and pause/resume refuse the same way.
    await expect(harness.supervisor.execute(planRequest(1, [target], [])))
      .rejects.toThrow(/plan-worker-count refused: .*durable stop directive is UNCERTAIN/);
    await expect(harness.supervisor.execute({ command: "pause-worker", member: target }))
      .rejects.toThrow(/pause-worker refused: .*durable stop directive is UNCERTAIN/);

    harness.children[0]?.emitExit(0, null);
    harness.leases.delete(target.workerId);
    expect(harness.supervisor.memberEvidence(target)).toEqual({
      state: "exited",
      pid: harness.children[0]?.pid,
      outcome: "crashed",
      exitCode: 0,
      signal: null,
      at: NOW,
      reportedBy: "os",
      observedStop: [],
    });
  });

  it("keeps exited/os evidence when the child exits WHILE the durable stop channel is in flight and the channel then throws — the guard is conditional on state, not unconditional", async () => {
    const { harness, target } = await runningHarness();
    const child = harness.children[0];
    if (child === undefined) throw new Error("expected a spawned child");

    harness.nextGracefulStop = (): WorkerDurableStopReceipt => {
      child.emitExit(0, null);
      throw new Error("directive store unavailable after exit");
    };

    await expect(harness.supervisor.execute(stopRequest(harness, target)))
      .rejects.toThrow(/is UNCERTAIN: the durable stop channel threw \(directive store unavailable after exit\)/);

    // Never clobbered to stop-uncertain: the exit is real OS-reported evidence.
    expect(harness.supervisor.memberEvidence(target)).toEqual({
      state: "exited",
      pid: child.pid,
      outcome: "crashed",
      exitCode: 0,
      signal: null,
      at: NOW,
      reportedBy: "os",
      observedStop: [],
    });
  });
});

function planRequest(
  desired: number,
  members: readonly WorkerPoolMember[],
  excess: readonly WorkerPoolMember[],
  at: string = NOW,
) {
  return {
    command: "plan-worker-count" as const,
    workflowId: WORKFLOW,
    desiredWorkers: PositiveIntSchema.parse(desired),
    members,
    excessMembers: excess,
    directive: stopDirective(at),
  };
}

describe("close", () => {

  it("racing an in-flight stop: reports the stop-in-flight, and the directive landing after teardown arms NO escalation", async () => {
    const harness = openHarness();
    const target = member(1);
    await harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target });
    let land: ((ack: WorkerDurableStopReceipt) => void) | undefined;
    harness.nextGracefulStop = (): Promise<WorkerDurableStopReceipt> =>
      new Promise((resolve) => {
        land = resolve;
      });
    const pendingStop = harness.supervisor.execute(stopRequest(harness, target));
    const settled = expect(pendingStop).rejects.toThrow(/interrupted by close\(\): the durable stop directive landed/);

    // close() runs while the durable stop request is still in flight — its
    // returned evidence must not hide the pending stop behind plain running.
    const live = harness.supervisor.close();
    expect(live).toEqual([{
      state: "running",
      pid: harness.children[0]?.pid,
      bornAt: NOW,
      leaseStartedAt: NOW,
      stopInFlight: true,
    }]);

    if (land === undefined) throw new Error("expected the durable stop request to be in flight");
    land(stopReceipt(NOW));
    await settled;

    expect(harness.scheduler.pending()).toHaveLength(0);
    expect(harness.faults).toHaveLength(1);
    expect(harness.faults[0]?.message).toMatch(
      /durable stop directive landed .* the supervisor closed while the request was in flight; no escalation will be armed/,
    );
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({
      state: "stopping",
      observedStop: [{ stage: "graceful-stop-requested", at: NOW }],
    });
  });
});
}
