import type { DashboardDayWire } from "../../../../models/dashboard/projection.js";
import type { StartPlanService } from "../../../runs/commands/start-plan-service.js";

/** The requesting tab is the latest-wins slot owner for a lane read; the signal ends with the request. */
export interface QueueDayRequest {
  readonly tab: string | undefined;
  readonly signal: AbortSignal;
}

export interface QueueRouteDeps {
  /** The day wire, or its JSON body as main stamped it around the lane's build. */
  readonly queue: { day(day: string, request: QueueDayRequest): DashboardDayWire | string | Promise<DashboardDayWire | string> };
  readonly startPlans: StartPlanService;
}
