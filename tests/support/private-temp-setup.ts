import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareTestProcesses } from "./compiled-process-setup.js";

let directory: string | undefined;

/** One private temp directory for this Vitest process. Repeated project setup reuses it. */
export async function setup(): Promise<void> {
  if (directory !== undefined) return;
  directory = mkdtempSync(join(tmpdir(), "hrt-"));
  if (process.platform !== "win32") chmodSync(directory, 0o700);
  process.env.TMPDIR = directory;
  process.env.TMP = directory;
  process.env.TEMP = directory;
  await prepareTestProcesses(directory);
}

export function teardown(): void {
  if (directory === undefined || process.env.KEEP_TEST_TMP === "1") return;
  rmSync(directory, { recursive: true, force: true });
  directory = undefined;
}
