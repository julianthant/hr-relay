import { StartPlanRequestSchema,StartPlanWireSchema,type StartPlanWire } from "../../domain/dashboard/start-plan.js";
import { schemaError } from "./errors.js";
import type { DashboardTransport } from "./transport.js";


/**
 * The start plan's request and response are owned by `domain/dashboard/start-plan.ts`
 * and imported here; `StartPlanResponse` is the surfaces' name for the wire.
 */
export type StartPlanResponse = StartPlanWire;


export interface StartCommands {

  submitStartPlan(input: unknown): Promise<StartPlanResponse>;
}

export function createStartCommands(transport: DashboardTransport): StartCommands { return Object.freeze({

    async submitStartPlan(input: unknown): Promise<StartPlanResponse> {
      const body = StartPlanRequestSchema.parse(input);
      const response = await transport.requestJson("/api/v1/start-plans", {
        method: "POST",
        body: JSON.stringify(body),
      });
      try {
        return StartPlanWireSchema.parse(response);
      } catch (error) {
        throw schemaError("POST /api/v1/start-plans", error);
      }
    }
}); }
