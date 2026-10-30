import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Writable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { parseCLI } from "vitest/node";
import { systemClock } from "../../src/rules/time/clock.js";

export interface TestProcessResult { readonly code: number; readonly detail: string }
export interface TestProcessOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly rootDirectory: string;
  readonly idleTimeoutMs?: number;
  /** A supplied lease remains caller-owned. */
  readonly suiteLock?: boolean | HeldSuiteLock;
  readonly suiteLockRetryIntervalMs?: number;
  readonly suiteLockWaitTimeoutMs?: number;
}
/** Default `run` stays off operator-machine tests. `test:local` selects them. */
const DEFAULT_RUN_PROJECTS = ["unit", "integration", "architecture", "perf"] as const;

export function vitestCommandArguments(args: readonly string[]): string[] {
  if (args[0] === "unit" || args[0] === "integration") return selectedTestArguments(args[0], args.slice(1));
  if (args[0] === "run" && !args.slice(1).some((arg) => arg === "--project" || arg.startsWith("--project=") || arg === "--config" || arg.startsWith("--config=") || arg === "-c")) {
    return ["run", ...DEFAULT_RUN_PROJECTS.flatMap((name) => ["--project", name]), ...args.slice(1)];
  }
  return [...args];
}

export function selectedTestArguments(
  project: "unit" | "integration",
  filters: readonly string[],
): string[] {
  for (const filter of filters) {
    if (!filter || filter.startsWith("-") || filter.includes("\0")) {
      throw new Error(`Invalid ${project} test filter: ${JSON.stringify(filter)}`);
    }
  }
  return ["run", "--project", project, "--passWithNoTests=false", ...filters];
}
export interface HeldSuiteLock { readonly stdin: Writable; readonly release: () => Promise<void> }
export interface SuiteLockOptions {
  readonly directory: string;
  readonly retryIntervalMs?: number;
  readonly waitTimeoutMs?: number;
}
export class TestSuiteWaitTimeoutError extends Error {
  constructor() {
    super("Another Relay test suite is still running; this run waited 45 minutes and did not start.");
    this.name = "TestSuiteWaitTimeoutError";
  }
}

export function hasTestFilter(args: readonly string[]): boolean {
  return parseCLI(["vitest", "run", ...args]).filter.length > 0;
}

export async function acquireSuiteLock(options: SuiteLockOptions): Promise<HeldSuiteLock> {
  const retryIntervalMs = options.retryIntervalMs ?? 5_000;
  const waitTimeoutMs = options.waitTimeoutMs ?? 45 * 60_000;
  for (const budget of [retryIntervalMs, waitTimeoutMs]) {
    if (!Number.isSafeInteger(budget) || budget <= 0) throw new Error("Invalid test-suite wait budget");
  }
  const path = join(prepareDirectory(options.directory), "suite.lock");
  const descriptor = openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600) throw new Error("Unsafe test-suite lock file");
  } finally { closeSync(descriptor); }
  const start = systemClock.nowMs();
  const since = new Date(start).toTimeString().slice(0, 5);
  let nextMessageAt = start;
  while (true) {
    if (systemClock.nowMs() - start >= waitTimeoutMs) throw new TestSuiteWaitTimeoutError();
    const holder = spawn("/usr/bin/lockf", ["-s", "-k", "-t", "0", path, "/bin/sh", "-c", "echo held; exec cat"], { detached: true, stdio: ["pipe", "pipe", "pipe"] });
    holder.stdin.on("error", (error: NodeJS.ErrnoException) => { if (error.code !== "EPIPE") throw error; });
    holder.stderr.resume();
    const closed = new Promise<TestProcessResult>((done) => {
      let spawnError: Error | undefined;
      holder.once("error", (error) => { spawnError = error; });
      holder.once("close", (code, signal) => done({ code: code ?? 1, detail: spawnError?.message ?? (signal === null ? `exit ${code}` : `signal ${signal}`) }));
    });
    const ready = new Promise<void>((done) => {
      let output = "";
      holder.stdout.on("data", (data: Buffer) => {
        output += data.toString("utf8");
        if (output === "held\n") done();
      });
    });
    const first = await Promise.race([ready.then(() => undefined), closed]);
    if (first === undefined) {
      let released = false;
      return { stdin: holder.stdin, release: async () => {
        if (released) throw new Error("Test-suite lock was released twice");
        released = true;
        holder.stdin.end();
        const result = await closed;
        if (result.code !== 0) throw new Error(`Test-suite lock holder failed (${result.detail})`);
      } };
    }
    if (first.code !== 75) throw new Error(`Test-suite lock unavailable (${first.detail})`);
    const now = systemClock.nowMs();
    if (now >= nextMessageAt) {
      process.stderr.write(`[test-run] waiting for another Relay test suite (since ${since})\n`);
      nextMessageAt = now + 60_000;
    }
    if (now - start >= waitTimeoutMs) throw new TestSuiteWaitTimeoutError();
    await sleep(Math.min(retryIntervalMs, waitTimeoutMs - (now - start)));
  }
}

