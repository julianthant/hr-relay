import { fileURLToPath, pathToFileURL } from "node:url";
import {
  admitLocalEnvironmentFile,
  assertNoMigratedEnvironmentKeys,
} from "../src/domain/secrets.js";

export type SecureEnvironmentEntrypoint = "cli" | "test-target-document-number";

export interface SecureEnvironmentBootstrapDependencies {
  readonly assertEnvironment?: () => void;
  readonly admitEnvironmentFile?: (path: string) => void;
  readonly runCli?: () => Promise<void>;
  readonly runTestTargetDocumentNumberSmoke?: () => Promise<number>;
}

/** The one production `.env`, anchored to this bootstrap rather than the caller's CWD. */
export function repositoryEnvironmentFilePath(): string {
  return fileURLToPath(new URL("../.env", import.meta.url));
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
  // `storage` (D322) and `test-data` (D341) are the only entrypoints that never load `.env`:
  // neither reads a credential, and test-data must not depend on the operator's environment.
  if (!(entrypoint === "cli" && (entrypointArgs[0] === "storage" || entrypointArgs[0] === "test-data"))) {
    (dependencies.assertEnvironment ?? (() => assertNoMigratedEnvironmentKeys()))();
    const environmentFilePath = repositoryEnvironmentFilePath();
    (dependencies.admitEnvironmentFile ?? ((path) => admitLocalEnvironmentFile(path)))(
      environmentFilePath,
    );
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
    await runCli();
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
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url) {
  await runSecureEnvironmentBootstrap();
}
