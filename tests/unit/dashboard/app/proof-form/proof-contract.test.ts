/**
 * D245 — the parked-write section's PROOF CONTRACT, end to end without React.
 *
 * The record this closes: `resolve-write-present` was refused by every surface
 * in the build because the wire served neither the proof's schema hash nor its
 * shape, so no client could compose the `SchemaBoundCanonicalValue` the kernel
 * demands — and the refusal copy pointed at a CLI path that does not exist.
 *
 * The load-bearing case here is the ROUND TRIP over every registered commit
 * contract: take the contract's own example output, derive the proof the kernel
 * would have taken from it, spell every leaf back as the strings an operator
 * would type, compose them through the same pure function the dialog uses, and
 * require the result to (a) equal the proof byte for byte and (b) parse through
 * the contract's real `completion.proofSchema`. A form that cannot do that is a
 * form that composes something the kernel rejects, which is the defect this
 * work exists to remove — and asserting it per REGISTERED CONTRACT rather than
 * per named schema is what stops a fifth commit contract from silently landing
 * with an undescribable proof and a disabled button.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { descriptorRuntimeNodes } from "../../../../../src/workflow-kit/workflow.js";
import { DESCRIPTORS } from "../../../../../src/backend/app/registries/workflow-registry.js";
import { describeProofShape } from "../../../../../src/models/validation/proof-shape.js";
import { ProofContractWireSchema } from "../../../../../src/models/dashboard/run-detail.js";

interface RegisteredCommit {
  readonly workflowId: string;
  readonly taskId: string;
  readonly proofSchema: z.ZodType;
  readonly proof: unknown;
}

/**
 * Every transaction node in the tree, with the proof the kernel itself would
 * have derived from the contract's declared example output. `proofFromOutput`
 * is the contract's own function — nothing here authors a proof.
 */
function registeredCommits(): readonly RegisteredCommit[] {
  return DESCRIPTORS.flatMap((descriptor) =>
    descriptorRuntimeNodes(descriptor).flatMap((node) => {
      if (node.kind !== "transaction") return [];
      const contract = node.commit.uses;
      const completion = contract.writeSafety.completion;
      const output: unknown = contract.output.parse(contract.example);
      return [{
        workflowId: String(descriptor.id),
        taskId: String(contract.id),
        proofSchema: completion.proofSchema,
        proof: completion.proofSchema.parse(
          Reflect.apply(completion.proofFromOutput, undefined, [output]),
        ),
      }];
    }));
}

/** Read a described leaf out of a real proof value, by its dot path. */

/** What an operator would type into each box to transcribe this exact proof. */

describe("the served proof contract (ref write-safety §4.1, D245)", () => {
  it("covers every registered commit contract — there is at least one", () => {
    assert.ok(registeredCommits().length > 0, "the tree registers no transaction node at all");
  });

  it("describes every registered commit contract's completion proof", () => {
    for (const commit of registeredCommits()) {
      const shape = describeProofShape(commit.proofSchema);
      assert.ok(
        shape.state === "described",
        `${commit.taskId} (${commit.workflowId}) has an undescribable proof, so its present arm cannot be `
        + `composed: ${shape.state === "undescribable" ? shape.reason : ""}`,
      );
      assert.ok(shape.fields.length > 0);
    }
  });

  it("parses every described field list through the served wire schema", () => {
    for (const commit of registeredCommits()) {
      const shape = describeProofShape(commit.proofSchema);
      assert.ok(shape.state === "described");
      const parsed = ProofContractWireSchema.parse({
        state: "served",
        commitTaskId: commit.taskId,
        completionKind: "save-verify",
        schemaHash: "a".repeat(64),
        fields: shape.fields,
      });
      assert.ok(parsed.state === "served");
      assert.equal(parsed.fields.length, shape.fields.length);
    }
  });
});

describe("shapes the proof describer refuses by name", () => {
  const cases: readonly (readonly [string, z.ZodType, RegExp])[] = [
    ["a non-object root", z.string(), /a proof this surface can compose is an object/u],
    ["an optional leaf", z.strictObject({ a: z.string().optional() }), /zod "optional"/u],
    ["a nullable leaf", z.strictObject({ a: z.string().nullable() }), /zod "nullable"/u],
    ["an array leaf", z.strictObject({ a: z.array(z.string()) }), /zod "array"/u],
    ["a union leaf", z.strictObject({ a: z.union([z.string(), z.number()]) }), /zod "union"/u],
    ["a float leaf", z.strictObject({ a: z.number() }), /non-integer number/u],
    ["a permissive object", z.looseObject({ a: z.string() }), /admits unknown keys/u],
    [
      "an object three levels deep",
      z.strictObject({ a: z.strictObject({ b: z.strictObject({ c: z.string() }) }) }),
      /nests deeper than this describer walks/u,
    ],
    ["an empty object", z.strictObject({}), /declares no fields at all/u],
  ];

  for (const [label, schema, expected] of cases) {
    it(`refuses ${label} with the path and the reason`, () => {
      const shape = describeProofShape(schema);
      assert.ok(shape.state === "undescribable", `${label} was described`);
      assert.match(shape.reason, expected);
    });
  }

  /**
   * A `.refine()` cannot cross a wire, and refusing the whole contract over one
   * would strand the arm — so the leaf is described and FLAGGED. Kuali's
   * finalization carries two of them, which is why this arm has a producer.
   */
  it("describes a refined leaf and flags that the server checks more", () => {
    const shape = describeProofShape(z.strictObject({
      a: z.string().min(1).max(10).refine((value) => value === value.trim(), "no padding"),
    }));
    assert.ok(shape.state === "described");
    const [field] = shape.fields;
    assert.ok(field && field.kind === "text");
    assert.equal(field.serverOnlyRules, true);
    assert.equal(field.minLength, 1);
    assert.equal(field.maxLength, 10);
  });

  it("carries a regex source and an instant's own format", () => {
    const shape = describeProofShape(z.strictObject({
      eid: z.string().regex(/^10\d{6}$/u, "eight digits"),
      at: z.iso.datetime({ offset: true }),
      count: z.number().int().min(0),
      flag: z.boolean(),
      status: z.enum(["Approved", "Denied"]),
    }));
    assert.ok(shape.state === "described");
    const byPath = new Map(shape.fields.map((field) => [field.path, field]));
    const eid = byPath.get("eid");
    assert.ok(eid && eid.kind === "text" && eid.pattern === "^10\\d{6}$" && !eid.serverOnlyRules);
    const at = byPath.get("at");
    assert.ok(at && at.kind === "text" && at.format === "iso-datetime");
    const count = byPath.get("count");
    assert.ok(count && count.kind === "integer" && count.minimum === 0);
    assert.ok(byPath.get("flag")?.kind === "boolean");
    const status = byPath.get("status");
    assert.ok(status && status.kind === "choice");
    assert.deepEqual(status.options, ["Approved", "Denied"]);
  });
});

/**
 * The label is an ACCESSIBLE NAME and the hint is the sentence beside the box,
 * so both are pinned here rather than only in the parity corpus — this tree
 * renders no React in the unit lane, which is exactly why `terminalOutcomeText`
 * became an exported pure function too (D187's lesson from the other side).
 */
