import { createActivitySelectionService } from "../queries/activity-selection.js";
import type { AuthorityDatabase } from "../../../infra/sqlite/authority-database.js";
import { runtimeTimeZone, type Clock } from "../../../domain/clock.js";
import { queryActivitySummaries } from "../queries/activity-summaries.js";
import type { ActivityRouteDeps } from "../routes/activity-types.js";

type ActivitySummaryDeps = Omit<Parameters<typeof queryActivitySummaries>[2], "timeZone">;
export function composeActivity(input: ActivitySummaryDeps & { database: AuthorityDatabase; clock: Clock; timeZone?:string }): ActivityRouteDeps["activity"] {
  const timeZone=input.timeZone??runtimeTimeZone();
  return createActivitySelectionService({ database:input.database,clock:input.clock,read:(from,to,generatedAt)=>queryActivitySummaries(input.database,
    { from, to, generatedAt }, {descriptors:input.descriptors,ledger:input.ledger,timeZone}) });
}
