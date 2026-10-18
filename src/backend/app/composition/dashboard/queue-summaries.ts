import type { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";
import { queryQueueSummaries } from "../../../runs/queries/queue-summaries.js";
import type { ServedSummaryQueries } from "../../../runs/projections/run-queue-projection.js";
export function composeQueueSummaries(database: AuthorityDatabase): Omit<ServedSummaryQueries, "activity"> {
  return { withSnapshot: read => database.withAuthorityReadSnapshot(read), queue: input => queryQueueSummaries(database, input), itemAttempts: items => database.listQueueItemAttempts(items) };
}
