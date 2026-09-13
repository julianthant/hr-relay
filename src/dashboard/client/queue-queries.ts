import { z } from "zod";
import { DashboardDayWireSchema,type DashboardDayWire } from "../../domain/dashboard/projection.js";
import { parseOrThrow } from "./query-parse.js";
import type { DashboardTransport } from "./transport.js";


export interface QueueQueries {

  dashboardDay(day: string): Promise<DashboardDayWire>;
}

export function createQueueQueries(transport: DashboardTransport): QueueQueries { return Object.freeze({

    async dashboardDay(day: string): Promise<DashboardDayWire> {
      const parsedDay = z.iso.date().parse(day);
      return parseOrThrow(
        DashboardDayWireSchema,
        "GET /api/v1/dashboard",
        await transport.requestJson(`/api/v1/dashboard?day=${parsedDay}`),
      );
    }
}); }
