import { ItemAttemptHistoryResponseSchema, type ItemAttemptHistoryResponse } from "../../../models/dashboard/item-attempt-history.js";
import { RunDetailSectionResponseSchema, RunDetailWireSchema, RunLogSearchQuerySchema, RunLogSearchResponseSchema,
  type RunDetailSectionResponse, type RunDetailWire, type RunLogSearchResponse } from "../../../models/dashboard/run-detail.js";
import { ArtifactIdSchema, DiagnosticBundleIdSchema } from "../../../rules/identity/ids.js";
import { DashboardClientError } from "../errors.js";
import { parseOrThrow } from "./query-parse.js";
import type { DashboardTransport } from "../transport.js";


function runIdentityError(context: string, code: string, requestedRunId: string): DashboardClientError {
  return new DashboardClientError({
    kind: "schema",
    code,
    message: `${context}: ${code}: response does not belong to requested run ${requestedRunId}`,
  });
}


export interface DetailQueries {
  runDetail(runId: string, signal?: AbortSignal): Promise<RunDetailWire>;

  runSection(runId: string, section: string, cursor?: string, signal?: AbortSignal, hostedRunIds?: readonly string[]): Promise<RunDetailSectionResponse>;
  searchRunLogs?(runId: string, query: string, signal: AbortSignal): Promise<RunLogSearchResponse>;

  /** Bounded same-item attempt history, pinned to this exact selected run. */
  itemAttemptHistory(
    runId: string,
    options?: Readonly<{ limit?: number; cursor?: string; signal?: AbortSignal }>,
  ): Promise<ItemAttemptHistoryResponse>;

  /** The browser downloads the server's canonical durable manifest; no UI reconstruction. */
  diagnosticBundleManifestUrl(bundleId: string): string;

  /** One exact indexed attachment, scoped to the bundle the operator inspected. */
  diagnosticBundleAttachmentUrl(bundleId: string, artifactId: string): string;

  /** One verified capture ref's byte resource. */
  artifactUrl(artifactId: string): string;

}

export function createDetailQueries(transport: DashboardTransport): DetailQueries { return Object.freeze({

    async runDetail(runId: string, signal?: AbortSignal): Promise<RunDetailWire> {
      const context = `GET /api/v1/runs/${runId}`;
      const detail = parseOrThrow(
        RunDetailWireSchema,
        context,
        await transport.requestJson(`/api/v1/runs/${encodeURIComponent(runId)}`, signal === undefined ? undefined : { signal }),
      );
      if (detail.runId !== runId) {
        throw runIdentityError(context, "RUN_DETAIL_IDENTITY_MISMATCH", runId);
      }
      return detail;
    },

    async runSection(runId: string, section: string, cursor?: string, signal?: AbortSignal, hostedRunIds: readonly string[] = []): Promise<RunDetailSectionResponse> {
      const query = cursor === undefined ? "" : `?cursor=${encodeURIComponent(cursor)}`;
      const context = `GET /api/v1/runs/${runId}/${section}`;
      const response = parseOrThrow(
        RunDetailSectionResponseSchema,
        context,
        await transport.requestJson(
          `/api/v1/runs/${encodeURIComponent(runId)}/${encodeURIComponent(section)}${query}`,
          signal === undefined ? undefined : { signal },
        ),
      );
      if (response.section !== section) throw runIdentityError(context, "RUN_SECTION_IDENTITY_MISMATCH", runId);
      const payload = response.payload;
      const owner = "runId" in payload ? payload.runId
        : "state" in payload && payload.state === "available" && "runId" in payload.value ? payload.value.runId : undefined;
      if (owner !== undefined && owner !== runId && !(section === "review" && hostedRunIds.includes(owner))) throw runIdentityError(context, "RUN_SECTION_IDENTITY_MISMATCH", runId);
      return response;
    },

    async searchRunLogs(runId: string, query: string, signal: AbortSignal): Promise<RunLogSearchResponse> {
      const path = `/api/v1/runs/${encodeURIComponent(runId)}/log-search`;
      const params = new URLSearchParams({ q: RunLogSearchQuerySchema.parse(query) });
      const context = `GET ${path}`;
      const response = parseOrThrow(RunLogSearchResponseSchema, context,
        await transport.requestJson(`/api/v1/runs/${encodeURIComponent(runId)}/log-search?${params.toString()}`, { signal }));
      if (response.runId !== runId) throw runIdentityError(context, "RUN_LOG_SEARCH_IDENTITY_MISMATCH", runId);
      return response;
    },

    async itemAttemptHistory(
      runId: string,
      options: Readonly<{ limit?: number; cursor?: string; signal?: AbortSignal }> = {},
    ): Promise<ItemAttemptHistoryResponse> {
      const query = new URLSearchParams();
      if (options.limit !== undefined) query.set("limit", String(options.limit));
      if (options.cursor !== undefined) query.set("cursor", options.cursor);
      const suffix = query.size === 0 ? "" : `?${query.toString()}`;
      const path = `/api/v1/runs/${encodeURIComponent(runId)}/attempt-history` + suffix;
      const context = `GET ${path}`;
      const response = parseOrThrow(
        ItemAttemptHistoryResponseSchema,
        context,
        await transport.requestJson(path, options.signal === undefined ? undefined : { signal: options.signal }),
      );
      const selectedRunId = response.state === "available" || response.state === "unavailable"
        ? response.selected.runId
        : response.selectedRunId;
      if (selectedRunId !== runId) {
        throw runIdentityError(context, "RUN_ATTEMPT_HISTORY_IDENTITY_MISMATCH", runId);
      }
      if (response.state === "available"
        && (response.selected.state === "absent"
          || response.selected.workflowId !== response.item.workflowId
          || response.selected.itemId !== response.item.itemId
          || response.page.entries.some((entry) =>
            entry.workflowId !== response.item.workflowId || entry.itemId !== response.item.itemId))) {
        throw runIdentityError(context, "RUN_ATTEMPT_HISTORY_IDENTITY_MISMATCH", runId);
      }
      return response;
    },

    diagnosticBundleManifestUrl(bundleId: string): string {
      const parsedBundleId = DiagnosticBundleIdSchema.parse(bundleId);
      return transport.resolveUrl(
        `/api/v1/diagnostic-bundles/${encodeURIComponent(parsedBundleId)}/manifest`,
      );
    },

    diagnosticBundleAttachmentUrl(bundleId: string, artifactId: string): string {
      const parsedBundleId = DiagnosticBundleIdSchema.parse(bundleId);
      const parsedArtifactId = ArtifactIdSchema.parse(artifactId);
      return transport.resolveUrl(
        `/api/v1/diagnostic-bundles/${encodeURIComponent(parsedBundleId)}/attachments/${encodeURIComponent(parsedArtifactId)}`,
      );
    },

    artifactUrl(artifactId: string): string {
      const parsedArtifactId = ArtifactIdSchema.parse(artifactId);
      return transport.resolveUrl(`/artifacts/v1/${encodeURIComponent(parsedArtifactId)}`);
    },


}); }
