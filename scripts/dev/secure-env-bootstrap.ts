import { pathToFileURL } from "node:url";

export async function runSecureEnvironmentEntrypoint(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  if (args[0] === "native-profile-probe") {
    if (args.length !== 1) throw new Error("native-profile-probe-extra-arguments");
    const { runNativeProfileProbeChild } = await import("../../src/backend/runtime/browser/native-profile-probe.js");
    await runNativeProfileProbeChild();
    return;
  }
  const { runSecureEnvironmentBootstrap } = await import("../../src/backend/app/bootstrap/secure-env-bootstrap.js");
  await runSecureEnvironmentBootstrap(args);
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url) {
  await runSecureEnvironmentEntrypoint();
}
