import type { DatabaseSync } from "node:sqlite";

/** The connection policy of the authority database (authority-database.ts #configureConnection), so test peers contend like production writers. */
export function applyProductionConnectionPolicy(database: DatabaseSync, busyTimeoutMs = 5000): void {
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec(`PRAGMA busy_timeout = ${String(busyTimeoutMs)}`);
}
