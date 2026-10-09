// pdfjs transfers its input buffer; copy it for each render. Wire its installed JBIG2 wasm decoder for scanned pages.
import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { pdf } from "pdf-to-img";
import { defineTask } from "../../../../workflow-kit/task.js";
import {
  ExtractPdfPages,
  ExtractPdfPagesOutputSchema,
} from "../../../../models/processing/extraction/extract-pdf-pages.js";

// The pinned 2× render scale preserves small handwriting and deterministic output.
const RENDER_SCALE = 2;
const PAGE_MEDIA_TYPE = "image/png";

/** Resolved from the installed pdfjs-dist so it can never name a stale copy. */
function pdfjsWasmUrl(): string {
  const require = createRequire(import.meta.url);
  return pathToFileURL(`${dirname(require.resolve("pdfjs-dist/package.json"))}/wasm/`).href;
}

async function readArtifactBytes(open: () => Promise<NodeJS.ReadableStream>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of await open()) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export const extractPdfPagesTask = defineTask(ExtractPdfPages, {
  sessions: [],
  async run({ input, ctx }) {
    const bytes = await readArtifactBytes(() => ctx.artifacts.open(input.document));
    if (bytes.byteLength === 0) {
      return ctx.fail("unreadable-pdf", `artifact ${input.document.id} is empty`);
    }

    let document;
    try {
      // A fresh copy: pdfjs detaches what it is given.
      document = await pdf(new Uint8Array(bytes), {
        scale: RENDER_SCALE,
        docInitParams: { wasmUrl: pdfjsWasmUrl() },
      });
    } catch (error) {
      return ctx.fail(
        "unreadable-pdf",
        `artifact ${input.document.id} could not be opened as a PDF: `
          + (error instanceof Error ? error.message : String(error)),
      );
    }

    const pageCount = document.length;
    if (pageCount === 0) return ctx.fail("empty-document", `artifact ${input.document.id} has no pages`);

    const from = input.fromPage ?? 1;
    const to = input.toPage ?? pageCount;
    if (from > to) {
      return ctx.fail("page-out-of-range", `page window ${String(from)}–${String(to)} runs backwards`);
    }
    if (to > pageCount) {
      // Refused, never clamped: an operator asking for pages past the end has
      // miscounted, and quietly returning fewer would hide it.
      return ctx.fail(
        "page-out-of-range",
        `pages ${String(from)}–${String(to)} were requested but the document has ${String(pageCount)}`,
      );
    }

    const pages: { sourcePage: number; image: unknown }[] = [];
    let sourcePage = 0;
    for await (const rendered of document) {
      sourcePage += 1;
      if (sourcePage < from) continue;
      if (sourcePage > to) break;
      if (rendered.byteLength === 0) {
        return ctx.fail("unreadable-pdf", `page ${String(sourcePage)} rendered to nothing`);
      }
      const image = await ctx.artifacts.put(rendered, { mediaType: PAGE_MEDIA_TYPE });
      pages.push({ sourcePage, image });
    }

    ctx.recordData([
      { direction: "read", field: "pageCount", value: pageCount },
      { direction: "read", field: "renderedPages", value: pages.length },
    ]);

    return ExtractPdfPagesOutputSchema.parse({ pageCount, pages });
  },
});
