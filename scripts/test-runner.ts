import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { systemClock } from "../src/domain/clock.js";

export interface TestProcessResult { readonly code: number; readonly detail: string }
export interface TestProcessOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly rootDirectory: string;
  readonly idleTimeoutMs?: number;
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

/** Explicit reclamation only: incomplete startup and live groups are retained. */
export function reapTestRuns(directory: string): { removed: string[]; retained: string[] } {
  const base = prepareDirectory(directory);
  const removed: string[] = [], retained: string[] = [];
  for (const name of readdirSync(base)) {
    if (!/^run-[A-Za-z0-9]+$/.test(name)) throw new Error(`Unknown entry in test-run directory: ${name}`);
    const root = join(base, name), owner = readOwner(root);
    if (owner.groupId === null || groupAlive(owner.groupId)) { retained.push(root); continue; }
    // No running owner can now create children. Refuse replacement of the owner before deletion.
    if (readOwner(root).id !== owner.id) throw new Error(`Test-run owner changed: ${root}`);
    rmSync(root, { recursive: true });
    removed.push(root);
  }
  return { removed, retained };
}

export async function runTestProcess(options: TestProcessOptions): Promise<TestProcessResult> {
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
        detached: true, stdio: ["ignore", "pipe", "pipe"],
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
  const final = live ? { code: 1, detail: `${result.detail}; child process group remains active` } : result;
  if (final.code === 0) rmSync(root, { recursive: true });
  else writeFileSync(join(root, "failure.txt"), `${final.detail}\n${tail}`, { flag: "wx", mode: 0o600 });
  process.stderr.write(`[test-run] ${basename(root)} ${final.detail}; ${systemClock.nowMs() - start}ms${final.code === 0 ? "; scratch removed" : `; retained ${root}`}\n`);
  return final;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--reap") { process.stdout.write(`${JSON.stringify(reapTestRuns(testRunsDirectory()))}\n`); return; }
  const commandArgs = args[0] === "unit" || args[0] === "integration"
    ? selectedTestArguments(args[0], args.slice(1))
    : args;
  const result = await runTestProcess({ command: process.execPath, args: [fileURLToPath(new URL("./vitest.mjs", import.meta.resolve("vitest/package.json"))), ...commandArgs], cwd: process.cwd(), env: process.env, rootDirectory: testRunsDirectory() });
  process.exitCode = result.code;
}
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
