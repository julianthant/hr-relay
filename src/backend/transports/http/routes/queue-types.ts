import type { StartPlanService } from "../../../runs/commands/start-plan-service.js";

export interface QueueRouteDeps {
  readonly queue: { day(day: string): import("../../../../models/dashboard/projection.js").DashboardDayWire };
  readonly startPlans: StartPlanService;
}
