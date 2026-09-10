import { SavedArchiveQuerySchema } from "../../../domain/dashboard/archive.js";
import { z } from "zod";


import { buildStorageDoctor } from "../queries/storage.js";
import { buildSettingsFacts } from "../queries/settings.js";
import { buildSettingsEditor } from "../queries/settings-editor.js";
import { readRunDetail } from "../queries/run-detail.js";




import {
  savedFileResource, savedArchiveVersions, savedArchiveIndex, savedArchiveDetail, savedCaptureResource, prepareSavedCaptureLease,
  buildArchiveIndex,
  buildArchivedCaptureResource,
  buildArchivedRunDetail,
  prepareArchivedCaptureLease,
} from "../queries/archive.js";
import { activityReportCsv, activityReportCsvFileName } from "../queries/activity-export.js";
import { SectionUnavailableError } from "../../failures.js";


import { verifiedByteResponse } from "./verified-byte-response.js";
import type { DashboardApp, DashboardAppDeps } from "./api-types.js";
const DayQuerySchema = z.iso.date();

export function registerOperatorRoutes(app: DashboardApp, deps: DashboardAppDeps): void {
  // Ref dashboard-surfaces §2.5's read-only doctor, on demand from the Settings surface.
  app.get("/api/v1/storage/doctor", async (c) => c.json(await buildStorageDoctor(deps.storage)));

  /**
   * D274 item 6 — System hosts + Workflow capabilities, read-only.
   *
   * GET-only by construction, and that remains the ruling: DCC3's separate
   * resolver-owned Settings editor does not make host/capability facts mutable.
   * Item 6's rejected option C was coupling these reads to the write family.
   */
  app.get("/api/v1/settings/facts", (c) => c.json(buildSettingsFacts(deps.settings)));

  // DCC3: values, provenance and editability are server-owned; this route has no mutation arm.
  app.get("/api/v1/settings/editable", (c) => c.json(buildSettingsEditor(deps.settingsEditor)));

  /* ── archive + activity (D179/D180, ref frontend-backend-integration §3.6) ───────────────────────── */
  app.get("/api/v1/archive/reports/:runId/files/:digest", async c => c.json(await savedFileResource(deps.archive, c.req.param("runId"), c.req.param("digest"), c.req.raw.signal)));
  app.get("/artifacts/v1/archive/:runId/files/:digest", async c => {
    const artifact = await prepareSavedCaptureLease(deps.archive, c.req.param("runId"), c.req.param("digest"), c.req.raw.signal, true);
    return verifiedByteResponse({ lease: artifact.lease, method: c.req.method, range: c.req.header("range"), profile: "archive" });
  });
  app.get("/api/v1/archive/versions", (c) => c.json(savedArchiveVersions(deps.archive)));
  app.get("/api/v1/archive/reports", (c) => {
    const params = Object.fromEntries(new URL(c.req.url).searchParams);
    const { after, limit, ...filters } = params;
    const query = SavedArchiveQuerySchema.parse({ ...filters, limit: limit === undefined ? 50 : Number(limit),
      ...(after === undefined ? {} : { after: JSON.parse(after) as unknown }) });
    return c.json(savedArchiveIndex(deps.archive, query));
  });
  app.get("/api/v1/archive/reports/:runId", (c) => c.json(savedArchiveDetail(deps.archive, c.req.param("runId"))));
  app.get("/api/v1/archive", (c) => c.json(deps.archive.storage === undefined ? buildArchiveIndex(deps.archive) : savedArchiveIndex(deps.archive, { limit: 50 })));


  app.get("/api/v1/archive/:runId/captures/:artifactId/resource", async (c) => {
    c.header("cache-control", "no-store");
    if (deps.archive.storage !== undefined) return c.json(await savedCaptureResource(deps.archive, c.req.param("runId"), c.req.param("artifactId"), c.req.raw.signal));
    if (deps.diagnosticBundles === undefined) {
      throw new SectionUnavailableError("archived capture bytes are not available: no artifact store is composed");
    }
    return c.json(await buildArchivedCaptureResource(
      { authority: deps.archive.authority, reader: deps.archive.reader, artifactReader: deps.diagnosticBundles.artifactReader },
      c.req.param("runId"),
      c.req.param("artifactId"),
      c.req.raw.signal,
    ));
  });

  app.get("/api/v1/archive/:runId", (c) =>
    c.json(deps.archive.storage === undefined ? buildArchivedRunDetail(deps.archive, c.req.param("runId")) : savedArchiveDetail(deps.archive, c.req.param("runId"))));

  app.get("/artifacts/v1/archive/:runId/:artifactId", async (c) => {
    c.header("cache-control", "no-store");
    if (deps.archive.storage !== undefined) {
      const artifact = await prepareSavedCaptureLease(deps.archive, c.req.param("runId"), c.req.param("artifactId"), c.req.raw.signal);
      return verifiedByteResponse({ lease: artifact.lease, method: c.req.method, range: c.req.header("range"), profile: "archive" });
    }
    if (deps.diagnosticBundles === undefined) {
      throw new SectionUnavailableError("archived capture bytes are not available: no artifact store is composed");
    }
    const artifact = await prepareArchivedCaptureLease(
      { authority: deps.archive.authority, reader: deps.archive.reader, artifactReader: deps.diagnosticBundles.artifactReader },
      c.req.param("runId"),
      c.req.param("artifactId"),
      c.req.raw.signal,
    );
    return verifiedByteResponse({
      lease: artifact.lease,
      method: c.req.method,
      range: c.req.header("range"),
      profile: "archive",
    });
  });

  app.get("/api/v1/reports/activity", (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (from === undefined || to === undefined) {
      // A missing range is NOT "today" or "this month": an aggregate over a
      // window the caller never named is a number nobody asked for.
      throw new Error("an activity report requires both from= and to= as YYYY-MM-DD");
    }
    return c.json(deps.projection.buildActivityReportWire(from, to));
  });

  /**
   * The same report as a file (D240). It refuses a missing bound in the SAME
   * words as the JSON route above — an export is the one copy that gets mailed
   * on, so a window it defaulted silently would travel further than a page that
   * did. The artifact carries its own caveats; see `activity-export.ts`.
   */
  app.get("/api/v1/reports/activity.csv", (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (from === undefined || to === undefined) {
      throw new Error("an activity report requires both from= and to= as YYYY-MM-DD");
    }
    const report = deps.projection.buildActivityReportWire(from, to);
    return new Response(activityReportCsv(report), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${activityReportCsvFileName(report)}"`,
        "cache-control": "no-store",
      },
    });
  });

  app.get("/api/v1/dashboard", (c) => {
    const day = DayQuerySchema.parse(c.req.query("day"));
    return c.json(deps.projection.buildDashboardDayWire(day));
  });

  app.get("/api/v1/runs/:runId", async (c) =>
    c.json(await readRunDetail(deps.runDetail, c.req.param("runId"), c.req.raw.signal)));
}
