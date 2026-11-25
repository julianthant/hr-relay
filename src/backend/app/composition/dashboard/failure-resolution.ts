import type { AuthorityRepositories } from "../../../storage/sqlite/authority-repositories.js";
import { createFailureResolutionQuery } from "../../../runs/queries/failure-resolution.js";
import { createFailureResolutionCommands } from "../../../runs/commands/failure-resolution.js";
export function composeFailureResolution(authority:AuthorityRepositories){return Object.freeze({query:createFailureResolutionQuery(authority),commands:createFailureResolutionCommands()});}
