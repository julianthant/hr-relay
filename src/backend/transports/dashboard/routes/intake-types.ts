import type { IntakeService } from "../../../../server/dashboard/commands/intake-service.js";

export interface IntakeRouteDeps {
  readonly intake: IntakeService;
}
