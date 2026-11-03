import { z } from "zod";
import { PositiveIntSchema, RunIdSchema } from "../../rules/identity/ids.js";
import { RunPauseSchema } from "../run/record.js";

export const ApplicationLifecycleSchema = z.strictObject({
  runtimeGeneration: PositiveIntSchema,
  state: z.enum(["ready", "pausing", "blocked", "quitting"]),
  targets: z.array(z.strictObject({ runId: RunIdSchema, expectedVersion: PositiveIntSchema,
    pause: RunPauseSchema.optional(), pauseUnavailable: z.boolean().optional() })),
  update: z.enum(["installer-unavailable", "deferred", "idle", "pending"]),
});
export type ApplicationLifecycle = z.infer<typeof ApplicationLifecycleSchema>;
