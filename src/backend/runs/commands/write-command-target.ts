import { FingerprintSchema } from "../../../rules/identity/ids.js";
import type { ActionWriteTargetSchema } from "../../../models/dashboard/actions.js";
import type { z } from "zod";
import { CommandRequestSchema, type CommandRequest } from "../../../rules/commands/commands.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import { rejectCommandRequest } from "./command-refusal.js";

type OccurrenceTarget = Pick<z.input<typeof ActionWriteTargetSchema>, "writeIntentId" | "intentGeneration" | "writeAttemptId" | "occurrenceKeyDigest">;

export function publicWriteTarget<Target extends OccurrenceTarget>(target: Target) {
  return { ...target, occurrenceKeyDigest: FingerprintSchema.parse(sha256Hex(canonicalJsonStringify({ domain: "relay:write-occurrence-token:v1",
    writeIntentId: target.writeIntentId, intentGeneration: target.intentGeneration, writeAttemptId: target.writeAttemptId }))) };
}

export function publicWriteCommand(request: CommandRequest): CommandRequest {
  if (request.family === "worker-browser" && request.type === "check-parked-write") {
    return { ...request, target: publicWriteTarget(request.target) };
  }
  if (request.family === "run" && (request.type === "recheck-write" || request.type === "resolve-write-absent")) {
    const target = publicWriteTarget({ ...request.target, ...request.payload });
    return { ...request, payload: { ...request.payload, occurrenceKeyDigest: target.occurrenceKeyDigest } };
  }
  return request;
}

export function resolveWriteCommandTarget(request: CommandRequest, repositories: Readonly<{
  commands: Pick<AuthorityRepositories["commands"], "get">;
  writeIntents: Pick<AuthorityRepositories["writeIntents"], "get">;
}>): CommandRequest {
  const target = request.family === "worker-browser" && request.type === "check-parked-write" ? request.target
    : request.family === "run" && (request.type === "recheck-write" || request.type === "resolve-write-absent")
      ? { ...request.target, ...request.payload } : undefined;
  if (target === undefined) return request;
  const retained = repositories.commands.get(request.commandId);
  if (retained !== undefined) {
    if (canonicalJsonStringify(publicWriteCommand(retained)) !== canonicalJsonStringify(request)) {
      rejectCommandRequest(request, "command-divergent", "The write command differs from its retained target.");
    }
    return retained;
  }
  const intent = repositories.writeIntents.get(target.writeIntentId);
  if (intent === undefined) rejectCommandRequest(request, "target-not-found", "The write occurrence is unavailable.");
  if (intent.status !== "parked") rejectCommandRequest(request, "invalid-state", "The write occurrence is no longer parked.");
  const expected = publicWriteTarget({ writeIntentId: intent.writeIntentId, intentGeneration: intent.generation,
    writeAttemptId: intent.currentAttemptId, occurrenceKeyDigest: intent.idempotencyKeyDigest });
  if (target.intentGeneration !== expected.intentGeneration || target.writeAttemptId !== expected.writeAttemptId
    || target.occurrenceKeyDigest !== expected.occurrenceKeyDigest) {
    rejectCommandRequest(request, "invalid-state", "The write occurrence changed. Reload before deciding.");
  }
  return CommandRequestSchema.parse(request.family === "worker-browser"
    ? { ...request, target: { ...request.target, occurrenceKeyDigest: intent.idempotencyKeyDigest } }
    : { ...request, payload: { occurrenceKeyDigest: intent.idempotencyKeyDigest,
      ...(request.family === "run" && request.type === "recheck-write" && request.payload.transactionId !== undefined
        ? { transactionId: request.payload.transactionId } : {}) } });
}
