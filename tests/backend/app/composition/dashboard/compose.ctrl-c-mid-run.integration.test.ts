import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { RuntimeLifetimeLock } from "../../../../../src/backend/storage/admission/lifetime-lock.js";
import { StoppedAuthorityBackupManifestSchema } from "../../../../../src/backend/storage/sqlite/recovery-contracts.js";
import { ApplicationLifecycleSchema } from "../../../../../src/models/dashboard/application-lifecycle.js";
import { DashboardDayWireSchema } from "../../../../../src/models/dashboard/projection.js";
import { StartPlanWireSchema } from "../../../../../src/models/dashboard/start-plan.js";
import { PublicProfileStateSchema } from "../../../../../src/models/profiles/public-profile.js";
import { CommandResultSchema } from "../../../../../src/rules/commands/commands.js";
import { localDatePart, systemClock } from "../../../../../src/rules/time/clock.js";
import { testProcessImport } from "../../../../support/compiled-process.js";
import { createBoundProfileFixture } from "../../../../support/helpers/admission-fixture.js";
import { credentialKeychainTestEnvironment } from "../../../../support/helpers/credential-keychain-fake.js";
import { EXECUTOR_EID } from "../../../../support/helpers/phase1f-executor-harness.js";
import { scaledMs } from "../../../../support/time-scale.js";

const CHILD = join(process.cwd(), "tests", "support", "processes", "dashboard-signal-child.ts");
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const step of cleanups.splice(0).reverse()) await step(); }, 30_000);

const RESERVED_PORTS = [3938, 3939, 5174];
const CUSTODY_FAULTS = /RUNTIME_CUSTODY_UNCERTAIN|WORKER_EXIT_UNOBSERVED|custody-unproved|WORKER_SUPERVISOR_FAILED/u;

