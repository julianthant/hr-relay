import { randomUUID } from "node:crypto";
import { OperatorXlsxExportRequestSchema } from "../../../../models/dashboard/xlsx-export.js";
import { sha256Hex } from "../../../../rules/validation/sha256.js";
import { CalendarQuerySchema } from "../../../../models/dashboard/calendar.js";
import { z } from "zod";
import { DateOnlySchema, PositiveIntSchema, ProjectionCursorSchema, RunIdSchema } from "../../../../rules/identity/ids.js";
import { buildBootstrap } from "../../../runs/queries/bootstrap.js";
import { emitOptionalDiagnostic } from "../../../logs/debug-events.js";
import { parseCrossDateSearchRouteQuery } from "./search-schema.js";
import { SectionUnavailableError } from "../../../runs/commands/refusals.js";
import { dashboardEventStreamBody } from "../subscriptions/sse-response.js";
import { PositiveIntegerTextSchema, rawRouteQuery } from "./request-parameters.js";

import type { DashboardApp } from "./api-types.js";
import type { ShellRouteDeps } from "./shell-types.js";

// One day, and at most one open run whose panel rides the stream.
const StreamQuerySchema = z.strictObject({
  topics: z.string().regex(/^dashboard-day:\d{4}-\d{2}-\d{2}(?:,run:[^,]+)?$/u, "events-topics-invalid")
    .transform(topics => {
      const [day, run] = topics.split(",run:");
      return { day: day?.slice("dashboard-day:".length), ...(run === undefined ? {} : { run }) };
    }).pipe(z.strictObject({ day: DateOnlySchema, run: RunIdSchema.optional() })),
  cursor: ProjectionCursorSchema.optional(),
  projectionGeneration: PositiveIntegerTextSchema.pipe(PositiveIntSchema).optional(),
});

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

export function registerShellRoutes(app: DashboardApp, deps: ShellRouteDeps): void {
  app.get("/api/v1/application-lifecycle", c => {
    if (deps.applicationLifecycle === undefined) throw new SectionUnavailableError("Application lifecycle is unavailable");
    return c.json(deps.applicationLifecycle.snapshot());
  });
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
    const query = StreamQuerySchema.parse(rawRouteQuery(c.req.url));
    const connectionId = randomUUID();
    const lifecycle = (phase: "started" | "settled" | "failed" | "reset", durationMs: number) =>
      emitOptionalDiagnostic(() => deps.debugEvents?.emit({ category: "sse", phase, correlationId: connectionId, durationMs },
        { kind: "transport", connectionId }));
    const rawGeneration = c.req.header("Dashboard-Projection-Generation");
    const resume = StreamResumeSchema.parse({
      lastEventId: c.req.header("Last-Event-ID") ?? query.cursor,
      lastProjectionGeneration: rawGeneration === undefined ? query.projectionGeneration : Number(rawGeneration),
    });
    const connection = await deps.hub.connect({ ...query.topics, ...resume });
    const stream = dashboardEventStreamBody(connection, lifecycle);
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
