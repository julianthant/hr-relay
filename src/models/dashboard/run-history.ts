import { z } from "zod";
import { CommandIdSchema } from "../../rules/identity/ids.js";
import { ProfileIdSchema } from "../profiles/profile.js";

export const RunHistoryCommandSchema = z.strictObject({ commandId: CommandIdSchema });
export type RunHistoryCommand = z.infer<typeof RunHistoryCommandSchema>;
export const RunHistoryTargetSchema = z.strictObject({ profileId: ProfileIdSchema, epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) });
export type RunHistoryTarget = z.infer<typeof RunHistoryTargetSchema>;
export const ClearRunHistoryRequestSchema = RunHistoryCommandSchema.extend({ target: RunHistoryTargetSchema });
export type ClearRunHistoryRequest = z.infer<typeof ClearRunHistoryRequestSchema>;

export const ClearRunHistoryResultSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("not-recorded"), commandId: CommandIdSchema }),
  z.strictObject({ state: z.literal("cleared"), commandId: CommandIdSchema, deletedRuns: z.number().int().nonnegative() }),
  z.strictObject({ state: z.literal("refused"), commandId: CommandIdSchema,
    reason: z.enum(["active-runs", "shared-checkpoint", "unresolved-write", "replay-divergent", "unavailable"]) }),
]);
export type ClearRunHistoryResult = z.infer<typeof ClearRunHistoryResultSchema>;
