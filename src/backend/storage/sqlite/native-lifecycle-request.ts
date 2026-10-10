import { z } from "zod";
import { PublicRerunPlanSchema, SourceBoundRunSchema } from "../../../models/run/rerun.js";
import { RunLifecycleCommandRecordSchema } from "../../../rules/commands/commands.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { CanonicalWorkerAdmissionRequestSchema, CanonicalCreateRunRequestSchema, CanonicalClaimNextRequestSchema, CanonicalTransitionRequestSchema,
  CanonicalRenewClaimRequestSchema, CanonicalWorkerTransitionRequestSchema, CanonicalFailureTerminalizeRequestSchema,
  CanonicalSuccessTerminalizeRequestSchema, CanonicalCancellationTerminalizeRequestSchema, CanonicalRequeueRequestSchema,
  CanonicalRetrySourceRequestSchema, CanonicalDeleteRequestSchema, CanonicalPurgeRequestSchema } from "./run-store-contracts.js";

const schemas = {
  "worker-admission":CanonicalWorkerAdmissionRequestSchema, create:CanonicalCreateRunRequestSchema.extend({sourceBound:PublicRerunPlanSchema.extend({confirmationCommandId:SourceBoundRunSchema.shape.confirmationCommandId}).optional()}),"claim-next":CanonicalClaimNextRequestSchema,transition:CanonicalTransitionRequestSchema,
  "renew-claim":CanonicalRenewClaimRequestSchema,"worker-transition":CanonicalWorkerTransitionRequestSchema,
  terminalize:z.union([CanonicalFailureTerminalizeRequestSchema,CanonicalSuccessTerminalizeRequestSchema,CanonicalCancellationTerminalizeRequestSchema]),
  requeue:CanonicalRequeueRequestSchema,retry:CanonicalRetrySourceRequestSchema,restart:CanonicalRetrySourceRequestSchema,
  delete:CanonicalDeleteRequestSchema,purge:CanonicalPurgeRequestSchema,
};
export function validateNativeLifecycleRequest(input: unknown): void {
  const command = RunLifecycleCommandRecordSchema.parse(input);
  if (!Object.hasOwn(schemas,command.operation)) throw new Error("run-lifecycle-operation-unavailable");
  const operation = z.enum(["create","claim-next","transition","renew-claim","worker-transition","worker-admission","terminalize","requeue","retry","restart","delete","purge"]).parse(command.operation);
  const parsed = schemas[operation].parse(command.request);
  if (z.object({commandId:z.string()}).parse(parsed).commandId !== command.commandId
    || canonicalJsonStringify(parsed) !== canonicalJsonStringify(command.request)
    || command.requestFingerprint !== sha256Hex(`hrauto:run-lifecycle-command:v1\0${command.operation}\0${canonicalJsonStringify(parsed)}`)) {
    throw new Error("run-lifecycle-request-binding-mismatch");
  }
  let expectedFence: unknown;
  if (["create","claim-next","purge","worker-admission"].includes(operation)) expectedFence = {kind:"none"};
  else if (operation === "renew-claim" || operation === "worker-transition") expectedFence = {kind:"claim",...z.object({claim:z.object({workerId:z.string(),claimGeneration:z.number()})}).parse(parsed).claim};
  else if (operation === "terminalize") {
    const request = z.object({terminal:z.object({authorization:z.object({expectedVersion:z.number(),claim:z.object({workerId:z.string(),claimGeneration:z.number()})})}).optional(),
      expectedVersion:z.number().optional(),claim:z.object({workerId:z.string(),claimGeneration:z.number()}).optional()}).parse(parsed);
    const owner = request.terminal?.authorization ?? request;
    expectedFence = {kind:"terminal",expectedVersion:owner.expectedVersion,...owner.claim};
  } else expectedFence = {kind:"version",expectedVersion:z.object({expectedVersion:z.number()}).parse(parsed).expectedVersion};
  if (canonicalJsonStringify(expectedFence) !== canonicalJsonStringify(command.fence)) throw new Error("run-lifecycle-request-fence-mismatch");
}
