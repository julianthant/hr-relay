import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { spawn as spawn_m1,type ChildProcess as ChildProcess_m1 } from "node:child_process";
import { randomUUID as randomUUID_m1 } from "node:crypto";
import { copyFileSync as copyFileSync_m1,existsSync as existsSync_m1,mkdtempSync as mkdtempSync_m1,readFileSync as readFileSync_m1,realpathSync as realpathSync_m1,rmSync as rmSync_m1,writeFileSync as writeFileSync_m1 } from "node:fs";
import { tmpdir as tmpdir_m1 } from "node:os";
import { join as join_m1 } from "node:path";
import { it as it_m0,it as it_m1 } from "vitest";
import { composeDashboardRuntime as composeDashboardRuntime_m1,type DashboardRuntime as DashboardRuntime_m1 } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { rebuildRuntimeIsolation as rebuildRuntimeIsolation_m1 } from "../../../../src/backend/app/config/runtime-isolation.js";
import { runQueuedSpanEvent as runQueuedSpanEvent_m1 } from "../../../../src/backend/runs/commands/run-queued-span.js";
import type { WorkerProcessSpawner as WorkerProcessSpawner_m1 } from "../../../../src/backend/runtime/workers/worker-supervisor.js";
import { createDashboardWorkerProcessSupervisor as createDashboardWorkerProcessSupervisor_m0 } from "../../../../src/backend/runtime/workers/worker-supervisor.js";
import { createTimelineEmitter as createTimelineEmitter_m1 } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { assertWorkerProcessStopped as assertWorkerProcessStopped_m1 } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { deriveSettingsPatchFingerprint as deriveSettingsPatchFingerprint_m1,SETTINGS_SCHEMA_HASH as SETTINGS_SCHEMA_HASH_m1 } from "../../../../src/models/config/settings.js";
import { RunRecordSchema as RunRecordSchema_m1 } from "../../../../src/models/run/record.js";
import { workerPoolMember as workerPoolMember_m0,WorkerPoolMemberSchema as WorkerPoolMemberSchema_m0 } from "../../../../src/models/run/worker-slot.js";
import { CommandResultSchema as CommandResultSchema_m1 } from "../../../../src/rules/commands/commands.js";
import { deriveTraceId as deriveTraceId_m1 } from "../../../../src/rules/identity/identifiers.js";
import { ActorIdSchema as ActorIdSchema_m0,ActorIdSchema as ActorIdSchema_m1,IsoInstantSchema as IsoInstantSchema_m0 } from "../../../../src/rules/identity/ids.js";
import { systemClock as systemClock_m1 } from "../../../../src/rules/time/clock.js";
import { healthyRuntimePreflightRunners as healthyRuntimePreflightRunners_m1 } from "../../../support/fixtures/preflight-seams.js";
import { AuthorityDatabase as AuthorityDatabase_m1,installationAdmission as installationAdmission_m1,releaseAdmissionFixtures as releaseAdmissionFixtures_m1 } from "../../../support/helpers/admission-fixture.js";
import { foundationFixture as foundationFixture_m0,id as id_m0,NOW as NOW_m0 } from "../../../support/helpers/database-foundation/fixtures.js";
import { ManualScheduler as ManualScheduler_m0,personLookupQueuedRun as personLookupQueuedRun_m1 } from "../../../support/helpers/phase1f-executor-harness.js";

