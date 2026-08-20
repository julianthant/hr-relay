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
import { descriptorRuntimeNodes } from "../../../src/base/workflow.js";
import { DESCRIPTORS } from "../../../src/control/workflow-registry.js";
import { describeProofShape, type ProofShapeField } from "../../../src/validation/proof-shape.js";
import {
  composeProofValue,
  initialProofDrafts,
  proofFieldHint,
  proofFieldLabel,
  proofFieldProblem,
} from "../../../src/dashboard/app/proof-form.js";
import { ProofContractWireSchema, type ProofFieldWire } from "../../../src/domain/dashboard/run-detail.js";

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
function valueAtPath(root: unknown, path: string): unknown {
  let cursor: unknown = root;
  for (const segment of path.split(".")) {
    assert.ok(cursor !== null && typeof cursor === "object", `path ${path} left the object at ${segment}`);
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/** What an operator would type into each box to transcribe this exact proof. */
function draftsFor(fields: readonly ProofShapeField[], proof: unknown): Record<string, string> {
  const drafts: Record<string, string> = {};
  for (const field of fields) {
    if (field.kind === "fixed") continue;
    drafts[field.path] = String(valueAtPath(proof, field.path));
  }
  return drafts;
}

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

  /**
   * The whole claim, per contract: what the form composes is what the kernel
   * parses. Everything else here is a detail of how it gets there.
   */
  it("round-trips a real proof through the form and back into the contract's own schema", () => {
    for (const commit of registeredCommits()) {
      const shape = describeProofShape(commit.proofSchema);
      assert.ok(shape.state === "described");
      const drafts = draftsFor(shape.fields, commit.proof);
      const composed = composeProofValue(shape.fields as readonly ProofFieldWire[], drafts);
      assert.ok(
        composed.state === "composed",
        `${commit.taskId} refused its own example proof: `
        + `${composed.state === "invalid" ? JSON.stringify(composed.problems) : ""}`,
      );
      assert.deepEqual(composed.value, commit.proof, `${commit.taskId} composed a different proof`);
      // The authority's own parse — the one `resolvePresent` performs.
      assert.doesNotThrow(() => commit.proofSchema.parse(composed.value), commit.taskId);
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

  /**
   * A literal is the SCHEMA's value, not the operator's. A form that let a
   * person type `kind` or `source` would be offering a choice the contract does
   * not have — and `source` in particular names how the fields were READ, which
   * an attestation does not change (the envelope's `proofSource:
   * operator-attestation` is what records who vouched for it).
   */
  it("pins literals as fixed and never as an operator input", () => {
    for (const commit of registeredCommits()) {
      const shape = describeProofShape(commit.proofSchema);
      assert.ok(shape.state === "described");
      const fixed = shape.fields.filter((field) => field.kind === "fixed");
      assert.ok(fixed.length > 0, `${commit.taskId} pins no literal at all`);
      const drafts = initialProofDrafts(shape.fields as readonly ProofFieldWire[]);
      for (const field of fixed) {
        assert.ok(!(field.path in drafts), `${field.path} was offered as a box to type in`);
      }
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

describe("the client-side refusal, per field (D245)", () => {
  const text: ProofFieldWire = {
    kind: "text",
    path: "emplId" as ProofFieldWire["path"],
    pattern: "^10\\d{6}$",
    serverOnlyRules: false,
  };
  const choice: ProofFieldWire = {
    kind: "choice",
    path: "approvalStatus" as ProofFieldWire["path"],
    options: ["Approved", "Pending"],
  };
  const integer: ProofFieldWire = {
    kind: "integer",
    path: "scannedRowCount" as ProofFieldWire["path"],
    minimum: 0,
  };

  it("refuses an empty answer as evidence rather than as a formatting slip", () => {
    assert.match(proofFieldProblem(text, "   ") ?? "", /not something you saw/u);
  });

  it("names the contract's own pattern, the option list, and the bound", () => {
    assert.match(proofFieldProblem(text, "99") ?? "", /\^10\\d\{6\}\$/u);
    assert.match(proofFieldProblem(choice, "Nope") ?? "", /Approved, Pending/u);
    assert.match(proofFieldProblem(integer, "-1") ?? "", /At least 0/u);
    assert.match(proofFieldProblem(integer, "1.5") ?? "", /whole number/u);
  });

  it("reports EVERY problem at once, so one look at the page fixes them all", () => {
    const composed = composeProofValue([text, choice, integer], {
      emplId: "99",
      approvalStatus: "Nope",
      scannedRowCount: "3",
    });
    assert.ok(composed.state === "invalid");
    assert.deepEqual(composed.problems.map(({ path }) => path), ["emplId", "approvalStatus"]);
  });

  it("builds the nested object a dotted path names", () => {
    const composed = composeProofValue([
      { kind: "fixed", path: "kind" as ProofFieldWire["path"], value: "kuali-saved-finalization" },
      { kind: "text", path: "fields.timekeeperName" as ProofFieldWire["path"], serverOnlyRules: false },
      { kind: "boolean", path: "fields.requestAcknowledged" as ProofFieldWire["path"] },
    ], { "fields.timekeeperName": "HEIN, JULIAN", "fields.requestAcknowledged": "true" });
    assert.ok(composed.state === "composed");
    assert.deepEqual(composed.value, {
      kind: "kuali-saved-finalization",
      fields: { timekeeperName: "HEIN, JULIAN", requestAcknowledged: true },
    });
  });
});

/**
 * The label is an ACCESSIBLE NAME and the hint is the sentence beside the box,
 * so both are pinned here rather than only in the parity corpus — this tree
 * renders no React in the unit lane, which is exactly why `terminalOutcomeText`
 * became an exported pure function too (D187's lesson from the other side).
 */
describe("what the proof form calls each field (D245)", () => {
  it("humanises the schema's own path and never renames the field", () => {
    const label = (path: string): string =>
      proofFieldLabel({ kind: "boolean", path: path as ProofFieldWire["path"] });
    assert.equal(label("transactionId"), "Transaction id");
    assert.equal(label("emplId"), "Empl id");
    assert.equal(label("fields.separationDate"), "Fields · separation date");
  });

  it("prints the contract's own constraint, verbatim where it is a pattern", () => {
    assert.equal(
      proofFieldHint({
        kind: "text",
        path: "transactionId" as ProofFieldWire["path"],
        pattern: "^T\\d{6,}$",
        serverOnlyRules: false,
      }),
      "must match ^T\\d{6,}$",
    );
    assert.match(
      proofFieldHint({
        kind: "text",
        path: "observedAt" as ProofFieldWire["path"],
        format: "iso-datetime",
        pattern: "whatever",
        serverOnlyRules: false,
      }) ?? "",
      /ISO-8601 instant with an offset/u,
    );
    // The one honest half-measure: the box cannot re-check a `.refine()`, and
    // says so instead of implying its own tick is the verdict.
    assert.match(
      proofFieldHint({
        kind: "text",
        path: "comments" as ProofFieldWire["path"],
        maxLength: 4000,
        serverOnlyRules: true,
      }) ?? "",
      /server checks more rules on this one than this box can/u,
    );
    // A choice and a boolean render their answers, so a sentence would repeat
    // the control.
    assert.equal(
      proofFieldHint({ kind: "boolean", path: "flag" as ProofFieldWire["path"] }),
      undefined,
    );
    assert.equal(
      proofFieldHint({
        kind: "choice",
        path: "status" as ProofFieldWire["path"],
        options: ["Approved"],
      }),
      undefined,
    );
  });
});
