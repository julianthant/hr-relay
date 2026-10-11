import type { DashboardCommandService } from "../../../runs/commands/command-service.js";
import type { BulkCommandAcceptanceAuthority } from "../../../runs/commands/operator-command-ingress.js";
import type { CommandRequest } from "../../../../rules/commands/commands.js";
import type { IntakeService } from "../../../runs/commands/intake-service.js";

export interface CommandsRouteDeps {
  readonly clock: import("../../../../rules/time/clock.js").Clock;
  readonly commands: DashboardCommandService;
  readonly commandJournal: { get(commandId: string): CommandRequest | undefined };
  readonly bulkCommandAcceptances: BulkCommandAcceptanceAuthority;
  readonly protectedCommandAcceptedAt: (commandId: string) => string | undefined;
  readonly intake: Pick<IntakeService, "prepare">;
}
