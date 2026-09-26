import type { DashboardCommandService } from "../commands/command-service.js";
import type { BulkCommandAcceptanceAuthority } from "../commands/operator-command-ingress.js";
import type { CommandRequest } from "../../../domain/commands.js";
import type { IntakeService } from "../commands/intake-service.js";

export interface CommandsRouteDeps {
  readonly clock: import("../../../domain/clock.js").Clock;
  readonly commands: DashboardCommandService;
  readonly commandJournal: { get(commandId: string): CommandRequest | undefined };
  readonly bulkCommandAcceptances: BulkCommandAcceptanceAuthority;
  readonly protectedCommandAcceptedAt: (commandId: string) => string | undefined;
  readonly runtimeVersionAcceptedAt?: (commandId: string) => string | undefined;
  readonly intake: Pick<IntakeService, "prepare">;
}
