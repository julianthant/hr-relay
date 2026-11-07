import { sha256Hex } from "../../../rules/validation/sha256.js";
import { schemaError } from "../errors.js";
import type { BinaryResponse } from "../transport.js";

export interface SelectionDownload { filename:string; mediaType:string; bytes:ArrayBuffer }
export async function verifySelectionDownload(response:BinaryResponse, expected: {path:string;filename:string;mediaType:string;token:string}):Promise<SelectionDownload> {
  const headers=response.headers, length=headers.get("content-length");
  const digest=await globalThis.crypto.subtle.digest("SHA-256",response.bytes);
  const actual=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
  if(headers.get("content-type")!==expected.mediaType
    ||headers.get("content-disposition")!==`attachment; filename="${expected.filename}"`
    ||length===null||!/^\d+$/u.test(length)||Number(length)!==response.bytes.byteLength
    ||headers.get("etag")!==`"${actual}"`||headers.get("x-selection-digest")!==sha256Hex(expected.token)) {
    throw schemaError(expected.path,new Error("download content or selection identity mismatch"));
  }
  return Object.freeze({filename:expected.filename,mediaType:expected.mediaType,bytes:response.bytes});
}
