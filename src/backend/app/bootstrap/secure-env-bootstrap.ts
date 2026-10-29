import { profileBrowserClosure } from "../../runtime/browser/native-profile-probe.js";
import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from '../../storage/source-closure.js';
import { acquireRuntimeLifetimeLock, receiveRuntimeLifetimeLock, RuntimeLifetimeLock, WorkerRuntimeLifetimeLock } from "../../storage/admission/lifetime-lock.js";
import { fileURLToPath } from "node:url";

import { assertNoMigratedEnvironmentKeys } from "../../../models/config/secrets.js";
import { acquireStorageBackupEntrypointAdmission, acquireDashboardEntrypointAdmission, acquireEntrypointAdmission } from "../../storage/admission/bootstrap-admission.js";
import { inspectPendingRelocationStatus } from "../../storage/admission/installation.js";
import { rebuildRuntimeIsolation } from "../config/runtime-isolation.js";
import { systemClock } from "../../../rules/time/clock.js";
import { join } from "node:path";
import { acquireExclusiveRuntimeAdmission, RuntimeAdmission } from "../../storage/admission/admission.js";
import { assertDashboardBuildCurrent } from "../composition/dashboard/build-identity.js";
import { RuntimeCustodyUncertainError } from "../composition/storage-compose.js";

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
  readonly runRelocation?: (input: Readonly<{ workspace: string; args: readonly string[];
    admission?: RuntimeAdmission }>) => Promise<Readonly<{ operationId: string; generation: number }>>;
  readonly inspectRelocationStatus?: (workspace: string) => ReturnType<typeof inspectPendingRelocationStatus>;
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
    retain = error instanceof RuntimeCustodyUncertainError || error instanceof AuthoritySourceClosureUnprovedError;
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
  const workspace = fileURLToPath(new URL("../../../..", import.meta.url));
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
  if (entrypoint === "cli" && entrypointArgs[0] === "storage" && entrypointArgs[1] === "relocate") {
    const { parseRelocationCommand, runOfflineStorageRelocation, StorageRelocationIncompleteError } = await import("../composition/storage/relocate.js");
    const command = parseRelocationCommand(entrypointArgs.slice(2));
    if (command.kind === "status") {
      const pending = (dependencies.inspectRelocationStatus ?? inspectPendingRelocationStatus)(workspace);
      process.stdout.write(command.json ? `${JSON.stringify(pending === undefined
        ? { state: "settled" } : { state: "pending", ...pending })}\n`
        : pending === undefined ? "storage relocate: no pending operation\n"
          : `storage relocate: ${pending.phase} operation ${pending.operationId}; run storage relocate --resume ${pending.operationId}\n`);
      return;
    }
    const admission = command.kind === "plan"
      ? (dependencies.acquireAdmission ?? ((requested) => acquireEntrypointAdmission(workspace, requested, rootLifetime())))("exclusive", lifetime.lock)
      : undefined;
    try {
      try {
        const result = dependencies.runRelocation === undefined
          ? await runOfflineStorageRelocation({ workspace, lifetime: rootLifetime(), command, ...(admission === undefined ? {} : { admission }) })
          : await dependencies.runRelocation({ workspace, args: entrypointArgs.slice(2),
            ...(admission === undefined ? {} : { admission }) });
        process.stdout.write(command.json ? `${JSON.stringify(result)}\n`
          : `storage relocate: verified operation ${result.operationId}; active generation ${String(result.generation)}\n`);
      } catch (error) {
        if (!(error instanceof StorageRelocationIncompleteError)) throw error;
        process.stderr.write(command.json ? `${JSON.stringify({ state: "incomplete", operationId: error.operationId,
          resume: `storage relocate --resume ${error.operationId}` })}\n`
          : `storage relocate: operation ${error.operationId} incomplete; run storage relocate --resume ${error.operationId}\n`);
        process.exitCode = 1;
      }
    } finally { admission?.release(); }
    return;
  }
  const bootDiagnostics = entrypoint === "cli" && entrypointArgs[0] === "explain" && entrypointArgs[1] === "diagnostics" && entrypointArgs.includes("--boot");
  if (bootDiagnostics) {
    const { parseDiagnosticArgs } = await import("../composition/explain-compose.js");
    parseDiagnosticArgs(entrypointArgs.slice(2));
  }
  const storageCommand = entrypoint === "cli" && entrypointArgs[0] === "storage" ? entrypointArgs[1] : undefined;
  const machineControlMaintenance = storageCommand === "upgrade" && entrypointArgs.includes("--machine-control");
  const duoPublicationRecovery = storageCommand === "recover-duo-publication";
  if (machineControlMaintenance || duoPublicationRecovery) {
    if (duoPublicationRecovery && entrypointArgs.length !== 2) throw new Error("unsupported storage recover-duo-publication argument");
    const admission = RuntimeAdmission.acquireStoppedMachineControlMaintenance(workspace, rootLifetime());
    let retainCustody = false;
    try {
      if (duoPublicationRecovery) {
        const recovered = admission.recoverInterruptedDuoPublication();
        process.stdout.write(`storage recover-duo-publication: recovered revision ${String(recovered.revision)}\n`);
        return;
      }
      const { composeStorageCommand } = await import("../composition/storage-compose.js");
      const outcome = await composeStorageCommand(rebuildRuntimeIsolation, entrypointArgs.slice(1), systemClock, workspace, admission);
      process.stdout.write(outcome.output.endsWith("\n") ? outcome.output : `${outcome.output}\n`);
      if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
    } catch (error) {
      if (error instanceof AuthoritySourceClosureUnprovedError) {
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
    if (error instanceof AuthoritySourceClosureUnprovedError) {
      shutdown = "retain";
      const failure = retainAuthoritySourceClosure([error], { admission });
      throw failure;
    }
    if (error instanceof RuntimeCustodyUncertainError) shutdown = "retain";
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
