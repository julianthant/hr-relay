import type { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";
import { queryQueueSummaries } from "../../../runs/dashboard/queries/queue-summaries.js";
import type { ServedSummaryQueries } from "../../../runs/dashboard/projectors/run-queue-projection.js";
export function composeQueueSummaries(database: AuthorityDatabase): Omit<ServedSummaryQueries, "activity"> {
  return { withSnapshot: read => database.withAuthorityReadSnapshot(read), queue: input => queryQueueSummaries(database, input) };
}
