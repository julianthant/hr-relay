import { CalendarQuerySchema, CalendarWireSchema, type CalendarQuery, type CalendarWire } from "../../domain/dashboard/calendar.js";
import { protocolError } from "./errors.js";
import { FrontendBootstrapWireSchema,type FrontendBootstrapWire } from "../../domain/dashboard/bootstrap.js";
import {
CrossDateSearchPageSchema,
CrossDateSearchQuerySchema,
type CrossDateSearchPage,
type CrossDateSearchQueryInput,
} from "../../domain/dashboard/search.js";
import { parseOrThrow } from "./query-parse.js";
import type { DashboardTransport } from "./transport.js";


export interface ShellQueries {

  calendar(query: CalendarQuery): Promise<CalendarWire>;

  bootstrap(): Promise<FrontendBootstrapWire>;

  /** D283: bounded cross-date search over exact durable run authority. */
  searchRuns(query: CrossDateSearchQueryInput, signal?: AbortSignal): Promise<CrossDateSearchPage>;
}

export function createShellQueries(transport: DashboardTransport): ShellQueries { return Object.freeze({

    async calendar(input: CalendarQuery): Promise<CalendarWire> {
      const query = CalendarQuerySchema.parse(input);
      const path = `/api/v1/calendar?${new URLSearchParams(query).toString()}`;
      const wire = parseOrThrow(CalendarWireSchema, "GET /api/v1/calendar", await transport.requestJson(path));
      if (wire.month !== query.month || wire.day !== query.day) throw protocolError("calendar-request-identity-mismatch");
      return wire;
    },

    async bootstrap(): Promise<FrontendBootstrapWire> {
      return parseOrThrow(FrontendBootstrapWireSchema, "GET /api/v1/bootstrap", await transport.requestJson("/api/v1/bootstrap"));
    },

    async searchRuns(input: CrossDateSearchQueryInput, signal?: AbortSignal): Promise<CrossDateSearchPage> {
      const query = CrossDateSearchQuerySchema.parse(input);
      const parameters = new URLSearchParams();
      parameters.set("q", query.q);
      parameters.set("scope", query.scope);
      for(const [key,value] of Object.entries(query.facets))if(value!==undefined)parameters.set(key,String(value));
      parameters.set("limit", String(query.limit));
      if (query.cursor !== undefined) parameters.set("cursor", query.cursor);
      const path = `/api/v1/search?${parameters.toString()}`;
      return parseOrThrow(
        CrossDateSearchPageSchema,
        "GET /api/v1/search",
        await transport.requestJson(path,{signal}),
      );
    }
}); }
