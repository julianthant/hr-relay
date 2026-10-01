import type { AuthorityDatabase } from "../../../../infra/sqlite/authority-database.js";
import { queryQueueSummaries } from "../../../../server/dashboard/queries/queue-summaries.js";
import type { ServedSummaryQueries } from "../../../../server/dashboard/projectors/run-queue-projection.js";
export function composeQueueSummaries(database: AuthorityDatabase): Omit<ServedSummaryQueries, "activity"> {
  return { withSnapshot: read => database.withAuthorityReadSnapshot(read), queue: input => queryQueueSummaries(database, input) };
}
