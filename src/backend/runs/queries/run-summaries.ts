import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
export { queryQueueSummaries } from "./queue-summaries.js";
export { queryActivitySummaries } from "./activity-summaries.js";
export function queryRunSummarySource(database: AuthorityDatabase, query: Parameters<AuthorityDatabase["queryRunSummaries"]>[0]) { return database.queryRunSummaries(query); }
