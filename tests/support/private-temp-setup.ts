import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareTestProcesses } from "./compiled-process-setup.js";

const tempKeys = ["TMPDIR", "TMP", "TEMP"] as const;
const loaderKey = "RELAY_TEST_PROCESS_IMPORT";
let invocation: { directory: string; previous: NodeJS.ProcessEnv; loader: string | undefined } | undefined;

/** One private temp directory for this Vitest process. Repeated project setup reuses it. */
export async function setup(): Promise<void> {
  if (invocation !== undefined) return;
  const previous = Object.fromEntries([...tempKeys, loaderKey].map(key => [key, process.env[key]]));
  const directory = mkdtempSync(join(tmpdir(), "hrt-"));
  invocation = { directory, previous, loader: process.env[loaderKey] };
  try {
    if (process.platform !== "win32") chmodSync(directory, 0o700);
    for (const key of tempKeys) process.env[key] = directory;
    const loader = await prepareTestProcesses(directory);
    invocation.loader = loader;
    process.env[loaderKey] = loader;
  } catch (error) {
    try { restoreEnvironment(process.env.KEEP_TEST_TMP === "1"); }
    catch (cleanup) { throw new AggregateError([error, cleanup], "private test temp setup and cleanup failed", { cause: error }); }
    throw error;
  }
}

export function teardown(): void {
  if (process.env.KEEP_TEST_TMP !== "1") restoreEnvironment(false);
}

function restoreEnvironment(keepDirectory: boolean): void {
  if (invocation === undefined) return;
  const { directory, previous, loader } = invocation;
  try {
    if (!keepDirectory) rmSync(directory, { recursive: true, force: true });
  } finally {
    invocation = undefined;
    for (const key of [...tempKeys, loaderKey]) {
      if (process.env[key] !== (key === loaderKey ? loader : directory)) continue;
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
