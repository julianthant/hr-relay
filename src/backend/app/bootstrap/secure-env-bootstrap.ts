import { fileURLToPath } from "node:url";
import { assertNoMigratedEnvironmentKeys } from "../../../models/config/secrets.js";
import { acquireEntrypointAdmission } from "../../storage/admission/bootstrap-admission.js";
import { inspectPendingRelocationStatus, recoverAbandonedAdmissionMutex } from "../../storage/admission/installation.js";
import { acquireRuntimeRestoreAdmission, acquireRuntimeProcessLock, type RuntimeProcessLockHandle } from "../../storage/sqlite/runtime-process-locks.js";
import { rebuildRuntimeIsolation } from "../config/runtime-isolation.js";
import { join } from "node:path";
import { acquireExclusiveRuntimeAdmission, type RuntimeAdmission } from "../../storage/admission/admission.js";
import { assertDashboardBuildCurrent } from "../composition/dashboard/build-identity.js";
import { parseDryRunScenarioArguments } from "../../runs/start/dry-run-scenario-runner.js";
import { loadDryRunScenarioManifest } from "../dry-run/manifests.js";
import { RuntimeCustodyUncertainError } from "../composition/storage-compose.js";

export type SecureEnvironmentEntrypoint = "cli" | "test-target-document-number";

export interface SecureEnvironmentBootstrapDependencies {
  readonly assertEnvironment?: () => void;
  readonly runCli?: (admission: RuntimeAdmission, takeInitialCustody?: () => RuntimeProcessLockHandle | undefined) => Promise<void>;
  readonly runTestTargetDocumentNumberSmoke?: () => Promise<number>;
  readonly acquireAdmission?: (mode: "shared" | "exclusive") => RuntimeAdmission;
  readonly validateDashboardBundle?: (workspace: string) => void;
  readonly runRelocation?: (input: Readonly<{ workspace: string; args: readonly string[];
    admission?: RuntimeAdmission }>) => Promise<Readonly<{ operationId: string; generation: number }>>;
  readonly inspectRelocationStatus?: (workspace: string) => ReturnType<typeof inspectPendingRelocationStatus>;
  readonly runAdmissionRecovery?: (workspace: string, expectedPid: number | "empty") => ReturnType<typeof recoverAbandonedAdmissionMutex>;
}

export function secureEnvironmentEntrypoint(
  selector: string | undefined,
): SecureEnvironmentEntrypoint {
  if (selector === "cli" || selector === "test-target-document-number") return selector;
  throw new Error(
    "secure environment entrypoint must be cli or test-target-document-number",
  );
}

function releaseUnboundWorkerCustody(custody: RuntimeProcessLockHandle | undefined, failure: unknown): void {
  try { custody?.release(); }
  catch (error) { throw new RuntimeCustodyUncertainError(failure === undefined ? [error] : [failure, error]); }
}

