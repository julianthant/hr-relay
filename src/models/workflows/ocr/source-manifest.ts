import { z } from "zod";
import { ArtifactRefSchema, type ArtifactRef } from "../../artifacts/artifacts.js";
import { ExtractPdfPagesOutputSchema } from "../../processing/extraction/extract-pdf-pages.js";
import { FingerprintSchema, ItemIdSchema } from "../../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";

const PdfSchema = ArtifactRefSchema.extend({ mediaType: z.literal("application/pdf"), bytes: z.number().int().positive() });
const PageImageSchema = ArtifactRefSchema.extend({ mediaType: z.literal("image/png"), bytes: z.number().int().positive() });
const ManifestContentSchema = z.strictObject({
  document: PdfSchema,
  pageCount: z.number().int().positive(),
  pages: z.array(z.strictObject({ sourcePage: z.number().int().positive(), image: PageImageSchema })).min(1),
});

function manifestFingerprint(content: z.infer<typeof ManifestContentSchema>) {
  return FingerprintSchema.parse(sha256Hex(`relay:ocr-source:v1\0${canonicalJsonStringify(content)}`));
}

export const OcrSourceManifestSchema = ManifestContentSchema.extend({ fingerprint: FingerprintSchema })
  .superRefine((manifest, context) => {
    if (manifest.pages.length !== manifest.pageCount
      || manifest.pages.some((page, index) => page.sourcePage !== index + 1)) {
      context.addIssue({ code: "custom", message: "OCR source manifest must cover every original page once, in order" });
    }
    const { fingerprint, ...content } = manifest;
    if (fingerprint !== manifestFingerprint(content)) {
      context.addIssue({ code: "custom", message: "OCR source manifest fingerprint does not match its content" });
    }
  });
export type OcrSourceManifest = z.infer<typeof OcrSourceManifestSchema>;

export function buildOcrSourceManifest(document: ArtifactRef, rendered: z.infer<typeof ExtractPdfPagesOutputSchema>): OcrSourceManifest {
  const output = ExtractPdfPagesOutputSchema.parse(rendered);
  const content = ManifestContentSchema.parse({ document, pageCount: output.pageCount,
    pages: output.pages.toSorted((left, right) => left.sourcePage - right.sourcePage) });
  return deepFreeze(OcrSourceManifestSchema.parse({ ...content, fingerprint: manifestFingerprint(content) }));
}

export const OcrPageInputSchema = z.strictObject({
  formType: z.literal("emergency-contact"),
  manifestFingerprint: FingerprintSchema,
  document: PdfSchema,
  sourcePage: z.number().int().positive(),
  image: PageImageSchema,
  readingId: ItemIdSchema,
});
export type OcrPageInput = z.infer<typeof OcrPageInputSchema>;

/** Reuse readingId for a replay; a deliberate rereading requires a new readingId. */
export function ocrPageInputs(manifest: OcrSourceManifest, readingId: z.input<typeof ItemIdSchema>): OcrPageInput[] {
  const source = OcrSourceManifestSchema.parse(manifest);
  return source.pages.map(page => OcrPageInputSchema.parse({ ...page, formType: "emergency-contact",
    manifestFingerprint: source.fingerprint, document: source.document, readingId }));
}

export function ocrExtractionId(input: OcrPageInput) {
  return FingerprintSchema.parse(sha256Hex(`relay:ocr-reading:v1\0${canonicalJsonStringify(OcrPageInputSchema.parse(input))}`));
}
