/**
 * The `dashboard` command's REAL lifecycle, end to end, in a child process.
 *
 * `tests/unit/backend/app/runtime-composition.test.ts` proves the seam logic against an
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
 * cleared, owned workers drained, and the database closed.
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
import { request } from "node:http";
import type { Readable } from "node:stream";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../src/config/runtime-isolation.js";
import { writeDashboardBuildIdentity } from "../../src/backend/app/dashboard/build-identity.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BOOTSTRAP = join(REPO_ROOT, "scripts", "secure-env-bootstrap.ts");
/** Ignored stdin and readable output streams; an optional fourth descriptor carries owned IPC. */
type DashboardChild = ChildProcessByStdio<null, Readable, Readable>;

const REFERENCE_ENVIRONMENT = "CEREBRAS_API_KEY=reference-only-fixture\n";
const LISTENING_MARKER = "dashboard BFF listening";
const BOOT_TIMEOUT_MS = 120_000;
const SHUTDOWN_TIMEOUT_MS = 60_000;
/**
 * The test checks that the child is still inside stop() before sending the
 * second signal; it does not assume a fixed drain duration.
 */

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

async function waitForIngressToClose(port: number, child: DashboardChild, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("dashboard exited before the test observed ingress closure");
    }
    const probe = createServer();
    const bindable = await new Promise<boolean>((resolve, reject) => {
      probe.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") resolve(false);
        else reject(error);
      });
      probe.once("listening", () => {
        probe.close((error) => error === undefined ? resolve(true) : reject(error));
      });
      probe.listen(port, "127.0.0.1");
    });
    if (bindable) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`dashboard ingress did not close within ${String(timeoutMs)}ms`);
}

/** The bootstrap refuses any `.env.providers` a group or other can read (D-secure-env). */
function requirePrivateEnvironmentFile(root: string): void {
  const path = join(root, ".env.providers");
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
 * `.tracker/state.db` on every per-commit gate: a config snapshot inserted,
 * the active runtime generation advanced, and the real `server` lock claimed.
 * The child gets a scratch cwd holding the production inputs it reads relative
 * to its root:
 *
 *  - `package.json` — the served app version (compose.ts) and half of the
 *    `runtime.compatibility` preflight;
 *  - `package-lock.json` — the other half of that same preflight and the build identity;
 *  - `src`, `vite.dashboard.config.ts`, and `tsconfig.json` — the identity-bound inputs;
 *  - a small synthetic `dist/dashboard` stamped from those copied inputs;
 *  - `config/test-data.json` — the public registry loaded by the secure bootstrap;
 *  - `node_modules` — a symlink, because Node resolves the bare `--import tsx`
 *    specifier against the CWD.
 *
 * `.tracker/**` and `config/**` are the composition's own to create. Copy the
 * unmodified production bootstrap into this root so its module-relative `.env`
 * is the private provider-only fixture, never the operator's migration sources.
 * Dependencies are linked read-only by convention; runtime state and admitted
 * environment bytes belong to this disposable root.
 */
function createScratchRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "hr-dashboard-lifecycle-"));
  for (const file of ["package.json", "package-lock.json", "vite.dashboard.config.ts", "tsconfig.json"]) {
    cpSync(join(REPO_ROOT, file), join(root, file));
  }
  cpSync(join(REPO_ROOT, "src"), join(root, "src"), { recursive: true });
  const bundleRoot = join(root, "dist", "dashboard");
  mkdirSync(join(bundleRoot, "assets"), { recursive: true });
  writeFileSync(join(bundleRoot, "index.html"), '<!doctype html><html><body><script type="module" src="/assets/app.js"></script></body></html>\n');
  writeFileSync(join(bundleRoot, "assets", "app.js"), `/* ${"x".repeat(16 * 1024 * 1024)} */\n`);
  writeDashboardBuildIdentity({ repoRoot: root, distDir: bundleRoot });
  mkdirSync(join(root, "config"), { recursive: true });
  cpSync(join(REPO_ROOT, "config", "test-data.json"), join(root, "config", "test-data.json"));
  cpSync(join(REPO_ROOT, "config", "pending-impl-bindings.json"), join(root, "config", "pending-impl-bindings.json"));
  symlinkSync(join(REPO_ROOT, "node_modules"), join(root, "node_modules"), "dir");
  mkdirSync(join(root, "scripts"));
  cpSync(BOOTSTRAP, join(root, "scripts", "secure-env-bootstrap.ts"));
  cpSync(join(REPO_ROOT, ".env.example"), join(root, ".env.providers"));
  chmodSync(join(root, ".env.providers"), 0o600);
  writeFileSync(join(root, ".env"), REFERENCE_ENVIRONMENT, { mode: 0o600 });
  return root;
}

