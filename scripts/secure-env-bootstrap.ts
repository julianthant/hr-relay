import { fileURLToPath, pathToFileURL } from "node:url";
import { admitLocalEnvironmentFile } from "../src/domain/secrets.js";

export type SecureEnvironmentEntrypoint = "cli" | "test-target-person-secrets";

export function secureEnvironmentEntrypoint(
  selector: string | undefined,
): SecureEnvironmentEntrypoint {
  if (selector === "cli" || selector === "test-target-person-secrets") return selector;
  throw new Error(
    "secure environment entrypoint must be cli or test-target-person-secrets",
  );
}

export async function runSecureEnvironmentBootstrap(
  args: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const [selector, ...entrypointArgs] = args;
  const entrypoint = secureEnvironmentEntrypoint(selector);
  admitLocalEnvironmentFile();

  if (entrypoint === "cli") {
    process.argv.splice(
      1,
      process.argv.length - 1,
      fileURLToPath(new URL("../src/cli.ts", import.meta.url)),
      ...entrypointArgs,
    );
    await import("../src/cli.js");
    return;
  }

  process.argv.splice(
    1,
    process.argv.length - 1,
    fileURLToPath(new URL("./smoke-test-target-person-secrets.ts", import.meta.url)),
    ...entrypointArgs,
  );
  const { runTestTargetPersonSecretsSmoke } = await import(
    "./smoke-test-target-person-secrets.js"
  );
  process.exitCode = await runTestTargetPersonSecretsSmoke();
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url) {
  await runSecureEnvironmentBootstrap();
}
