import { OperatorXlsxExportRequestSchema } from "../../../../domain/dashboard/xlsx-export.js";
import { sha256Hex } from "../../../../domain/sha256.js";
import { CalendarQuerySchema } from "../../../../domain/dashboard/calendar.js";
import { z } from "zod";
import { PositiveIntSchema, ProjectionCursorSchema } from "../../../../domain/ids.js";
import { buildBootstrap } from "../../../runs/dashboard/queries/bootstrap.js";
import { parseCrossDateSearchRouteQuery } from "./search-schema.js";
import { SectionUnavailableError } from "../../../runs/refusals.js";
import { dashboardEventStreamBody } from "../subscriptions/sse-response.js";
const TOPICS_PATTERN = /^dashboard-day:(\d{4}-\d{2}-\d{2})$/;
const StreamResumeSchema = z.strictObject({
  lastEventId: ProjectionCursorSchema.optional(),
  lastProjectionGeneration: PositiveIntSchema.optional(),
}).superRefine((resume, context) => {
  if (resume.lastProjectionGeneration !== undefined && resume.lastEventId === undefined) {
    context.addIssue({
      code: "custom",
      path: ["lastProjectionGeneration"],
      message: "a projection generation can resume only the cursor it qualifies",
    });
  }
});

import type { DashboardApp } from "./api-types.js";
import type { ShellRouteDeps } from "./shell-types.js";

export function registerShellRoutes(app: DashboardApp, deps: ShellRouteDeps): void {
  app.get("/api/v1/bootstrap", (c) => c.json(buildBootstrap(deps.bootstrap)));

  app.get("/api/v1/calendar", (c) => {
    const entries = [...new URL(c.req.url).searchParams];
    if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new Error("calendar-duplicate-query");
    const query = CalendarQuerySchema.parse(Object.fromEntries(entries));
    if (deps.calendar === undefined) throw new SectionUnavailableError("calendar authority is unavailable");
    return c.json(deps.calendar.read(query));
  });

  app.get("/api/v1/search", (c) =>
    c.json(deps.search.search(parseCrossDateSearchRouteQuery(c.req.url))));

  /**
   * DCR5's narrow operator workbook command. This is deliberately NOT an
   * artifact-id byte reader: the command composes, persists, verifies and
   * serves only the workbook it just generated from one strict selection.
   */
  app.post("/api/v1/exports/search", async c=>{
    if(deps.searchMetadataExports===undefined)throw new SectionUnavailableError("search metadata export is unavailable");
    return deps.searchMetadataExports.export(await c.req.json());
  });

  app.post("/api/v1/exports/xlsx", async (c) => {
    if (deps.xlsxExports === undefined) {
      throw new SectionUnavailableError("operator XLSX export is unavailable: no export authority is composed");
    }
    const request = OperatorXlsxExportRequestSchema.parse(await c.req.json());
    const download = await deps.xlsxExports.export(c.get("requestActorId"), request);
    return new Response(Uint8Array.from(download.bytes), {
      status: 200,
      headers: {
        "content-type": download.mediaType,
        "content-disposition": download.contentDisposition,
        "content-length": String(download.bytes.byteLength),
        etag: `"${download.evidence.download.sha256}"`,
        "x-operator-export-id": download.evidence.exportId,
        "x-selection-digest":sha256Hex(request.selection.kind==="search"?request.selection.snapshot.token:request.selection.snapshotToken),
        "cache-control": "no-store",
      },
    });
  });

  app.get("/events/v1", async (c) => {
    const topics = z.string()
      .regex(TOPICS_PATTERN, "topics must be dashboard-day:<YYYY-MM-DD>")
      .parse(c.req.query("topics"));
    const match = TOPICS_PATTERN.exec(topics);
    if (match === null) throw new Error(`topics ${topics} passed its schema but did not match; refusing to subscribe`);
    const rawLastEventId = c.req.header("Last-Event-ID") ?? c.req.query("cursor");
    const rawLastProjectionGeneration = c.req.header("Dashboard-Projection-Generation")
      ?? c.req.query("projectionGeneration");
    const resume = StreamResumeSchema.parse({
      ...(rawLastEventId === undefined ? {} : { lastEventId: rawLastEventId }),
      ...(rawLastProjectionGeneration === undefined
        ? {}
        : { lastProjectionGeneration: Number(rawLastProjectionGeneration) }),
    });
    const connection = await deps.hub.connect({
      day: match[1],
      ...resume,
    });
    const stream = dashboardEventStreamBody(connection);
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  });

}
