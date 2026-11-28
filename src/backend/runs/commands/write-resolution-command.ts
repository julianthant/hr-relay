import { type RunRecord, RunRecordSchema } from "../../../models/run/record.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { type WriteIntentRecord, WriteIntentRecordSchema } from "../../../rules/write-safety/write-safety.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-repositories.js";
import { runTarget } from "../lifecycle/run-fan-out.js";
import { applied, type CommandApplication } from "./command-application.js";
import type { CommandKernelDependencies } from "./command-kernel.js";
import { conflict, reject } from "./command-refusal.js";
import { requireRun, type RunCommand } from "./run-command-context.js";
import { z } from "zod";

type WriteResolutionCommand = Extract<RunCommand, { type: "recheck-write" | "resolve-write-absent" | "fail-read-back" }>;

export interface WriteResolutionContext {
  readonly command: WriteResolutionCommand;
  readonly run: RunRecord;
  readonly intent: WriteIntentRecord;
  readonly now: string;
  readonly auditId: string;
}

const WriteResolutionOutcomeSchema = z.strictObject({ run: RunRecordSchema, intent: WriteIntentRecordSchema });
interface PreparedWriteResolution {
  readonly outcome: z.infer<typeof WriteResolutionOutcomeSchema>;
  applyAfterAudit(): z.infer<typeof WriteResolutionOutcomeSchema>;
}

export interface WriteResolutionExecutor {
  recheck(repositories: AuthorityRepositories, context: WriteResolutionContext): PreparedWriteResolution;
  resolveAbsent(repositories: AuthorityRepositories, context: WriteResolutionContext): PreparedWriteResolution;
}

export function executeWriteResolution(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: WriteResolutionCommand,
  now: string,
  auditId: string,
): CommandApplication {
  const current = requireRun(repositories, request, request.target.runId);
  if (current.version !== request.target.expectedVersion) {
    conflict(
      request,
      current.version,
      `run ${request.target.runId} is at version ${String(current.version)}, not `
      + `${String(request.target.expectedVersion)}; refresh before resolving the write`,
    );
  }
  if (current.lifecycle.state !== "parked-write") {
    reject(
      request,
      "invalid-state",
      `run ${request.target.runId} is ${current.lifecycle.state}; only a parked-write run has a write to resolve`,
    );
  }
  if (current.lifecycle.writeIntentId !== request.target.writeIntentId
    || current.lifecycle.intentGeneration !== request.target.intentGeneration) {
    reject(
      request,
      "invalid-state",
      `run ${request.target.runId} is parked on intent ${current.lifecycle.writeIntentId} `
      + `generation ${String(current.lifecycle.intentGeneration)}, not `
      + `${request.target.writeIntentId} generation ${String(request.target.intentGeneration)}; `
      + "the resolution is stale",
    );
  }
  const intent = repositories.writeIntents.get(request.target.writeIntentId);
  if (intent === undefined) {
    throw new Error(
      `run ${request.target.runId} is parked on write intent ${request.target.writeIntentId}, `
      + "which does not exist in authority; refusing to resolve against an inconsistent store",
    );
  }
  if (intent.status !== "parked") {
    reject(
      request,
      "invalid-state",
      `write intent ${request.target.writeIntentId} is ${intent.status}; a ${intent.status} intent has no operator resolution`,
    );
  }
  if (intent.runId !== request.target.runId) {
    throw new Error(
      `run ${request.target.runId} is parked on write intent ${request.target.writeIntentId}, `
      + `but that intent belongs to run ${intent.runId}; refusing to resolve against an inconsistent store`,
    );
  }
  if (intent.generation !== request.target.intentGeneration) {
    reject(
      request,
      "invalid-state",
      `write intent ${request.target.writeIntentId} is at generation ${String(intent.generation)}, not `
      + `${String(request.target.intentGeneration)}; the resolution is stale`,
    );
  }

  if (intent.currentAttemptId !== request.target.writeAttemptId || intent.bindingProofDigest !== request.target.bindingProofDigest
    || intent.idempotencyKeyDigest !== request.payload.occurrenceKeyDigest) reject(request,"invalid-state","Resolution must bind the exact original parked attempt and permanent occurrence key");
  const context: WriteResolutionContext = Object.freeze({ command: request, run: current, intent, now, auditId });
  const raw = request.type === "resolve-write-absent"
    ? dependencies.writeResolution.resolveAbsent(repositories, context)
    : dependencies.writeResolution.recheck(repositories, context);
  const outcome = WriteResolutionOutcomeSchema.parse(raw.outcome);
  if (outcome.run.envelope.runId !== request.target.runId) {
    throw new Error(
      `write resolution for run ${request.target.runId} returned run ${outcome.run.envelope.runId}; `
      + "the executor resolved a different target",
    );
  }
  if (outcome.run.version !== current.version + 1) throw new Error("parked-write-resolution-planned-version-mismatch");
  const application = applied(request, [runTarget(request.target.runId)], [{
    target: runTarget(request.target.runId),
    before: current.version,
    after: outcome.run.version,
  }]);
  return {...application,writeResolution:outcome.intent,afterAudit:()=>{
    const actual = WriteResolutionOutcomeSchema.parse(raw.applyAfterAudit());
    if (canonicalJsonStringify(actual) !== canonicalJsonStringify(outcome)
      || canonicalJsonStringify(repositories.runs.get(request.target.runId)) !== canonicalJsonStringify(outcome.run)
      || canonicalJsonStringify(repositories.writeIntents.get(request.target.writeIntentId)) !== canonicalJsonStringify(outcome.intent)) throw new Error("parked-write-resolution-acknowledged-effects-mismatch");
  }};
}
