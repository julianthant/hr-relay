import type { IntakeService } from "../commands/intake-service.js";

export interface IntakeRouteDeps {
  readonly intake: IntakeService;
}
