import type { AuthorityDatabase } from "../../../infra/sqlite/authority-database.js";
import { queryQueueSummaries } from "../queries/queue-summaries.js";
import type { ServedSummaryQueries } from "../projectors/run-queue-projection.js";
export function composeQueueSummaries(database: AuthorityDatabase): Omit<ServedSummaryQueries, "activity"> {
  return { withSnapshot: read => database.withAuthorityReadSnapshot(read), queue: input => queryQueueSummaries(database, input) };
}
