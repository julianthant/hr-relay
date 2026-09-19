import { RerunValuesRequestSchema, RerunValuesResponseSchema, type RerunValuesResponse } from "../../domain/dashboard/rerun-values.js";
import { httpError, schemaError } from "./errors.js";
import { parseOrThrow } from "./query-parse.js";
import type { DashboardTransport } from "./transport.js";

export interface RerunQueries {
  rerunValues(input: unknown): Promise<RerunValuesResponse>;
}

export function createRerunQueries(transport: DashboardTransport): RerunQueries {
  return Object.freeze({
    async rerunValues(input: unknown): Promise<RerunValuesResponse> {
      const request = RerunValuesRequestSchema.parse(input);
      const path = `/api/v1/runs/${encodeURIComponent(request.runId)}/rerun-values?expectedVersion=${String(request.expectedVersion)}`;
      const response = await transport.requestJsonResponse(path);
      if (![200, 404, 409, 410].includes(response.status)) throw httpError(response.status, response.body);
      const result = parseOrThrow(RerunValuesResponseSchema, path, response.body);
      const expectedStatus = result.state === "available" ? 200 : result.code === "target-not-found" ? 404 : result.code === "target-deleted" ? 410 : 409;
      if (response.status !== expectedStatus) throw schemaError(path, "RERUN_VALUES_STATUS_MISMATCH");
      if (result.state === "available" && (result.snapshot.source.runId !== request.runId || result.snapshot.source.version !== request.expectedVersion)) {
        throw schemaError(path, "RERUN_VALUES_IDENTITY_MISMATCH");
      }
      return result;
    },
  });
}
