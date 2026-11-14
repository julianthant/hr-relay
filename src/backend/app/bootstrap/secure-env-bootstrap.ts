import { fileURLToPath } from "node:url";
import { profileBrowserClosure } from "../../runtime/browser/profile-browser-closure.js";
import { acquireRuntimeLifetimeLock,receiveRuntimeLifetimeLock,RuntimeAlreadyRunningError,RuntimeLifetimeLock,WorkerRuntimeLifetimeLock } from "../../storage/admission/lifetime-lock.js";
import { hasUnprovedSourceClosure,retainAuthoritySourceClosure } from '../../storage/source-closure.js';

import { connect } from "node:net";
import { join,resolve } from "node:path";
import { z } from "zod";
import { hostConfigFacts } from "../../../models/config/host-display.js";
import { assertNoMigratedEnvironmentKeys,hostAwareResolutionEnvironment } from "../../../models/config/secrets.js";
import { systemClock } from "../../../rules/time/clock.js";
import { acquireExclusiveRuntimeAdmission,RuntimeAdmission } from "../../storage/admission/admission.js";
import { acquireDashboardEntrypointAdmission,acquireEntrypointAdmission } from "../../storage/admission/bootstrap-admission.js";
import { FixedLayoutRefusedError } from "../../storage/maintenance/fixed-layout.js";
import { assertDashboardBuildCurrent } from "../composition/dashboard/build-identity.js";
import { AutomaticPersonRepairRefusedError,FINISH_SHUTDOWN_BACKUP,readPendingShutdownBackup,RegisteredPersonUpgradeRefusedError,removePendingShutdownBackup,RuntimeCustodyUncertainError } from "../composition/storage-compose.js";
import { applicationDataWorkspace,rebuildRuntimeIsolation } from "../config/runtime-isolation.js";
import { probePrimaryDisplay } from "../host/primary-display.js";
import { WORKER_GRACEFUL_STOP_TIMEOUT_MS, WorkerPoolError } from "../../runtime/workers/worker-pool.js";
import { installProcessCrashHandlers } from "./process-crash.js";

export type SecureEnvironmentEntrypoint = "cli" | "test-target-document-number";

export interface RuntimeLifetime {
  readonly lock: RuntimeLifetimeLock | WorkerRuntimeLifetimeLock;
  readonly parentSignal: AbortSignal;
}

export interface SecureEnvironmentBootstrapDependencies {
  readonly installCrashHandlers?: typeof installProcessCrashHandlers;
  readonly assertEnvironment?: () => void;
  readonly runCli?: (admission: RuntimeAdmission, acceptDashboardAdmission: (() => void) | undefined, lifetime: RuntimeLifetime) => Promise<void>;
  readonly acquireLifetimeLock?: (port: number) => Promise<RuntimeLifetimeLock>;
  readonly receiveLifetimeLock?: typeof receiveRuntimeLifetimeLock;
  readonly runTestTargetDocumentNumberSmoke?: () => Promise<number>;
  readonly acquireAdmission?: (mode: "shared" | "exclusive", lifetime: RuntimeLifetimeLock | WorkerRuntimeLifetimeLock) => RuntimeAdmission;
  readonly validateDashboardBundle?: (workspace: string) => void;
  /** The worker branch and an abnormal root shutdown end here; tests replace it. */
  readonly exit?: (code: number) => never;
}

/** The parent's graceful window: an orphaned worker finishes or parks its run, then exits. */
export const WORKER_ORPHAN_EXIT_MS = WORKER_GRACEFUL_STOP_TIMEOUT_MS;

function workerExitUnobserved(error: unknown, depth = 0): boolean {
  if (depth > 8 || typeof error !== "object" || error === null) return false;
  if (error instanceof WorkerPoolError && (error.code === "WORKER_EXIT_UNOBSERVED" || error.code === "WORKER_EXIT_SETTLEMENT_FAILED")) return true;
  const nested: unknown[] = [...(error instanceof AggregateError ? error.errors as unknown[] : []), ..."cause" in error ? [error.cause] : []];
  return nested.some(inner => workerExitUnobserved(inner, depth + 1));
}

export function secureEnvironmentEntrypoint(
  selector: string | undefined,
): SecureEnvironmentEntrypoint {
  if (selector === "cli" || selector === "test-target-document-number") return selector;
  throw new Error(
    "secure environment entrypoint must be cli or test-target-document-number",
  );
}

/** How long a starting dashboard or a quit-time backup finisher waits for the lifetime lock while no dashboard serves. */
export const SHUTDOWN_BACKUP_WAIT_MS = 600_000;

