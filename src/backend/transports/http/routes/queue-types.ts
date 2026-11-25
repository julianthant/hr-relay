import type { DashboardDayWire } from "../../../../models/dashboard/projection.js";
import type { StartPlanService } from "../../../runs/commands/start-plan-service.js";

/** The requesting tab is the latest-wins slot owner for a lane read; the signal ends with the request. */
export interface QueueDayRequest {
  readonly tab: string | undefined;
  readonly signal: AbortSignal;
}

export interface QueueRouteDeps {
  readonly queue: { day(day: string, request: QueueDayRequest): DashboardDayWire | Promise<DashboardDayWire> };
  readonly startPlans: StartPlanService;
}
