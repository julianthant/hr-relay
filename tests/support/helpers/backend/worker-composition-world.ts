import { vi } from "vitest";
import * as workerLoops from "../../../../src/backend/runtime/workers/worker-loop.js";
import type { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import * as processLocks from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import type { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { once } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { statSync } from "node:fs";
import { z } from "zod";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { ActorIdSchema, WorkerIdSchema, type PositiveInt, PositiveIntSchema } from "../../../../src/rules/identity/ids.js";
import { healthyRuntimePreflightRunners } from "../../fixtures/preflight-seams.js";
import { createBoundProfileFixture, boundProfileCredentials } from "../admission-fixture.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityDatabase as FixtureDatabase } from "../synthetic-database-admission.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { bindWorkerProcessAdmission, observeRuntimeLockSnapshot } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { systemClock, type Clock, type TestClock } from "../../../../src/rules/time/clock.js";
import { WORKFLOW_ID } from "../../fixtures/phase1f-run-fixtures.js";
import { duoCeremonyGatesOver } from "../duo-ceremony-fixtures.js";
import { ManualScheduler, type SessionFactoryHarness } from "../phase1f-executor-harness.js";



export function createWorkerCompositionTestWorld() {
  const profiles = new Map<string, ReturnType<typeof createBoundProfileFixture>>();

  const openDatabases: AuthorityDatabase[] = [];

  const NOW = "2026-08-03T09:00:00.000Z";

  const POOL_INDEX_1 = PositiveIntSchema.parse(1);

  function owner(root: string) {
    const fixture = profiles.get(root) ?? [...profiles.values()].find(value => value.stateRoot === root);
    if (fixture === undefined) throw new Error("worker fixture owner not issued");
    return fixture;
  }
  function repoRootWithState() {
    const fixture = createBoundProfileFixture({ sharedMachine: true });
    const repoRoot = fixture.workspace, stateRoot = fixture.stateRoot;
    profiles.set(repoRoot, fixture);
    writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "worker-composition-fixture", version: "0.1.0", type: "module" }));
    return { repoRoot, stateRoot, fixture };
  }
  function open(root: string, clock: TestClock) {
    const fixture = owner(root);
    return FixtureDatabase.open({ path: fixture.path, busyTimeoutMs: 250, migrationOwner: "worker-composition-fixture" },
      clock, undefined, undefined, undefined, boundProfileCredentials(fixture.admission));
  }
  function resolvedSettings(stateRoot: string, clock: TestClock) {
    const database = open(stateRoot, clock), fixture = owner(stateRoot);
    try { return resolveConfigWithProvenance(readSettings(database.authority).settings, hostConfigFacts({}), clock,
      { stateRoot, artifactRoot: fixture.admission.artifactRoot }); }
    finally { database.close(); }
  }
  function processLockRoot(stateRoot: string) { return join(owner(stateRoot).workspace, rebuildRuntimeIsolation.processLockRoot); }
  function stateRootFor(repoRoot: string) { return owner(repoRoot).stateRoot; }
  function profileAdmission(repoRoot: string) { return owner(repoRoot).admission; }
  function databaseDescriptors(stateRoot: string) {
    const path = owner(stateRoot).path;
    const result = spawnSync("lsof", ["-nP", "-a", "-p", String(process.pid), "-Fn"], { encoding: "utf8" });
    assert.equal(result.status, 0, "actual fixture process file observation must succeed");
    assert.equal(result.stderr, "");
    return result.stdout.split("\n").filter(line => [path, path + "-wal", path + "-shm"].some(file => line === "n" + file));
  }
  function closeDatabases() { for (const database of openDatabases.splice(0)) database.close(); }

  function seedQueuedRun(
    stateRoot: string,
    clock: TestClock,
    run: Record<string, unknown>,
    resolved = resolvedSettings(stateRoot, clock),
  ): void {
    const database = open(stateRoot, clock);
    try {
      const parsedRun = RunRecordSchema.parse(run);
      database.withAuthorityTransaction((repositories) => {
        const retained = repositories.configSnapshots.get(parsedRun.envelope.configSnapshotId);
        const configSnapshotId = retained === undefined ? parsedRun.envelope.configSnapshotId : randomUUID();
        const snapshot = {
          configSnapshotId,
          revision: readSettings(repositories).revision,
          fingerprint: resolved.fingerprint,
          capturedAt: clock.now().toISOString(),
          capturedBy: "local-operator",
          config: resolved.config,
          provenance: resolved.provenance,
        };
        if (repositories.runtimeConfig.get() === undefined) {
          repositories.runtimeConfig.initialize(snapshot);
        } else assert.equal(repositories.configSnapshots.insert(snapshot).state, "inserted");
        if (retained !== undefined) assert.deepEqual(repositories.configSnapshots.get(parsedRun.envelope.configSnapshotId), retained);
        assert.equal(repositories.runs.enqueue({
          ...parsedRun,
          envelope: { ...parsedRun.envelope, configSnapshotId, configFingerprint: resolved.fingerprint },
        }).state, "inserted");
      });
      const queued = database.authority.runs.get(parsedRun.envelope.runId); assert.ok(queued);
      createTimelineEmitter({ repository: database.authority.timelineEvents, clock }).emit(runQueuedSpanEvent({
        run: queued, actorId: ActorIdSchema.parse("local-operator"), title: "Synthetic queued worker fixture",
      }));
    } finally {
      database.close();
    }
  }

  function reopen(stateRoot: string, clock: TestClock): AuthorityDatabase {
    const database = open(stateRoot, clock);
    openDatabases.push(database);
    return database;
  }

  function ensureBaselineRuntimeConfig(repoRoot: string, clock: TestClock): void {
    const fixture = owner(repoRoot);
    const database = open(repoRoot, clock);
    try {
      database.withAuthorityTransaction((repositories) => {
        if (repositories.runtimeConfig.get() !== undefined) return;
        const resolved = resolveConfigWithProvenance(readSettings(repositories).settings, hostConfigFacts({}), clock, { stateRoot: fixture.stateRoot, artifactRoot: fixture.admission.artifactRoot });
        const configSnapshotId = "66666666-6666-4666-8666-666666666666";
        repositories.runtimeConfig.initialize({
          configSnapshotId,
          revision: readSettings(repositories).revision,
          fingerprint: resolved.fingerprint,
          capturedAt: clock.now().toISOString(),
          capturedBy: "local-operator",
          config: resolved.config,
          provenance: resolved.provenance,
        });
      });
    } finally {
      database.close();
    }
  }

  function composeInput(options: Readonly<{
    repoRoot: string;
    clock: TestClock;
    sessions: SessionFactoryHarness;
    poolIndex: PositiveInt;
    processId?: number;
    args?: readonly string[];
    stopSignal?: AbortSignal;
    lines?: string[];
  }>) {
    ensureBaselineRuntimeConfig(options.repoRoot, options.clock);
    return {
      preflightRunnerFactory: healthyRuntimePreflightRunners,
      isolation: rebuildRuntimeIsolation,
      args: options.args ?? [WORKFLOW_ID, "--pool-index", String(options.poolIndex), "--drain"],
      env: {},
      clock: options.clock,
      ids: { uuid: randomUUID },
      admission: owner(options.repoRoot).machine,
      repoRoot: options.repoRoot,
      processId: options.processId ?? process.pid,
      sessionFactory: options.sessions.factory,
      duoCeremony: duoCeremonyGatesOver(reopen(owner(options.repoRoot).stateRoot, options.clock), options.clock, new ManualScheduler(options.clock)),
      stopSignal: options.stopSignal ?? new AbortController().signal,
      // Long enough that no scheduled beat fires during a test; the boot beat is
      // synchronous, so the lease/sweep path is still exercised.
      heartbeatIntervalMs: 600_000,
      sweepIntervalMs: 600_000,
      write: (line: string): void => {
        options.lines?.push(line);
      },
    } as const;
  }
  function captureSyntheticClosure(repoRoot: string, clock: TestClock, createStore: typeof createCredentialStore) {
    const fixture = owner(repoRoot);
    const before = observeRuntimeLockSnapshot({ processLockRoot: processLockRoot(fixture.stateRoot),
      sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(fixture.path) }, clock);
    assert.equal(before.processLocks.workers.state, "stopped");
    let issued: RuntimeAdmission | undefined, store: ReturnType<typeof createCredentialStore> | undefined;
    let processLock: processLocks.RuntimeProcessLockHandle | undefined, database: AuthorityDatabase | undefined;
    let report: workerLoops.WorkerLoopReport | undefined;
    let descriptorsObserved = false;
    const bind = processLocks.bindWorkerProcessAdmission, loop = workerLoops.runWorkerLoop;
    const bindSpy = vi.spyOn(processLocks, "bindWorkerProcessAdmission").mockImplementation(<T>(input: Parameters<typeof bind<T>>[0]) => {
      assert.equal(input.authorityPath, fixture.path);
      const value = bind(input); processLock = value.processLock; return value;
    });
    const loopSpy = vi.spyOn(workerLoops, "runWorkerLoop").mockImplementation(async (...args) => {
      report = await loop(...args); return report;
    });
    const snapshot = () => observeRuntimeLockSnapshot({ processLockRoot: processLockRoot(fixture.stateRoot),
      sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(fixture.path) }, clock);
    return {
      createStore(options: Parameters<typeof createCredentialStore>[0]) {
        assert.equal(options.stateRoot, fixture.stateRoot);
        issued = options.admission; store = createStore(options); return store;
      },
      openDatabase(options: unknown, openClock: Clock) {
        assert.ok(issued); assert.ok(store);
        database = AuthorityDatabase.open(issued, options, openClock, undefined, undefined, undefined, store);
        descriptorsObserved = databaseDescriptors(fixture.stateRoot).length > 0;
        assert.equal(descriptorsObserved, true);
        return database;
      },
      get report() { return report; },
      assertHeld() {
        assert.ok(issued); issued.assertLive(); assert.ok(processLock); assert.ok(database);
        assert.equal(descriptorsObserved, true);
        assert.deepEqual(snapshot().processLocks.workers, { state: "active",
          generation: before.processLocks.workers.generation + 2, pid: process.pid });
        fixture.machine.assertLive();
      },
      async closeAfterSyntheticFailure(resourceCloses: readonly (() => Promise<unknown>)[]) {
        this.assertHeld();
        const results = await Promise.allSettled(resourceCloses.map(async close => close()));
        const failures = results.flatMap(result => result.status === "rejected" ? [result.reason as unknown] : []);
        if (failures.length > 0) throw new AggregateError(failures, "fixture resource closure remained unproved");
        assert.ok(database); database.close(); closeDatabases();
        assert.equal(databaseDescriptors(fixture.stateRoot).length, 0);
        assert.ok(issued); issued.release(); assert.ok(processLock); processLock.release();
        assert.deepEqual(snapshot().processLocks.workers, { state: "stopped",
          generation: before.processLocks.workers.generation + 2 });
      },
      restore() { loopSpy.mockRestore(); bindSpy.mockRestore(); },
    };
  }
  async function workerLifetime(stateRoot: string, clock: TestClock, workerIdInput: string) {
    const workerId = WorkerIdSchema.parse(workerIdInput), database = reopen(stateRoot, clock);
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", env: {} });
    await once(child, "spawn");
    assert.ok(child.pid);
    const exited = once(child, "exit");
    const crash = async () => {
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await exited; }
      assert.ok(child.exitCode !== null || child.signalCode !== null);
    };
    let processLock: processLocks.RuntimeProcessLockHandle | undefined;
    try {
      const bound = bindWorkerProcessAdmission({ processLockRoot: processLockRoot(stateRoot), authorityPath: owner(stateRoot).path,
        workerId, pid: child.pid, clock, open: () => database, admit: () => workerId, close: value => value.close() });
      processLock = bound.processLock;
      const started = database.startOwnedWorker({ workerId, workflow: WORKFLOW_ID, browserSystems: ["crm", "ucpath"],
        processId: child.pid, requestedBy: "local-operator", now: clock.now().toISOString() }, bound.processLock);
      assert.equal(started.state, "started");
      if (started.state !== "started") throw new Error("worker-fixture-birth-refused");
      const close = async () => {
        const lease = database.authority.workerLeases.get(workerId); assert.ok(lease);
        if (lease.lifecycle.state !== "stopped") {
          const now = clock.now().toISOString();
          assert.equal(database.authority.workerLeases.control({ workerId, expectedVersion: lease.version,
            control: { directive: "stop", requestedAt: now, requestedBy: "local-operator" }, now }).state, "applied");
          for (const state of ["stopping", "stopped"] as const) {
            assert.equal(database.authority.workerLeases.reportLifecycle({ workerId, leaseGeneration: lease.leaseGeneration,
              lifecycle: state === "stopped" ? { state, startedAt: lease.lifecycle.startedAt, stoppedAt: now, reason: "shutdown" }
                : { state, startedAt: lease.lifecycle.startedAt, heartbeatAt: now }, now }).state, "applied");
          }
        }
        await crash(); bound.processLock.release();
      };
      return { pid: child.pid, lease: started.lease, crash, close };
    } catch (error) {
      try { await crash(); processLock?.release(); }
      catch (closeError) { throw new AggregateError([error, closeError], "worker lifetime startup cleanup failed", { cause: closeError }); }
      throw error;
    }
  }
  async function concurrentWorkers(repoRoot: string, clock: TestClock) {
    const children: ChildProcess[] = [], exits: Promise<unknown[]>[] = [];
    const replies: Promise<unknown[]>[] = [];
    const message = z.strictObject({ state: z.enum(["ready", "report", "failed"]), detail: z.string() });
    const fixture = owner(repoRoot), expected = statSync(fixture.path), database = open(repoRoot, clock);
    const active = database.authority.runtimeConfig.get(); assert.ok(active);
    const settingsRevision = readSettings(database.authority).revision; database.close();
    const report = z.strictObject({ pid: z.number().int().positive(), profileId: z.uuid(), databaseIdentity: z.string(),
      device: z.number(), inode: z.number(), configFingerprint: z.string(), settingsRevision: z.number().int().positive(),
      workerId: z.string(), outcomes: z.array(z.string()), closure: z.literal("proved"), stopped: z.literal("idle") });
    let failure: unknown;
    let reports: z.infer<typeof report>[] = [];
    try {
      for (const index of [1, 2, 3]) {
        const child = spawn(process.execPath, ["--import", "tsx", join(process.cwd(), "tests/support/processes/worker-composition-child.ts"),
          repoRoot, String(index), clock.now().toISOString()], { cwd: process.cwd(), stdio: ["ignore", "ignore", "ignore", "ipc"] });
        children.push(child);
        const exited = once(child, "exit"); exits.push(exited);
        const ready = message.parse((await Promise.race([once(child, "message"), exited.then(() => { throw new Error("worker fixture exited before ready"); })]))[0]);
        assert.equal(ready.state, "ready");
        assert.equal(z.strictObject({ pid: z.number().int().positive() }).parse(JSON.parse(ready.detail)).pid, child.pid);
        replies.push(Promise.race([once(child, "message"), exited.then(() => { throw new Error("worker fixture exited before report"); })]));
      }
      for (const child of children) child.send("run");
      reports = await Promise.all(replies.map(async (reply, index) => {
        const result = message.parse((await reply)[0]); assert.equal(result.state, "report");
        const value = report.parse(JSON.parse(result.detail));
        assert.equal(value.pid, children[index]?.pid); assert.equal(value.profileId, fixture.admission.profileBinding.profileId);
        assert.equal(value.databaseIdentity, AuthorityDatabase.sourceDatabaseIdentity(fixture.path));
        assert.equal(value.device, expected.dev); assert.equal(value.inode, expected.ino);
        assert.equal(value.configFingerprint, active.configFingerprint); assert.equal(value.settingsRevision, settingsRevision);
        return value;
      }));
      assert.equal(new Set(reports.map(value => value.pid)).size, 3);
      for (const exit of exits) assert.deepEqual(await exit, [0, null]);
    } catch (error) { failure = error; }
    const cleanupFailures: unknown[] = [];
    for (const [index, child] of children.entries()) {
      try {
        if (child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await exits[index]; }
      } catch (error) { cleanupFailures.push(error); }
    }
    if (failure !== undefined || cleanupFailures.length > 0) throw new AggregateError([...(failure === undefined ? [] : [failure]), ...cleanupFailures], "worker fixture children failed");
    return reports;
  }
  const cleanup = () => {
    for (const fixture of profiles.values()) {
      const snapshot = observeRuntimeLockSnapshot({ processLockRoot: processLockRoot(fixture.stateRoot),
        sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(fixture.path) }, systemClock);
      assert.equal(snapshot.processLocks.workers.state, "stopped", "unproved fixture worker custody must be retained");
    }
    closeDatabases();
    for (const [root, fixture] of profiles) { fixture.close(); profiles.delete(root); }
  };
  return { openDatabases, NOW, POOL_INDEX_1, repoRootWithState, seedQueuedRun, reopen, ensureBaselineRuntimeConfig,
    resolvedSettings, processLockRoot, profileAdmission, stateRootFor, captureSyntheticClosure, workerLifetime, concurrentWorkers, databaseDescriptors, closeDatabases, composeInput, cleanup };
}