export interface ShutdownBackupLockWait {
  readonly acquire: (port: number) => Promise<RuntimeLifetimeLock>;
  readonly backendListening: () => Promise<boolean>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly nowMs: () => number;
  readonly onWait: () => void;
}

// A quit hands its backup to a finisher that holds the lifetime lock while no dashboard serves; wait for it instead of refusing.
export async function acquireLifetimeLockAfterShutdownBackup(port: number, wait: ShutdownBackupLockWait): Promise<RuntimeLifetimeLock> {
  const deadline = wait.nowMs() + SHUTDOWN_BACKUP_WAIT_MS;
  let announced = false;
  for (;;) {
    try { return await wait.acquire(port); }
    catch (error) {
      if (!(error instanceof RuntimeAlreadyRunningError) || wait.nowMs() >= deadline || await wait.backendListening()) throw error;
    }
    if (!announced) { announced = true; wait.onWait(); }
    await wait.sleep(1000);
  }
}

/** Completes the recorded quit-time backup: the finisher passes `only` and lets errors propagate, a starting dashboard passes `warn` and keeps the record on failure. */
export async function completePendingShutdownBackup(deps: Readonly<{ read: () => ReadonlySet<string> | undefined; backup: (people: ReadonlySet<string>) => Promise<void>;
  remove: () => void; only?: ReadonlySet<string>; warn?: (error: unknown) => void }>): Promise<void> {
  try {
    const record = deps.read();
    if (record === undefined) return;
    const people = new Set([...record].filter(person => deps.only?.has(person) ?? true));
    if (people.size > 0) await deps.backup(people);
    deps.remove();
  } catch (error) { if (deps.warn === undefined) throw error; deps.warn(error); }
}

function backendListening(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => { resolve(false); });
  });
}

export async function runSecureEnvironmentBootstrap(
  args: readonly string[] = process.argv.slice(2),
  dependencies: SecureEnvironmentBootstrapDependencies = {},
): Promise<void> {
  const [selector, ...entrypointArgs] = args;
  secureEnvironmentEntrypoint(selector);
  if (selector === "cli" && entrypointArgs.length === 2 && entrypointArgs[0] === "dashboard" && entrypointArgs[1] === "--prod") {
    const workspace = fileURLToPath(new URL("../../../..", import.meta.url));
    (dependencies.validateDashboardBundle ?? ((root: string) => {
      assertDashboardBuildCurrent({ distDir: join(root, "dist", "dashboard"), repoRoot: root });
    }))(workspace);
  }
  const controller = new AbortController();
  const exit = dependencies.exit ?? ((code: number): never => process.exit(code));
  if (selector === "cli" && entrypointArgs[0] === "worker") {
    const lock = await (dependencies.receiveLifetimeLock ?? receiveRuntimeLifetimeLock)(rebuildRuntimeIsolation.lockPort, () => {
      controller.abort(new Error("runtime-parent-disconnected"));
      setTimeout(() => exit(1), WORKER_ORPHAN_EXIT_MS);
    });
    // The child never closes its listener copy: the OS releases it at exit, after cleanup, so the port proves this process is gone.
    try { await runAdmittedEnvironmentBootstrap(args, dependencies, { lock, parentSignal: controller.signal }); }
    catch (error) {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      return exit(1);
    }
    return exit(typeof process.exitCode === "number" ? process.exitCode : 0);
  }
  const acquire = dependencies.acquireLifetimeLock ?? acquireRuntimeLifetimeLock;
  const dashboard = selector === "cli" && entrypointArgs[0] === "dashboard";
  const lock = dashboard || selector === "cli" && entrypointArgs[0] === "storage" && entrypointArgs[1] === FINISH_SHUTDOWN_BACKUP
    ? await acquireLifetimeLockAfterShutdownBackup(rebuildRuntimeIsolation.lockPort, { acquire, backendListening: () => backendListening(rebuildRuntimeIsolation.backendPort),
      sleep: ms => new Promise(done => setTimeout(done, ms)), nowMs: () => systemClock.nowMs(),
      onWait: () => { if (dashboard) process.stderr.write("[dashboard] finishing the last quit-time backup; starting when it is done.\n"); } })
    : await acquire(rebuildRuntimeIsolation.lockPort);
  let retain = false;
  try { await runAdmittedEnvironmentBootstrap(args, dependencies, { lock, parentSignal: controller.signal }); }
  catch (error) {
    if (workerExitUnobserved(error)) {
      // A worker outlived shutdown: close only the root's listener copy and exit, which closes the IPC channels.
      const survivors = await lock.abandonUnexitedChildren(error);
      process.stderr.write(`${JSON.stringify({ code: "WORKER_EXIT_UNOBSERVED", survivors })}\n`);
      return exit(1);
    }
    retain = error instanceof RuntimeCustodyUncertainError || hasUnprovedSourceClosure(error);
    throw error;
  } finally {
    if (!retain) await lock.close();
  }
}

