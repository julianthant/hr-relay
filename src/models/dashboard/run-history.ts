import { z } from "zod";
import { CommandIdSchema } from "../../rules/identity/ids.js";
import { ProfileIdSchema } from "../profiles/profile.js";

export const RunHistoryCommandSchema = z.strictObject({ commandId: CommandIdSchema });
export type RunHistoryCommand = z.infer<typeof RunHistoryCommandSchema>;
export const RunHistoryTargetSchema = z.strictObject({ profileId: ProfileIdSchema, epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) });
export type RunHistoryTarget = z.infer<typeof RunHistoryTargetSchema>;
export const ClearRunHistoryRequestSchema = RunHistoryCommandSchema.extend({ target: RunHistoryTargetSchema });
export type ClearRunHistoryRequest = z.infer<typeof ClearRunHistoryRequestSchema>;

export const RunHistoryStatusSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("available"), finishedRuns: z.number().int().nonnegative(), activeRuns: z.number().int().nonnegative() }),
  z.strictObject({ state: z.literal("unavailable") }),
]);
export type RunHistoryStatus = z.infer<typeof RunHistoryStatusSchema>;

export const ClearRunHistoryResultSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("not-recorded"), commandId: CommandIdSchema }),
  z.strictObject({ state: z.literal("cleared"), commandId: CommandIdSchema, deletedRuns: z.number().int().nonnegative() }),
  z.strictObject({ state: z.literal("refused"), commandId: CommandIdSchema,
    reason: z.enum(["active-runs", "shared-checkpoint", "unresolved-write", "replay-divergent", "unavailable"]) }),
]);
export type ClearRunHistoryResult = z.infer<typeof ClearRunHistoryResultSchema>;

export const RUN_HISTORY_REFUSALS: Record<Extract<ClearRunHistoryResult, { state: "refused" }>["reason"], string> = {
  "active-runs": "Finish or cancel all active runs before clearing run history.",
  "shared-checkpoint": "Run evidence is still referenced by retained records. History could not be cleared.",
  "unresolved-write": "A change still has an unresolved outcome. Resolve it before clearing run history.",
  "replay-divergent": "This action’s identity was already used for another request. Refresh Storage before continuing.",
  unavailable: "Run history is unavailable. Reconnect to Relay and refresh Storage.",
};
