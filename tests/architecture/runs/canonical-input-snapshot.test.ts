
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { DESCRIPTORS } from "../../../src/backend/app/registries/workflow-registry.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import {
  canonicalInputSamples,
  defineCanonicalInput,
  parseCanonicalInputSnapshot,
} from "../../../src/models/workflow/canonical-input.js";
import {
  defineCanonicalInputSnapshotMigration,
  migrateCanonicalInputSnapshot,
} from "../../../src/models/workflow/checkpoint.js";
import { auditCanonicalInputSchema } from "../../../src/models/validation/canonical-input-schema.js";
import { fixtureDescriptor } from "../../support/fixtures/descriptor-fixtures.js";

const HASH_OLD = FingerprintSchema.parse("1".repeat(64));
const HASH_NEW = FingerprintSchema.parse("2".repeat(64));
const HASH_OTHER = FingerprintSchema.parse("3".repeat(64));

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
        () => parseCanonicalInputSnapshot(descriptor.canonicalInput, { corrupted: true }),
        /stored canonical input snapshot is invalid and will not be re-derived from ingress/,
        String(descriptor.id),
      );
    }
  });

  it("moves a snapshot across schema hashes only through a checked-in migration", () => {
    const migration = defineCanonicalInputSnapshotMigration({
      workflowId: "person-lookup",
      from: HASH_OLD,
      to: HASH_NEW,
      migrate: (stored) => ({ ...(stored as Record<string, unknown>), includeCrmDates: false }),
    });

    assert.deepEqual(
      migrateCanonicalInputSnapshot(
        { schemaHash: HASH_OLD, value: { name: "Battistessa, Johnnie", keepNonHdh: false } },
        HASH_NEW,
        [migration],
        "person-lookup",
      ),
      { name: "Battistessa, Johnnie", keepNonHdh: false, includeCrmDates: false },
    );

    // No migration reaches the current hash → loud refusal, never a re-parse.
    assert.throws(
      () => migrateCanonicalInputSnapshot(
        { schemaHash: HASH_OTHER, value: {} },
        HASH_NEW,
        [migration],
        "person-lookup",
      ),
      /no checked-in snapshot migration reaches it/,
    );
    // A migration for another workflow is not a migration for this one.
    assert.throws(
      () => migrateCanonicalInputSnapshot(
        { schemaHash: HASH_OLD, value: {} },
        HASH_NEW,
        [migration],
        "fixture-graph",
      ),
      /no checked-in snapshot migration reaches it/,
    );
    // An unsealed object cannot stand in for a reviewed migration.
    assert.throws(
      () => migrateCanonicalInputSnapshot(
        { schemaHash: HASH_OLD, value: {} },
        HASH_NEW,
        [{ workflowId: "person-lookup", from: HASH_OLD, to: HASH_NEW, migrate: (value) => value }],
        "person-lookup",
      ),
      /must be the exact objects returned by defineCanonicalInputSnapshotMigration/,
    );
    // A no-op migration is a lie about compatibility.
    assert.throws(
      () => defineCanonicalInputSnapshotMigration({
        workflowId: "person-lookup",
        from: HASH_OLD,
        to: HASH_OLD,
        migrate: (value) => value,
      }),
      /does not change the schema hash/,
    );
  });

  it("refuses a snapshot migration chain that cycles", () => {
    const forward = defineCanonicalInputSnapshotMigration({
      workflowId: "person-lookup", from: HASH_OLD, to: HASH_NEW, migrate: (value) => value,
    });
    const backward = defineCanonicalInputSnapshotMigration({
      workflowId: "person-lookup", from: HASH_NEW, to: HASH_OLD, migrate: (value) => value,
    });
    assert.throws(
      () => migrateCanonicalInputSnapshot(
        { schemaHash: HASH_OLD, value: {} },
        HASH_OTHER,
        [forward, backward],
        "person-lookup",
      ),
      /form a cycle/,
    );
  });
});
