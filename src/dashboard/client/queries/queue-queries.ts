import { z } from "zod";
import { DashboardDayWireSchema,type DashboardDayWire } from "../../../models/dashboard/projection.js";
import { DashboardClientError, protocolError } from "../errors.js";
import { parseOrThrow } from "./query-parse.js";
import type { DashboardTransport } from "../transport.js";


export interface QueueQueries {

  dashboardDay(day: string): Promise<DashboardDayWire>;
}

const DAY_READ_ATTEMPTS = 3;
const DAY_READ_RETRY_MS = 250;

/** A retryable 503 is a read the server cannot serve right now; ask again before failing the caller. */
async function requestDay(transport: DashboardTransport, day: string): Promise<unknown> {
  for (let attempt = 1; ; attempt += 1) {
    try { return await transport.requestJson(`/api/v1/dashboard?day=${day}`); }
    catch (error) {
      const busy = error instanceof DashboardClientError && error.kind === "http" && error.status === 503 && error.retryable;
      if (!busy || attempt === DAY_READ_ATTEMPTS) throw error;
      await new Promise(resolve => setTimeout(resolve, DAY_READ_RETRY_MS));
    }
  }
}

export function createQueueQueries(transport: DashboardTransport): QueueQueries { return Object.freeze({

    async dashboardDay(day: string): Promise<DashboardDayWire> {
      const parsedDay = z.iso.date().parse(day);
      const result = parseOrThrow(
        DashboardDayWireSchema,
        "GET /api/v1/dashboard",
        await requestDay(transport, parsedDay),
      );
      if (result.day !== parsedDay) throw protocolError("day-request-identity-mismatch");
      return result;
    }
}); }
