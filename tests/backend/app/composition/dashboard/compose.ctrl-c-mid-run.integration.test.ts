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
import { StartPlanWireSchema } from "../../../../../src/models/dashboard/start-plan.js";
import { PublicProfileStateSchema } from "../../../../../src/models/profiles/public-profile.js";
import { CommandResultSchema } from "../../../../../src/rules/commands/commands.js";
import { systemClock } from "../../../../../src/rules/time/clock.js";
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

/** The dashboard process with one fixture worker whose first UCPath search holds on the barrier; Ctrl+C arrives while that run is inside its step.
 * Shutdown holds admission and pauses every live run, so the held run finishes its step and parks at the next boundary. */
async function interruptMidRun(emplIds: readonly string[]) {
  const f = await createBoundProfileFixture();
  cleanups.push(() => f.close());
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(f.workspace, name));
  await f.closeController();
  const barrier = mkdtempSync(join(tmpdir(), "relay-signal-barrier-"));
  cleanups.push(() => { rmSync(barrier, { recursive: true, force: true }); });
  const child: ChildProcess = spawn(process.execPath, ["--import", testProcessImport(), CHILD, f.workspace, barrier],
    { cwd: process.cwd(), env: credentialKeychainTestEnvironment(process.env), stdio: ["ignore", "pipe", "pipe"] });
  cleanups.push(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => { child.once("exit", (code, signal) => { resolve({ code, signal }); }); });
  const markers = () => readdirSync(barrier);
  const history = () => {
    if (!existsSync(f.path)) return [];
    const raw = new DatabaseSync(f.path, { readOnly: true });
    try { return raw.prepare("SELECT lifecycle_json AS lifecycle FROM runs").all().map(row => String(row.lifecycle)); } finally { raw.close(); }
  };
  const diagnostics = () => JSON.stringify({ output, markers: markers(), exitCode: child.exitCode, lifecycles: history() });
  const port = Number(await until(() => /dashboard BFF listening on 127\.0\.0\.1:(\d+)/u.exec(output)?.[1], "the dashboard listener", diagnostics));
  const lockPort = Number(/LIFETIME LOCK (\d+)/u.exec(output)?.[1]);
  for (const owned of [port, lockPort]) assert.ok(Number.isInteger(owned) && owned > 0 && !RESERVED_PORTS.includes(owned), diagnostics());

  const origin = `http://127.0.0.1:${String(port)}`;
  const post = (route: string, body: unknown, cookie?: string) => fetch(`${origin}/api/v1/${route}`, { method: "POST",
    headers: { origin, "content-type": "application/json", ...(cookie === undefined ? {} : { cookie }) }, body: JSON.stringify(body) });
  const signIn = await post("profile/sign-in", { email: "fixture@ucsd.edu", password: "disposable-fixture-password" });
  assert.equal(PublicProfileStateSchema.parse(await signIn.json()).state, "active");
  const cookie = signIn.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(cookie);
  const plan = StartPlanWireSchema.parse(await (await post("start-plans", { workflowId: "person-lookup", submissions: emplIds.map(emplId => ({ emplId })), dryRun: false }, cookie)).json());
  assert.deepEqual(plan.refused, []);
  const started = CommandResultSchema.parse(await (await post("commands", { commandId: randomUUID(), family: "start", type: "start-run", requestedAt: systemClock.now().toISOString(),
    requestedBy: "local-operator", source: "run-start", target: { workflowId: plan.workflowId, startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion },
    payload: plan.fingerprints }, cookie)).json());
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
  // The parent asks its worker to stop after the run; only then does the held step finish.
  await until(() => markers().find(name => name === `stop-shutdown-${String(workerPid)}`), "the parent's worker-stop", diagnostics);
  assert.ok(runs().some(run => run.state === "running"), "Ctrl+C never interrupts the run inside its step");
  writeFileSync(join(barrier, "release"), "");
  const exit = await Promise.race([exited, new Promise<never>((_, reject) => setTimeout(() => { reject(new Error(`dashboard did not exit\n${diagnostics()}`)); }, scaledMs(90_000)))]);

  assert.deepEqual(exit, { code: 0, signal: null }, diagnostics());
  assert.doesNotMatch(output, CUSTODY_FAULTS);
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
