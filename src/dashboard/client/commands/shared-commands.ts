import {
BulkRunCommandRequestSchema,
BulkRunCommandResponseSchema,
CommandRequestSchema,
CommandResultSchema,
type BulkRunCommandResponse,
type CommandResult
} from "../../../rules/commands/commands.js";
import { HistoricalNotificationSnoozeCommandSchema } from "../../../rules/commands/commands-history.js";
import { schemaError } from "../errors.js";
import type { DashboardTransport } from "../transport.js";


export interface SharedCommands {

  executeCommand(request: unknown): Promise<CommandResult>;

  /**
   * D235: one request, N CAS-bound transitions, N outcomes. The client parses
   * the vector verbatim for the same reason it parses a single result verbatim
   * — the server is the only party that knows what each run settled as.
   */
  executeBulkCommand(request: unknown): Promise<BulkRunCommandResponse>;
}

export function createSharedCommands(transport: DashboardTransport): SharedCommands { return Object.freeze({

    async executeCommand(request: unknown): Promise<CommandResult> {
      const live = CommandRequestSchema.safeParse(request);
      const command = live.success ? live.data : HistoricalNotificationSnoozeCommandSchema.parse(request);
      const response = await transport.requestJson("/api/v1/commands", {
        method: "POST",
        body: JSON.stringify(command),
      });
      try {
        return CommandResultSchema.parse(response);
      } catch (error) {
        throw schemaError("POST /api/v1/commands", error);
      }
    },

    async executeBulkCommand(request: unknown): Promise<BulkRunCommandResponse> {
      const bulk = BulkRunCommandRequestSchema.parse(request);
      const response = await transport.requestJson("/api/v1/commands/bulk", {
        method: "POST",
        body: JSON.stringify(bulk),
      });
      try {
        return BulkRunCommandResponseSchema.parse(response);
      } catch (error) {
        throw schemaError("POST /api/v1/commands/bulk", error);
      }
    }
}); }