async function runAdmittedEnvironmentBootstrap(
  args: readonly string[], dependencies: SecureEnvironmentBootstrapDependencies, lifetime: RuntimeLifetime,
): Promise<void> {
  lifetime.parentSignal.throwIfAborted();
  const [selector, ...entrypointArgs] = args;
  const entrypoint = secureEnvironmentEntrypoint(selector);
  const repoRoot = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
  const workspace = lifetime.lock instanceof WorkerRuntimeLifetimeLock ? lifetime.lock.workspace : applicationDataWorkspace();
  const workerLifetime = (): WorkerRuntimeLifetimeLock => {
    if (!(lifetime.lock instanceof WorkerRuntimeLifetimeLock)) throw new Error("inherited-worker-lifetime-required");
    lifetime.lock.assertHeld();
    return lifetime.lock;
  };
  const rootLifetime = (): RuntimeLifetimeLock => {
    if (!(lifetime.lock instanceof RuntimeLifetimeLock)) throw new Error("exclusive-root-lifetime-required");
    lifetime.lock.assertHeld();
    return lifetime.lock;
  };
  if (entrypoint === "cli" && entrypointArgs[0] === "storage" && entrypointArgs[1] === FINISH_SHUTDOWN_BACKUP) {
    const [target, ...people] = entrypointArgs.slice(2);
    if (target !== workspace) throw new Error("shutdown-backup-workspace-mismatch");
    const { backupRegisteredPeopleAtCleanShutdown } = await import("../composition/storage-compose.js");
    const only = new Set(z.array(z.uuid()).min(1).parse(people));
    await completePendingShutdownBackup({ read: () => readPendingShutdownBackup(workspace), only, remove: () => { removePendingShutdownBackup(workspace); },
      backup: done => backupRegisteredPeopleAtCleanShutdown(workspace, rootLifetime(), systemClock, done) });
    return;
  }
  if (repoRoot !== workspace && dependencies.acquireAdmission === undefined && !(lifetime.lock instanceof WorkerRuntimeLifetimeLock)) {
    const { sweepLeakedReadonlyAuthorityCopies } = await import("../../storage/sqlite/readonly-authority-snapshot.js");
    sweepLeakedReadonlyAuthorityCopies();
    const { prepareApplicationDataWorkspace } = await import("../composition/storage-compose.js");
    try { await prepareApplicationDataWorkspace(repoRoot, workspace, rootLifetime(), hostConfigFacts(hostAwareResolutionEnvironment(probePrimaryDisplay))); }
    catch (error) {
      if (error instanceof RegisteredPersonUpgradeRefusedError || error instanceof AutomaticPersonRepairRefusedError) throw error;
      throw new FixedLayoutRefusedError(error);
    }
  }
  if (entrypoint === "cli" && entrypointArgs[0] === "dashboard" && dependencies.acquireAdmission === undefined) {
    const { initializeRegisteredPersonStores } = await import("../composition/storage-compose.js");
    await initializeRegisteredPersonStores(workspace, rootLifetime(), hostConfigFacts(hostAwareResolutionEnvironment(probePrimaryDisplay)));
    const { backupRegisteredPeopleAtCleanShutdown } = await import("../composition/storage-compose.js");
    await completePendingShutdownBackup({ read: () => readPendingShutdownBackup(workspace), remove: () => { removePendingShutdownBackup(workspace); },
      backup: people => { process.stderr.write("[dashboard] finishing the last quit-time backup.\n"); return backupRegisteredPeopleAtCleanShutdown(workspace, rootLifetime(), systemClock, people); },
      warn: error => { process.stderr.write(`[dashboard] the last quit-time backup is unfinished: ${error instanceof Error ? error.message : String(error)}\n`); } });
  }
  if (entrypoint === "cli" && entrypointArgs[0] === "storage" && entrypointArgs[1] === "cancel-queued-runs") {
    const { runOfflineQueuedRunCancellation } = await import("../../storage/maintenance/cancel-queued-runs.js");
    const { report, json } = await runOfflineQueuedRunCancellation(profileBrowserClosure, workspace, entrypointArgs.slice(2), rootLifetime());
    process.stdout.write(json ? `${JSON.stringify(report)}\n` : `storage queued runs: ${report.state}; ${String(report.runIds.length)} runs\n`);
    return;
  }
  const bootDiagnostics = entrypoint === "cli" && entrypointArgs[0] === "explain" && entrypointArgs[1] === "diagnostics" && entrypointArgs.includes("--boot");
  if (bootDiagnostics) {
    const { parseDiagnosticArgs } = await import("../composition/explain-compose.js");
    parseDiagnosticArgs(entrypointArgs.slice(2));
  }
  const storageCommand = entrypoint === "cli" && entrypointArgs[0] === "storage" ? entrypointArgs[1] : undefined;
  const machineControlMaintenance = storageCommand === "upgrade" && entrypointArgs.includes("--machine-control");
  if (machineControlMaintenance) {
    const admission = RuntimeAdmission.acquireStoppedMachineControlMaintenance(workspace, rootLifetime());
    let retainCustody = false;
    try {
      const { composeStorageCommand } = await import("../composition/storage-compose.js");
      const outcome = await composeStorageCommand(rebuildRuntimeIsolation, entrypointArgs.slice(1), systemClock, workspace, admission);
      process.stdout.write(outcome.output.endsWith("\n") ? outcome.output : `${outcome.output}\n`);
      if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
    } catch (error) {
      if (hasUnprovedSourceClosure(error)) {
        retainCustody = true;
        throw retainAuthoritySourceClosure([error], { admission });
      }
      throw error;
    } finally {
      if (!retainCustody) admission.release();
    }
    return;
  }
  const mode = bootDiagnostics || entrypoint === "cli" && entrypointArgs[0] === "storage"
    && !["doctor", "transactions", "help", "--help", "-h"].includes(entrypointArgs[1] ?? "")
    ? "exclusive" : "shared";
  const admission = await (dependencies.acquireAdmission ?? ((requested) => entrypoint === "cli" && entrypointArgs[0] === "worker"
    ? RuntimeAdmission.acquireWorker(workspace, workerLifetime()) : bootDiagnostics ? acquireExclusiveRuntimeAdmission(workspace, rootLifetime())
    : entrypoint === "cli" && entrypointArgs[0] === "dashboard" ? acquireDashboardEntrypointAdmission(profileBrowserClosure, workspace, requested, rootLifetime())
    : acquireEntrypointAdmission(workspace, requested, rootLifetime())))(mode, lifetime.lock);
  let shutdown: "release" | "retain" = "release";
  let dashboardOwnsAdmission = false;
  try {
  if (entrypoint === "cli" && (entrypointArgs[0] === "dashboard" || entrypointArgs[0] === "worker")) {
    (dependencies.installCrashHandlers ?? installProcessCrashHandlers)({ stateRoot: admission.stateRoot, processKind: entrypointArgs[0] });
  }
  if (!bootDiagnostics && !(entrypoint === "cli" && (entrypointArgs[0] === "storage" || entrypointArgs[0] === "test-data"))) {
    (dependencies.assertEnvironment ?? (() => assertNoMigratedEnvironmentKeys()))();

  }

  if (entrypoint === "cli") {
    process.argv.splice(
      1,
      process.argv.length - 1,
      fileURLToPath(new URL("../../../cli.ts", import.meta.url)),
      ...entrypointArgs,
    );
    const runCli = dependencies.runCli ?? (await import("../../../cli.js")).runCli;
    // Await shutdown so a rejection reaches the process exit.
    await runCli(admission, () => {
      if (entrypointArgs[0] !== "dashboard" || dashboardOwnsAdmission) throw new Error("dashboard admission ownership unavailable");
      dashboardOwnsAdmission = true;
    }, lifetime);
    return;
  }

  process.argv.splice(
    1,
    process.argv.length - 1,
    fileURLToPath(new URL("../../../../scripts/verify/test-target-document-number.ts", import.meta.url)),
    ...entrypointArgs,
  );
  const runTestTargetDocumentNumberSmoke = dependencies.runTestTargetDocumentNumberSmoke
    ?? (await import("../../../../scripts/verify/test-target-document-number.js")).runTestTargetDocumentNumberSmoke;
  process.exitCode = await runTestTargetDocumentNumberSmoke();
  } catch (error) {
    if (error instanceof RuntimeCustodyUncertainError) shutdown = "retain";
    else if (hasUnprovedSourceClosure(error)) {
      shutdown = "retain";
      const failure = retainAuthoritySourceClosure([error], { admission });
      throw failure;
    }
    throw error;
  } finally {
    if (shutdown === "release" && !dashboardOwnsAdmission) {
    if (entrypoint === "cli" && entrypointArgs[0] === "dashboard") {
      // Retain signal ownership through the next turn; a queued Ctrl+C must not interrupt admission release.
      const absorb = (): void => undefined;
      process.on("SIGINT", absorb);
      process.on("SIGTERM", absorb);
      try {
        admission.release();
        await new Promise<void>(resolve => setImmediate(resolve));
      } finally {
        process.removeListener("SIGINT", absorb);
        process.removeListener("SIGTERM", absorb);
      }
    } else admission.release();
    }
  }
}