import { describe as describe_m2,expect as expect_m2,it as it_m2 } from "vitest";
import {
WORKER_GRACEFUL_STOP_TIMEOUT_MS as WORKER_GRACEFUL_STOP_TIMEOUT_MS_m2,
WORKER_SIGTERM_TIMEOUT_MS as WORKER_SIGTERM_TIMEOUT_MS_m2,
WorkerPoolMemberSchema as WorkerPoolMemberSchema_m2,
WorkerStopDirectiveContextSchema as WorkerStopDirectiveContextSchema_m2,
WorkerStopEscalationPolicySchema as WorkerStopEscalationPolicySchema_m2,
type WorkerPoolMember as WorkerPoolMember_m2,
type WorkerStopDirectiveContext as WorkerStopDirectiveContext_m2,
type WorkerStopEscalationPolicy as WorkerStopEscalationPolicy_m2
} from "../../../../src/backend/runtime/workers/worker-loop.js";
import {
createDashboardWorkerProcessSupervisor as createDashboardWorkerProcessSupervisor_m2,
workerCliArgv as workerCliArgv_m2,
type DashboardWorkerProcessSupervisor as DashboardWorkerProcessSupervisor_m2,
type SpawnedWorkerHandle as SpawnedWorkerHandle_m2,
type WorkerDurableStopReceipt as WorkerDurableStopReceipt_m2,
type WorkerLeaseBirthFact as WorkerLeaseBirthFact_m2,
type WorkerProcessSpawnRequest as WorkerProcessSpawnRequest_m2
} from "../../../../src/backend/runtime/workers/worker-supervisor.js";
import type { WorkerId as WorkerId_m2 } from "../../../../src/rules/identity/ids.js";
import { PositiveIntSchema as PositiveIntSchema_m2,WorkflowIdSchema as WorkflowIdSchema_m2 } from "../../../../src/rules/identity/ids.js";
import type { TestClock as TestClock_m2 } from "../../../../src/rules/time/clock.js";
import { manualClock as manualClock_m2 } from "../../../../src/rules/time/clock.js";
import { ManualScheduler as ManualScheduler_m2 } from "../../../support/helpers/phase1f-executor-harness.js";


{


it_m0.each(["poolIndex", "membershipRevision"] as const)("refuses an altered same-id spawned member %s before stop effects", async field => {
  const fixture = foundationFixture_m0();
  const slot = fixture.db.authority.workerSlots.list("person-lookup")[0];
  assert_m0.ok(slot);
  const member = workerPoolMember_m0(slot);
  const lease = fixture.db.authority.workerLeases.get(member.workerId);
  assert_m0.ok(lease);
  let onExit: ((code: number | null, signal: string | null) => void) | undefined;
  const effects: string[] = [];
  let spawned = false;
  const supervisor = createDashboardWorkerProcessSupervisor_m0({
    launch: { command: process.execPath, prefixArgs: [], cwd: fixture.root, environment: {} },
    spawn: () => { spawned = true; return ({ pid: process.pid, kill: signal => { effects.push(signal); return true; },
      onExit: listener => { onExit = listener; }, onError: () => undefined });
    },
    leases: { observe: () => spawned ? ({ processId: process.pid, startedAt: lease.lifecycle.startedAt }) : undefined },
    gracefulStop: { request: () => { effects.push("graceful-stop"); return { requestedAt: NOW_m0, leaseVersions: { before: 1, after: 2 } }; } },
    clock: fixture.clock, scheduler: new ManualScheduler_m0(fixture.clock, 0), birth: { pollMs: 250, timeoutMs: 10_000 },
    proveRetirement: () => { throw new Error("retirement must not be requested"); },
    onFault: error => { throw error; },
  });
  try {
    await supervisor.execute({ command: "spawn-worker", commandId: id_m0(200), member });
    const before = supervisor.memberEvidence(member);
    const generation = fixture.db.getMeta().authorityGeneration;
    const altered = WorkerPoolMemberSchema_m0.parse({ ...member, [field]: member[field] + 1 });
    await assert_m0.rejects(() => supervisor.execute({ command: "stop-worker", commandId: id_m0(201), member: altered,
      escalation: [{ stage: "graceful-stop-requested", timeoutMs: 120_000 }, { stage: "sigterm-sent", timeoutMs: 30_000 }, { stage: "sigkill-sent" }],
      directive: { commandId: id_m0(201), requestedAt: IsoInstantSchema_m0.parse(NOW_m0), requestedBy: ActorIdSchema_m0.parse("local-operator") },
    }), /worker-control-owned-member-changed/u);
    assert_m0.deepEqual(effects, []);
    assert_m0.deepEqual(supervisor.memberEvidence(member), before);
    assert_m0.deepEqual(fixture.db.authority.workerSlots.get(member.workerId), slot);
    assert_m0.deepEqual(fixture.db.authority.workerLeases.get(member.workerId), lease);
    assert_m0.equal(fixture.db.getMeta().authorityGeneration, generation);
  } finally {
    onExit?.(0, null);
    fixture.dispose();
  }
});
}

