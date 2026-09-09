import type { RunDiagnosticCapture } from "../base/diagnostics.js";
import { FailureResolutionCapabilitySchema } from "../domain/trust/failure-resolution.js";
import type { CommandApplication } from "./command-application.js";
import type { FailureResolutionCommand } from "../domain/commands.js";
import type { AuthorityRepositories } from "../infra/sqlite/authority-database.js";
export function failureResolutionCapability(){return FailureResolutionCapabilitySchema.parse({state:"unavailable",reason:"resolution-not-implemented"});}
export function executeFailureResolution(_repositories:AuthorityRepositories,request:FailureResolutionCommand,_now:string):CommandApplication {
 return {result:{state:"rejected",commandId:request.commandId,code:"capability-unavailable",message:"Failure resolution is not available in this build."},versionChanges:[],affectedDependencyIds:[]};
}
/** Real capture passes through D's boundary without changing immutable evidence. */
export function bindFailureCapture(capture:RunDiagnosticCapture):RunDiagnosticCapture {
 return Object.freeze({captureForFailure:(context:Parameters<RunDiagnosticCapture["captureForFailure"]>[0])=>capture.captureForFailure(context),persist:(bundle:Parameters<RunDiagnosticCapture["persist"]>[0])=>capture.persist(bundle)});
}
