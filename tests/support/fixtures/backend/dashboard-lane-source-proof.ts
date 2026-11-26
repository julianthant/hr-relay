import { chmodSync, renameSync, unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import "../../../../src/backend/storage/sqlite/dashboard-background-read-worker.js";
import { defineLaneRead, runReadLaneWorker } from "../../../../src/backend/storage/sqlite/dashboard-read-host.js";

const held = (path: string) => `${path}.held`;
/** Swaps the store for a copy at the same path, so its identity changes. */
function replaceSource(path: string): void {
  renameSync(path, held(path));
  new DatabaseSync(held(path), { readOnly: true }).exec(`VACUUM INTO '${path}'`);
  chmodSync(path, 0o600);
}
/** Puts the original store back at its path. */
export function restoreSource(path: string): void {
  unlinkSync(path);
  renameSync(held(path), path);
}

const PathArgs = z.strictObject({ path: z.string().min(1) });

/** A default read that replaces its source and runs one statement; it reports whether that statement refused, and restores the store. */
export const perStatementRead = defineLaneRead(import.meta.url, "source-proof-per-statement", { lane: "navigation", priority: "interactive", args: PathArgs,
  run(context, { path }) {
    replaceSource(path);
    try {
      context.history.getMeta();
      return { refusedInside: false };
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("profile-database-open-source-changed")) throw error;
      return { refusedInside: true };
    } finally { restoreSource(path); }
  } });

/** A per-read read that replaces its source and runs one statement; the store stays replaced until the test restores it. */
export const perReadRead = defineLaneRead(import.meta.url, "source-proof-per-read", { lane: "navigation", priority: "interactive", args: PathArgs,
  sourceProof: "per-read",
  run(context, { path }) {
    replaceSource(path);
    return { schemaVersion: context.history.getMeta().schemaVersion };
  } });

export const LANE_SOURCE_PROOF_ENTRY = new URL(import.meta.url);
runReadLaneWorker();
