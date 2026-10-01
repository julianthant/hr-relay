import type { DashboardCommandService } from "../../../../server/dashboard/commands/command-service.js";
import type { BulkCommandAcceptanceAuthority } from "../../../../server/dashboard/commands/operator-command-ingress.js";
import type { CommandRequest } from "../../../../domain/commands.js";
import type { IntakeService } from "../../../../server/dashboard/commands/intake-service.js";
import type { ProviderKeyPendingIdentity, ProviderKeyWriteRequest } from "../../../../infra/config/provider-key-store.js";

export interface CommandsRouteDeps {
  readonly clock: import("../../../../domain/clock.js").Clock;
  readonly commands: DashboardCommandService;
  readonly commandJournal: { get(commandId: string): CommandRequest | undefined };
  readonly bulkCommandAcceptances: BulkCommandAcceptanceAuthority;
  readonly protectedCommandAcceptedAt: (commandId: string) => string | undefined;
  readonly readPendingProviderRequest?: (identity: ProviderKeyPendingIdentity) => ProviderKeyWriteRequest;
  readonly providerCommandAcceptedAt?: (commandId: string, writeId: string) => string | undefined;
  readonly runtimeVersionAcceptedAt?: (commandId: string) => string | undefined;
  readonly intake: Pick<IntakeService, "prepare">;
}
