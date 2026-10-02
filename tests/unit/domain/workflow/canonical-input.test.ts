import assert from "node:assert/strict";
import { z } from "zod";
import { describe, it } from "vitest";
import {
  assertAuditedCanonicalInput,
  defineCanonicalInput,
  parseCanonicalInputSnapshot,
} from "../../../../src/domain/workflow/canonical-input.js";
import { auditCanonicalInputSchema } from "../../../../src/domain/validation/canonical-input-schema.js";
import { EidSchema } from "../../../../src/domain/ids.js";

/** The ref workflow-model §2 worked example: ingress applies two defaults, canonical does not. */
const PersonLookupInput = z.union([
  z.strictObject({
    name: z.string().min(1),
    keepNonHdh: z.boolean().default(false),
    includeCrmDates: z.boolean().default(false),
  }),
  z.strictObject({
    emplId: EidSchema,
    name: z.string().min(1).optional(),
    keepNonHdh: z.boolean().default(false),
    includeCrmDates: z.boolean().default(false),
  }),
]);

const PersonLookupCanonical = z.union([
  z.strictObject({
    name: z.string().min(1),
    keepNonHdh: z.boolean(),
    includeCrmDates: z.boolean(),
  }),
  z.strictObject({
    emplId: EidSchema,
    name: z.string().min(1).optional(),
    keepNonHdh: z.boolean(),
    includeCrmDates: z.boolean(),
  }),
]);

const SAMPLES = [
  { name: "Ada Lovelace" },
  { emplId: "10800000", keepNonHdh: true, includeCrmDates: true },
  { emplId: "10800001", name: "Grace Hopper" },
] as const;

describe("canonical input snapshots", () => {
  it("accepts a transform-free canonical schema that round-trips every ingress arm", () => {
    const canonical = defineCanonicalInput(PersonLookupInput, PersonLookupCanonical, SAMPLES);
    assert.deepEqual(
      canonical.parse({ name: "Ada Lovelace", keepNonHdh: false, includeCrmDates: false }),
      { name: "Ada Lovelace", keepNonHdh: false, includeCrmDates: false },
    );
  });

  it("rejects a canonical schema that would re-apply a default on resume", () => {
    assert.throws(
      () => defineCanonicalInput(
        PersonLookupInput,
        z.union([
          z.strictObject({
            name: z.string().min(1),
            keepNonHdh: z.boolean().default(false),
            includeCrmDates: z.boolean(),
          }),
          z.strictObject({
            emplId: EidSchema,
            name: z.string().min(1).optional(),
            keepNonHdh: z.boolean(),
            includeCrmDates: z.boolean(),
          }),
        ]),
        SAMPLES,
      ),
      /must be transform-free.*uses default/s,
    );
  });

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

  it("refuses a canonical schema that silently drops a field the ingress schema produced", () => {
    assert.throws(
      () => defineCanonicalInput(
        PersonLookupInput,
        z.union([
          z.strictObject({ name: z.string().min(1), keepNonHdh: z.boolean(), includeCrmDates: z.boolean() }),
          z.strictObject({ emplId: EidSchema, keepNonHdh: z.boolean(), includeCrmDates: z.boolean() }),
        ]),
        SAMPLES,
      ),
      // The third sample carries a name alongside emplId; a canonical arm that
      // omits it makes the snapshot non-round-tripping.
      /does not round-trip|Unrecognized key/,
    );
  });

  it("rejects an ingress schema that is not boundary-safe before auditing canonical", () => {
    assert.throws(
      () => defineCanonicalInput(
        z.strictObject({ anything: z.unknown() }),
        z.strictObject({ anything: z.unknown() }),
        [{ anything: 1 }],
      ),
      /workflow input schema is not boundary-safe/,
    );
  });

  it("fails loud on a corrupted stored snapshot instead of re-deriving it", () => {
    const canonical = defineCanonicalInput(PersonLookupInput, PersonLookupCanonical, SAMPLES);
    assert.deepEqual(
      parseCanonicalInputSnapshot(canonical, { name: "Ada", keepNonHdh: false, includeCrmDates: false }),
      { name: "Ada", keepNonHdh: false, includeCrmDates: false },
    );
    // A missing flag is exactly the case a default would have papered over.
    assert.throws(
      () => parseCanonicalInputSnapshot(canonical, { name: "Ada", keepNonHdh: false }),
      /stored canonical input snapshot is invalid and will not be re-derived from ingress/,
    );
    assert.throws(
      () => parseCanonicalInputSnapshot(canonical, { name: "Ada", keepNonHdh: false, includeCrmDates: "yes" }),
      /stored canonical input snapshot is invalid/,
    );
  });

  it("only accepts a schema that actually went through the audit", () => {
    const canonical = defineCanonicalInput(PersonLookupInput, PersonLookupCanonical, SAMPLES);
    assert.doesNotThrow(() => { assertAuditedCanonicalInput(canonical); });
    assert.throws(
      () => { assertAuditedCanonicalInput(z.strictObject({ name: z.string() })); },
      /requires the exact schema returned by defineCanonicalInput/,
    );
  });

  it("requires at least one sample, so the round-trip claim is never vacuous", () => {
    // @ts-expect-error samples is a non-empty tuple by construction
    assert.throws(() => defineCanonicalInput(PersonLookupInput, PersonLookupCanonical, []));
  });
});