{


async function waitFor(test: () => boolean, message: string, diagnostics: () => string) {
  const deadline = systemClock_m1.monotonicMs() + 25_000;
  while (!test()) { if (systemClock_m1.monotonicMs() > deadline) throw new Error(`${message}\n${diagnostics()}`); await new Promise(resolve => setTimeout(resolve, 25)); }
}

it_m1("retires a real worker only after its opened Chromium profile closes, custody releases and the slot directory is deleted", async () => {
  const root = mkdtempSync_m1(join_m1(realpathSync_m1(tmpdir_m1()), "native-profile-retirement-"));
  copyFileSync_m1("package.json", join_m1(root, "package.json"));
  copyFileSync_m1("package-lock.json", join_m1(root, "package-lock.json"));
  const output: string[] = [], children: ChildProcess_m1[] = [], runIds: string[] = [];
  const failures: unknown[] = [];
  let runtime: DashboardRuntime_m1 | undefined, database: AuthorityDatabase_m1 | undefined;
  const diagnostics = () => output.join("") + JSON.stringify({ runs: runIds.map(id => database?.authority.runs.get(id)), leases: database?.authority.workerLeases.listLive(), browsers: database?.authority.workerControls.browsers("person-lookup-worker-2") });
  const spawnWorker: WorkerProcessSpawner_m1 = request => {
    const child = spawn_m1(request.command, [...request.args], { cwd: request.cwd, stdio: ["ignore", "pipe", "pipe"], detached: true });
    children.push(child); child.stdout?.on("data", chunk => output.push(String(chunk))); child.stderr?.on("data", chunk => output.push(String(chunk)));
    return { pid: child.pid, kill: signal => child.kill(signal), onExit: listener => { child.on("exit", listener); }, onError: listener => { child.on("error", listener); } };
  };
  try {
    runtime = await composeDashboardRuntime_m1({ admission: installationAdmission_m1(root), preflightRunnerFactory: healthyRuntimePreflightRunners_m1, isolation: rebuildRuntimeIsolation_m1, backendPortOverride: 0, frontendPortOverride: 0, env: {}, repoRoot: root,
      workerProcess: { launch: { environment: {}, command: process.execPath, prefixArgs: ["--import", "tsx", join_m1(process.cwd(), "tests/support/processes/worker-browser-control-cli.ts"), root], cwd: process.cwd() }, spawn: spawnWorker, birth: { pollMs: 25, timeoutMs: 20_000 }, faultSink: line => output.push(line) } });
    const origin = `http://127.0.0.1:${String(runtime.port)}`, patch = { "daemon.idleRepollMs": { set: 100 } };
    const settings = await fetch(`${origin}/api/v1/commands`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ commandId: randomUUID_m1(), family: "settings", type: "apply-settings", target: { expectedRevision: 1 }, source: "dashboard", requestedBy: "local-operator", requestedAt: systemClock_m1.now().toISOString(), payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH_m1, patchFingerprint: deriveSettingsPatchFingerprint_m1(patch), patch } }) });
    assert_m1.equal(CommandResultSchema_m1.parse(await settings.json()).state, "applied");
    const db = AuthorityDatabase_m1.open({ path: join_m1(root, rebuildRuntimeIsolation_m1.stateRoot, "state.db"), busyTimeoutMs: 5000, migrationOwner: "native-retirement-proof" }, systemClock_m1); database = db;
    const post = async (type: string, target: unknown, payload?: unknown) => {
      assert_m1.ok(runtime); const origin = `http://127.0.0.1:${String(runtime.port)}`;
      const response = await fetch(`${origin}/api/v1/commands`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ commandId: randomUUID_m1(), family: "worker-browser", type, target, ...(payload === undefined ? {} : { payload }), source: "dashboard", requestedBy: "local-operator", requestedAt: systemClock_m1.now().toISOString() }) });
      const result = CommandResultSchema_m1.parse(await response.json()); assert_m1.equal(result.state, "applied", JSON.stringify(result) + diagnostics()); return result;
    };
    await post("plan-worker-count", { workflowId: "person-lookup", expectedVersion: 0 }, { desiredWorkers: 2 });
    await post("spawn-worker", { workflowId: "person-lookup", expectedVersion: 1 }, { workerId: "person-lookup-worker-2" });
    const active = db.authority.runtimeConfig.get(); assert_m1.ok(active);
    const runId = randomUUID_m1(), at = systemClock_m1.now().toISOString();
    runIds.push(runId);
    const candidate = RunRecordSchema_m1.parse(personLookupQueuedRun_m1({ runId, itemId: randomUUID_m1(), dryRun: true }));
    const run = RunRecordSchema_m1.parse({ ...candidate, createdAt: at, updatedAt: at, envelope: { ...candidate.envelope, traceId: deriveTraceId_m1("pl", runId, systemClock_m1), enqueuedAt: at, configSnapshotId: active.configSnapshotId, configFingerprint: active.configFingerprint } });
    db.withAuthorityTransaction(repositories => { repositories.runs.enqueue(run); createTimelineEmitter_m1({ repository: repositories.timelineEvents, clock: systemClock_m1 }).emit(runQueuedSpanEvent_m1({ run, actorId: ActorIdSchema_m1.parse("local-operator"), title: "Native profile retirement fixture" })); });
    await waitFor(() => db.authority.workerControls.browsers("person-lookup-worker-2").some(browser => browser.health !== "closed"), "opened browser observation missing", diagnostics);
    const slot = db.authority.workerSlots.get("person-lookup-worker-2"); assert_m1.ok(slot);
    const slotDirectory = join_m1(root, rebuildRuntimeIsolation_m1.browserProfileRoot, `w${String(slot.ordinal)}`);
    const opened = db.authority.workerControls.browsers(slot.workerId).filter(browser => browser.health !== "closed");
    assert_m1.ok(opened.length > 0); assert_m1.ok(existsSync_m1(slotDirectory));
    assert_m1.ok(opened.every(browser => {
      assert_m1.ok(browser.profileDirectory);
      const profileDirectory = browser.profileDirectory;
      return profileDirectory.startsWith(slotDirectory + "/");
    }));
    const resizing = post("plan-worker-count", { workflowId: "person-lookup", expectedVersion: 1 }, { desiredWorkers: 1 });
    await waitFor(() => db.authority.workerControls.pending("worker-pool:person-lookup").some(control => control.phase.state === "executing"), "retirement reservation missing", diagnostics);
    assert_m1.ok(existsSync_m1(slotDirectory), "opened profile must remain until close is observed");
    writeFileSync_m1(join_m1(root, "release-drivers"), "fixture released");
    await resizing;
    assert_m1.ok(children.every(child => child.exitCode !== null || child.signalCode !== null));
    assert_m1.ok(db.authority.workerControls.browsers(slot.workerId).every(browser => browser.health === "closed"));
    assertWorkerProcessStopped_m1(join_m1(root, rebuildRuntimeIsolation_m1.processLockRoot), slot.workerId);
    assert_m1.equal(existsSync_m1(slotDirectory), false, "retirement acknowledgement requires deletion of the opened slot profile");
    assert_m1.ok(db.authority.workerSlots.get(slot.workerId)?.retiredAt);
    for (const child of children) { assert_m1.ok(child.pid); assert_m1.deepEqual(JSON.parse(readFileSync_m1(join_m1(root, `cleanup-${String(child.pid)}.json`), "utf8")), { openContexts: 0, failures: 0 }); }
  } catch (error) { failures.push(error); }
  finally {
    writeFileSync_m1(join_m1(root, "release-drivers"), "cleanup released");
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    for (const child of children) try { await waitFor(() => child.exitCode !== null || child.signalCode !== null, "owned child cleanup did not exit", diagnostics); } catch (error) { failures.push(error); if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL"); }
    try { await runtime?.stop(); } catch (error) { failures.push(error); }
    database?.close(); releaseAdmissionFixtures_m1();
    if (failures.length === 0) rmSync_m1(root, { recursive: true, force: true });
  }
  if (failures.length > 0) throw new AggregateError(failures, `native retirement proof failed; retained ${root}\n${output.join("")}`);
}, 90_000);
}

