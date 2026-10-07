import { createActivitySelectionService } from "../../../runs/queries/activity-selection.js";
import type { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";
import { runtimeTimeZone, type Clock } from "../../../../rules/time/clock.js";
import { queryActivitySummaries } from "../../../runs/queries/activity-summaries.js";
import type { ActivityRouteDeps } from "../../../transports/http/routes/activity-types.js";

type ActivitySummaryDeps = Omit<Parameters<typeof queryActivitySummaries>[2], "timeZone">;
export function composeActivity(input: ActivitySummaryDeps & { database: AuthorityDatabase; clock: Clock; timeZone?:string }): ActivityRouteDeps["activity"] {
  const timeZone=input.timeZone??runtimeTimeZone();
  return createActivitySelectionService({ database:input.database,clock:input.clock,read:(from,to,generatedAt)=>queryActivitySummaries(input.database,
    { from, to, generatedAt }, {descriptors:input.descriptors,ledger:input.ledger,timeZone}) });
}
