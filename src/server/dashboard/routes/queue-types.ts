import type { StartPlanService } from "../commands/start-plan-service.js";

export interface QueueRouteDeps {
  readonly queue: { day(day: string): import("../../../domain/dashboard/projection.js").DashboardDayWire };
  readonly startPlans: StartPlanService;
}
