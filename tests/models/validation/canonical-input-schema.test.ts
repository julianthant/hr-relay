import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { z } from "zod";
import { auditCanonicalInputSchema } from "../../../src/models/validation/canonical-input-schema.js";
import { EidSchema } from "../../../src/rules/identity/ids.js";

describe("canonical input snapshots", () => {

  it("rejects catch, transform, pipe, and coercion anywhere in the graph", () => {
    const base = { name: z.string().min(1), includeCrmDates: z.boolean() };
    const cases: readonly [string, z.ZodType][] = [
      ["catch", z.strictObject({ ...base, keepNonHdh: z.boolean().catch(false) })],
      ["transform", z.strictObject({ ...base, keepNonHdh: z.boolean().transform((value) => !value) })],
      ["pipe", z.strictObject({ ...base, keepNonHdh: z.boolean().pipe(z.boolean()) })],
      ["coerce", z.strictObject({ ...base, keepNonHdh: z.coerce.boolean() })],
    ];
    for (const [label, schema] of cases) {
      const issues = auditCanonicalInputSchema(schema, "canonicalInput");
      assert.ok(issues.length > 0, `${label} should have been rejected`);
      assert.match(issues.join("; "), /keepNonHdh/);
    }
  });

  it("finds an ingress node nested under an array or a union arm", () => {
    const nested = z.strictObject({
      people: z.array(z.strictObject({ eid: EidSchema, keepNonHdh: z.boolean().default(false) })),
    });
    assert.match(
      auditCanonicalInputSchema(nested, "canonicalInput").join("; "),
      /canonicalInput\.people\[\]\.keepNonHdh uses default/,
    );
  });

  it("still enforces the strict-boundary rules on the canonical schema", () => {
    assert.match(
      auditCanonicalInputSchema(
        z.strictObject({ payload: z.record(z.string(), z.string()) }),
        "canonicalInput",
      ).join("; "),
      /decision-bearing record/,
    );
  });
});