const Owner = z.object({ version: z.literal(1), id: z.string().uuid(), groupId: z.number().int().min(2).max(2147483647).nullable() }).strict();
const FILE = "owner.json";

function privateDirectory(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o700) {
    throw new Error(`Unsafe test-run directory: ${path}`);
  }
}
export function testRunsDirectory(): string {
  // Keep UNIX socket paths below macOS limits even inside nested test fixtures.
  return join(realpathSync("/tmp"), `hrt-${process.getuid?.()}`);
}
function prepareDirectory(path: string): string {
  try { mkdirSync(path, { mode: 0o700 }); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; }
  privateDirectory(path);
  return realpathSync(path);
}
function groupAlive(id: number): boolean {
  try { process.kill(-id, 0); return true; }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
    // Darwin can return EPERM for an empty orphaned group after parent SIGKILL.
    // Require an independent, complete process-group listing before treating it as gone.
    if (process.platform === "darwin" && error instanceof Error && "code" in error && error.code === "EPERM") {
      const groups = execFileSync("/bin/ps", ["-axo", "pgid="], { encoding: "utf8" }).trim().split(/\s+/);
      if (!groups.every((value) => /^[1-9][0-9]*$/.test(value))) throw new Error("Invalid process-group listing", { cause: error });
      return groups.includes(String(id));
    }
    throw error;
  }
}
function readOwner(root: string): z.infer<typeof Owner> {
  privateDirectory(root);
  const fd = openSync(join(root, FILE), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600 || stat.size > 1024) throw new Error(`Unsafe test-run owner: ${root}`);
    return Owner.parse(JSON.parse(readFileSync(fd, "utf8")) as unknown);
  } finally { closeSync(fd); }
}

function emptyOwnerlessRun(root: string): string[] | undefined {
  privateDirectory(root);
  const entries = readdirSync(root);
  if (entries.length !== 0) {
    if (entries.length !== 1 || entries[0] !== "tmp") return undefined;
    const scratch = lstatSync(join(root, "tmp"));
    if (!scratch.isDirectory() || scratch.isSymbolicLink() || scratch.uid !== process.getuid?.() || (scratch.mode & 0o777) !== 0o700) return undefined;
    if (readdirSync(join(root, "tmp")).length !== 0) return undefined;
  }
  // shortcut: synchronous startup stalls only if frozen, revisit if startup becomes asynchronous.
  if (systemClock.nowMs() - lstatSync(root).mtimeMs <= 10 * 60_000) return undefined;
  return entries;
}

/** Explicit reclamation only: fresh startup and live groups are retained. */
export function reapTestRuns(directory: string): { removed: string[]; retained: string[] } {
  const base = prepareDirectory(directory);
  const removed: string[] = [], retained: string[] = [];
  for (const name of readdirSync(base)) {
    if (name === "suite.lock") continue;
    if (!/^run-[A-Za-z0-9]+$/.test(name)) throw new Error(`Unknown entry in test-run directory: ${name}`);
    const root = join(base, name);
    let owner: z.infer<typeof Owner>;
    try { owner = readOwner(root); }
    catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      const entries = emptyOwnerlessRun(root);
      if (entries === undefined) { retained.push(root); continue; }
      try {
        for (const entry of entries) rmdirSync(join(root, entry));
        rmdirSync(root);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOTEMPTY")) throw error;
        retained.push(root); continue;
      }
      removed.push(root); continue;
    }
    if (owner.groupId === null || groupAlive(owner.groupId)) { retained.push(root); continue; }
    // No running owner can now create children. Refuse replacement of the owner before deletion.
    if (readOwner(root).id !== owner.id) throw new Error(`Test-run owner changed: ${root}`);
    rmSync(root, { recursive: true });
    removed.push(root);
  }
  return { removed, retained };
}

export async function runTestProcess(options: TestProcessOptions): Promise<TestProcessResult> {
  const lease = options.suiteLock === true ? await acquireSuiteLock({ directory: options.rootDirectory, retryIntervalMs: options.suiteLockRetryIntervalMs, waitTimeoutMs: options.suiteLockWaitTimeoutMs }) : undefined;
  try { return await runOwnedTestProcess(options, lease ?? (typeof options.suiteLock === "object" ? options.suiteLock : undefined)); }
  finally { await lease?.release(); }
}

