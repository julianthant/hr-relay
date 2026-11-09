import type { DatabaseSync } from "node:sqlite";

export function configureWritableConnection(database: DatabaseSync, busyTimeoutMs: number): void {
  database.exec("PRAGMA foreign_keys = ON");
  // Enable secure deletion so freed SQLite pages do not retain deleted run bytes.
  database.exec("PRAGMA secure_delete = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec(`PRAGMA busy_timeout = ${String(busyTimeoutMs)}`);
}
