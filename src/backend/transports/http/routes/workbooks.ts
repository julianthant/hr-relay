import type { z } from "zod";
import { WorkbookRevisionSchema, WorkbookTypeSchema, WorkbookCreateRequestSchema, WorkbookSaveRequestSchema, WorkbookIntakeRequestSchema, WorkbookIntakeResultSchema, decodeEditableWorkbook, encodeSavedWorkbook } from "../../../../models/dashboard/workbooks.js";
import { WorkbookLibraryError } from "../../../workbooks/workbook-library-error.js";
import { type WorkbookLibraryService } from "../../../workbooks/workbook-library-service.js";
import type { createWorkbookIntakeBridge } from "../../../runs/commands/workbook-intake-service.js";
import type { DashboardApp } from "./api-types.js";
import { WorkbookCloneRequestSchema, WorkbookLibraryActionSchema, WorkbookLibraryImportRequestSchema } from "../../../../models/dashboard/workbook-library.js";
import type { WorkbookReferenceWorkflow } from "../../../workbooks/workbook-library-service.js";

export interface WorkbooksRouteDeps {
  readonly workbooks?: Readonly<{ library: WorkbookLibraryService; intake: ReturnType<typeof createWorkbookIntakeBridge>; workflows: readonly WorkbookReferenceWorkflow[] }>;
}
function workbookRequest<Value>(schema: z.ZodType<Value>, value: unknown): Value {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new WorkbookLibraryError("WORKBOOK_INVALID", { cause: parsed.error });
  return parsed.data;
}
export function registerWorkbookRoutes(app: DashboardApp, deps: WorkbooksRouteDeps): void {
  const service = () => {
    if (deps.workbooks === undefined) throw new WorkbookLibraryError("WORKBOOK_STORAGE_FAILED");
    return deps.workbooks;
  };
  app.get("/api/v1/workbooks/list", c => c.json(service().library.list().map(encodeSavedWorkbook)));
  app.get("/api/v1/workbooks/catalog", c => c.json(service().library.catalog()));
  app.get("/api/v1/workbooks/compatibility", c => c.json(service().library.compatibility(service().workflows)));
  app.post("/api/v1/workbooks/import", async c => {
    const request = workbookRequest(WorkbookLibraryImportRequestSchema, await c.req.json());
    return c.json('source' in request ? await service().library.importSharePoint(request, c.req.raw.signal)
      : service().library.importWorkbook(request), 201);
  });
  app.post("/api/v1/workbooks/:libraryId/clone", async c => {
    const request = workbookRequest(WorkbookCloneRequestSchema, await c.req.json());
    return c.json(service().library.cloneWorkbook(c.req.param('libraryId'), request), 201);
  });
  app.post("/api/v1/workbooks/:libraryId/library-actions", async c => {
    const request = workbookRequest(WorkbookLibraryActionSchema, await c.req.json());
    return c.json(await service().library.libraryAction(c.req.param('libraryId'), request, c.req.raw.signal));
  });
  app.get("/api/v1/workbooks/:libraryId/library-actions/:operationId", c => {
    return c.json(service().library.libraryActionStatus(c.req.param('libraryId'), c.req.param('operationId')));
  });
  app.post("/api/v1/workbooks", async c => {
    const request = workbookRequest(WorkbookCreateRequestSchema, await c.req.json());
    return c.json(encodeSavedWorkbook(service().library.create(decodeEditableWorkbook(request.workbook))), 201);
  });
  app.get("/api/v1/workbooks/types", c => c.json(service().library.types()));
  app.post("/api/v1/workbooks/types", async c => c.json(service().library.putType(workbookRequest(WorkbookTypeSchema, await c.req.json()))));
  app.get("/api/v1/workbooks/:libraryId/versions/:versionId", c => c.json(service().library.libraryVersion(c.req.param('libraryId'), c.req.param('versionId'))));
  app.get("/api/v1/workbooks/:libraryId/revisions/:version", c => c.json(encodeSavedWorkbook(service().library.revision(c.req.param('libraryId'), workbookRequest(WorkbookRevisionSchema, Number(c.req.param('version')))))));
  app.get("/api/v1/workbooks/:libraryId", c => c.json(encodeSavedWorkbook(service().library.read(c.req.param("libraryId")))));
  app.post("/api/v1/workbooks/:libraryId/save", async c => {
    const request = workbookRequest(WorkbookSaveRequestSchema, await c.req.json());
    return c.json(encodeSavedWorkbook(service().library.save(c.req.param("libraryId"), request.expectedVersion, decodeEditableWorkbook(request.workbook))));
  });
  app.get("/api/v1/workbooks/:libraryId/history", c => c.json(service().library.history(c.req.param("libraryId")).map(encodeSavedWorkbook)));
  app.post("/api/v1/workbooks/:libraryId/intake", async c => {
    const result = WorkbookIntakeResultSchema.parse(await service().intake(c.req.param("libraryId"), workbookRequest(WorkbookIntakeRequestSchema, await c.req.json())));
    return c.json(result, result.state === "created" ? 201 : result.state === "refused" ? 422 : 200);
  });
}
