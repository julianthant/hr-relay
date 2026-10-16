import { z } from "zod";
import { WorkbookCreateRequestSchema, WorkbookSaveRequestSchema, WorkbookIntakeRequestSchema, WorkbookIntakeResultSchema, decodeEditableWorkbook, encodeSavedWorkbook } from "../../../../models/dashboard/workbooks.js";
import { WorkbookLibraryError, type WorkbookLibraryService } from "../../../workbooks/workbook-library-service.js";
import type { createWorkbookIntakeBridge } from "../../../runs/commands/workbook-intake-service.js";
import type { DashboardApp } from "./api-types.js";

export interface WorkbooksRouteDeps {
  readonly workbooks?: Readonly<{ library: WorkbookLibraryService; intake: ReturnType<typeof createWorkbookIntakeBridge> }>;
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
  app.post("/api/v1/workbooks", async c => {
    const request = workbookRequest(WorkbookCreateRequestSchema, await c.req.json());
    return c.json(encodeSavedWorkbook(service().library.create(decodeEditableWorkbook(request.workbook))), 201);
  });
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
