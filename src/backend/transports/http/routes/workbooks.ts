import { z } from "zod";
import type { Context, HonoRequest } from "hono";
import { etag } from "hono/etag";
import { WorkbookSummarySchema, WorkbookIdSchema, WorkbookRevisionSchema, WorkbookTypeSchema, WorkbookCreateRequestSchema, WorkbookSaveRequestSchema, WorkbookCopyMappingRequestSchema, decodeEditableWorkbook, encodeSavedWorkbook } from "../../../../models/dashboard/workbooks.js";
import { cellText } from "../../../../rules/spreadsheets/workbook-io.js";
import { WorkbookLibraryError } from "../../../workbooks/workbook-library-error.js";
import { type WorkbookLibraryService } from "../../../workbooks/workbook-library-service.js";
import type { DashboardApp } from "./api-types.js";
import { PositiveIntegerTextSchema } from "./request-parameters.js";
import { WorkbookCloneRequestSchema, WorkbookLibraryActionSchema, WorkbookLibraryImportRequestSchema } from "../../../../models/dashboard/workbook-library.js";
import type { WorkbookReferenceWorkflow } from "../../../workbooks/workbook-library-service.js";
import { createPositionedReadResponse } from "../read-reuse.js";

const LibraryPathSchema = z.strictObject({ libraryId: WorkbookIdSchema });
const OperationPathSchema = LibraryPathSchema.extend({ operationId: WorkbookIdSchema });
const VersionPathSchema = LibraryPathSchema.extend({ versionId: WorkbookIdSchema });
const RevisionPathSchema = LibraryPathSchema.extend({ version: PositiveIntegerTextSchema.pipe(WorkbookRevisionSchema) });

export interface WorkbooksRouteDeps {
  readonly workbooks?: Readonly<{ library: WorkbookLibraryService; workflows: readonly WorkbookReferenceWorkflow[];
    withReadPosition?: (read: (position: number | undefined) => Response) => Response }>;
}
function workbookRequest<Value>(schema: z.ZodType<Value>, value: unknown): Value {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new WorkbookLibraryError("WORKBOOK_INVALID", { cause: parsed.error });
  return parsed.data;
}
function workbookPath<Value>(schema: z.ZodType<Value>, request: HonoRequest): Value {
  // Hono leaves malformed escapes in path params, where opaque IDs would accept them.
  try { decodeURIComponent(new URL(request.url).pathname); }
  catch (cause) { throw new WorkbookLibraryError("WORKBOOK_INVALID", { cause }); }
  return workbookRequest(schema, request.param());
}

