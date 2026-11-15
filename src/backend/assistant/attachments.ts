import { ASSISTANT_ATTACHMENT_TYPES, AssistantAttachmentMediaTypeSchema, AssistantAttachmentNameSchema, type AssistantAttachmentMediaType } from "../../models/dashboard/assistant.js";

export type AssistantAttachmentRefusalCode = "ASSISTANT_ATTACHMENT_UNSUPPORTED" | "ASSISTANT_ATTACHMENT_INVALID" | "ASSISTANT_ATTACHMENT_TOO_LARGE";
export class AssistantAttachmentRefusal extends Error {
  constructor(readonly code: AssistantAttachmentRefusalCode | "ASSISTANT_ATTACHMENT_BUSY" | "ASSISTANT_ATTACHMENT_TIMEOUT") { super(code); this.name = "AssistantAttachmentRefusal"; }
}
const refuse = (code: AssistantAttachmentRefusalCode): never => { throw new AssistantAttachmentRefusal(code); };

/** The accepted media type for a declared `Content-Type`, before any byte is read. */
export function attachmentMediaType(contentType: string | undefined): AssistantAttachmentMediaType {
  const parsed = AssistantAttachmentMediaTypeSchema.safeParse(contentType?.split(";")[0]?.trim().toLowerCase());
  return parsed.success ? parsed.data : refuse("ASSISTANT_ATTACHMENT_UNSUPPORTED");
}

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0) => signature.every((byte, index) => bytes[at + index] === byte);
const ascii = (text: string) => [...text].map(char => char.charCodeAt(0));
const SIGNATURES: Readonly<Partial<Record<AssistantAttachmentMediaType, (bytes: Uint8Array) => boolean>>> = {
  "image/png": bytes => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/jpeg": bytes => startsWith(bytes, [0xff, 0xd8, 0xff]),
  "image/webp": bytes => startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8),
  "application/pdf": bytes => startsWith(bytes, ascii("%PDF-")),
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": bytes => startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]),
};
// Text may hold tabs and line breaks; every other C0 control, DEL and NUL refuse.
const textControl = (text: string) => [...text].some(char => { const code = char.charCodeAt(0); return code === 0x7f || code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d; });

/**
 * Admits one upload: the name is a display-only basename whose extension agrees with the media type, the bytes are nonempty,
 * within the type's cap and carry its signature; text types are strict UTF-8 without controls. Signatures prove the container, not readability.
 */
export function admitAttachment(mediaType: AssistantAttachmentMediaType, name: string, bytes: Uint8Array): void {
  const type = ASSISTANT_ATTACHMENT_TYPES[mediaType];
  if (!AssistantAttachmentNameSchema.safeParse(name).success) refuse("ASSISTANT_ATTACHMENT_INVALID");
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  if (!(type.extensions as readonly string[]).includes(extension)) refuse("ASSISTANT_ATTACHMENT_UNSUPPORTED");
  if (bytes.byteLength > type.maxBytes) refuse("ASSISTANT_ATTACHMENT_TOO_LARGE");
  if (bytes.byteLength === 0) refuse("ASSISTANT_ATTACHMENT_INVALID");
  const signature = SIGNATURES[mediaType];
  if (signature !== undefined) { if (!signature(bytes)) refuse("ASSISTANT_ATTACHMENT_INVALID"); return; }
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes); }
  catch { return refuse("ASSISTANT_ATTACHMENT_INVALID"); }
  if (textControl(text)) refuse("ASSISTANT_ATTACHMENT_INVALID");
}
