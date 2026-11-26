import type { DashboardApp } from "./api-types.js";
import { OcrSourceRefusedError, OCR_UPLOAD_MAX_BYTES, type OcrSourceService } from "../../../runs/commands/ocr-source-service.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { readBoundedUpload } from "./bounded-upload.js";
import { wireError } from "./failure-status.js";
import { verifiedByteResponse } from "./verified-byte-response.js";
import { z } from "zod";
import { CommandIdSchema, PositiveIntSchema, RunIdSchema } from "../../../../rules/identity/ids.js";
import { PositiveIntegerTextSchema, rawRouteQuery } from "./request-parameters.js";

const CommandResultPathSchema = z.strictObject({ runId: RunIdSchema, commandId: CommandIdSchema });
const PageNumberSchema = PositiveIntegerTextSchema.pipe(PositiveIntSchema);
const PagePathSchema = z.strictObject({ runId: RunIdSchema, sourcePage: PageNumberSchema });
const PageQuerySchema = z.strictObject({ revision: PageNumberSchema });

export interface OcrRouteDeps { readonly ocr?: OcrSourceService; }
function uploadFileName(value: string | undefined): string {
  if (value === undefined) throw new OcrSourceRefusedError();
  let decoded: string;
  try { decoded = decodeURIComponent(value); }
  catch { throw new OcrSourceRefusedError(); }
  const parsed = z.string().min(1).max(255).safeParse(decoded);
  if (!parsed.success) throw new OcrSourceRefusedError();
  return parsed.data;
}
export function registerOcrRoutes(app: DashboardApp, deps: OcrRouteDeps): void {
  app.get("/api/v1/runs/:runId/ocr/commands/:commandId", c => {
    const { runId, commandId } = CommandResultPathSchema.parse(c.req.param());
    if (deps.ocr === undefined) throw new OcrSourceRefusedError();
    return c.json(deps.ocr.commandResult(runId, commandId));
  });
  app.post("/api/v1/ocr/files", async c => {
    try {
      if (deps.ocr === undefined) throw new OcrSourceRefusedError();
      const fileName = uploadFileName(c.req.header("x-relay-file-name"));
      const body = c.req.raw.body;
      if (body === null) throw new OcrSourceRefusedError();
      const bytes = await readBoundedUpload(body, OCR_UPLOAD_MAX_BYTES);
      if (bytes === undefined) throw new OcrSourceRefusedError();
      const source = await deps.ocr.upload({ actorId: c.get("requestActorId"),
        fileName, mediaType: c.req.header("content-type") ?? "", bytes });
      return c.json(source, 201);
    } catch (error) {
      if (error instanceof OcrSourceRefusedError) return c.json(wireError(error.code, ERROR_CATALOG.OCR_SOURCE_REFUSED.text, false), 422);
      throw error;
    }
  });
  app.get("/api/v1/runs/:runId/ocr/pages/:sourcePage", async c => {
    const { runId, sourcePage: page } = PagePathSchema.parse(c.req.param());
    const { revision } = PageQuerySchema.parse(rawRouteQuery(c.req.url));
    if (deps.ocr === undefined) throw new OcrSourceRefusedError();
    const lease = await deps.ocr.page(runId, revision, page, c.req.raw.signal);
    const response = await verifiedByteResponse({ lease, method: c.req.method, range: c.req.header("range"), profile: "generic" });
    response.headers.set("x-content-type-options", "nosniff");
    response.headers.set("content-disposition", `inline; filename="ocr-page-${page}.png"`);
    return response;
  });
}