{


const WORKFLOW = WorkflowIdSchema_m2.parse("person-lookup");
const NOW = "2026-08-26T09:00:00.000Z";

function member(poolIndex: number): WorkerPoolMember_m2 {
  const index = PositiveIntSchema_m2.parse(poolIndex);
  return WorkerPoolMemberSchema_m2.parse({
    workflowId: WORKFLOW,
    poolIndex: index,
    workerId: `${WORKFLOW}-worker-${index}`, ordinal: index, membershipRevision: 1,
  });
}

/* ── fakes at the process boundary ───────────────────────────────────────── */

type ExitListener = (code: number | null, signal: string | null) => void;
type ErrorListener = (error: Error) => void;

class FakeWorkerChild implements SpawnedWorkerHandle_m2 {
  readonly pid: number | undefined;
  readonly signalsSent: string[] = [];
  killResult = true;
  #exitListeners: ExitListener[] = [];
  #errorListeners: ErrorListener[] = [];
  #exited = false;

  constructor(pid: number | undefined) {
    this.pid = pid;
  }

  kill(signal: "SIGTERM" | "SIGKILL"): boolean {
    this.signalsSent.push(signal);
    return this.killResult;
  }

  onExit(listener: ExitListener): void {
    this.#exitListeners.push(listener);
  }

  onError(listener: ErrorListener): void {
    this.#errorListeners.push(listener);
  }

  emitExit(code: number | null, signal: string | null): void {
    if (this.#exited) throw new Error("fake child already exited");
    this.#exited = true;
    for (const listener of this.#exitListeners) listener(code, signal);
  }

  emitError(error: Error): void {
    for (const listener of this.#errorListeners) listener(error);
  }
}

interface Harness {
  readonly supervisor: DashboardWorkerProcessSupervisor_m2;
  readonly clock: TestClock_m2;
  readonly scheduler: ManualScheduler_m2;
  readonly spawnRequests: WorkerProcessSpawnRequest_m2[];
  readonly children: FakeWorkerChild[];
  readonly gracefulRequests: WorkerPoolMember_m2[];
  readonly faults: Error[];
  readonly leases: Map<WorkerId_m2, WorkerLeaseBirthFact_m2>;
  /** The next spawner behavior; default mints a fake child at the next pid. */
  nextSpawn: (request: WorkerProcessSpawnRequest_m2) => FakeWorkerChild;
  /** The lease probe behavior; default reads the `leases` map. */
  observeLease: (workerId: WorkerId_m2) => WorkerLeaseBirthFact_m2 | undefined;
  /** The graceful-stop channel behavior; default echoes the directive's own requestedAt (a well-behaved channel). */
  nextGracefulStop: (
    target: WorkerPoolMember_m2,
    directive: WorkerStopDirectiveContext_m2,
  ) => Promise<WorkerDurableStopReceipt_m2> | WorkerDurableStopReceipt_m2;
}


const DIRECTIVE_WRITE_VERSIONS = Object.freeze({ before: 1, after: 2 });

function stopReceipt(requestedAt: string): WorkerDurableStopReceipt_m2 {
  return Object.freeze({ requestedAt, leaseVersions: DIRECTIVE_WRITE_VERSIONS });
}

const LAUNCH = Object.freeze({
  command: "/usr/local/bin/node-worker-cli",
  prefixArgs: Object.freeze(["--import", "tsx", "src/cli.ts"]),
  cwd: "/repo/worktree",
});

function openHarness(overrides?: Readonly<{
  launchCommand?: string;
  /** `true` (default) publishes the child's lease synchronously at spawn. */
  publishLeaseOnSpawn?: boolean;
}>): Harness {
  const clock = manualClock_m2(new Date(NOW));
  const scheduler = new ManualScheduler_m2(clock, 0);
  const spawnRequests: WorkerProcessSpawnRequest_m2[] = [];
  const children: FakeWorkerChild[] = [];
  const gracefulRequests: WorkerPoolMember_m2[] = [];
  const faults: Error[] = [];
  const leases = new Map<WorkerId_m2, WorkerLeaseBirthFact_m2>();
  let nextPid = 4000;
  const publish = overrides?.publishLeaseOnSpawn ?? true;
  const harness: Harness = {
    clock,
    scheduler,
    spawnRequests,
    children,
    gracefulRequests,
    faults,
    leases,
    nextSpawn: (request): FakeWorkerChild => {
      const child = new FakeWorkerChild(nextPid += 1);
      if (publish && child.pid !== undefined) {
        leases.set(request.member.workerId, {
          processId: child.pid,
          startedAt: clock.now().toISOString(),
        });
      }
      return child;
    },
    observeLease: (workerId): WorkerLeaseBirthFact_m2 | undefined => leases.get(workerId),
    nextGracefulStop: (_target, directive): WorkerDurableStopReceipt_m2 =>
      stopReceipt(directive.requestedAt),
    supervisor: createDashboardWorkerProcessSupervisor_m2({
      launch: {
        environment: {},
        command: overrides?.launchCommand ?? LAUNCH.command,
        prefixArgs: LAUNCH.prefixArgs,
        cwd: LAUNCH.cwd,
      },
      spawn: (request) => {
        spawnRequests.push(request);
        const child = harness.nextSpawn(request);
        children.push(child);
        return child;
      },
      leases: { observe: (workerId) => harness.observeLease(workerId) },
      gracefulStop: {
        request: (target, directive) => {
          gracefulRequests.push(target);
          return harness.nextGracefulStop(target, directive);
        },
      },
      clock,
      scheduler,
      birth: { pollMs: 250, timeoutMs: 10_000 },
      proveRetirement: member => { throw new Error(`fixture native profile retirement not available: ${member.workerId}`); },
      onFault: (error) => {
        faults.push(error);
      },
    }),
  };
  return harness;
}

/* ── spawn: exact argv and birth proof ───────────────────────────────────── */

describe_m2("spawn-worker", () => {

  it_m2("derives the argv tail from the member alone", () => {
    expect_m2(workerCliArgv_m2(member(3), "00000000-0000-4000-8000-000000000003")).toEqual(["worker", "person-lookup", "--pool-index", "3", "--worker-id", "person-lookup-worker-3", "--ordinal", "3", "--membership-revision", "1", "--launch-command-id", "00000000-0000-4000-8000-000000000003"]);
  });

  it_m2("kills the child and rejects when a birth probe throws on a scheduler tick", async () => {
    const harness = openHarness({ publishLeaseOnSpawn: false });
    const target = member(1);
    const expectation = expect_m2(harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target }))
      .rejects.toThrow(/birth probe threw before proving its lease birth: lease store unreadable/);

    harness.observeLease = (): WorkerLeaseBirthFact_m2 | undefined => {
      throw new Error("lease store unreadable");
    };
    harness.clock.advanceMonotonic(250);
    const poll = harness.scheduler.pending()[0];
    if (poll === undefined) throw new Error("expected a scheduled birth poll");
    poll.fire();
    // Assert refusal before awaiting rejection so a swallowed catch fails promptly instead of hanging.
    expect_m2(harness.children[0]?.signalsSent).toEqual(["SIGKILL"]);
    expect_m2(harness.scheduler.pending()).toHaveLength(0);
    await expectation;

    // The killed child's real exit still lands as evidence and frees the slot.
    harness.children[0]?.emitExit(null, "SIGKILL");
    expect_m2(harness.supervisor.memberEvidence(target)).toMatchObject({
      state: "exited",
      outcome: "crashed",
      signal: "SIGKILL",
      reportedBy: "os",
    });
  });
});



function stopPolicy(): WorkerStopEscalationPolicy_m2 {
  return WorkerStopEscalationPolicySchema_m2.parse([
    { stage: "graceful-stop-requested", timeoutMs: WORKER_GRACEFUL_STOP_TIMEOUT_MS_m2 },
    { stage: "sigterm-sent", timeoutMs: WORKER_SIGTERM_TIMEOUT_MS_m2 },
    { stage: "sigkill-sent" },
  ]);
}

/** The kernel command's stop identity — `requestedAt` IS the command's now. */
function stopDirective(at: string): WorkerStopDirectiveContext_m2 {
  return WorkerStopDirectiveContextSchema_m2.parse({ requestedAt: at, requestedBy: "local-operator" });
}

/** A stop-worker request minted at the harness clock's current instant, as the kernel's executor would. */
function stopRequest(harness: Harness, target: WorkerPoolMember_m2): {
  command: "stop-worker";
  member: WorkerPoolMember_m2;
  escalation: WorkerStopEscalationPolicy_m2;
  directive: WorkerStopDirectiveContext_m2;
} {
  return {
    command: "stop-worker",
    member: target,
    escalation: stopPolicy(),
    directive: stopDirective(harness.clock.now().toISOString()),
  };
}

async function runningHarness(): Promise<{ harness: Harness; target: WorkerPoolMember_m2 }> {
  const harness = openHarness();
  const target = member(1);
  await harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target });
  return { harness, target };
}

