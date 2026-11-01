import { assertRuntimeLifetimeHeld } from "../../../support/helpers/backend/runtime-lifetime.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { once } from "node:events";
import { retainAuthoritySourceClosure } from '../../../../src/backend/storage/source-closure.js';
import { writePrivateStage } from '../../../../src/backend/storage/configuration/credential-safe-file.js';
import { workerProfileDirectory } from '../../../../src/backend/runtime/browser/browser-session-factory.js';
import { testRunService } from '../../../support/fixtures/run-lifecycle-fixtures.js';
import { lifecycleCommandId, requireLifecycleApplied } from '../../../../src/backend/runs/lifecycle/run-record-service.js';
import { runClaim } from '../../../../src/models/run/record.js';
import { personLookupDescriptor } from '../../../support/helpers/registered-workflows.js';
import { ErrorCatalogCodeSchema } from '../../../../src/models/failures/error-catalog.js';
import { createDashboardPortTestWorld } from "../../../support/helpers/backend/dashboard-port-world.js";
import { createWorkerSupervisionTestWorld, type Harness } from "../../../support/helpers/backend/worker-supervision-world.js";
import { default as assert } from "node:assert/strict";
import { spawn as spawn_m1, type ChildProcess } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join as join_m1 } from "node:path";
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
import { releaseAdmissionFixtures } from "../../../support/helpers/admission-fixture.js";
import { foundationFixture, id as id_m0, NOW as NOW_m0 } from "../../../support/helpers/database-foundation/fixtures.js";
import { ManualScheduler, personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";
import { describe, expect } from "vitest";
import { WorkerPoolMemberSchema as WorkerPoolMemberSchema_m2, type WorkerPoolMember } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { workerCliArgv, type WorkerDurableStopReceipt, type WorkerLeaseBirthFact } from "../../../../src/backend/runtime/workers/worker-supervisor.js";
import { PositiveIntSchema } from "../../../../src/rules/identity/ids.js";
import { scaledMs } from "../../../support/time-scale.js";

{

it.each(["poolIndex", "membershipRevision"] as const)("refuses an altered same-id spawned member %s before stop effects", async field => {
  const fixture = await foundationFixture();
  const slot = fixture.db.authority.workerSlots.list("person-lookup")[0];
  assert.ok(slot);
  const member = workerPoolMember(slot);
  const lease = fixture.db.authority.workerLeases.get(member.workerId);
  assert.ok(lease);
  let onExit: ((code: number | null, signal: string | null) => void) | undefined;
  const effects: string[] = [];
  let spawned = false;
  const supervisor = createDashboardWorkerProcessSupervisor({
    onExit: () => undefined,
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
  let primary: { error: unknown } | undefined;
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
  } catch (error) { primary = { error }; }
  const cleanupFailures: unknown[] = [];
  try { onExit?.(0, null); } catch (error) { cleanupFailures.push(error); }
  try {
    const run = fixture.db.authority.runs.get(fixture.run.envelope.runId);
    assert.ok(run);
    const claim = runClaim(run); assert.ok(claim);
    const lifecycle = testRunService(fixture.db, fixture.clock);
    const now = fixture.clock.now().toISOString();
    const requested = requireLifecycleApplied(lifecycle.transition({
      commandId: lifecycleCommandId('supervisor-fixture-cancel', run.envelope.runId),
      runId: run.envelope.runId, expectedVersion: run.version,
      lifecycle: { state: 'terminal', outcome: 'cancelled', endedAt: now },
    }));
    assert.equal(requested.cancelRequested, true);
    const terminal = requireLifecycleApplied(lifecycle.terminalize({ kind: 'cancelled',
      commandId: lifecycleCommandId('supervisor-fixture-terminal', run.envelope.runId),
      runId: run.envelope.runId, expectedVersion: requested.version,
      claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration }, endedAt: now,
    }, personLookupDescriptor));
    assert.deepEqual(terminal.lifecycle, { state: 'terminal', outcome: 'cancelled', endedAt: now });
    assert.equal(fixture.db.authority.runs.listByWorker(claim.workerId).some(owned => runClaim(owned) !== undefined), false);
    assert.doesNotThrow(() => fixture.db.assertWorkerLifecycleRelease(claim.workerId));
    await fixture.dispose();
  } catch (error) { cleanupFailures.push(error); }
  if (primary !== undefined) {
    if (cleanupFailures.length !== 0) throw new AggregateError([primary.error, ...cleanupFailures], 'supervisor-fixture-cleanup-failed', { cause: primary.error });
    throw primary.error;
  }
  if (cleanupFailures.length !== 0) throw new AggregateError(cleanupFailures, 'supervisor-fixture-cleanup-failed', { cause: cleanupFailures[0] });
});
}

{

const retainedPhysicalWorkerFixtures: object[] = [];

async function waitFor(test: () => boolean, message: string, diagnostics: () => string) {
  const deadline = systemClock.monotonicMs() + scaledMs(25_000);
  while (!test()) { if (systemClock.monotonicMs() > deadline) throw new Error(`${message}\n${diagnostics()}`); await new Promise(resolve => setTimeout(resolve, 25)); }
}

it("retires a real worker only after its opened Chromium profile closes, custody releases and the slot directory is deleted", async () => {
  const world = createDashboardPortTestWorld(() => undefined, releaseAdmissionFixtures);
  let profile: Awaited<ReturnType<typeof world.createProfileFixture>>;
  try { profile = await world.createProfileFixture(systemClock); }
  catch (primary) {
    let cleanupFailure: { error: unknown } | undefined = undefined;
    try { await world.cleanup(); } catch (error) { cleanupFailure = { error }; }
    if (cleanupFailure !== undefined) throw new AggregateError([primary, cleanupFailure.error], 'Worker fixture initialization and cleanup failed', { cause: primary });
    throw primary;
  }
  const root = profile.workspace;
  const output: string[] = [], children: ChildProcess[] = [], runIds: string[] = [];
  const childClosures: Promise<unknown[]>[] = [];
  const failures: unknown[] = [];
  let runtime: DashboardRuntime | undefined, database: ReturnType<typeof profile.openDatabase> | undefined;
  let retiringMember: ReturnType<typeof workerPoolMember> | undefined;
  const diagnostics = () => output.join("") + JSON.stringify({ runs: runIds.map(id => database?.authority.runs.get(id)), leases: database?.authority.workerLeases.listLive(), browsers: retiringMember === undefined ? [] : database?.authority.workerControls.browsers(retiringMember.workerId) });
  const spawnWorker: WorkerProcessSpawner = request => {
    const child = spawn_m1(request.command, [...request.args, "--fixture-lock-port", String(profile.lifetime.port)], { cwd: request.cwd, stdio: ["ignore", "pipe", "pipe", "ipc"], detached: true });
    childClosures.push(once(child, "close"));
    children.push(child); child.stdout?.on("data", chunk => output.push(String(chunk))); child.stderr?.on("data", chunk => output.push(String(chunk)));
    let transfer: Promise<void>;
    try { transfer = profile.lifetime.share(child); }
    catch (error) { transfer = Promise.reject(error instanceof Error ? error : new Error("worker lifetime transfer failed", { cause: error })); }
    void transfer.catch(error => { child.emit("error", error); child.kill("SIGTERM"); });
    return { pid: child.pid, kill: signal => child.kill(signal), onExit: listener => { child.on("exit", listener); }, onError: listener => { child.on("error", listener); } };
  };
  try {
    runtime = await composeDashboardRuntime({ lifetimeLock: profile.lifetime, ...profile.dashboardInput, preflightRunnerFactory: healthyRuntimePreflightRunners, isolation: rebuildRuntimeIsolation, backendPortOverride: 0, frontendPortOverride: 0, env: {}, repoRoot: root,
      workerProcess: { launch: { environment: {}, command: process.execPath, prefixArgs: ["--import", "tsx", join_m1(process.cwd(), "tests/support/processes/worker-browser-control-cli.ts"), root], cwd: process.cwd() }, spawn: spawnWorker, birth: { pollMs: 25, timeoutMs: 20_000 }, faultSink: line => output.push(line) } });
    const duoDirectory = join_m1(root, `physical-duo-${randomUUID()}`);
    mkdirSync(duoDirectory, { mode: 0o700 });
    const duoCredential = join_m1(duoDirectory, 'credential.json');
    const generated = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    writePrivateStage(duoCredential, Buffer.from(JSON.stringify({ rpId: 'duosecurity.com', credentialId: Buffer.from(randomUUID()).toString('base64'),
      privateKey: generated.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'), signCount: 0, transport: 'internal' })));
    assert.equal(statSync(duoDirectory).mode & 0o777, 0o700);
    assert.equal(statSync(duoCredential).mode & 0o777, 0o600);
    const origin = `http://127.0.0.1:${String(runtime.port)}`, patch = { "daemon.idleRepollMs": { set: 100 }, "browser.headless": { set: true }, 'paths.duoCredential': { set: duoCredential }, 'paths.duoExtensionDir': { set: join_m1(process.cwd(), 'duo-autopilot') } };
    const settings = await fetch(`${origin}/api/v1/commands`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ commandId: randomUUID(), family: "settings", type: "apply-settings", target: { expectedRevision: world.readRuntimeSettingsRevision(profile) }, source: "dashboard", requestedBy: "local-operator", requestedAt: systemClock.now().toISOString(), payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } }) });
    assert.equal(CommandResultSchema.parse(await settings.json()).state, "applied");
    const db = profile.openDatabase({ path: join_m1(profile.stateRoot, "state.db"), busyTimeoutMs: 5000, migrationOwner: "native-retirement-proof" }, systemClock); database = db;
    const post = async (type: string, target: unknown, payload?: unknown) => {
      assert.ok(runtime); const origin = `http://127.0.0.1:${String(runtime.port)}`;
      const cursor = db.authority.timelineEvents.highWaterMark();
      const response = await fetch(`${origin}/api/v1/commands`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ commandId: randomUUID(), family: "worker-browser", type, target, ...(payload === undefined ? {} : { payload }), source: "dashboard", requestedBy: "local-operator", requestedAt: systemClock.now().toISOString() }) });
      const body: unknown = await response.json();
      if (!CommandResultSchema.safeParse(body).success) {
        const catalog = ErrorCatalogCodeSchema.safeParse(typeof body === 'object' && body !== null ? Reflect.get(body, 'code') : undefined);
        const publicCode: unknown = typeof body === 'object' && body !== null ? Reflect.get(body, 'code') : undefined;
        const wireCode = publicCode === 'INTERNAL_FAILURE' || publicCode === 'LOGGING_UNAVAILABLE' || publicCode === 'SCHEMA_INVALID' ? publicCode : null;
        const primary = new Error(JSON.stringify({ status: response.status, code: catalog.success ? catalog.data : null, wireCode }));
        const frames = (text: string) => [...new Set(text.match(/(?:src|tests)\/[A-Za-z0-9_./-]+\.ts:\d+:\d+/g) ?? [])];
        const classes = (text: string) => ['Error', 'TypeError', 'RangeError', 'ZodError', 'RuntimeCustodyUncertainError', 'WorkerControlRefusalError']
          .filter(name => text.startsWith(name + ':') || text.startsWith(name + '\n'));
        let diagnosticFailure: { error: unknown } | undefined;
        let diagnostic: { timelineCount: number; debugCount: number; events: { frames: string[]; classes: string[]; code: string | null }[] } | undefined;
        try {
          const events = db.authority.timelineEvents.page({ after: cursor, limit: 100 });
          const debug = events.flatMap(row => row.payload.kind === 'debug' ? [row.payload.event] : []);
          diagnostic = { timelineCount: events.length, debugCount: debug.length,
            events: debug.map(event => { const code = ErrorCatalogCodeSchema.safeParse(event.code);
              return { frames: frames(event.stack ?? ''), classes: classes(event.stack ?? ''),
                code: code.success ? code.data : event.code === 'INTERNAL_FAILURE' || event.code === 'LOGGING_UNAVAILABLE' || event.code === 'SCHEMA_INVALID' ? event.code : null }; }) };
        } catch (error) { diagnosticFailure = { error }; }
        if (diagnosticFailure !== undefined) throw new AggregateError([primary, diagnosticFailure.error], 'worker-start-diagnostic-read-failed', { cause: primary });
        assert.ok(diagnostic);
        throw new Error(JSON.stringify({ status: response.status, code: catalog.success ? catalog.data : null, wireCode,
          ...diagnostic, childFrames: frames(output.join('')), childCount: children.length,
          children: children.map(child => ({ exitCode: child.exitCode, signalCode: child.signalCode })) }), { cause: primary });
      }
      const result = CommandResultSchema.parse(body); assert.equal(result.state, "applied", JSON.stringify(result) + diagnostics()); return result;
    };
    await post("plan-worker-count", { workflowId: "person-lookup", expectedVersion: 0 }, { desiredWorkers: 2 });
    const planned = db.authority.workerSlots.list("person-lookup").filter(slot => slot.retiredAt === null);
    const excess = planned.slice(1);
    assert.equal(excess.length, 1);
    const retiringSlot = excess[0]; assert.ok(retiringSlot);
    assert.equal(retiringSlot.poolIndex, 2);
    assert.equal(retiringSlot.ordinal, 2);
    const member = workerPoolMember(retiringSlot);
    assert.deepEqual(member, WorkerPoolMemberSchema.parse({ workflowId: retiringSlot.workflow,
      workerId: retiringSlot.workerId, poolIndex: retiringSlot.poolIndex, ordinal: retiringSlot.ordinal,
      membershipRevision: retiringSlot.membershipRevision }));
    retiringMember = member;
    await post("spawn-worker", { workflowId: "person-lookup", expectedVersion: 1 }, { workerId: member.workerId });
    const active = db.authority.runtimeConfig.get(); assert.ok(active);
    const activeSnapshot = db.authority.configSnapshots.get(active.configSnapshotId); assert.ok(activeSnapshot);
    assert.equal(activeSnapshot.fingerprint, active.configFingerprint);
    assert.equal(activeSnapshot.config.features.duoWebAuthn, true);
    assert.equal(activeSnapshot.config.paths.duoCredential, duoCredential);
    assert.equal(activeSnapshot.config.paths.duoExtensionDir, join_m1(process.cwd(), 'duo-autopilot'));
    const runId = randomUUID(), at = systemClock.now().toISOString();
    runIds.push(runId);
    const candidate = RunRecordSchema.parse(personLookupQueuedRun({ runId, itemId: randomUUID(), dryRun: true }));
    const run = RunRecordSchema.parse({ ...candidate, createdAt: at, updatedAt: at, envelope: { ...candidate.envelope, traceId: deriveTraceId("pl", runId, systemClock), enqueuedAt: at, configSnapshotId: active.configSnapshotId, configFingerprint: active.configFingerprint } });
    db.withAuthorityTransaction(repositories => { repositories.runs.enqueue(run); createTimelineEmitter({ repository: repositories.timelineEvents, clock: systemClock }).emit(runQueuedSpanEvent({ run, actorId: ActorIdSchema.parse("local-operator"), title: "Native profile retirement fixture" })); });
    await waitFor(() => db.authority.workerControls.browsers(member.workerId).some(browser => browser.health !== "closed"), "opened browser observation missing", diagnostics);
    const slot = db.authority.workerSlots.get(member.workerId); assert.ok(slot);
    const slotDirectory = dirname(workerProfileDirectory({ profileRoot: activeSnapshot.config.paths.browserProfileRoot, slotOrdinal: member.ordinal, system: 'crm' }));
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
    const completed = db.authority.runs.get(runId); assert.ok(completed);
    assert.equal(completed.lifecycle.state, 'terminal');
    assert.equal(runClaim(completed), undefined);
    const remaining = db.authority.workerSlots.list(member.workflowId).filter(value => value.retiredAt === null);
    assert.equal(remaining.length, 1);
    const survivor = remaining[0]; assert.ok(survivor);
    assert.equal(survivor.poolIndex, 1);
    assert.equal(survivor.ordinal, 1);
    const pool = db.authority.workerPools.get(member.workflowId); assert.ok(pool);
    assert.equal(pool.desiredWorkers, 1);
    await post('spawn-worker', { workflowId: member.workflowId, expectedVersion: pool.version }, { workerId: survivor.workerId });
    await waitFor(() => db.authority.workerLeases.get(survivor.workerId)?.lifecycle.state === 'idle', 'survivor worker did not become idle', diagnostics);
    const survivorLease = db.authority.workerLeases.get(survivor.workerId); assert.ok(survivorLease);
    assert.equal(children.some(child => child.pid === survivorLease.processId && child.exitCode === null && child.signalCode === null), true);
    assert.equal(db.authority.workerPools.get(member.workflowId)?.desiredWorkers, 1);
  } catch (error) { failures.push(error); }
  finally {
    try {
      writeFileSync(join_m1(root, "release-drivers"), "cleanup released");
      await runtime?.detach();
      await Promise.all(childClosures);
      assert.ok(children.every(child => child.exitCode !== null || child.signalCode !== null));
      if (database !== undefined) {
        const activeSlots = database.authority.workerSlots.list().filter(slot => slot.retiredAt === null);
        for (const slot of activeSlots) {
          assert.equal(database.authority.workerLeases.get(slot.workerId)?.lifecycle.state, 'stopped');
          assertWorkerProcessStopped(join_m1(root, rebuildRuntimeIsolation.processLockRoot), slot.workerId);
        }
      }
      for (const child of children) {
        const pid = child.pid; assert.ok(pid);
        assert.throws(() => process.kill(-pid, 0), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ESRCH');
      }
      database?.close();
      await runtime?.stop();
      if (runtime !== undefined) await assertRuntimeLifetimeHeld(profile.lifetime);
      if (failures.length === 0) {
        await world.cleanup();
        assert.throws(() => profile.lifetime.assertHeld());
        const replacement = await RuntimeLifetimeLock.acquire(profile.lifetime.port);
        await replacement.close();
      }
      else retainedPhysicalWorkerFixtures.push({ runtime, database, profile, children, world });
    } catch (error) {
      retainedPhysicalWorkerFixtures.push({ runtime, database, profile, children, world });
      failures.push(retainAuthoritySourceClosure([error], { ...(database === undefined ? {} : { database }), admission: profile.dashboardInput.admission }));
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, `native retirement proof failed; retained ${root}\n${output.join("")}`, { cause: failures[0] });
}, scaledMs(90_000));
}

