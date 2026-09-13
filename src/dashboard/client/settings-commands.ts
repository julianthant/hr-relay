import {
CommandResultSchema,
SettingsCommandRequestSchema,
type CommandResult
} from "../../domain/commands.js";
import { schemaError } from "./errors.js";
import type { DashboardTransport } from "./transport.js";


export interface SettingsCommands {

  /** Atomic N-leaf Settings command; request parses before it leaves the browser. */
  applySettings(request: unknown): Promise<CommandResult>;
}

export function createSettingsCommands(transport: DashboardTransport): SettingsCommands { return Object.freeze({

    async applySettings(request: unknown): Promise<CommandResult> {
      const command = SettingsCommandRequestSchema.parse(request);
      const response = await transport.requestJson("/api/v1/commands", {
        method: "POST",
        body: JSON.stringify(command),
      });
      try {
        return CommandResultSchema.parse(response);
      } catch (error) {
        throw schemaError("POST /api/v1/commands", error);
      }
    }
}); }
