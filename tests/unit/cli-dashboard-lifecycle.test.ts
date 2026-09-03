/**
 * The `dashboard` command's REAL lifecycle, end to end, in a child process.
 *
 * `tests/unit/runtime-composition.test.ts` proves the seam logic against an
 * injected composer, an injected signal seam, and the real `process` signal
 * registration. It cannot prove the half that actually broke: that the
 * production entrypoint — `scripts/secure-env-bootstrap.ts` → `runCli` →
 * `startRebuildRuntime` → `composeDashboardRuntime` — subscribes those handlers
 * at all, that awaiting the lifecycle keeps the process alive through `stop()`
 * instead of letting Node's default signal disposition kill it mid-drain, and
 * that the shutdown ordering therefore reaches its last step.
 *
 * The durable proof is the process lock. `composeDashboardRuntime`'s `stop()`
 * releases it only AFTER the authority database handle closed, so a released
 * record for this exact pid is evidence that ingress closed, the timers were
 * cleared, the worker supervisor closed, the graceful-drain backup succeeded
 * (it throws otherwise, which would be a non-zero exit) and the database
 * closed. Before this fix the same SIGINT left `releasedAt: null`.
 *
 * Two SIGINTs, not one: the second arrives while `stop()` is still draining.
 * With `process.once` the first signal removed its own listener, so the second
 * fell through to Node's default terminate and killed the process mid-ordering
 * — exit 130 and `releasedAt: null` again. Exit 0 with a released record for
 * this pid is the real-process proof that the listeners stayed subscribed.
 */
import assert from "node:assert/strict";
import { type ChildProcessByStdio, spawn } from "node:child_process";
import { createServer } from "node:net";
import type { Readable } from "node:stream";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../src/config/runtime-isolation.js";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BOOTSTRAP = join(REPO_ROOT, "scripts", "secure-env-bootstrap.ts");
/** `stdio: ["ignore", "pipe", "pipe"]` — no stdin, both output streams readable. */
type DashboardChild = ChildProcessByStdio<null, Readable, Readable>;

const LISTENING_MARKER = "dashboard BFF listening";
const BOOT_TIMEOUT_MS = 120_000;
const SHUTDOWN_TIMEOUT_MS = 60_000;
/**
 * When the second Ctrl+C is sent, measured against a scratch root's virgin
 * authority: the child listens ~1s after spawn and its whole drain takes ~40ms,
 * so 10ms lands inside the ordering with room to spare, and comfortably after
 * the first signal was delivered and handled (sub-millisecond).
 *
 * It must also stay inside the drain: `ownDashboardUntilShutdown` disposes both
 * listeners once `stop()` settles — correctly, since everything durable is
 * released by then — so a signal sent in the few milliseconds between that
 * disposal and process exit would terminate an already-drained process and
 * prove nothing. The test asserts the child is still running before it signals
 * rather than assuming the timing holds.
 */
const SECOND_SIGNAL_DELAY_MS = 10;

/**
 * A dashboard already listening on the isolated port makes this test measure
 * somebody else's process. That is a red gate, never a skip: the port is named
 * so the operator can stop the occupant. The isolated port is not overridable,
 * by design (`config/runtime-isolation.json`), so a scratch root does not — and
 * must not — make this probe unnecessary.
 */
async function requireIsolatedPortFree(): Promise<void> {
  const port = rebuildRuntimeIsolation.backendPort;
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error: NodeJS.ErrnoException) => {
      reject(new Error(
        `the rebuild dashboard port ${String(port)} is occupied (${error.code ?? error.message}); `
        + "stop the running dashboard before this lifecycle smoke can own it",
      ));
    });
    probe.once("listening", () => {
      probe.close(() => {
        resolve();
      });
    });
    probe.listen(port, "127.0.0.1");
  });
}

/** The bootstrap refuses any `.env` a group or other can read (D-secure-env). */
function requirePrivateEnvironmentFile(): void {
  const path = join(REPO_ROOT, ".env");
  const mode = statSync(path).mode & 0o777;
  assert.equal(
    mode,
    0o600,
    `${path} must be mode 600 for the secure bootstrap to admit it; observed ${mode.toString(8)}`,
  );
}

