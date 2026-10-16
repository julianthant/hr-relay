import type { createIntakeCommandResultQuery } from "../../../runs/queries/intake-command-result.js";
import type { IntakeService } from "../../../runs/commands/intake-service.js";

export interface IntakeRouteDeps {
  readonly intake: IntakeService;
  readonly intakeCommandResult?: ReturnType<typeof createIntakeCommandResultQuery>;
}
