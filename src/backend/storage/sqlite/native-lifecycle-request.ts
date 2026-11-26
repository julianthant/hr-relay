import { CanonicalCrashRecoveryRequestSchema } from "../../../models/run/worker.js";
import { RunHistoryCommandSchema } from "../../../models/dashboard/run-history.js";
import { z } from "zod";
import { DelegationAdmissionRequestSchema, DelegationInvocationRequestSchema, DelegationSettlementRequestSchema, DelegationRefreshRequestSchema, DelegationRetryRequestSchema } from "./delegation-contracts.js";
import { PublicRerunPlanSchema, SourceBoundRunSchema } from "../../../models/run/rerun.js";
import { RunLifecycleCommandRecordSchema } from "../../../rules/commands/commands.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { ApplicationAdmissionRequestSchema, CanonicalPauseRequestSchema, CanonicalAcknowledgePauseRequestSchema, CanonicalCreateRunRequestSchema, CanonicalClaimNextRequestSchema, CanonicalTransitionRequestSchema, CanonicalRenewClaimRequestSchema, CanonicalWorkerTransitionRequestSchema, CanonicalFailureTerminalizeRequestSchema, CanonicalSuccessTerminalizeRequestSchema, CanonicalCancellationTerminalizeRequestSchema, CanonicalRequeueRequestSchema, CanonicalRetrySourceRequestSchema, CanonicalRecoverRunRequestSchema, CanonicalDeleteRequestSchema, CanonicalPurgeRequestSchema } from "./run-store-contracts.js";

const schemas = {
  "application-admission": ApplicationAdmissionRequestSchema,
  pause: CanonicalPauseRequestSchema, resume: CanonicalPauseRequestSchema, "acknowledge-pause": CanonicalAcknowledgePauseRequestSchema,
  "recover-crash": CanonicalCrashRecoveryRequestSchema,
  "delegation-invocation": DelegationInvocationRequestSchema,
  "delegation-admission": DelegationAdmissionRequestSchema,
  "delegation-settlement": DelegationSettlementRequestSchema,
  "delegation-refresh": DelegationRefreshRequestSchema, DelegationRefreshRequestSchema,
  "delegation-retry": DelegationRetryRequestSchema,
  create:CanonicalCreateRunRequestSchema.extend({sourceBound:PublicRerunPlanSchema.extend({confirmationCommandId:SourceBoundRunSchema.shape.confirmationCommandId}).optional()}),"claim-next":CanonicalClaimNextRequestSchema,transition:CanonicalTransitionRequestSchema,
  "renew-claim":CanonicalRenewClaimRequestSchema,"worker-transition":CanonicalWorkerTransitionRequestSchema,
  terminalize:z.union([CanonicalFailureTerminalizeRequestSchema,CanonicalSuccessTerminalizeRequestSchema,CanonicalCancellationTerminalizeRequestSchema]),
  recover:CanonicalRecoverRunRequestSchema,requeue:CanonicalRequeueRequestSchema,retry:CanonicalRetrySourceRequestSchema,
  delete:CanonicalDeleteRequestSchema,purge:CanonicalPurgeRequestSchema,
  "clear-history": RunHistoryCommandSchema,
};
const LifecycleOperationSchema = z.enum(["application-admission","pause","resume","acknowledge-pause","delegation-invocation","delegation-admission","delegation-settlement","delegation-refresh","delegation-retry","create","claim-next","transition","recover-crash","renew-claim","worker-transition","terminalize","requeue","retry","recover","delete","purge","clear-history"]);
const CommandBindingSchema = z.object({ commandId: z.string() });
const VersionFenceSourceSchema = z.object({ expectedVersion: z.number() });
const ClaimSchema = z.object({ workerId: z.string(), claimGeneration: z.number() });
const ClaimFenceSourceSchema = z.object({ claim: ClaimSchema });
const TerminalFenceSourceSchema = z.object({
  terminal: z.object({ authorization: VersionFenceSourceSchema.extend({ claim: ClaimSchema }) }).optional(),
  expectedVersion: z.number().optional(),
  claim: ClaimSchema.optional(),
});

function fingerprintCanonicalRequest(operation: string, requestJson: string): string {
  return sha256Hex(`hrauto:run-lifecycle-command:v1\0${operation}\0${requestJson}`);
}

export function runLifecycleRequestFingerprint(operation: string, request: unknown): string {
  return fingerprintCanonicalRequest(operation, canonicalJsonStringify(request));
}
export function validateNativeLifecycleRequest(input: unknown): void {
  const command = RunLifecycleCommandRecordSchema.parse(input);
  if (!Object.hasOwn(schemas,command.operation)) throw new Error("run-lifecycle-operation-unavailable");
  const operation = LifecycleOperationSchema.parse(command.operation);
  const parsed = schemas[operation].parse(command.request);
  const requestJson = canonicalJsonStringify(parsed);
  if (CommandBindingSchema.parse(parsed).commandId !== command.commandId
    || requestJson !== canonicalJsonStringify(command.request)
    || command.requestFingerprint !== fingerprintCanonicalRequest(command.operation, requestJson)) {
    throw new Error("run-lifecycle-request-binding-mismatch");
  }
  let expectedFence: unknown;
  if (["application-admission","delegation-invocation","create","claim-next","purge","clear-history"].includes(operation)) expectedFence = {kind:"none"};
  else if (operation === "delegation-admission") {
    const request = DelegationAdmissionRequestSchema.parse(parsed);
    expectedFence = { kind: "terminal", expectedVersion: request.expectedVersion, ...request.claim };
  }
  else if (operation === "renew-claim" || operation === "worker-transition" || operation === "acknowledge-pause") expectedFence = {kind:"claim",...ClaimFenceSourceSchema.parse(parsed).claim};
  else if (operation === "recover-crash") {
    const request = CanonicalCrashRecoveryRequestSchema.parse(parsed);
    expectedFence = { kind: "terminal", expectedVersion: request.expectedVersion, ...request.claim };
  }
  else if (operation === "terminalize") {
    const request = TerminalFenceSourceSchema.parse(parsed);
    const owner = request.terminal?.authorization ?? request;
    expectedFence = {kind:"terminal",expectedVersion:owner.expectedVersion,...owner.claim};
  } else expectedFence = {kind:"version",expectedVersion:VersionFenceSourceSchema.parse(parsed).expectedVersion};
  if (canonicalJsonStringify(expectedFence) !== canonicalJsonStringify(command.fence)) throw new Error("run-lifecycle-request-fence-mismatch");
}
