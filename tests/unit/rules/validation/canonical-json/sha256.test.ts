import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "vitest";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../../../src/rules/validation/canonical-json.js";
import { ReadActiveStatus } from "../../../../../src/models/workflows/person-lookup/read-active-status.js";
import { deriveSchemaHash } from "../../../../../src/models/validation/schema-bound-value.js";
import { sha256Hex } from "../../../../../src/rules/validation/sha256.js";
import {
  PersonLookupCanonicalInput,
  PersonLookupResultSchema,
} from "../../../../../src/workflows/person-lookup/workflow.js";

function nodeSha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("browser-safe SHA-256 parity", () => {
  it("preserves exact canonical bytes and hashes across nested arrays and objects", () => {
    const input = [{ z: [null, true, -0, 1e30, ["東京", "\ud800", "\n\"\\"]], a: [{ ä: 3, a: 2, Z: 1 }] }];
    const expected = '[{"a":[{"Z":1,"a":2,"ä":3}],"z":[null,true,0,1e+30,["東京","\\ud800","\\n\\"\\\\"]]}]';
    const actual = canonicalJsonStringify(input);
    assert.equal(actual, expected);
    assert.deepEqual(Buffer.from(actual, "utf8"), Buffer.from(expected, "utf8"));
    assert.equal(sha256Hex(actual), nodeSha256(expected));
  });

  it("refuses invalid values nested through arrays before serialization", () => {
    for (const invalid of [undefined, Number.NaN, Infinity, -Infinity, 1n, new Map(), () => 1, Symbol("invalid")]) {
      assert.throws(() => canonicalJsonStringify([{ nested: [[{ value: invalid }]] }]));
    }
    const sparse = Array(1);
    assert.throws(() => canonicalJsonStringify([{ nested: [sparse] }]));
  });

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
