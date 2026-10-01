import type { AuthorityRepositories } from "../../../../infra/sqlite/authority-database.js";
import { createFailureResolutionQuery } from "../../../runs/dashboard/queries/failure-resolution.js";
import { createFailureResolutionCommands } from "../../../runs/dashboard/commands/failure-resolution.js";
export function composeFailureResolution(authority:AuthorityRepositories){return Object.freeze({query:createFailureResolutionQuery(authority),commands:createFailureResolutionCommands()});}