/**
 * `composeDashboardRuntime` takes `repoRoot = process.cwd()`, so spawning this
 * child in the checkout would boot a real dashboard over the developer's own
 * `.tracker-rebuild/state.db` on every per-commit gate: a config snapshot
 * inserted, the active runtime generation advanced, the real `server` lock
 * claimed, a drain backup written. The child gets a scratch cwd holding ONLY
 * what the composition reads relative to its root:
 *
 *  - `package.json` — the served app version (compose.ts) and half of the
 *    `runtime.compatibility` preflight;
 *  - `package-lock.json` — the other half of that same preflight;
 *  - `node_modules` — a symlink, because Node resolves the bare `--import tsx`
 *    specifier against the CWD.
 *
 * `.tracker-rebuild/**` and `config/**` are the composition's own to create,
 * and the bootstrap derives `.env` from its own module URL, so the checkout's
 * mode-600 file still applies to a child running anywhere.
 */
function createScratchRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "hr-dashboard-lifecycle-"));
  for (const file of ["package.json", "package-lock.json"]) {
    cpSync(join(REPO_ROOT, file), join(root, file));
  }
  symlinkSync(join(REPO_ROOT, "node_modules"), join(root, "node_modules"), "dir");
  return root;
}

/**
 * Unlink the `node_modules` symlink FIRST and by itself. `fs.rm` does not follow
 * symlinks, but the checkout's real dependency tree is not something to trust to
 * that one behaviour inside a recursive delete.
 */
function removeScratchRepoRoot(root: string): void {
  rmSync(join(root, "node_modules"), { force: true });
  rmSync(root, { recursive: true, force: true });
}

function waitForStdout(child: DashboardChild, marker: string, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      reject(new Error(
        `the dashboard never wrote ${JSON.stringify(marker)} within ${String(timeoutMs)}ms\n`
        + `stdout: ${stdout}\nstderr: ${stderr}`,
      ));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.includes(marker)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(
        `the dashboard exited (code ${String(code)}, signal ${String(signal)}) before it listened\n`
        + `stdout: ${stdout}\nstderr: ${stderr}`,
      ));
    });
  });
}

function waitForExit(
  child: DashboardChild,
  timeoutMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(
        `the dashboard was still running ${String(timeoutMs)}ms after SIGINT; `
        + "an awaited shutdown must terminate the process",
      ));
    }, timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * The negative half of "the gate stops writing developer state": this
 * checkout's authority database and server lock, byte-for-byte and by mtime,
 * before and after the child ran. `absent` is a legitimate reading on a
 * checkout that has never started a dashboard.
 */
function checkoutStateFingerprint(): Readonly<{ authority: string; lock: string }> {
  const describe_ = (path: string): string => {
    if (!existsSync(path)) return "absent";
    const stat = statSync(path);
    return `${String(stat.size)}:${String(stat.mtimeMs)}`;
  };
  const lockPath = join(REPO_ROOT, rebuildRuntimeIsolation.processLockRoot, "server.lock.json");
  return Object.freeze({
    authority: describe_(join(REPO_ROOT, rebuildRuntimeIsolation.stateRoot, "state.db")),
    lock: existsSync(lockPath) ? `${describe_(lockPath)}:${readFileSync(lockPath, "utf8")}` : "absent",
  });
}

function readScratchLock(lockPath: string): { name?: unknown; pid?: unknown; releasedAt?: unknown } {
  const record: unknown = JSON.parse(readFileSync(lockPath, "utf8"));
  assert.ok(record !== null && typeof record === "object", `${lockPath} must hold one lock record`);
  return record;
}