export async function runSecureEnvironmentBootstrap(
  args: readonly string[] = process.argv.slice(2),
  dependencies: SecureEnvironmentBootstrapDependencies = {},
): Promise<void> {
  const [selector, ...entrypointArgs] = args;
  const entrypoint = secureEnvironmentEntrypoint(selector);
  const workspace = fileURLToPath(new URL("../../../..", import.meta.url));
  if (entrypoint === "cli" && entrypointArgs[0] === "dry-run-scenario"
    && !["help", "--help", "-h"].includes(entrypointArgs[1] ?? "")) {
    const request = parseDryRunScenarioArguments(entrypointArgs.slice(1));
    await loadDryRunScenarioManifest(request.workflow);
  }
  if (entrypoint === "cli" && entrypointArgs[0] === "storage" && entrypointArgs[1] === "recover-admission") {
    const empty = entrypointArgs.length === 3 && entrypointArgs[2] === "--empty";
    if (!empty && (entrypointArgs.length !== 4 || entrypointArgs[2] !== "--pid"
      || !/^[1-9]\d*$/u.test(entrypointArgs[3] ?? ""))) throw new Error("storage recover-admission usage: --pid <abandoned-owner-pid> | --empty");
    const recover = dependencies.runAdmissionRecovery ?? ((root: string, expectedPid: number | "empty") => {
      const restore = acquireRuntimeRestoreAdmission({ processLockRoot: join(root, rebuildRuntimeIsolation.processLockRoot), pid: process.pid });
      try { return recoverAbandonedAdmissionMutex(root, restore, expectedPid); }
      finally { restore.release(); }
    });
    const result = recover(workspace, empty ? "empty" : Number(entrypointArgs[3]));
    process.stdout.write(`storage admission recovered: ${result.acquisitionId}; receipt ${result.receiptPath}\n`);
    return;
  }

  if (entrypoint === "cli" && entrypointArgs[0] === "storage" && entrypointArgs[1] === "recover-restore") {
    const { runOfflineAuthorityRestoreRecovery } = await import("../composition/storage-compose.js");
    const { report, json } = await runOfflineAuthorityRestoreRecovery(workspace, entrypointArgs.slice(2));
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
      ? (dependencies.acquireAdmission ?? ((requested) => acquireEntrypointAdmission(workspace, requested)))("exclusive")
      : undefined;
    try {
      try {
        const result = dependencies.runRelocation === undefined
          ? await runOfflineStorageRelocation({ workspace, command, ...(admission === undefined ? {} : { admission }) })
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
  if (entrypoint === "cli" && entrypointArgs.length === 2
    && entrypointArgs[0] === "dashboard" && entrypointArgs[1] === "--prod") {
    // A missing or stale bundle must refuse before installation admission can create authority.
    (dependencies.validateDashboardBundle ?? ((root: string) => {
      assertDashboardBuildCurrent({ distDir: join(root, "dist", "dashboard"), repoRoot: root });
    }))(workspace);
  }
  const bootDiagnostics = entrypoint === "cli" && entrypointArgs[0] === "explain" && entrypointArgs[1] === "diagnostics" && entrypointArgs.includes("--boot");
  if (bootDiagnostics) {
    const { parseDiagnosticArgs } = await import("../composition/explain-compose.js");
    parseDiagnosticArgs(entrypointArgs.slice(2));
  }
  const mode = bootDiagnostics || entrypoint === "cli" && entrypointArgs[0] === "storage"
    && !["doctor", "transactions", "help", "--help", "-h"].includes(entrypointArgs[1] ?? "")
    ? "exclusive" : "shared";
  let initialWorkerCustody: RuntimeProcessLockHandle | undefined;
  const admission = (dependencies.acquireAdmission ?? ((requested) => bootDiagnostics ? acquireExclusiveRuntimeAdmission(workspace)
    : acquireEntrypointAdmission(workspace, requested)))(mode);
  let shutdown: "release" | "retain" = "release";
  let runtimeFailure: unknown;
  try {
  if (entrypoint === "cli" && entrypointArgs[0] === "worker") {
    const { captureSelectedProfileStorage } = await import("../composition/storage-compose.js");
    const selected = captureSelectedProfileStorage(admission);
    initialWorkerCustody = acquireRuntimeProcessLock({ processLockRoot: join(workspace, rebuildRuntimeIsolation.processLockRoot),
      name: "workers", pid: process.pid, admission: { kind: "unbound-worker", authorityPath: selected.authorityPath } });
    selected.assertCurrent();
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
      const custody = initialWorkerCustody;
      initialWorkerCustody = undefined;
      return custody;
    });
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
    runtimeFailure = error;
    if (error instanceof RuntimeCustodyUncertainError) shutdown = "retain";
    throw error;
  } finally {
    if (shutdown === "release") {
    releaseUnboundWorkerCustody(initialWorkerCustody, runtimeFailure);
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
