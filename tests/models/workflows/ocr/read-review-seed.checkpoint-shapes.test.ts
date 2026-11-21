import assert from "node:assert/strict";
import { it } from "vitest";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { ReadOcrResult } from "../../../../src/models/workflows/ocr/read-result.js";
import { ReadOcrReviewSeed } from "../../../../src/models/workflows/ocr/read-review-seed.js";
import { ReadOcrSourcePages } from "../../../../src/models/workflows/ocr/read-source-pages.js";

// Hashes of the OCR checkpoints the Emergency Contact feature build stores in operator profiles.
// A dashboard day that holds one of them refuses to load when this build parses another shape.
it("reads the OCR checkpoint shapes the Emergency Contact build stores", () => {
  assert.deepEqual({
    readSourcePages: deriveSchemaHash(ReadOcrSourcePages.output, "output"),
    readReviewSeed: deriveSchemaHash(ReadOcrReviewSeed.output, "output"),
    readResult: deriveSchemaHash(ReadOcrResult.output, "output"),
  }, {
    readSourcePages: "83c17ecc15d6956b11af505927bd47dd21cabf12d25f4af71e4b343c5a8b9969",
    readReviewSeed: "7c75eda440868d4f4689811d9a9fe3c2aa60a07e58625b5ef8fa08c3d8ecc570",
    readResult: "5bf2e1ec7fbf79fd4800870c9605663ff709f0e549e875ceed1e7358cbb96488",
  });
});
