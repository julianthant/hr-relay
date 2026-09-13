import { RunAdvisoryWireSchema,type RunAdvisoryWire } from "../../domain/dashboard/advisory.js";
import {
DiagnosticBundleWireSchema,
type DiagnosticBundleWire,
} from "../../domain/dashboard/diagnostic-bundle.js";
import {
RunDetailSectionResponseSchema,
RunDetailWireSchema,
type RunDetailSectionResponse,
type RunDetailWire,
} from "../../domain/dashboard/run-detail.js";
import { ArtifactIdSchema,DiagnosticBundleIdSchema } from "../../domain/ids.js";
import {
DashboardClientError,
diagnosticBundleIdentityError
} from "./errors.js";
import { parseOrThrow } from "./query-parse.js";
import type { DashboardTransport } from "./transport.js";


export function runIdentityError(context: string, code: string, requestedRunId: string): DashboardClientError {
  return new DashboardClientError({
    kind: "schema",
    code,
    message: `${context}: ${code}: response does not belong to requested run ${requestedRunId}`,
  });
}


export interface DetailQueries {

  runDetail(runId: string): Promise<RunDetailWire>;

  runSection(runId: string, section: string, cursor?: string, signal?: AbortSignal): Promise<RunDetailSectionResponse>;

  /** One D137 bundle, read by its exact durable id only after the operator asks. */
  diagnosticBundle(bundleId: string, signal?: AbortSignal): Promise<DiagnosticBundleWire>;

  /** The browser downloads the server's canonical durable manifest; no UI reconstruction. */
  diagnosticBundleManifestUrl(bundleId: string): string;

  /** One exact indexed attachment, scoped to the bundle the operator inspected. */
  diagnosticBundleAttachmentUrl(bundleId: string, artifactId: string): string;

  /** One verified capture ref's DCA1 byte resource. */
  artifactUrl(artifactId: string): string;

  /**
   * Ref operator-trust §4.4's on-demand failure advisory (2i-G, D178).
   *
   * It is a METHOD an operator action calls, never a section the panel
   * prefetches: it spends a provider budget, so nothing may invoke it as a
   * side effect of opening a run. The three §4.4 outcomes all arrive as a
   * `200` document — `unavailable` and `invalid-response` are answers, not
   * transport faults — so only a real fault throws.
   */
  requestFailureAdvisory(runId: string): Promise<RunAdvisoryWire>;
}

export function createDetailQueries(transport: DashboardTransport): DetailQueries { return Object.freeze({

    async runDetail(runId: string): Promise<RunDetailWire> {
      const context = `GET /api/v1/runs/${runId}`;
      const detail = parseOrThrow(
        RunDetailWireSchema,
        context,
        await transport.requestJson(`/api/v1/runs/${encodeURIComponent(runId)}`),
      );
      if (detail.runId !== runId) {
        throw runIdentityError(context, "RUN_DETAIL_IDENTITY_MISMATCH", runId);
      }
      return detail;
    },

    async runSection(runId: string, section: string, cursor?: string, signal?: AbortSignal): Promise<RunDetailSectionResponse> {
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
      if ((section === "captures" && response.section !== "captures")
        || (response.section === "captures" && response.payload.runId !== runId)) {
        throw runIdentityError(context, "RUN_SECTION_IDENTITY_MISMATCH", runId);
      }
      return response;
    },

    async diagnosticBundle(bundleId: string, signal?: AbortSignal): Promise<DiagnosticBundleWire> {
      const parsedBundleId = DiagnosticBundleIdSchema.parse(bundleId);
      const path = `/api/v1/diagnostic-bundles/${encodeURIComponent(parsedBundleId)}`;
      const bundle = parseOrThrow(
        DiagnosticBundleWireSchema,
        `GET ${path}`,
        await transport.requestJson(path, signal === undefined ? undefined : { signal }),
      );
      if (bundle.bundleId !== parsedBundleId) {
        throw diagnosticBundleIdentityError(`GET ${path}`, parsedBundleId);
      }
      return bundle;
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

    async requestFailureAdvisory(runId: string): Promise<RunAdvisoryWire> {
      const path = `/api/v1/runs/${encodeURIComponent(runId)}/advisory`;
      return parseOrThrow(
        RunAdvisoryWireSchema,
        `POST ${path}`,
        await transport.requestJson(path, { method: "POST" }),
      );
    }
}); }
