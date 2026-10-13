import type { z } from "zod";
import { CommandRequestSchema, type BulkRunCommandRequest, type CommandRequest } from "./commands.js";
import { sha256Hex } from "../validation/sha256.js";
import { CommandIdSchema } from "../identity/ids.js";

/** Preserve the released v1 child identity and complete executable envelope. */
export function deriveBulkChildCommandId(bulkCommandId: string, runId: string): z.infer<typeof CommandIdSchema> {
  const digest = sha256Hex(`hrauto:bulk-run-child-command:v1\0${bulkCommandId}\0${runId}`);
  return CommandIdSchema.parse([
    digest.slice(0, 8), digest.slice(8, 12), `5${digest.slice(13, 16)}`,
    `${"89ab"[Number.parseInt(digest[16], 16) % 4]}${digest.slice(17, 20)}`, digest.slice(20, 32),
  ].join("-"));
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
