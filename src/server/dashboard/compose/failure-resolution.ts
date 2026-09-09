import type { AuthorityRepositories } from "../../../infra/sqlite/authority-database.js";
import { createFailureResolutionQuery } from "../queries/failure-resolution.js";
import { createFailureResolutionCommands } from "../commands/failure-resolution.js";
export function composeFailureResolution(authority:AuthorityRepositories){return Object.freeze({query:createFailureResolutionQuery(authority),commands:createFailureResolutionCommands()});}
