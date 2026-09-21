import { createActivitySelectionService } from "../queries/activity-selection.js";
import type { AuthorityDatabase } from "../../../infra/sqlite/authority-database.js";
import type { Clock } from "../../../domain/clock.js";
import { queryActivitySummaries } from "../queries/activity-summaries.js";
import type { ActivityRouteDeps } from "../routes/activity-types.js";

export function composeActivity(input: Parameters<typeof queryActivitySummaries>[2] & { database: AuthorityDatabase; clock: Clock }): ActivityRouteDeps["activity"] {
  return createActivitySelectionService({ database:input.database,clock:input.clock,read:(from,to,generatedAt)=>queryActivitySummaries(input.database,
    { from, to, generatedAt }, input) });
}
