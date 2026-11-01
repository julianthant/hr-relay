import { pathToFileURL } from "node:url";

export async function runSecureEnvironmentEntrypoint(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  const { runSecureEnvironmentBootstrap } = await import("../../src/backend/app/bootstrap/secure-env-bootstrap.js");
  await runSecureEnvironmentBootstrap(args);
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url) {
  await runSecureEnvironmentEntrypoint();
}
