import type { AuthorityRepositories } from "../../../infra/sqlite/authority-database.js";
import { failureResolutionCapability } from "../../../core/failure-resolution.js";
export function createFailureResolutionQuery(authority:Pick<AuthorityRepositories,"failures"|"failureResolution">){
 return Object.freeze({
  capability:failureResolutionCapability,
  getFailure(failureId:string){
   const failure=authority.failures.get(failureId);
   if(failure!==undefined&&authority.failureResolution.read(failure.runId,failure.failureId)===undefined)throw new Error("failure-resolution-annotation-missing");
   return failure;
  },
  read(runId:string,failureId:string){return authority.failureResolution.read(runId,failureId);},
 });
}
