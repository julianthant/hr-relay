import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { OcrSourceManifestSchema, OcrPageInputSchema, buildOcrSourceManifest, ocrExtractionId, ocrPageInputs } from "../../../../src/models/workflows/ocr/source-manifest.js";
import { DOCUMENT, READING_ID, sourceFixture } from "../../../support/fixtures/ocr/source-pages.js";

describe("OCR immutable source manifest", () => {
  it("retains original PDF and ordered rendered image identity without borrowing input arrays", () => {
    const { manifest, inputs } = sourceFixture();
    const rendered = { pageCount: 2, pages: [...manifest.pages].reverse() };
    const rebuilt = buildOcrSourceManifest(DOCUMENT, rendered);
    assert.deepEqual(rebuilt, manifest);
    rendered.pages.pop();
    assert.equal(rebuilt.pages.length, 2);
    assert.equal(Object.isFrozen(rebuilt), true);
    assert.equal(Object.isFrozen(rebuilt.pages[0].image), true);
    assert.throws(() => { rebuilt.pages.pop(); });
    assert.deepEqual(inputs.map(input => [input.document.sha256, input.sourcePage, input.image.sha256]),
      manifest.pages.map(page => [DOCUMENT.sha256, page.sourcePage, page.image.sha256]));
  });

  it("refuses a partial window, duplicate, missing, or out-of-range original page", () => {
    const { manifest } = sourceFixture();
    for (const pages of [[manifest.pages[0]], [manifest.pages[0], manifest.pages[0]],
      [manifest.pages[0], { ...manifest.pages[1], sourcePage: 3 }]]) {
      assert.throws(() => buildOcrSourceManifest(DOCUMENT, { pageCount: 2, pages }), /every original page/);
    }
  });

  it("binds every artifact property and refuses altered manifest or non-PDF/image media", () => {
    const { manifest } = sourceFixture();
    assert.equal(OcrSourceManifestSchema.safeParse({ ...manifest, document: { ...manifest.document, bytes: 1 } }).success, false);
    assert.equal(OcrSourceManifestSchema.safeParse({ ...manifest, pages: [...manifest.pages].reverse() }).success, false);
    assert.throws(() => buildOcrSourceManifest({ ...DOCUMENT, mediaType: "text/plain" }, { pageCount: 2, pages: manifest.pages }));
    assert.throws(() => buildOcrSourceManifest(DOCUMENT, { pageCount: 2,
      pages: manifest.pages.map(page => ({ ...page, image: { ...page.image, bytes: 0 } })) }));
  });

  it("keeps replay IDs stable and separates reread versions, pages and source identities", () => {
    const { manifest, inputs } = sourceFixture();
    assert.equal(ocrExtractionId(inputs[0]), ocrExtractionId(ocrPageInputs(manifest, READING_ID)[0]));
    assert.notEqual(ocrExtractionId(inputs[0]), ocrExtractionId(inputs[1]));
    assert.notEqual(ocrExtractionId(inputs[0]), ocrExtractionId(ocrPageInputs(manifest, "00000000-0000-4000-8000-000000000999")[0]));
    assert.notEqual(ocrExtractionId(inputs[0]), ocrExtractionId({ ...inputs[0], image: inputs[1].image }));
    assert.equal(OcrPageInputSchema.safeParse({ ...inputs[0], formType: "oath" }).success, false);
  });
});