/**
 * Unlink the dependency link before recursive cleanup; its target belongs to
 * the shared checkout.
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

function captureOutput(child: DashboardChild): () => string {
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { output += chunk; });
  child.stderr.on("data", (chunk: string) => { output += chunk; });
  return () => output;
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
    await requireIsolatedPortFree();

    const scratchRoot = createScratchRepoRoot();
    requirePrivateEnvironmentFile(scratchRoot);
    const lockPath = join(scratchRoot, rebuildRuntimeIsolation.processLockRoot, "server.lock.json");
    const checkoutBefore = checkoutStateFingerprint();
    try {
      // The production launch shape: `node --import tsx scripts/secure-env-bootstrap.ts cli dashboard`,
      // exactly what `productionWorkerLaunch` uses for a worker child. Spawning
      // node directly (rather than an npm/npx wrapper) makes `child.pid` the very
      // process the signal must reach and the lock record must name.
      const child = spawn(
        process.execPath,
        ["--import", "tsx", join(scratchRoot, "scripts", "secure-env-bootstrap.ts"), "cli", "dashboard", "--prod"],
        { cwd: scratchRoot, stdio: ["ignore", "pipe", "pipe", "ipc"] },
      ) as DashboardChild;
      const readiness = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("owned dashboard IPC readiness timed out")), BOOT_TIMEOUT_MS);
        const onMessage = (message: unknown): void => {
          clearTimeout(timer); child.removeListener("exit", onExit); resolve(message);
        };
        const onExit = (): void => {
          clearTimeout(timer); child.removeListener("message", onMessage);
          reject(new Error("dashboard exited before IPC readiness"));
        };
        child.once("message", onMessage);
        child.once("exit", onExit);
      });
      const pid = child.pid;
      assert.ok(pid, "the spawned dashboard must report a pid");

      try {
        const [, readinessMessage] = await Promise.all([
          waitForStdout(child, LISTENING_MARKER, BOOT_TIMEOUT_MS), readiness,
        ]);
        assert.deepEqual(readinessMessage, { type: "hrauto-dashboard-ready" });
        const staticResponse = await fetch(`http://127.0.0.1:${String(rebuildRuntimeIsolation.backendPort)}/`);
        assert.equal(staticResponse.status, 200, "the production child serves the built dashboard bytes");
        assert.match(staticResponse.headers.get("content-type") ?? "", /text\/html/u);
        assert.match(await staticResponse.text(), /<script[^>]+type="module"/u);

        const duplicate = spawn(
          process.execPath,
          ["--import", "tsx", join(scratchRoot, "scripts", "secure-env-bootstrap.ts"), "cli", "dashboard", "--prod"],
          { cwd: scratchRoot, stdio: ["ignore", "pipe", "pipe"] },
        );
        const duplicateOutput = captureOutput(duplicate);
        const duplicateExit = await waitForExit(duplicate, BOOT_TIMEOUT_MS);
        assert.notEqual(duplicateExit.code, 0, `a second production dashboard must be refused: ${duplicateOutput()}`);
        const liveOwner = readScratchLock(lockPath);
        assert.equal(liveOwner.pid, pid, "the duplicate must not adopt or replace the live owner's record");
        assert.equal(liveOwner.releasedAt, null, "the duplicate must leave the first owner's lock live");
        assert.equal(child.exitCode, null, "refusing a duplicate must leave the original dashboard running");

        const transfer = request({
          hostname: "127.0.0.1",
          port: rebuildRuntimeIsolation.backendPort,
          path: "/assets/app.js",
        });
        const activeResponse = await new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
          transfer.once("response", resolve);
          transfer.once("error", reject);
          transfer.end();
        });
        activeResponse.on("error", () => undefined);
        assert.equal(activeResponse.complete, false, "the large static transfer is active before shutdown starts");
        assert.equal(child.kill("SIGINT"), true, "SIGINT must be delivered to the running dashboard");
        await waitForIngressToClose(rebuildRuntimeIsolation.backendPort, child, 10_000);
        assert.equal(child.exitCode, null, "the child remains in ordered drain after ingress closes");
        assert.equal(readScratchLock(lockPath).releasedAt, null, "the server lock stays held after ingress closes");
        assert.equal(child.kill("SIGINT"), true, "the second SIGINT must reach the active-transfer drain");
        activeResponse.destroy();
        transfer.destroy();
        const exit = await waitForExit(child, SHUTDOWN_TIMEOUT_MS);
        if (exit.signal !== null) {
          const lock = existsSync(lockPath) ? readScratchLock(lockPath) : undefined;
          assert.fail(`dashboard exited by ${exit.signal} mid-drain (lock releasedAt=${String(lock?.releasedAt)})`);
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
      assert.equal(readFileSync(join(scratchRoot, ".env"), "utf8"), REFERENCE_ENVIRONMENT);
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

  it("refuses a missing production bundle before touching an established state root or process lock", async () => {
    const scratchRoot = createScratchRepoRoot();
    requirePrivateEnvironmentFile(scratchRoot);
    const stateRoot = join(scratchRoot, rebuildRuntimeIsolation.stateRoot);
    mkdirSync(stateRoot, { recursive: true });
    writeFileSync(join(stateRoot, "retained-evidence"), "evidence");
    rmSync(join(scratchRoot, "dist", "dashboard", "dashboard-build-identity.json"));
    const lockPath = join(scratchRoot, rebuildRuntimeIsolation.processLockRoot, "server.lock.json");
    try {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", join(scratchRoot, "scripts", "secure-env-bootstrap.ts"), "cli", "dashboard", "--prod"],
        { cwd: scratchRoot, stdio: ["ignore", "pipe", "pipe"] },
      );
      const output = captureOutput(child);
      const exit = await waitForExit(child, BOOT_TIMEOUT_MS);
      assert.notEqual(exit.code, 0, `missing production identity must refuse startup: ${output()}`);
      assert.match(output(), /dashboard bundle refused: missing dashboard-build-identity\.json/u);
      assert.equal(existsSync(join(stateRoot, "state.db")), false);
      assert.equal(existsSync(lockPath), false, "bundle identity is checked before process-lock admission");
      assert.equal(readFileSync(join(stateRoot, "retained-evidence"), "utf8"), "evidence");
    } finally {
      removeScratchRepoRoot(scratchRoot);
    }
  }, BOOT_TIMEOUT_MS + 30_000);
});