describe("the `dashboard` CLI command's shutdown lifecycle", () => {
  it("drains through a second Ctrl+C, exits 0, and releases its process lock", async () => {
    requirePrivateEnvironmentFile();
    await requireIsolatedPortFree();

    const scratchRoot = createScratchRepoRoot();
    const lockPath = join(scratchRoot, rebuildRuntimeIsolation.processLockRoot, "server.lock.json");
    const checkoutBefore = checkoutStateFingerprint();
    try {
      // The production launch shape: `node --import tsx scripts/secure-env-bootstrap.ts cli dashboard`,
      // exactly what `productionWorkerLaunch` uses for a worker child. Spawning
      // node directly (rather than an npm/npx wrapper) makes `child.pid` the very
      // process the signal must reach and the lock record must name.
      const child = spawn(
        process.execPath,
        ["--import", "tsx", BOOTSTRAP, "cli", "dashboard"],
        { cwd: scratchRoot, stdio: ["ignore", "pipe", "pipe"] },
      );
      const pid = child.pid;
      assert.ok(pid, "the spawned dashboard must report a pid");

      try {
        await waitForStdout(child, LISTENING_MARKER, BOOT_TIMEOUT_MS);
        assert.equal(child.kill("SIGINT"), true, "SIGINT must be delivered to the running dashboard");
        const firstSignalAt = performance.now();
        await delay(SECOND_SIGNAL_DELAY_MS);
        // The premise of the second signal, asserted rather than assumed: a
        // dashboard that already left its drain proves nothing about absorbing
        // one, so a faster-than-expected shutdown fails loud here instead of
        // passing vacuously.
        assert.equal(
          child.exitCode === null && child.signalCode === null,
          true,
          `the dashboard left its drain within ${String(SECOND_SIGNAL_DELAY_MS)}ms, so the second Ctrl+C could not land `
          + "inside stop(); this proof needs a signal that arrives while the shutdown ordering is still running",
        );
        assert.equal(child.kill("SIGINT"), true, "the second Ctrl+C must reach the draining dashboard");
        const secondSignalAfterMs = performance.now() - firstSignalAt;
        const exit = await waitForExit(child, SHUTDOWN_TIMEOUT_MS);
        if (exit.signal !== null) {
          // A signal-terminated exit has two readings, and only the lock tells
          // them apart: a released record means the second Ctrl+C landed in the
          // window after stop() settled and its listeners were disposed but
          // before the process exited — a timing miss of THIS test, not the
          // regression — while `releasedAt: null` is the mid-drain kill the
          // listener rule exists to prevent.
          const lock = existsSync(lockPath) ? readScratchLock(lockPath) : undefined;
          const reading = typeof lock?.releasedAt === "string"
            ? `TIMING MISS: the second Ctrl+C was sent ${secondSignalAfterMs.toFixed(1)}ms after the first and landed after the drain had released the lock (${lock.releasedAt}); rerun on a quieter machine`
            : `REGRESSION: the second Ctrl+C killed the dashboard mid-drain (lock releasedAt=${String(lock?.releasedAt)})`;
          assert.fail(`dashboard exited by ${exit.signal} — ${reading}`);
        }
        assert.equal(exit.code, 0, "a drained dashboard exits 0 of its own accord");
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }

      // The scratch root, not the checkout, is where this dashboard's authority
      // lives — the positive half of "the gate stops writing developer state".
      assert.ok(
        statSync(join(scratchRoot, rebuildRuntimeIsolation.stateRoot, "state.db")).size > 0,
        "the child must have opened its authority under the scratch root it was given",
      );
      const lock = readScratchLock(lockPath);
      // The pid binds this assertion to THIS run: an earlier run's released record
      // must never stand in for a shutdown that did not happen.
      assert.equal(lock.pid, pid, "the surviving lock record must belong to the dashboard just stopped");
      assert.equal(lock.name, "server");
      assert.equal(
        typeof lock.releasedAt,
        "string",
        "stop() releases the process lock after the database handle closed; `null` means the process was killed mid-drain",
      );
      assert.deepEqual(
        checkoutStateFingerprint(),
        checkoutBefore,
        "the smoke must leave this checkout's authority database and server lock byte-for-byte untouched",
      );
    } finally {
      removeScratchRepoRoot(scratchRoot);
    }
  }, BOOT_TIMEOUT_MS + SHUTDOWN_TIMEOUT_MS + 30_000);
});
