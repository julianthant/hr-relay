import { fileURLToPath, pathToFileURL } from "node:url";
import {
  admitLocalEnvironmentFile,
  assertNoMigratedEnvironmentKeys,
} from "../src/domain/secrets.js";
import { publishProviderBootProvenance } from "../src/domain/config/provider-boot-provenance.js";
import { acquireEntrypointAdmission } from "../src/backend/storage/admission/bootstrap-admission.js";
import { inspectPendingRelocationStatus, recoverAbandonedAdmissionMutex } from "../src/backend/storage/admission/installation.js";
import { acquireRuntimeRestoreAdmission } from "../src/backend/storage/sqlite/runtime-process-locks.js";
import { rebuildRuntimeIsolation } from "../src/config/runtime-isolation.js";
import { join } from "node:path";
import type { RuntimeAdmission } from "../src/backend/storage/admission/admission.js";
import { assertDashboardBuildCurrent } from "../src/backend/app/dashboard/build-identity.js";

export type SecureEnvironmentEntrypoint = "cli" | "test-target-document-number";

export interface SecureEnvironmentBootstrapDependencies {
  readonly assertEnvironment?: () => void;
  readonly admitEnvironmentFile?: (path: string) => void;
  readonly runCli?: (admission: RuntimeAdmission) => Promise<void>;
  readonly runTestTargetDocumentNumberSmoke?: () => Promise<number>;
  readonly acquireAdmission?: (mode: "shared" | "exclusive") => RuntimeAdmission;
  readonly validateDashboardBundle?: (workspace: string) => void;
  readonly runRelocation?: (input: Readonly<{ workspace: string; args: readonly string[];
    admission?: RuntimeAdmission }>) => Promise<Readonly<{ operationId: string; generation: number }>>;
  readonly inspectRelocationStatus?: (workspace: string) => ReturnType<typeof inspectPendingRelocationStatus>;
  readonly runAdmissionRecovery?: (workspace: string, expectedPid: number) => ReturnType<typeof recoverAbandonedAdmissionMutex>;
}

/** The one production `.env.providers`, anchored to this bootstrap rather than the caller's CWD. */
export function repositoryEnvironmentFilePath(): string {
  return fileURLToPath(new URL("../.env.providers", import.meta.url));
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
  const entrypoint = secureEnvironmentEntrypoint(selector);
  const workspace = fileURLToPath(new URL("..", import.meta.url));
  if (entrypoint === "cli" && entrypointArgs[0] === "storage" && entrypointArgs[1] === "recover-admission") {
    if (entrypointArgs.length !== 4 || entrypointArgs[2] !== "--pid"
      || !/^[1-9]\d*$/u.test(entrypointArgs[3] ?? "")) throw new Error("storage recover-admission usage: --pid <abandoned-owner-pid>");
    const recover = dependencies.runAdmissionRecovery ?? ((root: string, expectedPid: number) => {
      const restore = acquireRuntimeRestoreAdmission({ processLockRoot: join(root, rebuildRuntimeIsolation.processLockRoot), pid: process.pid });
      try { return recoverAbandonedAdmissionMutex(root, restore, expectedPid); }
      finally { restore.release(); }
    });
    const result = recover(workspace, Number(entrypointArgs[3]));
    process.stdout.write(`storage admission recovered: ${result.acquisitionId}; receipt ${result.receiptPath}\n`);
    return;
  }

  if (entrypoint === "cli" && entrypointArgs[0] === "storage" && entrypointArgs[1] === "relocate") {
    const { parseRelocationCommand, runOfflineStorageRelocation, StorageRelocationIncompleteError } = await import("../src/backend/app/storage/relocate.js");
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
  const mode = entrypoint === "cli" && entrypointArgs[0] === "storage"
    && !["backup", "doctor", "transactions", "help", "--help", "-h"].includes(entrypointArgs[1] ?? "")
    ? "exclusive" : "shared";
  const admission = (dependencies.acquireAdmission ?? ((requested) => acquireEntrypointAdmission(workspace, requested)))(mode);
  try {
  // `storage` (D322) and `test-data` (D341) are the only entrypoints that never load `.env.providers`:
  // neither reads a credential, and test-data must not depend on the operator's environment.
  if (!(entrypoint === "cli" && (entrypointArgs[0] === "storage" || entrypointArgs[0] === "test-data"))) {
    (dependencies.assertEnvironment ?? (() => assertNoMigratedEnvironmentKeys()))();
    const environmentFilePath = repositoryEnvironmentFilePath();
    if (dependencies.admitEnvironmentFile !== undefined) dependencies.admitEnvironmentFile(environmentFilePath);
    else {
      const provenance = admitLocalEnvironmentFile(environmentFilePath);
      if (provenance === undefined) throw new Error("provider boot provenance missing after admission");
      publishProviderBootProvenance(provenance);
    }
  }

  if (entrypoint === "cli") {
    process.argv.splice(
      1,
      process.argv.length - 1,
      fileURLToPath(new URL("../src/cli.ts", import.meta.url)),
      ...entrypointArgs,
    );
    const runCli = dependencies.runCli ?? (await import("../src/cli.js")).runCli;
    // Awaited: for `dashboard` this promise is the runtime's lifetime, and a
    // rejection must crash the process loudly rather than becoming an
    // unobserved rejection while the shell reports success.
    await runCli(admission);
    return;
  }

  process.argv.splice(
    1,
    process.argv.length - 1,
    fileURLToPath(new URL("./smoke-test-target-document-number.ts", import.meta.url)),
    ...entrypointArgs,
  );
  const runTestTargetDocumentNumberSmoke = dependencies.runTestTargetDocumentNumberSmoke
    ?? (await import("./smoke-test-target-document-number.js")).runTestTargetDocumentNumberSmoke;
  process.exitCode = await runTestTargetDocumentNumberSmoke();
  } finally {
    if (entrypoint === "cli" && entrypointArgs[0] === "dashboard") {
      // The runtime's shutdown listeners end before this final admission release.
      // Keep signal ownership through the next event-loop turn so a queued second
      // Ctrl+C cannot interrupt the mutex owner publication or cleanup.
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

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url) {
  await runSecureEnvironmentBootstrap();
}
