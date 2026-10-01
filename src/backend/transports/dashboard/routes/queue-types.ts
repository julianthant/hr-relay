import type { StartPlanService } from "../../../runs/dashboard/commands/start-plan-service.js";

export interface QueueRouteDeps {
  readonly queue: { day(day: string): import("../../../../domain/dashboard/projection.js").DashboardDayWire };
  readonly startPlans: StartPlanService;
}
