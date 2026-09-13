/** Internal compatibility exports; query implementations have exclusive owners. */
import type { AuthorityDatabase } from "../../../infra/sqlite/authority-database.js";
export { QueueSummaryQuerySchema, queryQueueSummaries } from "./queue-summaries.js";
export { queryActivitySummaries } from "./activity-summaries.js";
export function readRunSummarySource(database: AuthorityDatabase) { return database.readRunSummaries(); }
export function queryRunSummarySource(database: AuthorityDatabase, query: Parameters<AuthorityDatabase["queryRunSummaries"]>[0]) { return database.queryRunSummaries(query); }
