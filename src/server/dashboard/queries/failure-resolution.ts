import { FailureResolutionCaptureSchema, type FailureResolutionCapture } from "../../../domain/trust/failure-resolution.js";
import type { AuthorityRepositories } from "../../../infra/sqlite/authority-database.js";
import { failureResolutionCapability } from "../../../domain/trust/failure-resolution.js";
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

/** Keep raw capture identity separate from the operator-facing protected-text projection. */
export function projectFailureResolution(capture: FailureResolutionCapture, protectedInput: boolean): FailureResolutionCapture {
  const parsed = FailureResolutionCaptureSchema.parse(capture);
  return protectedInput && parsed.resolution.status === "resolved" && parsed.resolution.note !== undefined
    ? { ...parsed, resolution: { ...parsed.resolution, note: "Protected resolution note withheld." } }
    : parsed;
}
