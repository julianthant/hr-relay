
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { z } from "zod";
import { assertBooleanSelectionField, assertSchemaOwnsPath, assertSchemaOffersPath, contractSchemaLeaves } from "../../../src/models/validation/contract-boundary.js";

const paths = (schema: z.core.$ZodType): readonly string[] =>
  contractSchemaLeaves(schema).map((leaf) => leaf.path);

describe("contractSchemaLeaves", () => {
  it("names every nested field by its dotted path, sorted", () => {
    const schema = z.strictObject({
      state: z.literal("found"),
      record: z.strictObject({ emplId: z.string(), name: z.string() }),
    });
    assert.deepEqual(paths(schema), ["record.emplId", "record.name", "state"]);
  });

  it("counts an ARRAY as one leaf, the way evidence leaves and byField already do", () => {
    const schema = z.strictObject({
      rows: z.array(z.strictObject({ day: z.string(), hours: z.number() })),
    });
    const leaves = contractSchemaLeaves(schema);
    assert.deepEqual(leaves.map((leaf) => leaf.path), ["rows"]);
    assert.equal(leaves[0]?.kind, "list");
  });

  it("marks an optional field `sometimes` and a required one `always`", () => {
    const leaves = contractSchemaLeaves(z.strictObject({
      eid: z.string(),
      reason: z.string().optional(),
    }));
    assert.equal(leaves.find((leaf) => leaf.path === "eid")?.presence, "always");
    assert.equal(leaves.find((leaf) => leaf.path === "reason")?.presence, "sometimes");
  });

  it("unions the arms of a discriminated union and weakens a path only SOME arms carry", () => {
    const schema = z.discriminatedUnion("state", [
      z.strictObject({ state: z.literal("found"), emplId: z.string() }),
      z.strictObject({ state: z.literal("absent"), reason: z.string() }),
    ]);
    const leaves = contractSchemaLeaves(schema);
    assert.deepEqual(leaves.map((leaf) => leaf.path), ["emplId", "reason", "state"]);
    assert.equal(leaves.find((leaf) => leaf.path === "state")?.presence, "always");
    assert.equal(leaves.find((leaf) => leaf.path === "emplId")?.presence, "sometimes");
    assert.equal(leaves.find((leaf) => leaf.path === "reason")?.presence, "sometimes");
  });

  it("merges a literal discriminant's arms into ONE closed vocabulary", () => {
    const leaves = contractSchemaLeaves(z.discriminatedUnion("state", [
      z.strictObject({ state: z.literal("found") }),
      z.strictObject({ state: z.literal("absent") }),
    ]));
    assert.deepEqual(leaves[0]?.options, ["absent", "found"]);
  });

  it("serves an enum's whole vocabulary sorted", () => {
    const leaves = contractSchemaLeaves(z.strictObject({
      status: z.enum(["terminated", "active", "inactive"]),
    }));
    assert.equal(leaves[0]?.kind, "enum");
    assert.deepEqual(leaves[0]?.options, ["active", "inactive", "terminated"]);
  });

  it("drops the bare `null` row of a field that is an OBJECT in another arm", () => {

    const schema = z.discriminatedUnion("status", [
      z.strictObject({
        status: z.literal("resolved"),
        selected: z.strictObject({ emplId: z.string(), name: z.string() }),
      }),
      z.strictObject({ status: z.literal("not-found"), selected: z.null() }),
    ]);
    assert.deepEqual(paths(schema), ["selected.emplId", "selected.name", "status"]);
  });

  it("refuses a root that is not an object or a union of objects, because its fields have no names", () => {
    assert.throws(
      () => contractSchemaLeaves(z.string()),
      /must be an object or a union of objects/u,
    );
  });

  it("refuses an unrecognised zod tag rather than reporting a subtree as one field", () => {

    assert.doesNotThrow(() => contractSchemaLeaves(z.strictObject({ seen: z.map(z.string(), z.string()) })));
    assert.throws(
      () => contractSchemaLeaves(z.strictObject({ when: z.promise(z.string()) })),
      /does not recognise/u,
    );
  });

  it("reports a self-referential schema as the one leaf it sits at, never unrolled", () => {
    type Node = { readonly label: string; readonly child?: Node };
    const NodeSchema: z.ZodType<Node> = z.lazy(() => z.strictObject({
      label: z.string(),
      child: NodeSchema.optional(),
    }));
    const leaves = contractSchemaLeaves(z.strictObject({ tree: NodeSchema }));
    assert.ok(leaves.some((leaf) => leaf.path === "tree.label"));
    assert.ok(leaves.every((leaf) => !leaf.path.startsWith("tree.child.child")));
  });
});

describe("schema field ownership", () => {
  it("accepts the same nested schema reused in every union arm", () => {
    const record = z.strictObject({ id: z.string() });
    const schema = z.discriminatedUnion("state", [
      z.strictObject({ state: z.literal("a"), record }),
      z.strictObject({ state: z.literal("b"), record }),
    ]);
    assert.doesNotThrow(() => assertSchemaOwnsPath(schema, "record.id", "freshness"));
    assert.doesNotThrow(() => assertSchemaOffersPath(schema, "record.id", "subject"));
    assert.throws(() => assertSchemaOwnsPath(schema, "record.missing", "freshness"), /unknown schema field/u);
  });

  it("refuses a recursive path without a field and retains every-arm ownership", () => {
    const recursive: z.ZodType = z.lazy(() => recursive);
    assert.throws(() => assertSchemaOwnsPath(recursive, "id", "freshness"), /unknown schema field/u);
    const schema = z.union([
      z.strictObject({ record: z.strictObject({ id: z.string() }) }),
      z.strictObject({ record: z.strictObject({ name: z.string() }) }),
    ]);
    assert.throws(() => assertSchemaOwnsPath(schema, "record.id", "freshness"), /unknown schema field/u);
    assert.doesNotThrow(() => assertSchemaOffersPath(schema, "record.id", "subject"));
  });
});

describe("boolean start selection contract", () => {
  it("checks every offered union arm and wrapper without relying on samples", () => {
    for (const enabled of [z.boolean(), z.literal(false), z.union([z.literal(true), z.literal(false)]),
      z.boolean().default(true).readonly(), z.boolean().optional()]) {
      assert.doesNotThrow(() => assertBooleanSelectionField(z.strictObject({ enabled }), "enabled", "fixture"));
    }
    assert.doesNotThrow(() => assertBooleanSelectionField(z.union([
      z.strictObject({ mode: z.literal("search"), enabled: z.boolean() }),
      z.strictObject({ mode: z.literal("match"), enabled: z.literal(false) }),
    ]), "enabled", "fixture"));
    for (const enabled of [z.union([z.boolean(), z.string()]), z.boolean().nullable(),
      z.union([z.literal(false), z.literal("yes")]).optional(), z.boolean().pipe(z.boolean()),
      z.intersection(z.boolean(), z.boolean())]) {
      assert.throws(() => assertBooleanSelectionField(z.strictObject({ enabled }), "enabled", "fixture"), /must be boolean/u);
    }
    assert.throws(() => assertBooleanSelectionField(z.union([
      z.strictObject({ mode: z.literal("search"), enabled: z.boolean() }),
      z.strictObject({ mode: z.literal("match"), enabled: z.string() }),
    ]), "enabled", "fixture"), /must be boolean/u);
  });
});
