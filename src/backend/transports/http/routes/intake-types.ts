import type { IntakeService } from "../../../runs/commands/intake-service.js";

export interface IntakeRouteDeps {
  readonly intake: IntakeService;
}
