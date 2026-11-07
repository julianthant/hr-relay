import { createActivityPopulationService } from "../../../runs/queries/activity-population.js";
import type { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";
import { runtimeTimeZone, type Clock } from "../../../../rules/time/clock.js";
import type { queryActivitySummaries } from "../../../runs/queries/activity-summaries.js";
import type { ActivityRouteDeps } from "../../../transports/http/routes/activity-types.js";

type ActivitySummaryDeps = Omit<Parameters<typeof queryActivitySummaries>[2], "timeZone">;
export function composeActivity(input: ActivitySummaryDeps & { database: AuthorityDatabase; clock: Clock; timeZone?: string }): ActivityRouteDeps {
  const activityPopulation = createActivityPopulationService({ ...input, timeZone: input.timeZone ?? runtimeTimeZone() });
  return { activity: activityPopulation.reports, activityPopulation };
}
