import type { DashboardApp } from "./api-types.js";
import { OcrSourceRefusedError, OCR_UPLOAD_MAX_BYTES, type OcrSourceService } from "../../../runs/commands/ocr-source-service.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { wireError } from "./failure-status.js";
import { verifiedByteResponse } from "./verified-byte-response.js";
import { z } from "zod";

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
async function uploadBytes(request: Request): Promise<Uint8Array> {
  if (request.body === null) throw new OcrSourceRefusedError();
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > OCR_UPLOAD_MAX_BYTES) { await reader.cancel(); throw new OcrSourceRefusedError(); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
export function registerOcrRoutes(app: DashboardApp, deps: OcrRouteDeps): void {
  app.get("/api/v1/runs/:runId/ocr/commands/:commandId", c => {
    if (deps.ocr === undefined) throw new OcrSourceRefusedError();
    return c.json(deps.ocr.commandResult(c.req.param("runId"), c.req.param("commandId")));
  });
  app.post("/api/v1/ocr/files", async c => {
    try {
      if (deps.ocr === undefined) throw new OcrSourceRefusedError();
      const source = await deps.ocr.upload({ actorId: c.get("requestActorId"),
        fileName: uploadFileName(c.req.header("x-relay-file-name")), mediaType: c.req.header("content-type") ?? "",
        bytes: await uploadBytes(c.req.raw) });
      return c.json(source, 201);
    } catch (error) {
      if (error instanceof OcrSourceRefusedError) return c.json(wireError(error.code, ERROR_CATALOG.OCR_SOURCE_REFUSED.text, false), 422);
      throw error;
    }
  });
  app.get("/api/v1/runs/:runId/ocr/pages/:sourcePage", async c => {
    if (deps.ocr === undefined) throw new OcrSourceRefusedError();
    const page = z.coerce.number().int().positive().parse(c.req.param("sourcePage"));
    const revision = z.coerce.number().int().positive().parse(c.req.query("revision"));
    const lease = await deps.ocr.page(c.req.param("runId"), revision, page, c.req.raw.signal);
    const response = await verifiedByteResponse({ lease, method: c.req.method, range: c.req.header("range"), profile: "generic" });
    response.headers.set("x-content-type-options", "nosniff");
    response.headers.set("content-disposition", `inline; filename="ocr-page-${page}.png"`);
    return response;
  });
}
