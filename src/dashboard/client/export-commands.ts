import { z } from "zod";
import {
OPERATOR_XLSX_MEDIA_TYPE,
OperatorXlsxExportIdSchema,
OperatorXlsxExportRequestSchema,
OperatorXlsxFileNameSchema,
type OperatorXlsxExportRequest,
} from "../../domain/dashboard/xlsx-export.js";
import { FingerprintSchema } from "../../domain/ids.js";
import { schemaError } from "./errors.js";
import type { DashboardTransport } from "./transport.js";


export interface OperatorXlsxClientDownload {
  readonly exportId: z.infer<typeof OperatorXlsxExportIdSchema>;
  readonly filename: z.infer<typeof OperatorXlsxFileNameSchema>;
  readonly mediaType: typeof OPERATOR_XLSX_MEDIA_TYPE;
  readonly sha256: z.infer<typeof FingerprintSchema>;
  readonly bytes: ArrayBuffer;
}


const OperatorXlsxResponseHeadersSchema = z.strictObject({
  exportId: OperatorXlsxExportIdSchema,
  filename: OperatorXlsxFileNameSchema,
  mediaType: z.literal(OPERATOR_XLSX_MEDIA_TYPE),
  byteLength: z.number().int().positive(),
  sha256: FingerprintSchema,
});


function requiredHeader(headers: Headers, name: string): string {
  const value = headers.get(name);
  if (value === null) throw new Error(`POST /api/v1/exports/xlsx response omitted ${name}`);
  return value;
}


function fileNameFromContentDisposition(value: string): string {
  const match = /^attachment; filename="([^"]+)"$/u.exec(value);
  if (match?.[1] === undefined) {
    throw new Error("POST /api/v1/exports/xlsx response has malformed content-disposition");
  }
  return match[1];
}


async function sha256Of(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}


export interface ExportCommands {

  exportXlsx(request: OperatorXlsxExportRequest): Promise<OperatorXlsxClientDownload>;
}

export function createExportCommands(transport: DashboardTransport): ExportCommands { return Object.freeze({

    async exportXlsx(input: OperatorXlsxExportRequest): Promise<OperatorXlsxClientDownload> {
      const request = OperatorXlsxExportRequestSchema.parse(input);
      const response = await transport.requestBinary("/api/v1/exports/xlsx", {
        method: "POST",
        body: JSON.stringify(request),
      });
      let headers: z.infer<typeof OperatorXlsxResponseHeadersSchema>;
      try {
        const etag = requiredHeader(response.headers, "etag");
        headers = OperatorXlsxResponseHeadersSchema.parse({
          exportId: requiredHeader(response.headers, "x-operator-export-id"),
          filename: fileNameFromContentDisposition(requiredHeader(response.headers, "content-disposition")),
          mediaType: requiredHeader(response.headers, "content-type"),
          byteLength: Number(requiredHeader(response.headers, "content-length")),
          sha256: /^"([0-9a-f]{64})"$/u.exec(etag)?.[1],
        });
      } catch (error) {
        throw schemaError("POST /api/v1/exports/xlsx", error);
      }
      if (response.bytes.byteLength !== headers.byteLength) {
        throw schemaError(
          "POST /api/v1/exports/xlsx",
          new Error(`body has ${String(response.bytes.byteLength)} bytes but header records ${String(headers.byteLength)}`),
        );
      }
      const actualDigest = await sha256Of(response.bytes);
      if (actualDigest !== headers.sha256) {
        throw schemaError(
          "POST /api/v1/exports/xlsx",
          new Error(`body digest ${actualDigest} disagrees with ${headers.sha256}`),
        );
      }
      return Object.freeze({ ...headers, bytes: response.bytes });
    }
}); }
