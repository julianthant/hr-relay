/** Server-side bulk derivation; the public command schemas remain browser-safe. */
import type { z } from "zod";
import { CommandRequestSchema, type BulkRunCommandRequest, type CommandRequest } from "./commands.js";
import { deriveStableUuid } from "../identity/identifiers.js";
import { CommandIdSchema } from "../identity/ids.js";

/** Preserve the released v1 child identity and complete executable envelope. */
export function deriveBulkChildCommandId(bulkCommandId: string, runId: string): z.infer<typeof CommandIdSchema> {
  return CommandIdSchema.parse(deriveStableUuid("hrauto:bulk-run-child-command:v1", `${bulkCommandId}\0${runId}`));
}

export function deriveBulkChildCommand(request: BulkRunCommandRequest, target: BulkRunCommandRequest["targets"][number]): CommandRequest {
  return CommandRequestSchema.parse({
    commandId: deriveBulkChildCommandId(request.bulkCommandId, target.runId),
    requestedAt: request.requestedAt,
    requestedBy: request.requestedBy,
    source: request.source,
    ...(request.reason === undefined ? {} : { reason: request.reason }),
    family: "run",
    type: request.type,
    target,
  });
}
