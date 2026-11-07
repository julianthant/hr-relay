/** `extraction/extract-pdf-pages`: a scanned PDF becomes one page artifact each, feeding `ocr/extract-form-page`; content-addressed input and a pinned render scale make the images deterministic. */
import { z } from "zod";
import { ArtifactRefSchema } from "../../artifacts/artifacts.js";
import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";

export const ExtractPdfPagesInputSchema = z.strictObject({
  document: ArtifactRefSchema,
    /* 1-based inclusive window; absent means every page, and a window past the end is refused rather than clamped. */
  fromPage: z.number().int().positive().optional(),
  toPage: z.number().int().positive().optional(),
});

export const ExtractPdfPagesOutputSchema = z.strictObject({
  /** Pages in the whole document, not in the returned window. */
  pageCount: z.number().int().positive(),
  pages: z.array(z.strictObject({
    sourcePage: z.number().int().positive(),
    /** The rendered page, in the content-addressed store. */
    image: ArtifactRefSchema,
  })).min(1),
});

export const ExtractPdfPages = defineTaskContract({
  id: taskId("extraction/extract-pdf-pages"),
  title: "Splitting document pages",
  effect: "read",
  input: ExtractPdfPagesInputSchema,
  output: ExtractPdfPagesOutputSchema,
  errorCodes: ["unreadable-pdf", "empty-document", "page-out-of-range"],
  subject: { kind: "none", reason: "rasterizing a local document resolves no person" },
  freshness: {
    defaultMaxAgeMs: Number.POSITIVE_INFINITY,
    defaultOverride: "forbidden",
  },
  provenance: { default: "live" },
  artifacts: "content-addressed",
  scenarios: [
    "intake/pdf/every-page",
    "intake/pdf/page-window",
    "intake/pdf/page-out-of-range",
    "intake/pdf/unreadable",
  ],
  example: {
    pageCount: 3,
    pages: [
      {
        sourcePage: 1,
        image: {
          id: "11111111-2222-4333-8444-555555555555",
          sha256: "3f1c0a2b4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8",
          bytes: 6642,
          mediaType: "image/png",
        },
      },
    ],
  },
});
