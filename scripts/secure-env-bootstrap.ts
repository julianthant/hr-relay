import { fileURLToPath, pathToFileURL } from "node:url";
import {
  admitLocalEnvironmentFile,
  assertNoMigratedEnvironmentKeys,
} from "../src/domain/secrets.js";
import { publishProviderBootProvenance } from "../src/domain/config/provider-boot-provenance.js";
import { acquireEntrypointAdmission } from "../src/infra/runtime-control/bootstrap-admission.js";
import { inspectPendingRelocationStatus } from "../src/infra/runtime-control/installation.js";
import type { RuntimeAdmission } from "../src/infra/runtime-control/admission.js";

export type SecureEnvironmentEntrypoint = "cli" | "test-target-document-number";

export interface SecureEnvironmentBootstrapDependencies {
  readonly assertEnvironment?: () => void;
  readonly admitEnvironmentFile?: (path: string) => void;
  readonly runCli?: (admission: RuntimeAdmission) => Promise<void>;
  readonly runTestTargetDocumentNumberSmoke?: () => Promise<number>;
  readonly acquireAdmission?: (mode: "shared" | "exclusive") => RuntimeAdmission;
  readonly runRelocation?: (input: Readonly<{ workspace: string; args: readonly string[];
    admission?: RuntimeAdmission }>) => Promise<Readonly<{ operationId: string; generation: number }>>;
  readonly inspectRelocationStatus?: (workspace: string) => ReturnType<typeof inspectPendingRelocationStatus>;
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
  if (entrypoint === "cli" && entrypointArgs[0] === "storage" && entrypointArgs[1] === "relocate") {
    const { parseRelocationCommand, runOfflineStorageRelocation, StorageRelocationIncompleteError } = await import("../src/server/storage/relocate.js");
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
    admission.release();
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url) {
  await runSecureEnvironmentBootstrap();
}
