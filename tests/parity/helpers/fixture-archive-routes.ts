import { ArchiveGroupQuerySchema } from "../../../src/models/archive/report.js";
import { matchesArchiveComparisonQuery } from "./fixture-archive-query.js";
import { Hono } from "hono";
import { SavedArchiveQuerySchema, ArchivedCaptureResourceWireSchema, SavedArchiveGroupsWireSchema, SavedRuntimeVersionIndexWireSchema, SavedArchiveIndexWireSchema } from "../../../src/models/dashboard/archive.js";
import {
archiveEvidenceResponseBody,
FIXTURE_ARCHIVE_EVIDENCE_BYTES,
FIXTURE_ARCHIVE_EVIDENCE_CAPTURE,
FIXTURE_ARCHIVE_EVIDENCE_INDEX
} from "./fixture-archive-evidence.js";
import {
FIXTURE_ARCHIVE_INDEX,
FIXTURE_ARCHIVED_RUN,
FIXTURE_SAVED_REPORT,
FIXTURE_SAVED_VERSIONS
} from "./fixture-archive.js";
import { type FixtureBffOptions } from "./fixture-profile.js";
import { wireError } from "./fixture-wire-error.js";
export function registerFixtureArchiveRoutes({ app, archiveEvidence, archivedRun, input }: { app: Hono; archiveEvidence: boolean; archivedRun: typeof FIXTURE_ARCHIVED_RUN; input: Pick<FixtureBffOptions, "savedArchiveFileResponse" | "archiveComparison"> }): void {


  /**
   * The Archive and Activity pair (2i-G, D179/D180). The archived detail is
   * served by exact run id: a fixture that answered any id with the same
   * record would let a surface pass while addressing the wrong run.
   */
  app.get("/api/v1/archive/reports/:runId/files/:digest", c => c.json({ runId: c.req.param("runId"), digest: c.req.param("digest"),
    resource: { state: "missing", reason: "The retained synthetic attachment is missing. Saved report remains readable." } }));

  app.get("/api/v1/archive/reports", c => {
    if (input.archiveComparison === undefined) return c.json({ items: c.req.query("workflow") && c.req.query("workflow") !== FIXTURE_SAVED_REPORT.workflow ? [] : [FIXTURE_SAVED_REPORT], next: null });
    const query = SavedArchiveQuerySchema.parse(parseArchiveFixtureQuery(c.req.query(), true));
    const limit = query.limit;
    const reports = input.archiveComparison.reports.filter(report => matchesArchiveComparisonQuery(report, query))
      .sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.runId.localeCompare(b.runId))
      .filter(report => query.after === undefined || report.completedAt > query.after.completedAt
        || (report.completedAt === query.after.completedAt && report.runId > query.after.runId));
    const items = reports.slice(0, limit);
    const last = items.at(-1);
    return c.json(SavedArchiveIndexWireSchema.parse({ items, next: reports.length > items.length && last !== undefined
      ? { completedAt: last.completedAt, runId: last.runId } : null }));
  });

  app.get("/api/v1/archive/groups", c => c.json(SavedArchiveGroupsWireSchema.parse({ groups: input.archiveComparison === undefined ?
    (c.req.query("workflow") && c.req.query("workflow") !== FIXTURE_SAVED_REPORT.workflow)
      || (c.req.query("outcome") && c.req.query("outcome") !== FIXTURE_SAVED_REPORT.outcome)
      ? [] : [{ dashboardVersion: null, workflow: FIXTURE_SAVED_REPORT.workflow, workflowVersion: null,
        reportCount: 1, latestCompletedAt: FIXTURE_SAVED_REPORT.completedAt }] : [...input.archiveComparison.reports.filter(report => matchesArchiveComparisonQuery(report, ArchiveGroupQuerySchema.parse(parseArchiveFixtureQuery(c.req.query(), false)))).reduce((groups, report) => {
          const dashboard = report.runtimeVersion?.dashboard ?? null;
          const workflowVersion = report.runtimeVersion?.workflow ?? null;
          const key = `${JSON.stringify(dashboard)}:${report.workflow}:${JSON.stringify(workflowVersion)}`;
          const existing = groups.get(key);
          groups.set(key, { dashboardVersion: dashboard, workflow: report.workflow, workflowVersion,
            reportCount: (existing?.reportCount ?? 0) + 1,
            latestCompletedAt: existing?.latestCompletedAt && existing.latestCompletedAt > report.completedAt ? existing.latestCompletedAt : report.completedAt,
            latestCapturedAt: existing?.latestCapturedAt && existing.latestCapturedAt > report.capturedAt ? existing.latestCapturedAt : report.capturedAt });
          return groups;
        }, new Map<string, { dashboardVersion: { major: number; minor: number } | null; workflow: string; workflowVersion: { major: number; minor: number } | null; reportCount: number; latestCompletedAt: string; latestCapturedAt: string }>()).values()] })));

  app.get("/api/v1/archive/runtime-versions", c => c.json(input.archiveComparison?.versions ?? SavedRuntimeVersionIndexWireSchema.parse({
    revision: 1, dashboard: { major: 1, minor: 0 },
    workflows: [{ workflowId: "person-lookup", label: "Person lookup", version: { major: 1, minor: 0 } }],
    changes: [],
  })));

  app.get("/api/v1/archive/versions", c => c.json(FIXTURE_SAVED_VERSIONS));

  app.get("/api/v1/archive/reports/:runId", c => c.json((input.archiveComparison?.reports ?? [FIXTURE_SAVED_REPORT]).find(report => report.runId === c.req.param("runId"))
    ?? { state: "missing", runId: c.req.param("runId"), reason: "No retained run has this identity." }));

  app.get("/api/v1/archive", (c) => c.json((archiveEvidence ? FIXTURE_ARCHIVE_EVIDENCE_INDEX : FIXTURE_ARCHIVE_INDEX) as unknown));

  app.get("/api/v1/archive/:runId/captures/:artifactId/resource", (c) => {
    const runId = c.req.param("runId");
    const artifactId = c.req.param("artifactId");
    if (!archiveEvidence && runId === FIXTURE_SAVED_REPORT.runId && artifactId === FIXTURE_SAVED_REPORT.files[0].artifactIds?.[0]) {
      return c.json({ runId, artifactId, resource: { state: "missing", reason: "The retained synthetic attachment is missing. Saved report remains readable." } });
    }
    if (!archiveEvidence || runId !== archivedRun.runId || artifactId !== FIXTURE_ARCHIVE_EVIDENCE_CAPTURE.artifactId) {
      return c.json(wireError("ARCHIVE_CAPTURE_UNKNOWN", `no frozen fixture capture ${artifactId} for archived run ${runId}`), 404);
    }
    return c.json(ArchivedCaptureResourceWireSchema.parse({
      runId,
      artifactId,
      resource: { state: "available", downloadUrl: `/artifacts/v1/archive/${runId}/${artifactId}` },
    }));
  });

  app.get("/api/v1/archive/:runId", (c) => {
    if (c.req.param("runId") !== archivedRun.runId) {
      return c.json(wireError("ARCHIVE_RUN_UNKNOWN", `no fixture archived run ${c.req.param("runId")}`), 404);
    }
    return c.json(archivedRun as unknown);
  });

  app.get("/artifacts/v1/archive/:runId/files/:digest", async c => input.savedArchiveFileResponse === undefined
    ? c.json(wireError("ARCHIVE_FILE_UNKNOWN", "No native fixture file was registered"),404)
    : await input.savedArchiveFileResponse(c.req.param("runId"),c.req.param("digest")));

  app.get("/artifacts/v1/archive/:runId/:artifactId", (c) => {
    const { runId, artifactId } = c.req.param();
    if (!archiveEvidence || runId !== archivedRun.runId || artifactId !== FIXTURE_ARCHIVE_EVIDENCE_CAPTURE.artifactId) {
      return c.json(wireError("ARCHIVE_CAPTURE_UNKNOWN", `no frozen fixture capture ${artifactId} for archived run ${runId}`), 404);
    }
    return new Response(archiveEvidenceResponseBody(FIXTURE_ARCHIVE_EVIDENCE_BYTES), {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="archive-${FIXTURE_ARCHIVE_EVIDENCE_CAPTURE.artifactId}"`,
        "content-length": String(FIXTURE_ARCHIVE_EVIDENCE_BYTES.byteLength),
        "content-type": FIXTURE_ARCHIVE_EVIDENCE_CAPTURE.mediaType,
        "x-content-type-options": "nosniff",
      },
    });
  });
}

function parseArchiveFixtureQuery(raw: Record<string, string>, paged: boolean): unknown {
  const query: Record<string, unknown> = { ...raw };
  for (const key of ["dashboardVersion", "workflowVersion", "after"]) {
    const value = raw[key]; if (value !== undefined) query[key] = JSON.parse(value);
  }
  if (paged) query.limit = Number(raw.limit ?? 50);
  return query;
}
