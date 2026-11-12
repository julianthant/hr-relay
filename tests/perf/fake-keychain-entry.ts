import { spawnSync } from "node:child_process";

const PRELOAD = "credential-keychain-process-preload.mjs";
const preloadUrl = new URL(`../support/helpers/${PRELOAD}`, import.meta.url).href;

// Perf fixtures create bound profiles, which write a credential key; a plain CLI run must never reach the real OS keychain.
// Vitest mocks the keyring itself. Anything else re-runs under the fake-keychain preload before an application module evaluates.
if (process.env.VITEST === undefined
  && !process.execArgv.some(argument => argument.includes(PRELOAD))
  && !(process.env.NODE_OPTIONS ?? "").includes(PRELOAD)) {
  const child = spawnSync(process.execPath, [...process.execArgv, `--import=${preloadUrl}`, ...process.argv.slice(1)], { stdio: "inherit" });
  if (child.error !== undefined) throw child.error;
  process.exit(child.status ?? 1);
}

/** Refuses to seed a perf fixture unless `@napi-rs/keyring` resolves to the test fake. */
export async function assertFakeKeychain(): Promise<void> {
  const { Entry } = await import("@napi-rs/keyring");
  if (typeof (Entry as unknown as { snapshot?: unknown }).snapshot !== "function") {
    throw new Error("perf fixtures need the fake keychain (vitest's mock or the credential keychain preload); refusing to write the real OS keychain");
  }
}
