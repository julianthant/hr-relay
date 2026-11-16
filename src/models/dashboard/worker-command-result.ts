import { z } from "zod";
import { CommandResultSchema, WorkerBrowserCommandRequestSchema } from "../../rules/commands/commands.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../rules/identity/ids.js";

export const WorkerCommandResultWireSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("unavailable") }),
  z.strictObject({ state: z.literal("recorded"), request: WorkerBrowserCommandRequestSchema, result: CommandResultSchema }).superRefine((record, context) => {
    if (record.request.commandId !== record.result.commandId || record.request.requestedBy !== LOCAL_OPERATOR_ACTOR_ID
      || record.result.state === "pending") context.addIssue({ code: "custom", message: "worker command result identity mismatch" });
  }),
]);
export type WorkerCommandResultWire = z.infer<typeof WorkerCommandResultWireSchema>;
