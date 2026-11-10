/** A run claim: the worker id and the claim generation every later worker write is fenced by. */
import { z } from "zod";
import { CommandIdSchema, IsoInstantSchema, PositiveIntSchema, RunIdSchema, WorkerIdSchema } from "../../rules/identity/ids.js";

export const RunClaimTokenSchema = z.strictObject({ workerId: WorkerIdSchema, claimGeneration: PositiveIntSchema });
export type RunClaimToken = z.infer<typeof RunClaimTokenSchema>;
export const CanonicalCrashRecoveryRequestSchema = z.strictObject({ commandId: CommandIdSchema, runId: RunIdSchema,
  expectedVersion: PositiveIntSchema, claim: RunClaimTokenSchema, now: IsoInstantSchema });
