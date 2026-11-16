import { z } from "zod";
import { BrowserSessionIdSchema, FingerprintSchema, IsoInstantSchema, PositiveIntSchema, WorkerIdSchema } from "../../rules/identity/ids.js";

export const ExclusiveSessionLeaseSchema = z.strictObject({
  identityKey: FingerprintSchema,
  generation: PositiveIntSchema,
  workerId: WorkerIdSchema,
  workerLeaseGeneration: PositiveIntSchema,
  sessionId: BrowserSessionIdSchema,
  acquiredAt: IsoInstantSchema,
  releasedAt: IsoInstantSchema.nullable(),
});
export type ExclusiveSessionLease = z.infer<typeof ExclusiveSessionLeaseSchema>;
