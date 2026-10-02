import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

/** Schema admission authenticates released layouts before this compatibility branch. */
export function hasHistoricalArchiveTables(database: DatabaseSync): boolean {
  return z.object({ user_version: z.number().int().nonnegative() }).parse(database.prepare("PRAGMA user_version").get()).user_version < 49;
}
export function unarchivedRunSql(database: DatabaseSync, key: string): string {
  return hasHistoricalArchiveTables(database)
    ? `NOT EXISTS (SELECT 1 FROM archived_runs archived WHERE archived.record_key = ${key})`
    : `NOT EXISTS (SELECT 1 FROM archive_transfers archived WHERE archived.record_key = ${key})`;
}
