import { SettingsCommandRequestSchema, StorageRelocationCommandRequestSchema, type CommandResult } from "../../../rules/commands/commands.js";
import { DashboardClientError } from "../errors.js";
import { checkedCommandResult } from "./shared-commands.js";
import type { DashboardTransport } from "../transport.js";


export interface SettingsCommands {

  /** Atomic N-leaf Settings command; request parses before it leaves the browser. */
  applySettings(request: unknown): Promise<CommandResult>;
  applyStorageRelocation(request: unknown): Promise<CommandResult>;
}

export function createSettingsCommands(transport: DashboardTransport): SettingsCommands { return Object.freeze({

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
    async applyStorageRelocation(request: unknown): Promise<CommandResult> {
      const command = StorageRelocationCommandRequestSchema.parse(request);
      const response = await transport.requestJson("/api/v1/commands", { method: "POST", body: JSON.stringify(command) });
      try { return checkedCommandResult(command, response); }
      catch (cause) {
        if (cause instanceof DashboardClientError && cause.kind === "protocol") throw cause;
        throw new DashboardClientError({ kind: "schema", code: "STORAGE_RELOCATION_RESPONSE_INVALID", message: "Storage relocation command response could not be verified", cause });
      }
    },
}); }