{

const { WORKFLOW, NOW, stopReceipt, stopDirective, openHarness, stopRequest, planRequest } = createWorkerSupervisionTestWorld();


function member(poolIndex: number): WorkerPoolMember {
  const index = PositiveIntSchema.parse(poolIndex);
  return WorkerPoolMemberSchema_m2.parse({
    workflowId: WORKFLOW,
    poolIndex: index,
    workerId: `${WORKFLOW}-worker-${index}`, ordinal: index, membershipRevision: 1,
  });
}

it("reports only actual child exit and invalidates its retained record on replacement", async () => {
  const exits: { worker: WorkerPoolMember; pid: number | undefined; valid: () => boolean }[] = [];
  const harness = openHarness({ onExit: (worker, pid, valid) => exits.push({ worker, pid, valid }) }), target = member(1);
  await harness.supervisor.execute({ command: "spawn-worker", commandId: randomUUID(), member: target });
  assert.equal(exits.length, 0);
  harness.leases.delete(target.workerId);
  harness.children[0]?.emitExit(null, "SIGKILL");
  assert.equal(exits.length, 1);
  assert.deepEqual(exits[0]?.worker, target);
  assert.equal(exits[0]?.pid, harness.children[0]?.pid);
  assert.equal(exits[0]?.valid(), true);
  await harness.supervisor.execute({ command: "spawn-worker", commandId: randomUUID(), member: target });
  assert.equal(exits[0]?.valid(), false);
});

it("retains a failed exit reconciliation and refuses replacement and shutdown success", async () => {
  const failure = new Error("synthetic crash reconciliation refusal");
  const harness = openHarness({ onExit: () => { throw failure; } }), target = member(1);
  await harness.supervisor.execute({ command: "spawn-worker", commandId: randomUUID(), member: target });
  harness.leases.delete(target.workerId);
  harness.children[0]?.emitExit(null, "SIGKILL");
  assert.deepEqual(harness.faults, [failure]);
  await assert.rejects(harness.supervisor.execute({ command: "spawn-worker", commandId: randomUUID(), member: target }), error => error === failure);
  await assert.rejects(harness.supervisor.drainOwnedChildren(stopDirective(NOW)), AggregateError);
  assert.equal(harness.children.length, 1);
});

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

  it('accepts the same child OS exit after its durable stop receipt validates', async () => {
    const { harness, target } = await runningHarness();
    harness.nextGracefulStop = async (): Promise<WorkerDurableStopReceipt> => {
      harness.children[0]?.emitExit(1, null);
      return stopReceipt(harness.clock.now().toISOString());
    };

    await expect(harness.supervisor.execute(stopRequest(harness, target)))
      .resolves.toMatchObject({ command: "stop-worker", state: "acknowledged", directiveLeaseVersions: stopReceipt(NOW).leaseVersions });
    expect(harness.supervisor.memberEvidence(target)).toEqual({
      state: "exited",
      pid: harness.children[0]?.pid,
      outcome: "stopped",
      exitCode: 1,
      signal: null,
      at: NOW,
      reportedBy: "os",
      observedStop: [{ stage: "graceful-stop-requested", at: NOW }],
    });
    expect(harness.scheduler.pending()).toHaveLength(0);
  });

  it('drain waits for the valid durable receipt after the same born child exits', async () => {
    const { harness, target } = await runningHarness();
    let land: ((receipt: WorkerDurableStopReceipt) => void) | undefined;
    harness.nextGracefulStop = () => new Promise(resolve => { land = resolve; });
    let settled = false;
    const draining = harness.supervisor.drainOwnedChildren(stopRequest(harness, target).directive);
    void draining.then(() => { settled = true; });
    harness.children[0]?.emitExit(0, null);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({ state: 'exited', outcome: 'crashed', observedStop: [] });
    expect(land).toBeTypeOf('function');
    if (land === undefined) throw new Error('receipt gate missing');
    land(stopReceipt(NOW));
    await draining;
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({ state: 'exited', outcome: 'stopped',
      reportedBy: 'os', observedStop: [{ stage: 'graceful-stop-requested', at: NOW }] });
    expect(harness.children[0]?.signalsSent).toEqual([]);
    expect(harness.scheduler.pending()).toHaveLength(0);
    expect(harness.supervisor.close()).toEqual([]);
  });

  it.each(['wrong-at', 'invalid-versions', 'request-failed', 'closed', 'replacement'] as const)(
    'early OS exit does not authorize an invalid durable receipt: %s', async fault => {
      const { harness, target } = await runningHarness();
      let land: ((receipt: WorkerDurableStopReceipt) => void) | undefined;
      let fail: ((error: Error) => void) | undefined;
      harness.nextGracefulStop = () => new Promise((resolve, reject) => { land = resolve; fail = reject; });
      const stopping = harness.supervisor.execute(stopRequest(harness, target));
      const refusal = {
  "wrong-at": "command's own instant, so this worker refuses plan coverage and further stop commands until its ",
  "invalid-versions": "plan coverage and further stop commands until its exit is observed",
  "request-failed": "); the directive may or may not have landed, so this worker refuses plan coverage ",
  "closed": "worker-supervisor-closed",
  "replacement": "worker-stop-owner-changed"
};
      const rejected = expect(stopping).rejects.toThrow(refusal[fault]);
      harness.children[0]?.emitExit(0, null);
      if (fault === 'closed') expect(harness.supervisor.close()).toEqual([]);
      if (fault === 'replacement') {
        harness.leases.delete(target.workerId);
        await harness.supervisor.execute({ command: 'spawn-worker', commandId: '10000000-0000-4000-8000-000000000002', member: target });
      }
      if (land === undefined || fail === undefined) throw new Error('receipt gate missing');
      if (fault === 'request-failed') fail(new Error('durable request failed'));
      else land(fault === 'wrong-at' ? stopReceipt(new Date(Date.parse(NOW) + 1).toISOString())
        : fault === 'invalid-versions' ? { requestedAt: NOW, leaseVersions: { before: 1, after: 3 } } : stopReceipt(NOW));
      await rejected;
      const evidence = harness.supervisor.memberEvidence(target);
      if (fault === 'replacement') {
        expect(evidence).toMatchObject({ state: 'running', pid: harness.children[1]?.pid });
        harness.children[1]?.emitExit(0, null);
      } else expect(evidence).toMatchObject({ state: 'exited', outcome: 'crashed', reportedBy: 'os', observedStop: [] });
      expect(harness.children.flatMap(child => child.signalsSent)).toEqual([]);
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

describe("reset owner preflight has no effects", () => {
  const world = createWorkerSupervisionTestWorld();
  for (const state of ["external", "awaiting-birth", "running", "changed-member", "changed-lifetime", "dead", "uncertain"] as const) {
    it(`authenticates ${state} custody before reset admission`, async () => {
      const h = world.openHarness({ publishLeaseOnSpawn: state !== "awaiting-birth" });
      const target = world.member(1);
      let spawning: Promise<unknown> | undefined;
      if (state !== "external") {
        spawning = h.supervisor.execute({ command: "spawn-worker", commandId: randomUUID(), member: target });
        if (state !== "awaiting-birth") await spawning;
      }
      if (state === "dead") h.children[0]?.emitExit(1, null);
      if (state === "uncertain") {
        h.nextGracefulStop = () => { throw new Error("possibly landed stop"); };
        await expect(h.supervisor.execute(world.stopRequest(h, target))).rejects.toThrow();
      }
      const original = h.leases.get(target.workerId);
      const lifetime = { leaseGeneration: 1, processId: original?.processId ?? 4001, startedAt: original?.startedAt ?? world.NOW };
      if (state === "changed-lifetime") h.leases.set(target.workerId, { processId: lifetime.processId + 1, startedAt: lifetime.startedAt });
      const member = state === "changed-member" ? WorkerPoolMemberSchema.parse({ ...target, membershipRevision: 2 }) : target;
      const before = { evidence: h.supervisor.memberEvidence(target), stops: h.gracefulRequests.length,
        signals: h.children.flatMap(child => child.signalsSent), timers: h.scheduler.pending().length };
      if (state === "running") {
        expect(() => h.supervisor.assertResetOwner?.(member, lifetime)).not.toThrow();
        expect(() => h.supervisor.assertResetOwner?.(member, { ...lifetime, processId: lifetime.processId + 1 })).toThrow();
        expect(() => h.supervisor.assertResetOwner?.(member, { ...lifetime, startedAt: "2026-08-26T09:01:00.000Z" })).toThrow();
      } else expect(() => h.supervisor.assertResetOwner?.(member, lifetime)).toThrow();
      expect({ evidence: h.supervisor.memberEvidence(target), stops: h.gracefulRequests.length,
        signals: h.children.flatMap(child => child.signalsSent), timers: h.scheduler.pending().length }).toEqual(before);
      if (state === "awaiting-birth") {
        const rejected = expect(spawning).rejects.toThrow();
        h.children[0]?.emitExit(1, null);
        await rejected;
      }
      h.supervisor.close();
    });
  }
});