describe_m2("stop-worker", () => {

  it_m2("refuses a durable requestedAt that is not the command's now, and blocks the member until exit", async () => {
    // Stop-stage instants are bounded by the command instant, not an effect-time clock read.
    const { harness, target } = await runningHarness();
    const durableAt = new Date(Date.parse(NOW) + 1234).toISOString();
    harness.nextGracefulStop = (): WorkerDurableStopReceipt_m2 => stopReceipt(durableAt);

    await expect_m2(harness.supervisor.execute(stopRequest(harness, target)))
      .rejects.toThrow(/durable requestedAt 2026-08-26T09:00:01\.234Z that is not the command's now/);
    expect_m2(harness.supervisor.memberEvidence(target)).toMatchObject({
      state: "stop-uncertain",
      cause: expect_m2.stringContaining("landed at 2026-08-26T09:00:01.234Z, not the command's now") as unknown,
    });
    await expect_m2(harness.supervisor.execute(stopRequest(harness, target)))
      .rejects.toThrow(/durable stop directive is UNCERTAIN/);
  });

  it_m2("refuses a stop whose durable request raced the child's exit, preserving the exit evidence", async () => {
    const { harness, target } = await runningHarness();
    harness.nextGracefulStop = async (): Promise<WorkerDurableStopReceipt_m2> => {
      // The child dies while the durable directive is still being requested:
      // the stop must refuse rather than record a stage over a dead child.
      harness.children[0]?.emitExit(1, null);
      return stopReceipt(harness.clock.now().toISOString());
    };

    await expect_m2(harness.supervisor.execute(stopRequest(harness, target)))
      .rejects.toThrow(/graceful stop for person-lookup-worker-1 raced: .*now exited/);
    expect_m2(harness.supervisor.memberEvidence(target)).toEqual({
      state: "exited",
      pid: harness.children[0]?.pid,
      outcome: "crashed",
      exitCode: 1,
      signal: null,
      at: NOW,
      reportedBy: "os",
      observedStop: [],
    });
    expect_m2(harness.scheduler.pending()).toHaveLength(0);
  });

  it_m2("refuses the second of two concurrent stops — the in-flight guard is synchronous", async () => {
    const { harness, target } = await runningHarness();
    harness.nextGracefulStop = async (): Promise<WorkerDurableStopReceipt_m2> => {
      await Promise.resolve();
      return stopReceipt(harness.clock.now().toISOString());
    };

    const first = harness.supervisor.execute(stopRequest(harness, target));
    const second = harness.supervisor.execute(stopRequest(harness, target));

    await expect_m2(second).rejects.toThrow(/a stop is already in flight for person-lookup-worker-1/);
    await expect_m2(first).resolves.toMatchObject({ command: "stop-worker", state: "acknowledged" });
    expect_m2(harness.gracefulRequests).toHaveLength(1);
    expect_m2(harness.supervisor.memberEvidence(target)).toMatchObject({
      state: "stopping",
      observedStop: [{ stage: "graceful-stop-requested", at: NOW }],
    });
  });

  it_m2("marks the record stop-uncertain when the durable stop channel throws — a possibly-landed directive is never masked as running", async () => {
    const { harness, target } = await runningHarness();
    harness.nextGracefulStop = (): WorkerDurableStopReceipt_m2 => {
      throw new Error("directive store unavailable");
    };

    // A throw AFTER the durable directive landed is indistinguishable from
    // one before it: the record must not revert to plain "running".
    await expect_m2(harness.supervisor.execute(stopRequest(harness, target)))
      .rejects.toThrow(/is UNCERTAIN: the durable stop channel threw \(directive store unavailable\)/);
    expect_m2(harness.supervisor.memberEvidence(target)).toEqual({
      state: "stop-uncertain",
      pid: harness.children[0]?.pid,
      bornAt: NOW,
      leaseStartedAt: NOW,
      at: NOW,
      cause: "directive store unavailable",
    });

    // A retry does NOT double-write the durable directive…
    harness.nextGracefulStop = (): WorkerDurableStopReceipt_m2 =>
      stopReceipt(harness.clock.now().toISOString());
    await expect_m2(harness.supervisor.execute(stopRequest(harness, target)))
      .rejects.toThrow(/stop-worker refused: .*durable stop directive is UNCERTAIN/);
    expect_m2(harness.gracefulRequests).toHaveLength(1);
    // …plan coverage refuses to attest a healthy member over a possibly-landed
    // stop, and pause/resume refuse the same way.
    await expect_m2(harness.supervisor.execute(planRequest(1, [target], [])))
      .rejects.toThrow(/plan-worker-count refused: .*durable stop directive is UNCERTAIN/);
    await expect_m2(harness.supervisor.execute({ command: "pause-worker", member: target }))
      .rejects.toThrow(/pause-worker refused: .*durable stop directive is UNCERTAIN/);


    harness.children[0]?.emitExit(0, null);
    harness.leases.delete(target.workerId);
    expect_m2(harness.supervisor.memberEvidence(target)).toEqual({
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

  it_m2("keeps exited/os evidence when the child exits WHILE the durable stop channel is in flight and the channel then throws — the guard is conditional on state, not unconditional", async () => {
    const { harness, target } = await runningHarness();
    const child = harness.children[0];
    if (child === undefined) throw new Error("expected a spawned child");

    harness.nextGracefulStop = (): WorkerDurableStopReceipt_m2 => {
      child.emitExit(0, null);
      throw new Error("directive store unavailable after exit");
    };

    await expect_m2(harness.supervisor.execute(stopRequest(harness, target)))
      .rejects.toThrow(/is UNCERTAIN: the durable stop channel threw \(directive store unavailable after exit\)/);

    // Never clobbered to stop-uncertain: the exit is real OS-reported evidence.
    expect_m2(harness.supervisor.memberEvidence(target)).toEqual({
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
  members: readonly WorkerPoolMember_m2[],
  excess: readonly WorkerPoolMember_m2[],
  at: string = NOW,
) {
  return {
    command: "plan-worker-count" as const,
    workflowId: WORKFLOW,
    desiredWorkers: PositiveIntSchema_m2.parse(desired),
    members,
    excessMembers: excess,
    directive: stopDirective(at),
  };
}

describe_m2("close", () => {

  it_m2("racing an in-flight stop: reports the stop-in-flight, and the directive landing after teardown arms NO escalation", async () => {
    const harness = openHarness();
    const target = member(1);
    await harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target });
    let land: ((ack: WorkerDurableStopReceipt_m2) => void) | undefined;
    harness.nextGracefulStop = (): Promise<WorkerDurableStopReceipt_m2> =>
      new Promise((resolve) => {
        land = resolve;
      });
    const pendingStop = harness.supervisor.execute(stopRequest(harness, target));
    const settled = expect_m2(pendingStop).rejects.toThrow(/interrupted by close\(\): the durable stop directive landed/);

    // close() runs while the durable stop request is still in flight — its
    // returned evidence must not hide the pending stop behind plain running.
    const live = harness.supervisor.close();
    expect_m2(live).toEqual([{
      state: "running",
      pid: harness.children[0]?.pid,
      bornAt: NOW,
      leaseStartedAt: NOW,
      stopInFlight: true,
    }]);


    if (land === undefined) throw new Error("expected the durable stop request to be in flight");
    land(stopReceipt(NOW));
    await settled;

    expect_m2(harness.scheduler.pending()).toHaveLength(0);
    expect_m2(harness.faults).toHaveLength(1);
    expect_m2(harness.faults[0]?.message).toMatch(
      /durable stop directive landed .* the supervisor closed while the request was in flight; no escalation will be armed/,
    );
    expect_m2(harness.supervisor.memberEvidence(target)).toMatchObject({
      state: "stopping",
      observedStop: [{ stage: "graceful-stop-requested", at: NOW }],
    });
  });
});
}
