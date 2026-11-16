import type { DashboardCommandService } from "../../../runs/commands/command-service.js";
import type { BulkCommandAcceptanceAuthority, IdentityGateAnswerResolution } from "../../../runs/commands/operator-command-ingress.js";
import type { CommandRequest, GateArmAnswerRequest, IdentityGateAnswerRequest } from "../../../../rules/commands/commands.js";
import type { createWorkerCommandResultQuery } from "../../../runs/queries/worker-command-result.js";
import type { IntakeService } from "../../../runs/commands/intake-service.js";

export interface CommandsRouteDeps {
  readonly clock: import("../../../../rules/time/clock.js").Clock;
  readonly commands: DashboardCommandService;
  readonly resolveWriteCommand: (request: CommandRequest) => CommandRequest;
  readonly commandJournal: { get(commandId: string): CommandRequest | undefined };
  readonly bulkCommandAcceptances: BulkCommandAcceptanceAuthority;
  readonly protectedCommandAcceptedAt: (commandId: string) => string | undefined;
  readonly intake: Pick<IntakeService, "prepare">;
  readonly resolveIdentityGateAnswer: (answer: IdentityGateAnswerRequest, journaled: CommandRequest | undefined) => IdentityGateAnswerResolution;
  readonly resolveGateArmAnswer: (answer: GateArmAnswerRequest, journaled: CommandRequest | undefined) => IdentityGateAnswerResolution;
  readonly workerCommandResult?: ReturnType<typeof createWorkerCommandResultQuery>;
}
