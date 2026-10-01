import type { IntakeService } from "../../../runs/dashboard/commands/intake-service.js";

export interface IntakeRouteDeps {
  readonly intake: IntakeService;
}
