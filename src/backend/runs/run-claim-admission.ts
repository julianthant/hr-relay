import type { RuntimeConfigClaimToken } from "../../domain/config/runtime-generation.js";
import type { AuthorityRepositories } from "../../infra/sqlite/authority-database.js";
/** Configuration authorization is separate from worker ownership fencing. */
export function runRuntimeMatches(repositories:Pick<AuthorityRepositories,"runtimeConfig"|"settingsCurrent">,token:RuntimeConfigClaimToken):boolean {
 return repositories.runtimeConfig.matchesClaim(token);
}
