import { z } from "zod";
import { canonicalJsonStringify } from "../canonical-json.js";

export const PROVIDER_KEY_HEADER_PREFIX = "# hrauto-provider-keys-v1 ";
export const ProviderKeyHeaderSchema = z.strictObject({
  revision: z.number().int().min(2), receiptId: z.uuid(), commandId: z.uuid(),
  writeId: z.uuid(), expectedRevision: z.number().int().positive(),
  schemaHash: z.string().regex(/^[0-9a-f]{64}$/u), markedFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
});

export function parseProviderKeyHeaderRevision(text: string): number {
  const first = text.split(/\r?\n/u, 1)[0] ?? "";
  if (!first.startsWith(PROVIDER_KEY_HEADER_PREFIX)) {
    if (first.startsWith("# hrauto-provider-keys")) throw new Error("provider-key-header-invalid");
    return 1;
  }
  const encoded = first.slice(PROVIDER_KEY_HEADER_PREFIX.length);
  const receipt = ProviderKeyHeaderSchema.parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
  if (Buffer.from(canonicalJsonStringify(receipt)).toString("base64url") !== encoded) throw new Error("provider-key-header-invalid");
  return receipt.revision;
}
