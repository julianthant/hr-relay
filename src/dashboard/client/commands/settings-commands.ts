import { SettingsCommandRequestSchema,type CommandResult } from "../../../rules/commands/commands.js";
import { DashboardClientError } from "../errors.js";
import type { DashboardTransport } from "../transport.js";
import { checkedCommandResult } from "./shared-commands.js";
import { ClearRunHistoryRequestSchema, ClearRunHistoryResultSchema, type ClearRunHistoryRequest, type ClearRunHistoryResult } from "../../../models/dashboard/run-history.js";


export interface SettingsCommands {
  clearRunHistory(request: ClearRunHistoryRequest): Promise<ClearRunHistoryResult>;

  /** Atomic N-leaf Settings command; request parses before it leaves the browser. */
  applySettings(request: unknown): Promise<CommandResult>;
}

export function createSettingsCommands(transport: DashboardTransport): SettingsCommands { return Object.freeze({
    async clearRunHistory(input: ClearRunHistoryRequest) {
      const request = ClearRunHistoryRequestSchema.parse(input);
      const result = ClearRunHistoryResultSchema.parse(await transport.requestJson("/api/v1/storage/run-history/clear", { method: "POST", body: JSON.stringify(request) }));
      if (result.commandId !== request.commandId) throw new DashboardClientError({ kind: "protocol", code: "COMMAND_RESULT_IDENTITY_MISMATCH", message: "Run history result does not match the requested action." });
      return result;
    },

    async applySettings(request: unknown): Promise<CommandResult> {
      const command = SettingsCommandRequestSchema.parse(request);
      const response = await transport.requestJson("/api/v1/commands", {
        method: "POST",
        body: JSON.stringify(command),
      });
      try {
        return checkedCommandResult(command, response);
      } catch (cause) {
        if (cause instanceof DashboardClientError && cause.kind === "protocol") throw cause;
        throw new DashboardClientError({ kind: "schema", code: "SETTINGS_RESPONSE_INVALID", message: "Settings command response could not be verified", cause });
      }
    },
}); }
