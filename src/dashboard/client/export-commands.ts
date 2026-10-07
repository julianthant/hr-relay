import { verifySelectionDownload,type SelectionDownload } from "./selection-download.js";
import { SearchMetadataExportRequestSchema,type SearchMetadataExportRequest } from "../../models/dashboard/search-export.js";
import { z } from "zod";
import {
OPERATOR_XLSX_MEDIA_TYPE,
OperatorXlsxExportIdSchema,
OperatorXlsxExportRequestSchema,
OperatorXlsxFileNameSchema,
type OperatorXlsxExportRequest,
} from "../../models/dashboard/xlsx-export.js";
import { FingerprintSchema } from "../../rules/identity/ids.js";
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

  exportSearchMetadata(request:SearchMetadataExportRequest,generatedAt:string,signal?:AbortSignal):Promise<SelectionDownload>;
  exportXlsx(request: OperatorXlsxExportRequest, signal?:AbortSignal): Promise<OperatorXlsxClientDownload>;
}

export function createExportCommands(transport: DashboardTransport): ExportCommands { return Object.freeze({

    async exportSearchMetadata(input:SearchMetadataExportRequest,generatedAt:string,signal?:AbortSignal) {
      const request=SearchMetadataExportRequestSchema.parse(input);
      if(request.selection.kind!=="search")throw new Error("search export selection required");
      const date=z.iso.datetime().parse(generatedAt).slice(0,10),format=request.format;
      const path="/api/v1/exports/search";
      const response=await transport.requestBinary(path,{method:"POST",body:JSON.stringify(request),signal});
      return verifySelectionDownload(response,{path,filename:`hr-run-search-${date}-g${String(request.selection.snapshot.authorityGeneration)}${format==="csv"?".csv":"-diagnostic.json"}`,
        mediaType:format==="csv"?"text/csv; charset=utf-8":"application/json; charset=utf-8",token:request.selection.snapshot.token});
    },
    async exportXlsx(input: OperatorXlsxExportRequest, signal?:AbortSignal): Promise<OperatorXlsxClientDownload> {
      const request = OperatorXlsxExportRequestSchema.parse(input);
      const response = await transport.requestBinary("/api/v1/exports/xlsx", {
        method: "POST",signal,
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
      const selection=request.selection;
      const filename=selection.kind==="activity"?`hr-activity-${selection.from}_${selection.to}.xlsx`: `hr-run-search-${selection.snapshot.generatedAt.slice(0,10)}-g${String(selection.snapshot.authorityGeneration)}.xlsx`;
      if(selection.kind==="search"&&!headers.filename.endsWith(`-g${String(selection.snapshot.authorityGeneration)}.xlsx`))throw schemaError("POST /api/v1/exports/xlsx",new Error("XLSX generation mismatch"));
      await verifySelectionDownload(response,{path:"POST /api/v1/exports/xlsx",filename,mediaType:OPERATOR_XLSX_MEDIA_TYPE,
        token:selection.kind==="search"?selection.snapshot.token:selection.snapshotToken});
      return Object.freeze({ ...headers, bytes: response.bytes });
    }
}); }
