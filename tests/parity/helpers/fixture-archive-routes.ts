import { Hono } from "hono";
import { ArchivedCaptureResourceWireSchema, SavedArchiveGroupsWireSchema, SavedRuntimeVersionIndexWireSchema } from "../../../src/domain/dashboard/archive.js";
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
export function registerFixtureArchiveRoutes({ app, archiveEvidence, archivedRun, input }: { app: Hono; archiveEvidence: boolean; archivedRun: typeof FIXTURE_ARCHIVED_RUN; input: Pick<FixtureBffOptions, "savedArchiveFileResponse"> }): void {


  /**
   * The Archive and Activity pair (2i-G, D179/D180). The archived detail is
   * served by exact run id: a fixture that answered any id with the same
   * record would let a surface pass while addressing the wrong run.
   */
  app.get("/api/v1/archive/reports/:runId/files/:digest", c => c.json({ runId: c.req.param("runId"), digest: c.req.param("digest"),
    resource: { state: "missing", reason: "The retained synthetic attachment is missing. Saved report remains readable." } }));

  app.get("/api/v1/archive/reports", c => c.json({ items: c.req.query("workflow") && c.req.query("workflow") !== FIXTURE_SAVED_REPORT.workflow ? [] : [FIXTURE_SAVED_REPORT], next: null }));

  app.get("/api/v1/archive/groups", c => c.json(SavedArchiveGroupsWireSchema.parse({ groups:
    (c.req.query("workflow") && c.req.query("workflow") !== FIXTURE_SAVED_REPORT.workflow)
      || (c.req.query("outcome") && c.req.query("outcome") !== FIXTURE_SAVED_REPORT.outcome)
      ? [] : [{ dashboardVersion: null, workflow: FIXTURE_SAVED_REPORT.workflow, workflowVersion: null,
        reportCount: 1, latestCompletedAt: FIXTURE_SAVED_REPORT.completedAt }] })));

  app.get("/api/v1/archive/runtime-versions", c => c.json(SavedRuntimeVersionIndexWireSchema.parse({
    revision: 1, dashboard: { major: 1, minor: 0 },
    workflows: [{ workflowId: "person-lookup", label: "Person lookup", version: { major: 1, minor: 0 } }],
    changes: [],
  })));

  app.get("/api/v1/archive/versions", c => c.json(FIXTURE_SAVED_VERSIONS));

  app.get("/api/v1/archive/reports/:runId", c => c.json(c.req.param("runId") === FIXTURE_SAVED_REPORT.runId
    ? FIXTURE_SAVED_REPORT : { state: "missing", runId: c.req.param("runId"), reason: "No retained run has this identity." }));

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
