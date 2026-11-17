import { createActivityPopulationService } from "../../../runs/queries/activity-population.js";
import type { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";
import type { Clock } from "../../../../rules/time/clock.js";
import type { queryActivitySummaries } from "../../../runs/queries/activity-summaries.js";
import type { ActivityRouteDeps } from "../../../transports/http/routes/activity-types.js";

type ActivitySummaryDeps = Parameters<typeof queryActivitySummaries>[2];
export function composeActivity(input: ActivitySummaryDeps & { database: AuthorityDatabase; clock: Clock }): ActivityRouteDeps {
  const activityPopulation = createActivityPopulationService(input);
  return { activity: activityPopulation.reports, activityPopulation };
}