export function registerWorkbookRoutes(app: DashboardApp, deps: WorkbooksRouteDeps): void {
  const service = () => {
    if (deps.workbooks === undefined) throw new WorkbookLibraryError("WORKBOOK_STORAGE_FAILED");
    return deps.workbooks;
  };
  const workbookRead = <Wire extends object>(read: () => Wire, volatile = false) => {
    const cacheControl = "private, no-cache";
    const respond = createPositionedReadResponse<Wire>(cacheControl);
    return (c: Pick<Context, "res" | "json">) => {
      c.res.headers.append("Vary", "X-Relay-Session");
      const serve = (position: number | undefined) => {
        if (position !== undefined && !volatile) return respond(position, read);
        return c.json(read(), 200, { "Cache-Control": cacheControl });
      };
      const { withReadPosition } = service();
      return withReadPosition === undefined ? serve(undefined) : withReadPosition(serve);
    };
  };
  app.get("/api/v1/workbooks/list", c =>
    c.json(service().library.listWithType().map(({ record, typeId }) => WorkbookSummarySchema.parse({
      libraryId: record.libraryId, name: record.workbook.name, typeId,
      version: record.version, createdAt: record.createdAt, savedAt: record.savedAt,
      rowCount: record.workbook.sheets.reduce((count, sheet) => count + sheet.rows.length - (sheet.headerRow ?? 1), 0),
      sheets: record.workbook.sheets.map(sheet => ({ name: sheet.name, headerRow: sheet.sourceHeaderRow ?? sheet.headerRow ?? 1,
        columns: sheet.rows[(sheet.headerRow ?? 1) - 1].cells.map(cellText),
        ...(sheet.columnBindings === undefined ? {} : { columnBindings: sheet.columnBindings }),
      })),
    }))));
  app.get("/api/v1/workbooks/catalog", etag(), workbookRead(() => service().library.catalog(), true));
  app.get("/api/v1/workbooks/compatibility", etag(), workbookRead(() => service().library.compatibility(service().workflows)));
  app.post("/api/v1/workbooks/import", async c => {
    const request = workbookRequest(WorkbookLibraryImportRequestSchema, await c.req.json());
    return c.json('source' in request ? await service().library.importSharePoint(request, c.req.raw.signal)
      : service().library.importWorkbook(request), 201);
  });
  app.post("/api/v1/workbooks/:libraryId/clone", async c => {
    const { libraryId } = workbookPath(LibraryPathSchema, c.req);
    const request = workbookRequest(WorkbookCloneRequestSchema, await c.req.json());
    return c.json(service().library.cloneWorkbook(libraryId, request), 201);
  });
  app.post("/api/v1/workbooks/:libraryId/library-actions", async c => {
    const { libraryId } = workbookPath(LibraryPathSchema, c.req);
    const request = workbookRequest(WorkbookLibraryActionSchema, await c.req.json());
    return c.json(await service().library.libraryAction(libraryId, request, c.req.raw.signal));
  });
  app.get("/api/v1/workbooks/:libraryId/library-actions/:operationId", c => {
    const { libraryId, operationId } = workbookPath(OperationPathSchema, c.req);
    return c.json(service().library.libraryActionStatus(libraryId, operationId));
  });
  app.post("/api/v1/workbooks", async c => {
    const request = workbookRequest(WorkbookCreateRequestSchema, await c.req.json());
    return c.json(encodeSavedWorkbook(service().library.create(decodeEditableWorkbook(request.workbook))), 201);
  });
  app.get("/api/v1/workbooks/types", etag(), workbookRead(() => service().library.types()));
  app.post("/api/v1/workbooks/types", async c => c.json(service().library.putType(workbookRequest(WorkbookTypeSchema, await c.req.json()))));
  app.get("/api/v1/workbooks/:libraryId/versions/:versionId", c => {
    const { libraryId, versionId } = workbookPath(VersionPathSchema, c.req);
    return c.json(service().library.libraryVersion(libraryId, versionId));
  });
  app.get("/api/v1/workbooks/:libraryId/revisions/:version", c => {
    const { libraryId, version } = workbookPath(RevisionPathSchema, c.req);
    return c.json(encodeSavedWorkbook(service().library.revision(libraryId, version)));
  });
  app.get("/api/v1/workbooks/:libraryId", c => {
    const { libraryId } = workbookPath(LibraryPathSchema, c.req);
    return c.json(encodeSavedWorkbook(service().library.read(libraryId)));
  });
  app.post("/api/v1/workbooks/:libraryId/save", async c => {
    const { libraryId } = workbookPath(LibraryPathSchema, c.req);
    const request = workbookRequest(WorkbookSaveRequestSchema, await c.req.json());
    return c.json(encodeSavedWorkbook(service().library.save(libraryId, request.expectedVersion, decodeEditableWorkbook(request.workbook))));
  });
  app.post("/api/v1/workbooks/:libraryId/copy-mapping", async c => {
    const { libraryId } = workbookPath(LibraryPathSchema, c.req);
    const request = workbookRequest(WorkbookCopyMappingRequestSchema, await c.req.json());
    return c.json(encodeSavedWorkbook(service().library.copyMapping(libraryId, request.expectedVersion, request.worksheetId)));
  });
  app.get("/api/v1/workbooks/:libraryId/history", c => {
    const { libraryId } = workbookPath(LibraryPathSchema, c.req);
    return c.json(service().library.history(libraryId).map(encodeSavedWorkbook));
  });
}
