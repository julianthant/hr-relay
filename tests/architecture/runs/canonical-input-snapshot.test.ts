
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { DESCRIPTORS } from "../../../src/backend/app/registries/workflow-registry.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import {
  canonicalInputSamples,
  defineCanonicalInput,
  parseCanonicalInputSnapshot,
} from "../../../src/models/workflow/canonical-input.js";
import { auditCanonicalInputSchema } from "../../../src/models/validation/canonical-input-schema.js";
import { fixtureDescriptor } from "../../support/fixtures/descriptor-fixtures.js";

describe("canonical input snapshot", () => {
  it("keeps every registered canonical schema transform-free and round-tripping", () => {
    for (const descriptor of [...DESCRIPTORS, fixtureDescriptor]) {
      const id = String(descriptor.id);
      assert.deepEqual(auditCanonicalInputSchema(descriptor.canonicalInput, id), [], id);
      const samples = canonicalInputSamples(descriptor.canonicalInput);
      assert.ok(samples.length > 0, `${id} proves its round-trip against no sample`);
      for (const sample of samples) {
        const revalidated: unknown = descriptor.canonicalInput.parse(sample);
        assert.equal(canonicalJsonStringify(revalidated), canonicalJsonStringify(sample), id);
      }
    }
  });

  it("rejects a transform buried anywhere in the schema graph", () => {
    const ingress = z.strictObject({ eid: z.string().min(1), tags: z.array(z.string()) });
    // Top-level, inside an array element, and inside a union arm all re-apply on
    // the same read, so all three must be caught.
    const buried = [
      z.strictObject({ eid: z.string().min(1).default("x"), tags: z.array(z.string()) }),
      z.strictObject({ eid: z.string().min(1), tags: z.array(z.string().catch("")) }),
      z.union([
        z.strictObject({ eid: z.string().min(1), tags: z.array(z.string()) }),
        z.strictObject({ eid: z.coerce.string(), tags: z.array(z.string()) }),
      ]),
    ];
    for (const [index, schema] of buried.entries()) {
      assert.ok(auditCanonicalInputSchema(schema, "fixture").length > 0, `buried transform ${String(index)}`);
      assert.throws(
        () => defineCanonicalInput(ingress, schema, [{ eid: "a", tags: [] }]),
        /transform-free/,
        `buried transform ${String(index)}`,
      );
    }
  });

  it("refuses a canonical schema that drifted from its ingress schema", () => {

    const ingress = z.strictObject({ eid: z.string().min(1), note: z.string() });
    assert.throws(
      () => defineCanonicalInput(
        ingress,
        z.strictObject({ eid: z.string().min(1), note: z.string().min(1) }),
        [{ eid: "10800000", note: "" }],
      ),
      /too small|expected string/i,
    );
    // The same schema is fine once the ingress corpus and the canonical schema
    // agree about what a valid stored value looks like.
    assert.ok(defineCanonicalInput(
      ingress,
      z.strictObject({ eid: z.string().min(1), note: z.string().min(1) }),
      [{ eid: "10800000", note: "ok" }],
    ));
  });

  it("fails loud on a corrupted snapshot rather than re-deriving it from ingress", () => {
    for (const descriptor of DESCRIPTORS) {
      assert.throws(
        () => parseCanonicalInputSnapshot(descriptor.canonicalInput, { schemaHash: deriveSchemaHash(descriptor.canonicalInput, "output"), value: { corrupted: true } }),
        /stored canonical input snapshot is invalid and will not be re-derived from ingress/,
        String(descriptor.id),
      );
    }
  });

  it("requires the exact current schema hash without changing canonical bytes", () => {
    for (const descriptor of [...DESCRIPTORS, fixtureDescriptor]) {
      const value = canonicalInputSamples(descriptor.canonicalInput)[0];
      const expected = deriveSchemaHash(descriptor.canonicalInput, "output");
      const stored = { schemaHash: expected, value };
      const before = canonicalJsonStringify(stored);
      assert.equal(canonicalJsonStringify(parseCanonicalInputSnapshot<z.ZodType>(descriptor.canonicalInput, stored)), canonicalJsonStringify(value));
      assert.equal(canonicalJsonStringify(stored), before);
      assert.throws(() => parseCanonicalInputSnapshot<z.ZodType>(descriptor.canonicalInput, { ...stored, schemaHash: "0".repeat(64) }), /bound to schema.*will not be re-derived from ingress/u);
    }
  });
});
