import { installationAdmission, releaseAdmissionFixtures } from "../../../../../support/helpers/admission-fixture.js";
import { healthyRuntimePreflightRunners } from "../../../../../support/fixtures/preflight-seams.js";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { createTimelineEmitter } from "../../../../../../src/backend/storage/events/timeline-emitter.js";
import { runQueuedSpanEvent } from "../../../../../../src/backend/runs/commands/run-queued-span.js";
import { ActorIdSchema } from "../../../../../../src/rules/identity/ids.js";
import { deriveTraceId } from "../../../../../../src/rules/identity/identifiers.js";
import { systemClock } from "../../../../../../src/rules/time/clock.js";
import { rebuildRuntimeIsolation } from "../../../../../../src/backend/app/config/runtime-isolation.js";
import { RunRecordSchema } from "../../../../../../src/models/run/record.js";
import { CommandResultSchema } from "../../../../../../src/rules/commands/commands.js";
import { AuthorityDatabase } from "../../../../../support/helpers/admission-fixture.js";
import { assertWorkerProcessStopped } from "../../../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { composeDashboardRuntime, type DashboardRuntime } from "../../../../../../src/backend/app/composition/dashboard/compose.js";
import type { WorkerProcessSpawner } from "../../../../../../src/backend/runtime/workers/worker-supervisor.js";
import { personLookupQueuedRun } from "../../../../../support/helpers/phase1f-executor-harness.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../../../src/models/config/settings.js";

async function waitFor(test: () => boolean, message: string, diagnostics: () => string) {
  const deadline = systemClock.monotonicMs() + 25_000;
  while (!test()) { if (systemClock.monotonicMs() > deadline) throw new Error(`${message}\n${diagnostics()}`); await new Promise(resolve => setTimeout(resolve, 25)); }
}

it("retires a real worker only after its opened Chromium profile closes, custody releases and the slot directory is deleted", async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "native-profile-retirement-"));
  copyFileSync("package.json", join(root, "package.json"));
  copyFileSync("package-lock.json", join(root, "package-lock.json"));
  const output: string[] = [], children: ChildProcess[] = [], runIds: string[] = [];
  const failures: unknown[] = [];
  let runtime: DashboardRuntime | undefined, database: AuthorityDatabase | undefined;
  const diagnostics = () => output.join("") + JSON.stringify({ runs: runIds.map(id => database?.authority.runs.get(id)), leases: database?.authority.workerLeases.listLive(), browsers: database?.authority.workerControls.browsers("person-lookup-worker-2") });
  const spawnWorker: WorkerProcessSpawner = request => {
    const child = spawn(request.command, [...request.args], { cwd: request.cwd, stdio: ["ignore", "pipe", "pipe"], detached: true });
    children.push(child); child.stdout?.on("data", chunk => output.push(String(chunk))); child.stderr?.on("data", chunk => output.push(String(chunk)));
    return { pid: child.pid, kill: signal => child.kill(signal), onExit: listener => { child.on("exit", listener); }, onError: listener => { child.on("error", listener); } };
  };
  try {
    runtime = await composeDashboardRuntime({ admission: installationAdmission(root), preflightRunnerFactory: healthyRuntimePreflightRunners, isolation: rebuildRuntimeIsolation, backendPortOverride: 0, frontendPortOverride: 0, env: {}, repoRoot: root,
      workerProcess: { launch: { environment: {}, command: process.execPath, prefixArgs: ["--import", "tsx", join(process.cwd(), "tests/support/processes/worker-browser-control-cli.ts"), root], cwd: process.cwd() }, spawn: spawnWorker, birth: { pollMs: 25, timeoutMs: 20_000 }, faultSink: line => output.push(line) } });
    const origin = `http://127.0.0.1:${String(runtime.port)}`, patch = { "daemon.idleRepollMs": { set: 100 } };
    const settings = await fetch(`${origin}/api/v1/commands`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ commandId: randomUUID(), family: "settings", type: "apply-settings", target: { expectedRevision: 1 }, source: "dashboard", requestedBy: "local-operator", requestedAt: systemClock.now().toISOString(), payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } }) });
    assert.equal(CommandResultSchema.parse(await settings.json()).state, "applied");
    const db = AuthorityDatabase.open({ path: join(root, rebuildRuntimeIsolation.stateRoot, "state.db"), busyTimeoutMs: 5000, migrationOwner: "native-retirement-proof" }, systemClock); database = db;
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
    const slotDirectory = join(root, rebuildRuntimeIsolation.browserProfileRoot, `w${String(slot.ordinal)}`);
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
    writeFileSync(join(root, "release-drivers"), "fixture released");
    await resizing;
    assert.ok(children.every(child => child.exitCode !== null || child.signalCode !== null));
    assert.ok(db.authority.workerControls.browsers(slot.workerId).every(browser => browser.health === "closed"));
    assertWorkerProcessStopped(join(root, rebuildRuntimeIsolation.processLockRoot), slot.workerId);
    assert.equal(existsSync(slotDirectory), false, "retirement acknowledgement requires deletion of the opened slot profile");
    assert.ok(db.authority.workerSlots.get(slot.workerId)?.retiredAt);
    for (const child of children) { assert.ok(child.pid); assert.deepEqual(JSON.parse(readFileSync(join(root, `cleanup-${String(child.pid)}.json`), "utf8")), { openContexts: 0, failures: 0 }); }
  } catch (error) { failures.push(error); }
  finally {
    writeFileSync(join(root, "release-drivers"), "cleanup released");
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    for (const child of children) try { await waitFor(() => child.exitCode !== null || child.signalCode !== null, "owned child cleanup did not exit", diagnostics); } catch (error) { failures.push(error); if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL"); }
    try { await runtime?.stop(); } catch (error) { failures.push(error); }
    database?.close(); releaseAdmissionFixtures();
    if (failures.length === 0) rmSync(root, { recursive: true, force: true });
  }
  if (failures.length > 0) throw new AggregateError(failures, `native retirement proof failed; retained ${root}\n${output.join("")}`);
}, 90_000);
