import { z } from "zod";
import { WriteIntentParkCodeSchema } from "../../storage/sqlite/write-commit-contracts.js";
import { RunLifecycleRefusedError, type RunMutationOutcome } from "../../runs/lifecycle/run-record-service.js";
import { DelegationPendingSchema } from "./durable-child-executor.js";

export const RunExecutionOutcomeSchema = z.discriminatedUnion("state", [
  DelegationPendingSchema.extend({ state: z.literal("yielded-delegation") }),
  z.strictObject({ state: z.literal("done"), runId: z.string().min(1) }),
  z.strictObject({ state: z.literal("failed"), runId: z.string().min(1), failureId: z.string().min(1) }),
  z.strictObject({ state: z.literal("parked-gate"), runId: z.string().min(1), gateId: z.string().min(1) }),
  // Post-fence parking is already durable; the interpreter must not overwrite it with ordinary failure.
  z.strictObject({
    state: z.literal("parked-write"),
    runId: z.string().min(1),
    writeIntentId: z.string().min(1),
    intentGeneration: z.number().int().positive(),
    code: WriteIntentParkCodeSchema,
  }),
  z.strictObject({ state: z.literal("abandoned"), runId: z.string().min(1), reason: z.string().min(1) }),
]);
export type RunExecutionOutcome = z.infer<typeof RunExecutionOutcomeSchema>;

/** The claim is gone — cancelled, swept, or re-owned. Not a failure to settle. */
export class RunAbandonedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunAbandonedError";
  }
}

export class RunPauseRequestedError extends RunAbandonedError {}
export class RunCancellationRequestedError extends RunAbandonedError {}

/** The worker's abort of the current step for a pause or stop request it read from the run. */
export class RunControlAbortError extends Error {
  constructor() {
    super("worker-run-control-current-work");
    this.name = "RunControlAbortError";
  }
}

export class RunTerminalAdmissionLostError extends RunLifecycleRefusedError {
  constructor(outcome: RunMutationOutcome, readonly admissionVersion: number) { super(outcome); }
}
