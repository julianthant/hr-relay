/**
 * The `dashboard` command's REAL lifecycle, end to end, in a child process.
 *
 * `tests/unit/runtime-composition.test.ts` proves the seam logic against an
 * injected composer and an injected signal seam. It cannot prove the half that
 * actually broke: that the production entrypoint — `scripts/secure-env-bootstrap.ts`
 * → `runCli` → `startRebuildRuntime` → `composeDashboardRuntime` — subscribes
 * the real `process.once("SIGINT")` handlers, that awaiting the lifecycle keeps
 * the process alive through `stop()` instead of letting Node's default signal
 * disposition kill it mid-drain, and that the shutdown ordering therefore
 * reaches its last step.
 *
 * The durable proof is the process lock. `composeDashboardRuntime`'s `stop()`
 * releases it only AFTER the authority database handle closed, so a released
 * record for this exact pid is evidence that ingress closed, the timers were
 * cleared, the worker supervisor closed, the graceful-drain backup succeeded
 * (it throws otherwise, which would be a non-zero exit) and the database
 * closed. Before this fix the same SIGINT left `releasedAt: null`.
 */
import assert from "node:assert/strict";
import { type ChildProcessByStdio, spawn } from "node:child_process";
import { createServer } from "node:net";
import type { Readable } from "node:stream";
import { readFileSync, statSync } from "node:fs";
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
 * A dashboard already listening on the isolated port makes this test measure
 * somebody else's process. That is a red gate, never a skip: the port is named
 * so the operator can stop the occupant.
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

describe("the `dashboard` CLI command's shutdown lifecycle", () => {
  it("stops the composed runtime on SIGINT, exits 0, and releases its process lock", async () => {
    requirePrivateEnvironmentFile();
    await requireIsolatedPortFree();

    // The production launch shape: `node --import tsx scripts/secure-env-bootstrap.ts cli dashboard`,
    // exactly what `productionWorkerLaunch` uses for a worker child. Spawning
    // node directly (rather than an npm/npx wrapper) makes `child.pid` the very
    // process the signal must reach and the lock record must name.
    const child = spawn(
      process.execPath,
      ["--import", "tsx", BOOTSTRAP, "cli", "dashboard"],
      { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );
    const pid = child.pid;
    assert.ok(pid, "the spawned dashboard must report a pid");

    try {
      await waitForStdout(child, LISTENING_MARKER, BOOT_TIMEOUT_MS);
      assert.equal(child.kill("SIGINT"), true, "SIGINT must be delivered to the running dashboard");
      const exit = await waitForExit(child, SHUTDOWN_TIMEOUT_MS);
      assert.deepEqual(
        { code: exit.code, signal: exit.signal },
        { code: 0, signal: null },
        "a drained dashboard exits 0 of its own accord, never by the signal's default terminate",
      );
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }

    const lockPath = join(REPO_ROOT, rebuildRuntimeIsolation.processLockRoot, "server.lock.json");
    const record: unknown = JSON.parse(readFileSync(lockPath, "utf8"));
    assert.ok(record !== null && typeof record === "object", `${lockPath} must hold one lock record`);
    const lock = record as { name?: unknown; pid?: unknown; releasedAt?: unknown };
    // The pid binds this assertion to THIS run: an earlier run's released record
    // must never stand in for a shutdown that did not happen.
    assert.equal(lock.pid, pid, "the surviving lock record must belong to the dashboard just stopped");
    assert.equal(lock.name, "server");
    assert.equal(
      typeof lock.releasedAt,
      "string",
      "stop() releases the process lock after the database handle closed; `null` means the process was killed mid-drain",
    );
  }, BOOT_TIMEOUT_MS + SHUTDOWN_TIMEOUT_MS + 30_000);
});
