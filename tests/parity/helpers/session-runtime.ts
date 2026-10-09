import { healthyRuntimePreflightRunners } from "../../support/fixtures/preflight-seams.js";
/** Private 3.1.11 runtime: real BFF, child and Chromium, synthetic transaction-free drivers. */
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { cpSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { composeDashboardRuntime, type DashboardRuntime } from "../../../src/backend/app/composition/dashboard/compose.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";
import { WorkerProcessLockFileSchema } from "../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { systemClock } from "../../../src/rules/time/clock.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { CommandResultSchema } from "../../../src/rules/commands/commands.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../src/models/config/settings.js";
import { RunRecordSchema } from "../../../src/models/run/record.js";
import { ActorIdSchema } from "../../../src/rules/identity/ids.js";
import { deriveTraceId } from "../../../src/rules/identity/identifiers.js";
import { createTimelineEmitter } from "../../../src/backend/storage/events/timeline-emitter.js";
import { runQueuedSpanEvent } from "../../../src/backend/runs/commands/run-queued-span.js";
import { personLookupQueuedRun } from "../../support/helpers/phase1f-executor-harness.js";
import { PARITY_DIST_DIR, ensureParityBundle } from "./bundle.js";

export async function sessionRuntime() {
  ensureParityBundle();
  const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-sessions-ui-"));
  const children: ChildProcess[] = []; const logs: string[] = [];
  let runtime: DashboardRuntime | undefined; let database: AuthorityDatabase | undefined;
  const workerId = "person-lookup-worker-1";
  const wait = async (predicate: () => boolean) => {
    const deadline = Date.now() + 20_000;
    while (!predicate()) { if (Date.now() > deadline) throw new Error(`Session fixture deadline: ${logs.join("")}`); await new Promise((resolve) => setTimeout(resolve, 25)); }
  };
  async function close() {
    const failures: unknown[] = [];
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    for (const child of children) {
      try {
        await wait(() => child.exitCode !== null || child.signalCode !== null);
        assert.ok(child.pid);
        await wait(() => !execFileSync("ps", ["-eo", "pgid="], { encoding: "utf8" }).split("\n").some((line) => Number(line.trim()) === child.pid));
        assert.deepEqual(JSON.parse(readFileSync(join(root, `cleanup-${String(child.pid)}.json`), "utf8")), { openContexts: 0, failures: 0 });
      } catch (error) {
        failures.push(error);
        if (child.pid !== undefined) try { process.kill(-child.pid, "SIGKILL"); } catch (killError) { failures.push(killError); }
      }
    }
    try { await runtime?.stop(); } catch (error) { failures.push(error); }
    try { database?.close(); } catch (error) { failures.push(error); }
    try {
      const locks = join(root, rebuildRuntimeIsolation.processLockRoot, "workers");
      if (existsSync(locks)) for (const name of readdirSync(locks)) if (name.endsWith(".lock.json")) {
        assert.notEqual(WorkerProcessLockFileSchema.parse(JSON.parse(readFileSync(join(locks, name), "utf8"))).releasedAt, null);
      }
    } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, `Retained failed UI fixture ${root}`);
    process.stdout.write(`[sessions-ui-cleanup] ${JSON.stringify({ root, pids: children.map((child) => child.pid), survivors: 0, openContexts: 0, workerLocks: "released" })}\n`);
    rmSync(root, { recursive: true, force: true });
  }
  try {
    for (const name of ["package.json", "package-lock.json", "vite.dashboard.config.ts", "tsconfig.json"]) copyFileSync(name, join(root, name));
    cpSync(join(process.cwd(), "src"), join(root, "src"), { recursive: true });
    mkdirSync(join(root, "dist")); cpSync(PARITY_DIST_DIR, join(root, "dist/dashboard"), { recursive: true });
    writeFileSync(join(root, "release-drivers"), "released\n");
    runtime = await composeDashboardRuntime({ preflightRunnerFactory: healthyRuntimePreflightRunners, repoRoot: root, isolation: rebuildRuntimeIsolation, frontend: "built-bundle", backendPortOverride: 0, frontendPortOverride: 0, env: {},
      workerProcess: { launch: { environment: {}, command: process.execPath,
        prefixArgs: ["--import", "tsx", join(process.cwd(), "tests/support/processes/worker-browser-control-cli.ts"), root], cwd: process.cwd() },
      spawn: (request) => {
        const child = spawn(request.command, [...request.args], { cwd: request.cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] }); children.push(child);
        child.stdout?.on("data", (chunk) => logs.push(String(chunk))); child.stderr?.on("data", (chunk) => logs.push(String(chunk)));
        return { pid: child.pid, kill: (signal) => child.kill(signal), onExit: (listener) => { child.on("exit", listener); }, onError: (listener) => { child.on("error", listener); } };
      }, birth: { pollMs: 25, timeoutMs: 20_000 }, faultSink: (line) => logs.push(line) } });
    const baseUrl = `http://127.0.0.1:${String(runtime.port)}`;
    const command = async (request: Record<string, unknown>) => {
      const response = await fetch(`${baseUrl}/api/v1/commands`, { method: "POST", headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ commandId: randomUUID(), requestedAt: systemClock.now().toISOString(), requestedBy: "local-operator", source: "dashboard", ...request }) });
      const result = CommandResultSchema.parse(await response.json()); assert.equal(result.state, "applied", JSON.stringify(result)); return result;
    };
    const patch = { "daemon.idleRepollMs": { set: 100 } };
    await command({ family: "settings", type: "apply-settings", target: { expectedRevision: 1 }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
    const db = AuthorityDatabase.open({ path: join(root, rebuildRuntimeIsolation.stateRoot, "state.db"), busyTimeoutMs: 5000, migrationOwner: "sessions-ui-proof" }, systemClock); database = db;
    await command({ family: "worker-browser", type: "plan-worker-count", target: { workflowId: "person-lookup", expectedVersion: 0 }, payload: { desiredWorkers: 1 } });
    await command({ family: "worker-browser", type: "spawn-worker", target: { workflowId: "person-lookup", expectedVersion: 1 }, payload: { workerId } });
    const active = db.authority.runtimeConfig.get(); assert.ok(active);
    const runId = randomUUID(); const enqueuedAt = systemClock.now().toISOString();
    const candidate = RunRecordSchema.parse(personLookupQueuedRun({ runId, itemId: randomUUID(), dryRun: true }));
    const run = RunRecordSchema.parse({ ...candidate, createdAt: enqueuedAt, updatedAt: enqueuedAt, envelope: { ...candidate.envelope,
      traceId: deriveTraceId("pl", runId, systemClock), enqueuedAt, configSnapshotId: active.configSnapshotId, configFingerprint: active.configFingerprint } });
    db.withAuthorityTransaction((r) => {
      assert.equal(r.runs.enqueue(run).state, "inserted");
      createTimelineEmitter({ repository: r.timelineEvents, clock: systemClock }).emit(runQueuedSpanEvent({ run, actorId: ActorIdSchema.parse("local-operator"), title: "Synthetic session UI proof" }));
    });
    await wait(() => db.authority.runs.get(runId)?.lifecycle.state === "terminal");
    const terminal = db.authority.runs.get(runId); assert.ok(terminal?.lifecycle.state === "terminal" && terminal.lifecycle.outcome === "done");
    await wait(() => db.authority.workerLeases.get(workerId)?.lifecycle.state === "idle");
    return { baseUrl, root, workerId, db, close, runId };
  } catch (error) { try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "session UI startup and cleanup failed", { cause: cleanup }); } throw error; }
}
