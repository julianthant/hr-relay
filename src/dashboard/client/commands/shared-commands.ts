import {
BulkRunCommandRequestSchema,
BulkRunCommandResponseSchema,
CommandRequestSchema,
CommandResultSchema,
type BulkRunCommandResponse,
type CommandResult
} from "../../../rules/commands/commands.js";
import { parseOrThrow } from "../queries/query-parse.js";
import type { DashboardTransport } from "../transport.js";


export interface SharedCommands {

  executeCommand(request: unknown): Promise<CommandResult>;

  /** One request, N CAS-bound transitions, N outcomes. The client parses
 * the vector verbatim for the same reason it parses a single result verbatim */
  executeBulkCommand(request: unknown): Promise<BulkRunCommandResponse>;
}

export function createSharedCommands(transport: DashboardTransport): SharedCommands { return Object.freeze({

    async executeCommand(request: unknown): Promise<CommandResult> {
      const command = CommandRequestSchema.parse(request);
      const response = await transport.requestJson("/api/v1/commands", {
        method: "POST",
        body: JSON.stringify(command),
      });
      return parseOrThrow(CommandResultSchema, "POST /api/v1/commands", response);
    },

    async executeBulkCommand(request: unknown): Promise<BulkRunCommandResponse> {
      const bulk = BulkRunCommandRequestSchema.parse(request);
      const response = await transport.requestJson("/api/v1/commands/bulk", {
        method: "POST",
        body: JSON.stringify(bulk),
      });
      return parseOrThrow(BulkRunCommandResponseSchema, "POST /api/v1/commands/bulk", response);
    }
}); }