async function runOwnedTestProcess(options: TestProcessOptions, lease?: HeldSuiteLock): Promise<TestProcessResult> {
  if (process.platform === "win32") throw new Error("Owned test runs require POSIX process groups");
  if (options.idleTimeoutMs !== undefined && (!Number.isSafeInteger(options.idleTimeoutMs) || options.idleTimeoutMs <= 0)) throw new Error("Invalid test-run inactivity budget");
  const base = prepareDirectory(options.rootDirectory);
  const root = mkdtempSync(join(base, "run-"));
  const scratch = join(root, "tmp"); mkdirSync(scratch, { mode: 0o700 });
  const owner: z.infer<typeof Owner> = { version: 1, id: randomUUID(), groupId: null };
  const publish = (): void => {
    const next = join(root, "owner.next");
    writeFileSync(next, JSON.stringify(owner), { flag: "wx", mode: 0o600 });
    renameSync(next, join(root, FILE));
  };
  publish();
  const start = systemClock.nowMs();
  let tail = "", idle: NodeJS.Timeout | undefined, escalation: NodeJS.Timeout | undefined;
  let shutdown: Promise<void> | undefined;
  let failure: string | undefined;
  const previousUmask = process.umask(0o077);
  const child = (() => {
    try {
      return spawn(options.command, [...options.args], {
        cwd: options.cwd, env: { ...options.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch },
        detached: true, stdio: ["ignore", "pipe", "pipe", lease?.stdin ?? "ignore"],
      });
    } finally { process.umask(previousUmask); }
  })();
  if (child.pid !== undefined) { owner.groupId = child.pid; publish(); }
  const terminate = (signal: NodeJS.Signals): void => {
    const id = owner.groupId;
    if (id === null || !groupAlive(id)) return;
    try { process.kill(-id, signal); }
    catch (error) {
      // The last group member may exit between the liveness check and signal.
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
    }
  };
  const stop = (): void => {
    terminate("SIGTERM");
    shutdown ??= new Promise<void>((finish) => {
      escalation = setTimeout(() => { terminate("SIGKILL"); finish(); }, 3000);
    });
  };
  const interrupt = (): void => { failure = "interrupted"; stop(); };
  const progress = (): void => {
    if (idle !== undefined) clearTimeout(idle);
    if (options.idleTimeoutMs !== undefined) idle = setTimeout(() => {
      failure = `no test output for ${options.idleTimeoutMs}ms; process group ${owner.groupId}`;
      process.stderr.write(`[test-run] ${failure}; diagnostics: ${root}\n`); stop();
    }, options.idleTimeoutMs);
  };
  const capture = (data: Buffer, stream: NodeJS.WriteStream): void => {
    tail = (tail + data.toString("utf8")).slice(-16384); stream.write(data); progress();
  };
  if (child.stdout === null || child.stderr === null) throw new Error("Test-run output pipes unavailable");
  child.stdout.on("data", (data: Buffer) => capture(data, process.stdout));
  child.stderr.on("data", (data: Buffer) => capture(data, process.stderr));
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt); progress();
  const result = await new Promise<TestProcessResult>((done) => {
    child.once("error", (error) => { failure = `could not start: ${error.message}`; });
    child.once("close", (code, signal) => done({ code: failure === undefined ? (code ?? 1) : 1, detail: failure ?? (signal === null ? `exit ${code}` : `signal ${signal}`) }));
  });
  if (idle !== undefined) clearTimeout(idle);
  // A leader can close while a TERM-resistant descendant with private stdio survives.
  // Keep the promised forced shutdown until the entire owned group is gone.
  if (shutdown !== undefined && owner.groupId !== null && groupAlive(owner.groupId)) await shutdown;
  if (escalation !== undefined) clearTimeout(escalation);
  process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
  const live = owner.groupId !== null && groupAlive(owner.groupId);
  if (options.suiteLock && live) {
    stop();
    await shutdown;
    while (owner.groupId !== null && groupAlive(owner.groupId)) await sleep(10);
  }
  const final = live ? { code: 1, detail: `${result.detail}; child process group remains active` } : result;
  if (final.code === 0) rmSync(root, { recursive: true });
  else {
    writeFileSync(join(root, "failure.txt"), `${final.detail}\n${tail}`, { flag: "wx", mode: 0o600 });
    if (!live || options.suiteLock) rmSync(scratch, { recursive: true });
  }
  process.stderr.write(`[test-run] ${basename(root)} ${final.detail}; ${systemClock.nowMs() - start}ms${final.code === 0 ? "; scratch removed" : `; retained ${root}`}\n`);
  return final;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--reap") { process.stdout.write(`${JSON.stringify(reapTestRuns(testRunsDirectory()))}\n`); return; }
  const commandArgs = vitestCommandArguments(args);
  const result = await runTestProcess({ command: process.execPath, args: [fileURLToPath(new URL("./vitest.mjs", import.meta.resolve("vitest/package.json"))), ...commandArgs], cwd: process.cwd(), env: process.env, rootDirectory: testRunsDirectory(), suiteLock: ["run", "unit", "integration"].includes(args[0]) && !hasTestFilter(commandArgs.slice(1)) });
  process.exitCode = result.code;
}
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
