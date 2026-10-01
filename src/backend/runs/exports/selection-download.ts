import { sha256Hex } from "../../../domain/sha256.js";

export function selectionDownload(body: string, filename: string, mediaType: string, token: string): Response {
  const bytes=Buffer.from(body,"utf8");
  return new Response(bytes,{headers:{
    "content-type":mediaType,"content-disposition":`attachment; filename="${filename}"`,
    "content-length":String(bytes.length),etag:`"${sha256Hex(body)}"`,
    "x-selection-digest":sha256Hex(token),"cache-control":"no-store",
  }});
}
