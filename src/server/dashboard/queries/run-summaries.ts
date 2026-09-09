import type { AuthorityDatabase } from "../../../infra/sqlite/authority-database.js";

/** Internal source for Q. Public aggregate and pagination contracts remain with Q/V. */
export function readRunSummarySource(database: AuthorityDatabase) {
  return database.readRunSummaries();
}