async function until<T>(read: () => T | undefined, what: string, diagnostics: () => string, timeoutMs = 60_000): Promise<T> {
  const deadline = systemClock.monotonicMs() + scaledMs(timeoutMs);
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (systemClock.monotonicMs() > deadline) throw new Error(`timed out waiting for ${what}\n${diagnostics()}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ESRCH") return false; throw error; }
}

async function startDashboard(processGroup = false, fault?: "stream-close" | "stream-close-unproved" | "transport-close" | "worker-stop") {
  const f = await createBoundProfileFixture();
  cleanups.push(() => f.close());
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(f.workspace, name));
  await f.closeController();
  const barrier = mkdtempSync(join(tmpdir(), "relay-signal-barrier-"));
  cleanups.push(() => { rmSync(barrier, { recursive: true, force: true }); });
  const child: ChildProcess = spawn(process.execPath, ["--conditions=development", "--import", testProcessImport(), CHILD, f.workspace, barrier, ...(fault ? [fault] : [])],
    { detached: processGroup, cwd: process.cwd(), env: credentialKeychainTestEnvironment(process.env), stdio: ["ignore", "pipe", "pipe"] });
  cleanups.push(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => { child.once("close", (code, signal) => { resolve({ code, signal }); }); });
  const markers = () => readdirSync(barrier);
  const history = () => {
    if (!existsSync(f.path)) return [];
    const raw = new DatabaseSync(f.path, { readOnly: true });
    try { return raw.prepare("SELECT lifecycle_json AS lifecycle FROM runs").all().map(row => String(row.lifecycle)); } finally { raw.close(); }
  };
  const spool = join(f.workspace, ".tracker", "data", "logs", "boot.jsonl");
  const diagnostics = () => JSON.stringify({ output, spool: existsSync(spool) ? readFileSync(spool, "utf8") : undefined, markers: markers(), exitCode: child.exitCode, lifecycles: history() });
  const port = Number(await until(() => /dashboard BFF listening on 127\.0\.0\.1:(\d+)/u.exec(output)?.[1], "the dashboard listener", diagnostics));
  const lockPort = Number(/LIFETIME LOCK (\d+)/u.exec(output)?.[1]);
  for (const owned of [port, lockPort]) assert.ok(Number.isInteger(owned) && owned > 0 && !RESERVED_PORTS.includes(owned), diagnostics());

  const origin = `http://127.0.0.1:${String(port)}`;
  const post = (route: string, body: unknown, credential?: string) => fetch(`${origin}/api/v1/${route}`, { method: "POST",
    headers: { origin, "content-type": "application/json", ...(credential === undefined ? {} : { "x-relay-session": credential }) }, body: JSON.stringify(body) });
  const signIn = await post("profile/sign-in", { email: "fixture@ucsd.edu", password: "disposable-fixture-password" });
  assert.equal(PublicProfileStateSchema.parse(await signIn.json()).state, "active");
  const credential = signIn.headers.get("x-relay-session") ?? undefined; assert.ok(credential);
  return { f, barrier, child, exited, markers, diagnostics, post, origin, credential, lockPort, output: () => output };
}

/** The dashboard process with one fixture worker whose first UCPath search holds on the barrier; Ctrl+C arrives while that run is inside its step.
 * Shutdown holds admission and pauses every live run before it stops the worker; the pause cancels the held step, so the run parks while its search is still pending. */
async function interruptMidRun(emplIds: readonly string[]) {
  const { f, barrier, child, exited, markers, diagnostics, post, credential, output, lockPort } = await startDashboard();
  const plan = StartPlanWireSchema.parse(await (await post("start-plans", { workflowId: "person-lookup", submissions: emplIds.map(emplId => ({ emplId })), dryRun: false }, credential)).json());
  assert.deepEqual(plan.refused, []);
  const started = CommandResultSchema.parse(await (await post("commands", { commandId: randomUUID(), family: "start", type: "start-run", requestedAt: systemClock.now().toISOString(),
    requestedBy: "local-operator", source: "run-start", target: { workflowId: plan.workflowId, startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion },
    payload: plan.fingerprints }, credential)).json());
  assert.ok(started.state === "applied" && started.workerStartup === undefined, JSON.stringify(started));

  const entered = await until(() => markers().find(name => name.startsWith("entered-")), "the run to enter its held step", diagnostics);
  const workerPid = Number(entered.slice("entered-".length));
  const runs = () => {
    const raw = new DatabaseSync(f.path, { readOnly: true });
    try {
      return raw.prepare("SELECT state, outcome, owner_worker_id AS owner, claim_generation AS generation, json_extract(lifecycle_json,'$.pause.state') AS pause, updated_at AS updatedAt FROM runs").all()
        .map(row => ({ state: String(row.state), outcome: row.outcome === null ? null : String(row.outcome), owner: row.owner === null ? null : String(row.owner),
          generation: Number(row.generation), pause: row.pause === null ? null : String(row.pause), updatedAt: String(row.updatedAt) })).toSorted((left, right) => left.state.localeCompare(right.state));
    } finally { raw.close(); }
  };
  assert.deepEqual(runs().map(run => run.state), [...emplIds.slice(1).map(() => "queued"), "running"]);

  const interruptedAt = systemClock.now().toISOString();
  assert.equal(child.kill("SIGINT"), true);
  await until(() => markers().find(name => name === `stop-shutdown-${String(workerPid)}`), "the parent's worker-stop", diagnostics);
  await until(() => runs().every(run => run.state === "queued") || undefined, "the held run to park before its search returns", diagnostics);
  writeFileSync(join(barrier, "release"), "");
  const deadline = Promise.withResolvers<never>();
  const timer = setTimeout(() => { deadline.reject(new Error(`dashboard did not exit\n${diagnostics()}`)); }, scaledMs(90_000));
  const exit = await Promise.race([exited, deadline.promise]).finally(() => clearTimeout(timer));

  assert.deepEqual(exit, { code: 0, signal: null }, diagnostics());
  const firstPhase = output().indexOf('"phase":"closing transport"');
  const firstStop = output().indexOf("Sending worker stop");
  assert.ok(firstPhase >= 0 && firstStop > firstPhase, "shutdown must be visible before the worker stop is sent");
  assert.doesNotMatch(output(), CUSTODY_FAULTS);
  assert.ok(markers().includes(`exit-0-${String(workerPid)}`), `the worker exits on its stop: ${diagnostics()}`);
  assert.equal(pidAlive(workerPid), false);
  const raw = new DatabaseSync(f.path, { readOnly: true });
  try { assert.equal(raw.prepare("SELECT count(*) AS count FROM write_intents").get()?.count, 0); } finally { raw.close(); }

  const directory = join(f.stateRoot, "backups", "authority");
  const names = readdirSync(directory).filter(name => name.endsWith(".shutdown.sqlite.manifest.json"));
  assert.equal(names.length, 1, JSON.stringify(readdirSync(directory)));
  const manifest = StoppedAuthorityBackupManifestSchema.parse(JSON.parse(readFileSync(join(directory, names[0] ?? ""), "utf8")));
  assert.equal(manifest.sha256, createHash("sha256").update(readFileSync(join(directory, manifest.backupFileName))).digest("hex"));
  assert.equal(manifest.verification.quickCheck, "ok");
  assert.ok(manifest.createdAt > interruptedAt && runs().every(run => manifest.createdAt >= run.updatedAt), "the clean-shutdown backup follows the run's last write");
  const released = await RuntimeLifetimeLock.acquire(lockPort);
  await released.close();
  assert.equal(existsSync(join(f.workspace, ".tracker", "control", "journal.json")), false);
  return { runs: runs(), diagnostics: diagnostics() };
}

it("an applied Pause all and quit closes the store and exits the dashboard process cleanly", async () => {
  const { exited, post, origin, credential, diagnostics, output } = await startDashboard();
  const state = ApplicationLifecycleSchema.parse(await (await fetch(`${origin}/api/v1/application-lifecycle`,
    { headers: { "x-relay-session": credential } })).json());
  const quit = await post("commands", { commandId: randomUUID(), requestedAt: systemClock.now().toISOString(),
    requestedBy: "local-operator", source: "dashboard", family: "application", type: "pause-all-and-quit",
    target: { runtimeGeneration: state.runtimeGeneration }, payload: { targets: state.targets, confirmed: true } }, credential);
  assert.equal(quit.status, 200);
  assert.equal(CommandResultSchema.parse(await quit.json()).state, "applied");
  assert.deepEqual(await exited, { code: 0, signal: null }, diagnostics());
  assert.match(output(), /"phase":"closing store"/u);
  assert.match(output(), /"phase":"done"/u);
}, 180_000);

it("Ctrl+C parks the in-flight run at its next step boundary, then the observed worker exit and a verified clean-shutdown backup end the dashboard with exit 0", async () => {
  const { runs, diagnostics } = await interruptMidRun([EXECUTOR_EID]);
  assert.deepEqual(runs.map(({ state, outcome, owner, generation, pause }) => ({ state, outcome, owner, generation, pause })),
    [{ state: "queued", outcome: null, owner: null, generation: 1, pause: "paused" }], diagnostics);
}, 180_000);

it("Ctrl+C stops the worker at its parked run: the next queued run is never claimed and the dashboard still exits 0 with a verified backup", async () => {
  const { runs, diagnostics } = await interruptMidRun([EXECUTOR_EID, String(Number(EXECUTOR_EID) + 1)]);
  assert.deepEqual(runs.map(({ state, outcome, owner, generation, pause }) => ({ state, outcome, owner, generation, pause })).toSorted((left, right) => left.generation - right.generation),
    [{ state: "queued", outcome: null, owner: null, generation: 0, pause: "paused" }, { state: "queued", outcome: null, owner: null, generation: 1, pause: "paused" }], diagnostics);
}, 180_000);

async function startIdleWorkers(post: Awaited<ReturnType<typeof startDashboard>>["post"], credential: string, count: number) {
  const result = CommandResultSchema.parse(await (await post("commands", { commandId: randomUUID(), requestedAt: systemClock.now().toISOString(),
    requestedBy: "local-operator", source: "dashboard", family: "worker-browser", type: "plan-worker-count",
    target: { workflowId: "person-lookup", expectedVersion: 0 }, payload: { desiredWorkers: count } }, credential)).json());
  assert.equal(result.state, "applied", JSON.stringify(result));
}

it("an idle Person Lookup worker claims and starts a task within two seconds of admission", async () => {
  const { f, barrier, child, exited, post, origin, credential, diagnostics } = await startDashboard();
  const headers = { "x-relay-session": credential };
  const day = localDatePart(systemClock.now());
  const stream = await fetch(`${origin}/events/v1?topics=dashboard-day:${day}`, { headers });
  const db = new DatabaseSync(f.path, { readOnly: true });
  try {
    assert.equal(stream.status, 200);
    const plan = StartPlanWireSchema.parse(await (await post("start-plans", {
      workflowId: "person-lookup", submissions: [{ emplId: EXECUTOR_EID }], dryRun: false,
    }, credential)).json());
    assert.deepEqual(plan.refused, []);
    await startIdleWorkers(post, credential, 1);
    const idle = db.prepare("SELECT 1 FROM debug_events WHERE json_extract(payload_json,'$.payload.event.reason')='worker-idle' LIMIT 1");
    await until(() => idle.get(), "the worker to finish its empty claim", diagnostics);

    const started = CommandResultSchema.parse(await (await post("commands", {
      commandId: randomUUID(), family: "start", type: "start-run", requestedAt: systemClock.now().toISOString(),
      requestedBy: "local-operator", source: "run-start",
      target: { workflowId: plan.workflowId, startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion },
      payload: plan.fingerprints,
    }, credential)).json());
    assert.equal(started.state, "applied", JSON.stringify(started));
    const run = started.affectedTargets.find(target => target.family === "run");
    assert.ok(run);
    const milestone = db.prepare(`SELECT MIN(occurred_at) AS instant FROM timeline_events
      WHERE run_id=? AND kind=? AND (? != 'span.started' OR json_extract(payload_json,'$.payload.event.kind')='task')`);
    const at = (kind: string) => {
      const instant = milestone.get(run.runId, kind, kind)?.instant;
      return typeof instant === "string" ? instant : undefined;
    };
    const firstTask = await until(() => at("span.started"), "the first task span", diagnostics, 40_000);
    const queued = at("run.queued"), claimed = at("run.claimed");
    assert.ok(queued !== undefined && claimed !== undefined);
    const claimMs = Date.parse(claimed) - Date.parse(queued);
    const firstTaskMs = Date.parse(firstTask) - Date.parse(queued);
    const timing = JSON.stringify({ queued, claimed, firstTask, claimMs, firstTaskMs });
    assert.ok(0 <= claimMs && claimMs <= firstTaskMs && firstTaskMs <= 2_000, timing);

    const queue = DashboardDayWireSchema.parse(await (await fetch(`${origin}/api/v1/dashboard?day=${localDatePart(new Date(queued))}`, { headers })).json());
    assert.equal(queue.queueSurfaces.find(row => row.runId === run.runId)?.status, "running", timing);
    process.stdout.write(`Person Lookup startup ${timing}\n`);
  } finally {
    db.close();
    await stream.body?.cancel();
    writeFileSync(join(barrier, "release"), "");
    child.kill("SIGINT");
    assert.deepEqual(await exited, { code: 0, signal: null }, diagnostics());
  }
}, 180_000);

it.skipIf(process.platform === "win32")("one terminal SIGINT drains two idle worker children and logs every shutdown phase through exit 0", async () => {
  const { f, child, post, origin, credential, markers, diagnostics, exited, output } = await startDashboard(true);
  await startIdleWorkers(post, credential, 2);
  assert.ok(child.pid);
  const stream = await fetch(`${origin}/events/v1?topics=dashboard-day:2026-11-05`, { headers: { "x-relay-session": credential } });
  assert.equal(stream.status, 200);
  {
    using state = new DatabaseSync(f.path, { readOnly: true });
    const idle = state.prepare("SELECT count(DISTINCT worker_id) AS count FROM debug_events WHERE json_extract(payload_json,'$.payload.event.reason')='worker-idle'");
    await until(() => idle.get()?.count === 2 || undefined, "both workers to finish their empty claims", diagnostics, 20_000);
  }
  // Model a busy dashboard whose workers finish handling the terminal interrupt first.
  process.kill(child.pid, "SIGSTOP");
  try {
    process.kill(-child.pid, "SIGINT");
    const exits = await until(() => {
      const observed = markers().filter(name => name.startsWith("exit-"));
      return observed.some(name => !name.startsWith("exit-0-")) || observed.length === 2 ? observed : undefined;
    }, "both workers to finish the terminal interrupt", diagnostics, 10_000);
    assert.equal(exits.filter(name => name.startsWith("exit-0-")).length, 2, diagnostics());
  } finally { process.kill(child.pid, "SIGCONT"); }
  let dashboardExit: Awaited<typeof exited> | undefined;
  void exited.then(result => { dashboardExit = result; });
  assert.deepEqual(await until(() => dashboardExit, "dashboard exit after the terminal interrupt", diagnostics, 30_000),
    { code: 0, signal: null }, diagnostics());
  assert.equal(markers().filter(name => name.startsWith("exit-0-")).length, 2, diagnostics());
  assert.deepEqual([...output().matchAll(/"message":"dashboard shutdown","phase":"([^"]+)"/gu)].map(match => match[1]),
    ["closing transport", "stopping workers", "closing store", "backing up", "done"], diagnostics());
  assert.doesNotMatch(output(), /unhandled-rejection|UnhandledPromiseRejection/iu);
  using state = new DatabaseSync(f.path, { readOnly: true });
  using timeline = new DatabaseSync(join(f.stateRoot, "timeline.db"), { readOnly: true });
  const workerEnds = "SELECT id, payload_json FROM timeline_events WHERE kind='span.ended' AND json_extract(payload_json,'$.payload.event.kind')='worker' ORDER BY cursor";
  const ended = state.prepare(workerEnds).all();
  assert.equal(ended.length, 2, diagnostics());
  assert.deepEqual(timeline.prepare(workerEnds).all(), ended, diagnostics());
}, 180_000);

it.each(["stream-close", "transport-close", "worker-stop"] as const)("Ctrl+C completes the verified backup before exiting 1 after %s fails", async fault => {
  const { child, exited, output, diagnostics, f, lockPort, post, credential } = await startDashboard(false, fault);
  if (fault === "worker-stop") await startIdleWorkers(post, credential, 1);
  assert.equal(child.kill("SIGINT"), true);
  const exit = await exited;
  assert.deepEqual([...output().matchAll(/"message":"dashboard shutdown","phase":"([^"]+)"/gu)].map(match => match[1]),
    ["closing transport", "stopping workers", "closing store", "backing up", "done"], diagnostics());
  assert.deepEqual(exit, { code: 1, signal: null }, diagnostics());
  const spool = readFileSync(join(f.workspace, ".tracker", "data", "logs", "boot.jsonl"), "utf8");
  assert.ok(spool.includes(`"reason":"${fault}"`), diagnostics());
  assert.match(spool, /TypeError/u);
  assert.doesNotMatch(spool + output(), /unhandled-rejection|uncaught-exception|private synthetic shutdown detail/iu);
  const backups = join(f.stateRoot, "backups", "authority");
  const manifests = readdirSync(backups).filter(name => name.endsWith(".shutdown.sqlite.manifest.json"));
  assert.equal(manifests.length, 1);
  const manifest = StoppedAuthorityBackupManifestSchema.parse(JSON.parse(readFileSync(join(backups, manifests[0]), "utf8")));
  assert.equal(manifest.verification.quickCheck, "ok");
  assert.equal(manifest.sha256, createHash("sha256").update(readFileSync(join(backups, manifest.backupFileName))).digest("hex"));
  const released = await RuntimeLifetimeLock.acquire(lockPort);
  await released.close();
}, 180_000);

it("Ctrl+C refuses store release and backup when the stream close rejects before disposing subscriptions", async () => {
  const { child, output, exited, diagnostics, f } = await startDashboard(false, "stream-close-unproved");
  assert.equal(child.kill("SIGINT"), true);
  assert.deepEqual(await exited, { code: 1, signal: null }, diagnostics());
  assert.deepEqual([...output().matchAll(/"message":"dashboard shutdown","phase":"([^"]+)"/gu)].map(match => match[1]),
    ["closing transport", "stopping workers"], diagnostics());
  assert.match(output(), /Stream close refused with admission and lifetime held/u);
  const backups = join(f.stateRoot, "backups", "authority");
  assert.ok(!existsSync(backups) || !readdirSync(backups).some(name => name.endsWith(".shutdown.sqlite.manifest.json")));
});
