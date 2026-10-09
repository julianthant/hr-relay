import { SavedArchiveQuerySchema } from "../../../../models/dashboard/archive.js";
import { ArchiveGroupQuerySchema } from "../../../../models/archive/report.js";

import {
  savedFileResource, savedArchiveVersions, savedArchiveRuntimeVersions, savedArchiveGroups, savedArchiveIndex, savedArchiveDetail, savedCaptureResource, prepareSavedCaptureLease,
  buildArchiveIndex,
  buildArchivedCaptureResource,
  buildArchivedRunDetail,
  prepareArchivedCaptureLease,
} from "../../../runs/queries/archive.js";
import { SectionUnavailableError } from "../../../runs/commands/refusals.js";

import { verifiedByteResponse } from "./verified-byte-response.js";

import { isLoopbackHost } from "./loopback.js";
import { wireError } from "./failure-status.js";

import type { DashboardApp } from "./api-types.js";
import type { ArchiveRouteDeps } from "./archive-types.js";

export function registerArchiveRoutes(app: DashboardApp, deps: ArchiveRouteDeps): void {
  // Saved documents and bytes share the same loopback admission before any authority read.
  for (const path of ["/api/v1/archive", "/api/v1/archive/*", "/artifacts/v1/archive/*"]) {
    app.use(path, async (c, next) => {
      if (deps.archive.storage !== undefined) {
        c.header("cache-control", "no-store");
        const host = c.req.header("host");
        const origin = c.req.header("origin");
        if (!isLoopbackHost(host) || (origin !== undefined && origin !== `http://${host}`)) {
          return c.json(wireError("ARCHIVE_INGRESS_FORBIDDEN", "Saved archive reads require a loopback Host and matching Origin when supplied", false), 403);
        }
      }
      return next();
    });
  }


  app.get("/api/v1/archive/reports/:runId/files/:digest", async c => c.json(await savedFileResource(deps.archive, c.req.param("runId"), c.req.param("digest"), c.req.raw.signal)));
  app.get("/artifacts/v1/archive/:runId/files/:digest", async c => {
    const artifact = await prepareSavedCaptureLease(deps.archive, c.req.param("runId"), c.req.param("digest"), c.req.raw.signal, true);
    return verifiedByteResponse({ lease: artifact.lease, method: c.req.method, range: c.req.header("range"), profile: "archive" });
  });
  app.get("/api/v1/archive/versions", (c) => c.json(savedArchiveVersions(deps.archive)));
  app.get("/api/v1/archive/runtime-versions", (c) => c.json(savedArchiveRuntimeVersions(deps.archive)));
  app.get("/api/v1/archive/groups", (c) => {
    const filters = Object.fromEntries(new URL(c.req.url).searchParams);
    const query = ArchiveGroupQuerySchema.parse({ ...filters,
      ...(filters.dashboardVersion === undefined ? {} : { dashboardVersion: JSON.parse(filters.dashboardVersion) as unknown }),
      ...(filters.workflowVersion === undefined ? {} : { workflowVersion: JSON.parse(filters.workflowVersion) as unknown }) });
    return c.json(savedArchiveGroups(deps.archive, query));
  });
  app.get("/api/v1/archive/reports", (c) => {
    const params = Object.fromEntries(new URL(c.req.url).searchParams);
    const { after, limit, ...filters } = params;
    const query = SavedArchiveQuerySchema.parse({ ...filters,
      ...(filters.dashboardVersion === undefined ? {} : { dashboardVersion: JSON.parse(filters.dashboardVersion) as unknown }),
      ...(filters.workflowVersion === undefined ? {} : { workflowVersion: JSON.parse(filters.workflowVersion) as unknown }),
      limit: limit === undefined ? 50 : Number(limit),
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

}
