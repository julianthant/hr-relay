import type { DashboardCommandService } from "../../../runs/commands/command-service.js";
import type { BulkCommandAcceptanceAuthority } from "../../../runs/commands/operator-command-ingress.js";
import type { CommandRequest } from "../../../../rules/commands/commands.js";
import type { HistoricalNotificationSnoozeCommand } from "../../../../rules/commands/commands-history.js";
import type { IntakeService } from "../../../runs/commands/intake-service.js";
import type { ProviderKeyPendingIdentity, ProviderKeyWriteRequest } from "../../../storage/configuration/provider-key-store.js";

export interface CommandsRouteDeps {
  readonly clock: import("../../../../rules/time/clock.js").Clock;
  readonly commands: DashboardCommandService;
  readonly commandJournal: { get(commandId: string): CommandRequest | HistoricalNotificationSnoozeCommand | undefined };
  readonly bulkCommandAcceptances: BulkCommandAcceptanceAuthority;
  readonly protectedCommandAcceptedAt: (commandId: string) => string | undefined;
  readonly readPendingProviderRequest?: (identity: ProviderKeyPendingIdentity) => ProviderKeyWriteRequest;
  readonly providerCommandAcceptedAt?: (commandId: string, writeId: string) => string | undefined;
  readonly runtimeVersionAcceptedAt?: (commandId: string) => string | undefined;
  readonly intake: Pick<IntakeService, "prepare">;
}
