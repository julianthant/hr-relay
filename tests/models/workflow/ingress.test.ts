import { default as assert } from "node:assert/strict";
import { describe } from "vitest";
import { it } from "vitest";
import { FileAcceptSpecSchema } from "../../../src/models/workflow/ingress.js";
import { InputParserSpecSchema } from "../../../src/models/workflow/ingress.js";
import { UploadFieldSpecSchema } from "../../../src/models/workflow/ingress.js";
import { assertFileAccepted } from "../../../src/models/workflow/ingress.js";
import { parseInputRunText } from "../../../src/models/workflow/ingress.js";
import { renderTextTemplate } from "../../../src/models/workflow/ingress.js";
import { resolveUploadFields } from "../../../src/models/workflow/ingress.js";
import { toRawSubmission } from "../../../src/models/workflow/ingress.js";
import { personLookupDescriptor } from "../../support/helpers/registered-workflows.js";
import { z } from "zod";
import { defineCanonicalInput } from "../../../src/models/workflow/canonical-input.js";
import { ENTRY_PATTERNS } from "../../../src/models/workflow/ingress.js";
import { ENTRY_PATTERN_NOUNS } from "../../../src/models/workflow/ingress.js";
import { InputRunSurfaceSchema } from "../../../src/models/workflow/ingress.js";
import { inputRunParserLabel } from "../../../src/models/workflow/ingress.js";
import { inputRunSeparatorLabel } from "../../../src/models/workflow/ingress.js";
import { inputRunValueNoun } from "../../../src/models/workflow/ingress.js";
import type { InputRunExample } from "../../../src/models/workflow/ingress.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/models/workflow/presentation.js";
import { EidSchema } from "../../../src/rules/identity/ids.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import { flow as flow_m1 } from "../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor } from "../../../src/workflow-kit/workflow.js";
import { FixtureReadReceipt } from "../../support/fixtures/descriptor-fixtures.js";

