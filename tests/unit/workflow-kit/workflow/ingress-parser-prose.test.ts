
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { defineWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { EidSchema, FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import {
  ENTRY_PATTERNS,
  ENTRY_PATTERN_NOUNS,
  InputParserSpecSchema,
  InputRunSurfaceSchema,
  type InputRunExample,
  inputRunParserLabel,
  inputRunSeparatorLabel,
  inputRunValueNoun,
} from "../../../../src/models/workflow/ingress.js";
import { FixtureReadReceipt } from "../../../support/fixtures/descriptor-fixtures.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

const parser = (spec: unknown) => InputParserSpecSchema.parse(spec);

describe("the parser, described to the operator", () => {
  it("legends exactly the closed pattern vocabulary — no arm without words, no words without an arm", () => {
    // The whole reason the prose is derived rather than authored: this pair of
    // key sets is what makes a sentence unable to describe a rule that is gone.
    assert.deepEqual(
      Object.keys(ENTRY_PATTERN_NOUNS).sort(),
      Object.keys(ENTRY_PATTERNS).sort(),
    );
  });

  it("names the values a box accepts, and says 'entries' when the spec claims nothing", () => {
    assert.equal(
      inputRunValueNoun(parser({
        split: { kind: "delimited", delimiters: [";"] },
        rules: [
          { when: { kind: "pattern", pattern: "eid" }, emit: "emplId" },
          { when: { kind: "otherwise" }, emit: "name" },
        ],
      })),
      "employee IDs",
    );
    assert.equal(
      inputRunValueNoun(parser({
        split: { kind: "delimited", delimiters: [","] },
        rules: [
          { when: { kind: "pattern", pattern: "eid" }, emit: "emplId" },
          { when: { kind: "pattern", pattern: "email" }, emit: "email" },
          { when: { kind: "pattern", pattern: "digits" }, emit: "docId" },
        ],
      })),
      "employee IDs, email addresses or numbers",
    );
    // A spec whose ONLY rule is `otherwise` makes no claim about its values, and
    // the honest word for that is not a guessed noun.
    assert.equal(
      inputRunValueNoun(parser({
        split: { kind: "whole-text" },
        rules: [{ when: { kind: "otherwise" }, emit: "note" }],
      })),
      "entries",
    );
  });

  it("says how the box splits, including the arm where it does not", () => {
    assert.equal(
      inputRunSeparatorLabel(parser({
        split: { kind: "delimited", delimiters: [";", "\n"] },
        rules: [{ when: { kind: "otherwise" }, emit: "name" }],
      })),
      "separated by “;” or a new line",
    );
    assert.equal(
      inputRunSeparatorLabel(parser({
        split: { kind: "whole-text" },
        rules: [{ when: { kind: "otherwise" }, emit: "note" }],
      })),
      "the whole box is one entry",
    );
  });

  it("states the rules — and the two fallbacks are genuinely different promises", () => {
    // WITH an `otherwise`: everything is accepted, which is worth knowing before
    // pasting forty lines.
    assert.equal(
      inputRunParserLabel(parser({
        split: { kind: "delimited", delimiters: [";"] },
        rules: [
          { when: { kind: "pattern", pattern: "eid" }, emit: "emplId" },
          { when: { kind: "otherwise" }, emit: "name" },
        ],
      })),
      "An employee ID is eight digits beginning 10; anything else is taken exactly as typed.",
    );

    assert.equal(
      inputRunParserLabel(parser({
        split: { kind: "delimited", delimiters: [";"] },
        rules: [{ when: { kind: "pattern", pattern: "eid" }, emit: "emplId" }],
      })),
      "An employee ID is eight digits beginning 10; an entry matching none of these refuses the whole box, "
      + "and nothing is started.",
    );
  });

  it("describes the registered person-lookup surface with no workflow-specific prose anywhere", () => {
    const surface = InputRunSurfaceSchema.parse(personLookupDescriptor.surfaces.inputRun);
    assert.equal(inputRunValueNoun(surface.parser), "employee IDs");
    assert.equal(inputRunSeparatorLabel(surface.parser), "separated by “;” or a new line");
    assert.equal(
      inputRunParserLabel(surface.parser),
      "An employee ID is eight digits beginning 10; anything else is taken exactly as typed.",
    );
  });
});

describe("a declared input-run example", () => {
  const Input = z.union([
    z.strictObject({ emplId: EidSchema, keepNonHdh: z.boolean().default(false) }),
    z.strictObject({ note: z.string().min(3), keepNonHdh: z.boolean().default(false) }),
  ]);
  const CanonicalInput = defineCanonicalInput(
    Input,
    z.union([
      z.strictObject({ emplId: EidSchema, keepNonHdh: z.boolean() }),
      z.strictObject({ note: z.string().min(3), keepNonHdh: z.boolean() }),
    ]),
    [{ emplId: "10800000", keepNonHdh: false }, { note: "note", keepNonHdh: false }],
  );

  const descriptorWith = (examples: InputRunExample[] | undefined) =>
    () => defineWorkflowDescriptor({
      id: "example-fixture",
      version: 1,
      contractFingerprint: FingerprintSchema.parse("b".repeat(64)),
      code: "ex",
      label: "Example Fixture",
      icon: "ShieldCheck",
      category: "operations",
      canonicalInput: CanonicalInput,
      inputSubject: "eid",
      surface: { shape: "single" },
      enqueue: "reject-active",
      actions: STANDARD_WORKFLOW_ACTIONS,
      surfaces: {
        inputRun: {
          placeholder: "Enter EIDs, semicolon-separated",
          parser: {
            split: { kind: "delimited", delimiters: [";"] },
            rules: [
              { when: { kind: "pattern", pattern: "eid" }, emit: "emplId" },
              { when: { kind: "otherwise" }, emit: "note" },
            ],
            constants: [{ field: "keepNonHdh", value: { kind: "boolean", value: false } }],
          },
          ...(examples === undefined ? {} : { examples }),
        },
      },
      details: [],
      identity: { matchKey: (input) => ("emplId" in input ? `eid:${input.emplId}` : `note:${input.note}`) },
      presentation: { title: () => "Example fixture" },
      scenarios: ["ucpath/person-org-happy"],
      flow: flow(Input)
        .step("probe", FixtureReadReceipt, {
          dependsOn: [],
          replay: "checkpoint",
          bind: ({ input }) => ({ eid: "emplId" in input ? input.emplId : "10800000" }),
        })
        .build({
          schema: z.strictObject({ present: z.boolean() }),
          dependsOn: ["probe"],
          derive: ({ outputs }) => ({ present: outputs.probe.present }),
        }),
    });

  it("accepts an example that parses and satisfies the workflow's own input schema", () => {
    assert.doesNotThrow(descriptorWith([
      { key: "one", label: "One EID", text: "10800000", note: "the ordinary case" },
      { key: "two", label: "Two", text: "10800000; 10800001", note: "two runs from one box" },
    ]));
  });

  it("REFUSES an example the surface's own parser cannot split — at module load", () => {
    // Empty-ish text is exactly what `parseInputRunText` refuses, so a button
    // offering it would clear the box and then say the box is empty.
    assert.throws(
      descriptorWith([{ key: "blank", label: "Blank", text: "  ;  ", note: "nothing at all" }]),
      /input-run example "blank" does not parse under this surface's own parser/u,
    );
  });

  it("REFUSES an example the workflow's own input schema will not accept", () => {

    assert.throws(
      descriptorWith([{ key: "empty-note", label: "Bad", text: "10800000; x", note: "n" }]),
      /input-run example "empty-note" entry 2 \("x"\) is refused by this workflow's own input schema/u,
    );
  });

  it("REFUSES two examples sharing one key, and accepts a surface declaring none", () => {
    assert.throws(
      descriptorWith([
        { key: "one", label: "A", text: "10800000", note: "n" },
        { key: "one", label: "B", text: "10800001", note: "n" },
      ]),
      /input-run example keys/u,
    );
    assert.doesNotThrow(descriptorWith(undefined));
  });

  it("proves the registered person-lookup examples the same way the factory did", () => {
    const surface = InputRunSurfaceSchema.parse(personLookupDescriptor.surfaces.inputRun);
    assert.deepEqual(
      (surface.examples ?? []).map((example) => example.key),
      ["one-eid", "eid-and-name"],
    );
  });
});
