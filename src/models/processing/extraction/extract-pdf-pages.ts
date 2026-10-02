/**
 * `extraction/extract-pdf-pages` — a scanned PDF becomes one page artifact each.
 *
 * This is what feeds `ocr/extract-form-page`, whose input is ONE page. The
 * operator scans a stack; this splits it so every page can be read, reviewed
 * and re-read independently, and so `sourcePage` means something a human can
 * check against the paper.
 *
 * ## Ref data-intake-and-edit-data §3's `parse-pdf-fields` described a capability that does not exist
 *
 * That entry says "same shape for a fielded PDF (onboarding's extraction step
 * ports here)". Reading legacy at `4deabc5a`: onboarding's `extract.ts` is
 * Playwright scraping labelled fields off a CRM page, and no legacy code reads
 * an AcroForm anywhere. What legacy actually does with PDFs is rasterize pages
 * for OCR, split a page out for OnBase, and text-extract Kronos reports. So the
 * real intake need is rasterization, and inventing an AcroForm reader for a
 * form nobody submits would be building against a misremembered requirement.
 * §3.2 records the correction.
 *
 * ## Determinism
 *
 * The input is content-addressed and the render scale is pinned, so the same
 * bytes produce the same images. `maxAgeMs` is Infinity for the same reason the
 * spreadsheet parse is: a renderer upgrade can change the ENCODING of a page
 * image, never what the page shows, and a replayed page image is still that
 * page. That is a different claim from the OCR read, which is an interpretation
 * and therefore ages.
 */
import { z } from "zod";
import { ArtifactRefSchema } from "../../artifacts/artifacts.js";
import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";

export const ExtractPdfPagesInputSchema = z.strictObject({
  document: ArtifactRefSchema,
  /**
   * 1-based inclusive window. Absent means every page. A window is refused
   * rather than clamped when it runs past the end: an operator who asked for
   * pages 40–50 of a 44-page scan has miscounted something, and silently
   * returning five pages would hide it.
   */
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
