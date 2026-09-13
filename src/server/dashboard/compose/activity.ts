import type { AuthorityDatabase } from "../../../infra/sqlite/authority-database.js";
import type { Clock } from "../../../domain/clock.js";
import { queryActivitySummaries } from "../queries/activity-summaries.js";
import type { ActivityRouteDeps } from "../routes/activity-types.js";

export function composeActivity(input: Parameters<typeof queryActivitySummaries>[2] & { database: AuthorityDatabase; clock: Clock }): ActivityRouteDeps["activity"] {
  return Object.freeze({ read: (from: string, to: string) => queryActivitySummaries(input.database,
    { from, to, generatedAt: input.clock.now().toISOString() }, input) });
}
