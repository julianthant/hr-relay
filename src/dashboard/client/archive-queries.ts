import {
ArchiveIndexWireSchema,
ArchivedCaptureResourceWireSchema,
ArchivedRunDetailWireSchema,SavedArchiveDetailWireSchema,SavedArchiveFileWireSchema,SavedArchiveIndexWireSchema,SavedArchiveGroupsWireSchema,SavedArchiveQuerySchema,SavedVersionIndexWireSchema,SavedRuntimeVersionIndexWireSchema,type ArchiveIndexWire,
type ArchivedCaptureResourceWire,
type ArchivedRunDetailWire,type SavedArchiveDetailWire,type SavedArchiveFileWire,type SavedArchiveIndexWire,type SavedArchiveGroupsWire,type SavedArchiveQuery,type SavedVersionIndexWire,type SavedRuntimeVersionIndexWire
} from "../../domain/dashboard/archive.js";
import { ArchiveGroupQuerySchema, type ArchiveGroupQuery } from "../../domain/archive/report.js";
import { ArtifactIdSchema,FingerprintSchema,RunIdSchema } from "../../domain/ids.js";
import { runIdentityError } from "./detail-queries.js";
import {
DashboardClientError
} from "./errors.js";
import { parseOrThrow } from "./query-parse.js";
import type { DashboardTransport } from "./transport.js";


function archivedCaptureIdentityError(
  context: string,
  requestedRunId: string,
  requestedArtifactId: string,
): DashboardClientError {
  return new DashboardClientError({
    kind: "schema",
    code: "ARCHIVE_CAPTURE_RESOURCE_IDENTITY_MISMATCH",
    message: `${context}: ARCHIVE_CAPTURE_RESOURCE_IDENTITY_MISMATCH: response does not belong to requested archived capture ${requestedRunId}/${requestedArtifactId}`,
  });
}


function archivedRunIdentityError(context: string, requestedRunId: string): DashboardClientError {
  return new DashboardClientError({
    kind: "schema",
    code: "ARCHIVED_RUN_IDENTITY_MISMATCH",
    message: `${context}: ARCHIVED_RUN_IDENTITY_MISMATCH: response does not belong to requested archived run ${requestedRunId}`,
  });
}


export interface ArchiveQueries {

  /**
   * The read-only Archive index plus the LIVE version-bump state (2i-G, D179).
   *
   * The version state is re-derived per request rather than read off a stored
   * plan: a plan is a review copy and it goes stale the moment a run is
   * enqueued, so a surface that showed the plan's copy would invite an apply
   * whose blocker list the operator had already been shown as empty.
   */
  archiveIndex(): Promise<ArchiveIndexWire>;

  savedArchiveFile(runId: string, digest: string): Promise<SavedArchiveFileWire>;

  savedArchiveVersions(): Promise<SavedVersionIndexWire>;
  savedRuntimeVersions(): Promise<SavedRuntimeVersionIndexWire>;
  savedArchiveGroups(query: ArchiveGroupQuery): Promise<SavedArchiveGroupsWire>;

  savedArchiveIndex(query: SavedArchiveQuery, signal?: AbortSignal): Promise<SavedArchiveIndexWire>;

  savedArchiveReport(runId: string): Promise<SavedArchiveDetailWire>;

  /** ONE archived run, whole. Nothing on this path resolves a descriptor. */
  archivedRun(runId: string): Promise<ArchivedRunDetailWire>;

  /** Re-verifies one exact frozen archived capture before serving resource state. */
  archivedCaptureResource(
    runId: string,
    artifactId: string,
    signal?: AbortSignal,
  ): Promise<ArchivedCaptureResourceWire>;
}