{

const PARSER = InputParserSpecSchema.parse({
  split: { kind: "delimited", delimiters: [";", "\n"] },
  rules: [
    { when: { kind: "pattern", pattern: "eid" }, emit: "emplId" },
    { when: { kind: "otherwise" }, emit: "name" },
  ],
  constants: [{ field: "keepNonHdh", value: { kind: "boolean", value: false } }],
});

describe("run-surface ingress", () => {
  it("splits typed text into one entry per intended run and classifies each", () => {
    const entries = parseInputRunText(PARSER, " 10873698 ; Battistessa, Johnnie\n10606060 ");
    assert.deepEqual(entries.map((entry) => entry.sourceText), [
      "10873698",
      "Battistessa, Johnnie",
      "10001573",
    ]);
    assert.deepEqual(entries.map((entry) => entry.fields[0].field), ["emplId", "name", "emplId"]);

    for (const entry of entries) {
      assert.deepEqual(entry.fields[1], { field: "keepNonHdh", value: { kind: "boolean", value: false } });
    }
  });

  it("fails loud on empty text and on an entry no rule claims", () => {
    assert.throws(() => parseInputRunText(PARSER, "   \n ; "), /contained no entries to run/);
    const eidOnly = InputParserSpecSchema.parse({
      split: { kind: "delimited", delimiters: [";"] },
      rules: [{ when: { kind: "pattern", pattern: "eid" }, emit: "emplId" }],
    });

    assert.throws(() => parseInputRunText(eidOnly, "10873698; Battistessa"), /matched no parser rule/);
  });

  it("hands the caller a raw submission the workflow's own schema then parses", () => {
    const [entry] = parseInputRunText(PARSER, "10873698");
    const submission = toRawSubmission(entry);
    assert.deepEqual(submission, { emplId: "10873698", keepNonHdh: false });

    assert.deepEqual(personLookupDescriptor.input.parse(submission), {
      emplId: "10873698",
      keepNonHdh: false,
      includeCrmDates: false,
    });
  });

  it("treats whole-text parsing as a single entry", () => {
    const whole = InputParserSpecSchema.parse({
      split: { kind: "whole-text" },
      rules: [{ when: { kind: "otherwise" }, emit: "name" }],
    });
    assert.deepEqual(
      parseInputRunText(whole, "  Battistessa, Johnnie; and a note  ").map((entry) => entry.sourceText),
      ["Battistessa, Johnnie; and a note"],
    );
  });

  it("renders a template and refuses to render a missing field blank", () => {
    const template = {
      segments: [
        { kind: "literal" as const, text: "Queued " },
        { kind: "count" as const, field: "pages", singular: "page", plural: "pages" },
        { kind: "literal" as const, text: " for " },
        { kind: "field" as const, field: "documentName" },
      ],
    };
    assert.equal(
      renderTextTemplate(template, [
        { field: "pages", value: { kind: "count", value: 1 } },
        { field: "documentName", value: { kind: "text", text: "packet.pdf" } },
      ]),
      "Queued 1 page for packet.pdf",
    );
    assert.equal(
      renderTextTemplate(template, [
        { field: "pages", value: { kind: "count", value: 3 } },
        { field: "documentName", value: { kind: "text", text: "packet.pdf" } },
      ]),
      "Queued 3 pages for packet.pdf",
    );
    assert.throws(
      () => renderTextTemplate(template, [{ field: "pages", value: { kind: "count", value: 1 } }]),
      /references field "documentName", which the surface did not supply/,
    );
    assert.throws(
      () => renderTextTemplate(template, [
        { field: "pages", value: { kind: "text", text: "3" } },
        { field: "documentName", value: { kind: "text", text: "packet.pdf" } },
      ]),
      /count segment "pages" received a text value/,
    );
  });

  it("resolves upload fields and refuses undeclared, missing, and out-of-vocabulary values", () => {
    const specs = [
      UploadFieldSpecSchema.parse({ kind: "text", field: "documentName", label: "Document", required: true }),
      UploadFieldSpecSchema.parse({ kind: "boolean", field: "keepNonHdh", label: "Keep non-HDH", initial: true }),
      UploadFieldSpecSchema.parse({
        kind: "select", field: "mode", label: "Mode", required: true,
        options: [{ value: "sign", label: "Sign" }, { value: "upload", label: "Upload" }],
      }),
    ];
    assert.deepEqual(resolveUploadFields(specs, [
      { field: "documentName", value: { kind: "text", text: "packet.pdf" } },
      { field: "mode", value: { kind: "text", text: "sign" } },
    ]), [
      { field: "documentName", value: { kind: "text", text: "packet.pdf" } },
      { field: "keepNonHdh", value: { kind: "boolean", value: true } },
      { field: "mode", value: { kind: "text", text: "sign" } },
    ]);

    assert.throws(
      () => resolveUploadFields(specs, [{ field: "smuggled", value: { kind: "text", text: "x" } }]),
      /undeclared field "smuggled"/,
    );
    assert.throws(
      () => resolveUploadFields(specs, [{ field: "mode", value: { kind: "text", text: "sign" } }]),
      /"documentName" is required/,
    );
    assert.throws(
      () => resolveUploadFields(specs, [
        { field: "documentName", value: { kind: "text", text: "packet.pdf" } },
        { field: "mode", value: { kind: "text", text: "shred" } },
      ]),
      /out-of-vocabulary value "shred"/,
    );
    assert.throws(
      () => resolveUploadFields(specs, [
        { field: "documentName", value: { kind: "text", text: "a" } },
        { field: "documentName", value: { kind: "text", text: "b" } },
      ]),
      /same field twice/,
    );
  });

  it("refuses a file the accept list does not cover, and one over its byte limit", () => {
    const accepts = [FileAcceptSpecSchema.parse({
      mediaType: "application/pdf",
      extensions: [".pdf"],
      maxBytes: 1_000,
    })];
    assertFileAccepted(accepts, { fileName: "packet.PDF", mediaType: "application/pdf", byteLength: 900 });
    assert.throws(
      () => assertFileAccepted(accepts, { fileName: "packet.png", mediaType: "image/png", byteLength: 10 }),
      /is not an accepted file/,
    );
    assert.throws(
      () => assertFileAccepted(accepts, { fileName: "packet.pdf", mediaType: "application/pdf", byteLength: 1_001 }),
      /over the 1000-byte limit/,
    );
  });
});
}

{

const parser = (spec: unknown) => InputParserSpecSchema.parse(spec);

describe("the parser, described to the operator", () => {
  it("legends exactly the closed pattern vocabulary — no arm without words, no words without an arm", () => {


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
      flow: flow_m1(Input)
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
}
