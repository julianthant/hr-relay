import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "vitest";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../../src/domain/canonical-json.js";
import { ReadActiveStatus } from "../../../../src/domain/contracts/person-lookup/read-active-status.js";
import { deriveSchemaHash } from "../../../../src/domain/schema-bound-value.js";
import { sha256Hex } from "../../../../src/domain/sha256.js";
import {
  PersonLookupCanonicalInput,
  PersonLookupResultSchema,
} from "../../../../src/workflows/person-lookup/workflow.js";

function nodeSha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("browser-safe SHA-256 parity", () => {
  it("matches Node for Unicode, NUL, and lone surrogate UTF-8 encoding", () => {
    const values = [
      "UCSD 🧭 résumé 東京",
      "before\0after",
      "\ud800",
      "\udc00",
      "left\ud800right",
      "paired \ud83e\udded and lone \ud83e",
    ];
    for (const value of values) assert.equal(sha256Hex(value), nodeSha256(value), JSON.stringify(value));
  });

  it("matches Node across SHA-256 padding block boundaries", () => {
    for (const byteLength of [0, 1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 129]) {
      const value = "a".repeat(byteLength);
      assert.equal(sha256Hex(value), nodeSha256(value), `${String(byteLength)} bytes`);
    }
  });

  it("matches Node for real descriptor and task schema projections", () => {
    const schemas = [
      PersonLookupCanonicalInput,
      PersonLookupResultSchema,
      ReadActiveStatus.output,
    ];
    for (const schema of schemas) {
      for (const io of ["input", "output"] as const) {
        const projection = z.toJSONSchema(schema, { io, unrepresentable: "any", cycles: "ref" });
        const identity = `hrauto:schema-identity:v1\0${io}\0${canonicalJsonStringify(projection)}`;
        assert.equal(deriveSchemaHash(schema, io), nodeSha256(identity));
      }
    }
  });
});
