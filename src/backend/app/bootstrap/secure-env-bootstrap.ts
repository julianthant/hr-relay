import { fileURLToPath } from "node:url";
import { profileBrowserClosure } from "../../runtime/browser/profile-browser-closure.js";
import { acquireRuntimeLifetimeLock,receiveRuntimeLifetimeLock,RuntimeLifetimeLock,WorkerRuntimeLifetimeLock } from "../../storage/admission/lifetime-lock.js";
import { hasUnprovedSourceClosure,retainAuthoritySourceClosure } from '../../storage/source-closure.js';

import { join,resolve } from "node:path";
import { hostConfigFacts } from "../../../models/config/host-display.js";
import { assertNoMigratedEnvironmentKeys,hostAwareResolutionEnvironment } from "../../../models/config/secrets.js";
import { systemClock } from "../../../rules/time/clock.js";
import { acquireExclusiveRuntimeAdmission,RuntimeAdmission } from "../../storage/admission/admission.js";
import { acquireDashboardEntrypointAdmission,acquireEntrypointAdmission,acquireStorageBackupEntrypointAdmission } from "../../storage/admission/bootstrap-admission.js";
import { FixedLayoutRefusedError } from "../../storage/maintenance/fixed-layout.js";
import { assertDashboardBuildCurrent } from "../composition/dashboard/build-identity.js";
import { RuntimeCustodyUncertainError } from "../composition/storage-compose.js";
import { applicationDataWorkspace,rebuildRuntimeIsolation } from "../config/runtime-isolation.js";
import { probePrimaryDisplay } from "../host/primary-display.js";

export type SecureEnvironmentEntrypoint = "cli" | "test-target-document-number";

export interface RuntimeLifetime {
  readonly lock: RuntimeLifetimeLock | WorkerRuntimeLifetimeLock;
  readonly parentSignal: AbortSignal;
}

export interface SecureEnvironmentBootstrapDependencies {
  readonly assertEnvironment?: () => void;
  readonly runCli?: (admission: RuntimeAdmission, acceptDashboardAdmission: (() => void) | undefined, lifetime: RuntimeLifetime) => Promise<void>;
  readonly acquireLifetimeLock?: (port: number) => Promise<RuntimeLifetimeLock>;
  readonly runTestTargetDocumentNumberSmoke?: () => Promise<number>;
  readonly acquireAdmission?: (mode: "shared" | "exclusive", lifetime: RuntimeLifetimeLock | WorkerRuntimeLifetimeLock) => RuntimeAdmission;
  readonly validateDashboardBundle?: (workspace: string) => void;
}

export function secureEnvironmentEntrypoint(
  selector: string | undefined,
): SecureEnvironmentEntrypoint {
  if (selector === "cli" || selector === "test-target-document-number") return selector;
  throw new Error(
    "secure environment entrypoint must be cli or test-target-document-number",
  );
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
  const lock = selector === "cli" && entrypointArgs[0] === "worker"
    ? await receiveRuntimeLifetimeLock(rebuildRuntimeIsolation.lockPort, () => controller.abort(new Error("runtime-parent-disconnected")))
    : await (dependencies.acquireLifetimeLock ?? acquireRuntimeLifetimeLock)(rebuildRuntimeIsolation.lockPort);
  let retain = false;
  try { await runAdmittedEnvironmentBootstrap(args, dependencies, { lock, parentSignal: controller.signal }); }
  catch (error) {
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
  if (repoRoot !== workspace && dependencies.acquireAdmission === undefined && !(lifetime.lock instanceof WorkerRuntimeLifetimeLock)) {
    const { prepareApplicationDataWorkspace } = await import("../composition/storage-compose.js");
    try { await prepareApplicationDataWorkspace(repoRoot, workspace, rootLifetime(), hostConfigFacts(hostAwareResolutionEnvironment(probePrimaryDisplay))); }
    catch (error) { throw new FixedLayoutRefusedError(error); }
  }
  if (entrypoint === "cli" && entrypointArgs[0] === "dashboard" && dependencies.acquireAdmission === undefined) {
    const { upgradeRegisteredPersonStores } = await import("../composition/storage-compose.js");
    await upgradeRegisteredPersonStores(workspace, rootLifetime(), hostConfigFacts(hostAwareResolutionEnvironment(probePrimaryDisplay)));
  }
  if (entrypoint === "cli" && entrypointArgs[0] === "storage" && entrypointArgs[1] === "cancel-queued-runs") {
    const { runOfflineQueuedRunCancellation } = await import("../../storage/maintenance/cancel-queued-runs.js");
    const { report, json } = await runOfflineQueuedRunCancellation(profileBrowserClosure, workspace, entrypointArgs.slice(2), rootLifetime());
    process.stdout.write(json ? `${JSON.stringify(report)}\n` : `storage queued runs: ${report.state}; ${String(report.runIds.length)} runs\n`);
    return;
  }
  if (entrypoint === "cli" && entrypointArgs[0] === "storage" && entrypointArgs[1] === "recover-restore") {
    const { runOfflineAuthorityRestoreRecovery } = await import("../composition/storage-compose.js");
    const { report, json } = await runOfflineAuthorityRestoreRecovery(workspace, entrypointArgs.slice(2), rootLifetime());
    process.stdout.write(json ? `${JSON.stringify(report)}\n`
      : `storage restore: verified ${report.outcome} operation ${report.operationId} settled\n`);
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
    : storageCommand === "backup" ? acquireStorageBackupEntrypointAdmission(workspace, rootLifetime())
    : acquireEntrypointAdmission(workspace, requested, rootLifetime())))(mode, lifetime.lock);
  let shutdown: "release" | "retain" = "release";
  let dashboardOwnsAdmission = false;
  try {
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
