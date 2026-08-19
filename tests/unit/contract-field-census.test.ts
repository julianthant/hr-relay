/**
 * The contract field census (D226) — `contractSchemaLeaves`.
 *
 * The explorer's node panel renders one row per FIELD, and every row is derived
 * from the contract's own zod shape rather than from an authored list. These
 * cases pin the three rules that decision rests on: an array is one leaf, a
 * union contributes the union of its arms with a weakened presence, and an
 * unrecognised zod tag throws instead of collapsing a subtree into one row.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { z } from "zod";
import { contractSchemaLeaves } from "../../src/validation/contract-boundary.js";

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
    // `selected: null` in two arms and a candidate object in the third is
    // exactly `ucpath/search-person-org`'s shape. Listing `selected` beside
    // `selected.emplId` would count a container as a field, and the children's
    // `sometimes` already carries "this may hold no record".
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
    // A `Map` is a container this walker does NOT understand as a field list,
    // and the boundary audit already refuses it in a contract. The census
    // refuses it a second time on its own terms: silently emitting one row for
    // it would under-report fields while looking complete.
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
