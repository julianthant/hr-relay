import type { AuthorityDatabase } from "../../../infra/sqlite/authority-database.js";

/** Internal source for Q. Public aggregate and pagination contracts remain with Q/V. */
export function readRunSummarySource(database: AuthorityDatabase) {
  return database.readRunSummaries();
}

export function queryRunSummarySource(database:AuthorityDatabase,query:Parameters<AuthorityDatabase["queryRunSummaries"]>[0]) {
  return database.queryRunSummaries(query);
}
