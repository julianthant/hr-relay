import {
CommandResultSchema,
ProviderKeysCommandRequestSchema,
ProviderKeysRetryIntentSchema,
SettingsCommandRequestSchema,
type CommandResult
} from "../../domain/commands.js";
import { DashboardClientError } from "./errors.js";
import type { DashboardTransport } from "./transport.js";


export interface SettingsCommands {

  /** Atomic N-leaf Settings command; request parses before it leaves the browser. */
  applySettings(request: unknown): Promise<CommandResult>;
  applyProviderKeys(request: unknown): Promise<CommandResult>;
  retryProviderKeys(request: unknown): Promise<CommandResult>;
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
      } catch {
        throw new DashboardClientError({ kind: "schema", code: "SETTINGS_RESPONSE_INVALID", message: "Settings command response could not be verified" });
      }
    },
    async applyProviderKeys(request: unknown): Promise<CommandResult> {
      const command = ProviderKeysCommandRequestSchema.parse(request);
      const response = await transport.requestJson("/api/v1/commands", { method: "POST", body: JSON.stringify(command) });
      try { return CommandResultSchema.parse(response); }
      catch { throw new DashboardClientError({ kind: "schema", code: "PROVIDER_RESPONSE_INVALID", message: "Provider command response could not be verified" }); }
    },
    async retryProviderKeys(request: unknown): Promise<CommandResult> {
      const intent = ProviderKeysRetryIntentSchema.parse(request);
      const response = await transport.requestJson("/api/v1/commands", { method: "POST", body: JSON.stringify(intent) });
      try { return CommandResultSchema.parse(response); }
      catch { throw new DashboardClientError({ kind: "schema", code: "PROVIDER_RESPONSE_INVALID", message: "Provider recovery response could not be verified" }); }
    },
}); }