export function createArchiveQueries(transport: DashboardTransport): ArchiveQueries { return Object.freeze({


    async savedArchiveFile(runId: string, digest: string): Promise<SavedArchiveFileWire> {
      const path = `/api/v1/archive/reports/${RunIdSchema.parse(runId)}/files/${FingerprintSchema.parse(digest)}`;
      const file = parseOrThrow(SavedArchiveFileWireSchema, `GET ${path}`, await transport.requestJson(path));
      if (file.runId !== runId || file.digest !== digest) throw runIdentityError(`GET ${path}`, "SAVED_FILE_IDENTITY_MISMATCH", runId);
      return file;
    },

    async savedArchiveVersions(): Promise<SavedVersionIndexWire> {
      return parseOrThrow(SavedVersionIndexWireSchema, "GET /api/v1/archive/versions", await transport.requestJson("/api/v1/archive/versions"));
    },

    async savedRuntimeVersions(): Promise<SavedRuntimeVersionIndexWire> {
      return parseOrThrow(SavedRuntimeVersionIndexWireSchema, "GET /api/v1/archive/runtime-versions",
        await transport.requestJson("/api/v1/archive/runtime-versions"));
    },

    async savedArchiveGroups(input: ArchiveGroupQuery): Promise<SavedArchiveGroupsWire> {
      const query = ArchiveGroupQuerySchema.parse(input);
      const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, typeof value === "object" ? JSON.stringify(value) : String(value)]));
      const path = "/api/v1/archive/groups" + (params.size === 0 ? "" : `?${params.toString()}`);
      return parseOrThrow(SavedArchiveGroupsWireSchema, `GET ${path}`, await transport.requestJson(path));
    },

    async savedArchiveIndex(input: SavedArchiveQuery, signal?: AbortSignal): Promise<SavedArchiveIndexWire> {
      const query = SavedArchiveQuerySchema.parse(input);
      const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, typeof value === "object" ? JSON.stringify(value) : String(value)]));
      const path = `/api/v1/archive/reports?${params.toString()}`;
      return parseOrThrow(SavedArchiveIndexWireSchema, `GET ${path}`, await transport.requestJson(path, signal === undefined ? undefined : { signal }));
    },

    async savedArchiveReport(runId: string): Promise<SavedArchiveDetailWire> {
      const requested = RunIdSchema.parse(runId);
      const path = `/api/v1/archive/reports/${encodeURIComponent(requested)}`;
      const report = parseOrThrow(SavedArchiveDetailWireSchema, `GET ${path}`, await transport.requestJson(path));
      if (report.runId !== requested || (report.state === "deleted" && (report.deletion.runId !== requested
        || (report.deletion.command.state === "pending" && report.deletion.command.resumeRequest !== undefined
          && report.deletion.command.resumeRequest.target.archivedRunId !== requested)))) {
        throw archivedRunIdentityError(`GET ${path}`, requested);
      }
      return report;
    },

    async archiveIndex(): Promise<ArchiveIndexWire> {
      return parseOrThrow(
        ArchiveIndexWireSchema,
        "GET /api/v1/archive",
        await transport.requestJson("/api/v1/archive"),
      );
    },

    async archivedRun(runId: string): Promise<ArchivedRunDetailWire> {
      const parsedRunId = RunIdSchema.parse(runId);
      const path = `/api/v1/archive/${encodeURIComponent(parsedRunId)}`;
      const detail = parseOrThrow(ArchivedRunDetailWireSchema, `GET ${path}`, await transport.requestJson(path));
      if (detail.runId !== parsedRunId) throw archivedRunIdentityError(`GET ${path}`, parsedRunId);
      return detail;
    },

    async archivedCaptureResource(
      runId: string,
      artifactId: string,
      signal?: AbortSignal,
    ): Promise<ArchivedCaptureResourceWire> {
      const parsedRunId = RunIdSchema.parse(runId);
      const parsedArtifactId = ArtifactIdSchema.parse(artifactId);
      const path = `/api/v1/archive/${encodeURIComponent(parsedRunId)}/captures/${encodeURIComponent(parsedArtifactId)}/resource`;
      const resource = parseOrThrow(
        ArchivedCaptureResourceWireSchema,
        `GET ${path}`,
        await transport.requestJson(path, signal === undefined ? undefined : { signal }),
      );
      if (resource.runId !== parsedRunId || resource.artifactId !== parsedArtifactId) {
        throw archivedCaptureIdentityError(`GET ${path}`, parsedRunId, parsedArtifactId);
      }
      return resource;
    }
}); }
