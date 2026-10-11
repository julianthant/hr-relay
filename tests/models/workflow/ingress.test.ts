import assert_m0 from "node:assert/strict";
import { describe as describe_m0,it as it_m0 } from "vitest";
import {
FileAcceptSpecSchema as FileAcceptSpecSchema_m0,
InputParserSpecSchema as InputParserSpecSchema_m0,
UploadFieldSpecSchema as UploadFieldSpecSchema_m0,
assertFileAccepted as assertFileAccepted_m0,
parseInputRunText as parseInputRunText_m0,
renderTextTemplate as renderTextTemplate_m0,
resolveUploadFields as resolveUploadFields_m0,
toRawSubmission as toRawSubmission_m0
} from "../../../src/models/workflow/ingress.js";
import { personLookupDescriptor as personLookupDescriptor_m0 } from "../../support/helpers/registered-workflows.js";

import assert_m1 from "node:assert/strict";
import { describe as describe_m1,it as it_m1 } from "vitest";
import { z as z_m1 } from "zod";
import { defineCanonicalInput as defineCanonicalInput_m1 } from "../../../src/models/workflow/canonical-input.js";
import {
ENTRY_PATTERNS as ENTRY_PATTERNS_m1,
ENTRY_PATTERN_NOUNS as ENTRY_PATTERN_NOUNS_m1,
InputParserSpecSchema as InputParserSpecSchema_m1,
InputRunSurfaceSchema as InputRunSurfaceSchema_m1,
inputRunParserLabel as inputRunParserLabel_m1,
inputRunSeparatorLabel as inputRunSeparatorLabel_m1,
inputRunValueNoun as inputRunValueNoun_m1,
type InputRunExample as InputRunExample_m1
} from "../../../src/models/workflow/ingress.js";
import { STANDARD_WORKFLOW_ACTIONS as STANDARD_WORKFLOW_ACTIONS_m1 } from "../../../src/models/workflow/presentation.js";
import { EidSchema as EidSchema_m1,FingerprintSchema as FingerprintSchema_m1 } from "../../../src/rules/identity/ids.js";
import { flow as flow_m1 } from "../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor as defineWorkflowDescriptor_m1 } from "../../../src/workflow-kit/workflow.js";
import { FixtureReadReceipt as FixtureReadReceipt_m1 } from "../../support/fixtures/descriptor-fixtures.js";
import { personLookupDescriptor as personLookupDescriptor_m1 } from "../../support/helpers/registered-workflows.js";


{


const PARSER = InputParserSpecSchema_m0.parse({
  split: { kind: "delimited", delimiters: [";", "\n"] },
  rules: [
    { when: { kind: "pattern", pattern: "eid" }, emit: "emplId" },
    { when: { kind: "otherwise" }, emit: "name" },
  ],
  constants: [{ field: "keepNonHdh", value: { kind: "boolean", value: false } }],
});

describe_m0("run-surface ingress", () => {
  it_m0("splits typed text into one entry per intended run and classifies each", () => {
    const entries = parseInputRunText_m0(PARSER, " 10873698 ; Battistessa, Johnnie\n10606060 ");
    assert_m0.deepEqual(entries.map((entry) => entry.sourceText), [
      "10873698",
      "Battistessa, Johnnie",
      "10001573",
    ]);
    assert_m0.deepEqual(entries.map((entry) => entry.fields[0].field), ["emplId", "name", "emplId"]);
    // The panel's flags ride every entry, and never displace the parsed field.
    for (const entry of entries) {
      assert_m0.deepEqual(entry.fields[1], { field: "keepNonHdh", value: { kind: "boolean", value: false } });
    }
  });

  it_m0("fails loud on empty text and on an entry no rule claims", () => {
    assert_m0.throws(() => parseInputRunText_m0(PARSER, "   \n ; "), /contained no entries to run/);
    const eidOnly = InputParserSpecSchema_m0.parse({
      split: { kind: "delimited", delimiters: [";"] },
      rules: [{ when: { kind: "pattern", pattern: "eid" }, emit: "emplId" }],
    });
    // A silently dropped entry is an EID the operator believes is queued.
    assert_m0.throws(() => parseInputRunText_m0(eidOnly, "10873698; Battistessa"), /matched no parser rule/);
  });

  it_m0("hands the caller a raw submission the workflow's own schema then parses", () => {
    const [entry] = parseInputRunText_m0(PARSER, "10873698");
    const submission = toRawSubmission_m0(entry);
    assert_m0.deepEqual(submission, { emplId: "10873698", keepNonHdh: false });
    // The parser never mints a validated input — ingress stays the one gate.
    assert_m0.deepEqual(personLookupDescriptor_m0.input.parse(submission), {
      emplId: "10873698",
      keepNonHdh: false,
      includeCrmDates: false,
    });
  });

  it_m0("treats whole-text parsing as a single entry", () => {
    const whole = InputParserSpecSchema_m0.parse({
      split: { kind: "whole-text" },
      rules: [{ when: { kind: "otherwise" }, emit: "name" }],
    });
    assert_m0.deepEqual(
      parseInputRunText_m0(whole, "  Battistessa, Johnnie; and a note  ").map((entry) => entry.sourceText),
      ["Battistessa, Johnnie; and a note"],
    );
  });

  it_m0("renders a template and refuses to render a missing field blank", () => {
    const template = {
      segments: [
        { kind: "literal" as const, text: "Queued " },
        { kind: "count" as const, field: "pages", singular: "page", plural: "pages" },
        { kind: "literal" as const, text: " for " },
        { kind: "field" as const, field: "documentName" },
      ],
    };
    assert_m0.equal(
      renderTextTemplate_m0(template, [
        { field: "pages", value: { kind: "count", value: 1 } },
        { field: "documentName", value: { kind: "text", text: "packet.pdf" } },
      ]),
      "Queued 1 page for packet.pdf",
    );
    assert_m0.equal(
      renderTextTemplate_m0(template, [
        { field: "pages", value: { kind: "count", value: 3 } },
        { field: "documentName", value: { kind: "text", text: "packet.pdf" } },
      ]),
      "Queued 3 pages for packet.pdf",
    );
    assert_m0.throws(
      () => renderTextTemplate_m0(template, [{ field: "pages", value: { kind: "count", value: 1 } }]),
      /references field "documentName", which the surface did not supply/,
    );
    assert_m0.throws(
      () => renderTextTemplate_m0(template, [
        { field: "pages", value: { kind: "text", text: "3" } },
        { field: "documentName", value: { kind: "text", text: "packet.pdf" } },
      ]),
      /count segment "pages" received a text value/,
    );
  });

  it_m0("resolves upload fields and refuses undeclared, missing, and out-of-vocabulary values", () => {
    const specs = [
      UploadFieldSpecSchema_m0.parse({ kind: "text", field: "documentName", label: "Document", required: true }),
      UploadFieldSpecSchema_m0.parse({ kind: "boolean", field: "keepNonHdh", label: "Keep non-HDH", initial: true }),
      UploadFieldSpecSchema_m0.parse({
        kind: "select", field: "mode", label: "Mode", required: true,
        options: [{ value: "sign", label: "Sign" }, { value: "upload", label: "Upload" }],
      }),
    ];
    assert_m0.deepEqual(resolveUploadFields_m0(specs, [
      { field: "documentName", value: { kind: "text", text: "packet.pdf" } },
      { field: "mode", value: { kind: "text", text: "sign" } },
    ]), [
      { field: "documentName", value: { kind: "text", text: "packet.pdf" } },
      { field: "keepNonHdh", value: { kind: "boolean", value: true } },
      { field: "mode", value: { kind: "text", text: "sign" } },
    ]);

    assert_m0.throws(
      () => resolveUploadFields_m0(specs, [{ field: "smuggled", value: { kind: "text", text: "x" } }]),
      /undeclared field "smuggled"/,
    );
    assert_m0.throws(
      () => resolveUploadFields_m0(specs, [{ field: "mode", value: { kind: "text", text: "sign" } }]),
      /"documentName" is required/,
    );
    assert_m0.throws(
      () => resolveUploadFields_m0(specs, [
        { field: "documentName", value: { kind: "text", text: "packet.pdf" } },
        { field: "mode", value: { kind: "text", text: "shred" } },
      ]),
      /out-of-vocabulary value "shred"/,
    );
    assert_m0.throws(
      () => resolveUploadFields_m0(specs, [
        { field: "documentName", value: { kind: "text", text: "a" } },
        { field: "documentName", value: { kind: "text", text: "b" } },
      ]),
      /same field twice/,
    );
  });

  it_m0("refuses a file the accept list does not cover, and one over its byte limit", () => {
    const accepts = [FileAcceptSpecSchema_m0.parse({
      mediaType: "application/pdf",
      extensions: [".pdf"],
      maxBytes: 1_000,
    })];
    assertFileAccepted_m0(accepts, { fileName: "packet.PDF", mediaType: "application/pdf", byteLength: 900 });
    assert_m0.throws(
      () => assertFileAccepted_m0(accepts, { fileName: "packet.png", mediaType: "image/png", byteLength: 10 }),
      /is not an accepted file/,
    );
    assert_m0.throws(
      () => assertFileAccepted_m0(accepts, { fileName: "packet.pdf", mediaType: "application/pdf", byteLength: 1_001 }),
      /over the 1000-byte limit/,
    );
  });
});
}

{


const parser = (spec: unknown) => InputParserSpecSchema_m1.parse(spec);

describe_m1("the parser, described to the operator", () => {
  it_m1("legends exactly the closed pattern vocabulary — no arm without words, no words without an arm", () => {
    // The whole reason the prose is derived rather than authored: this pair of
    // key sets is what makes a sentence unable to describe a rule that is gone.
    assert_m1.deepEqual(
      Object.keys(ENTRY_PATTERN_NOUNS_m1).sort(),
      Object.keys(ENTRY_PATTERNS_m1).sort(),
    );
  });

  it_m1("names the values a box accepts, and says 'entries' when the spec claims nothing", () => {
    assert_m1.equal(
      inputRunValueNoun_m1(parser({
        split: { kind: "delimited", delimiters: [";"] },
        rules: [
          { when: { kind: "pattern", pattern: "eid" }, emit: "emplId" },
          { when: { kind: "otherwise" }, emit: "name" },
        ],
      })),
      "employee IDs",
    );
    assert_m1.equal(
      inputRunValueNoun_m1(parser({
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
    assert_m1.equal(
      inputRunValueNoun_m1(parser({
        split: { kind: "whole-text" },
        rules: [{ when: { kind: "otherwise" }, emit: "note" }],
      })),
      "entries",
    );
  });

  it_m1("says how the box splits, including the arm where it does not", () => {
    assert_m1.equal(
      inputRunSeparatorLabel_m1(parser({
        split: { kind: "delimited", delimiters: [";", "\n"] },
        rules: [{ when: { kind: "otherwise" }, emit: "name" }],
      })),
      "separated by “;” or a new line",
    );
    assert_m1.equal(
      inputRunSeparatorLabel_m1(parser({
        split: { kind: "whole-text" },
        rules: [{ when: { kind: "otherwise" }, emit: "note" }],
      })),
      "the whole box is one entry",
    );
  });

  it_m1("states the rules — and the two fallbacks are genuinely different promises", () => {
    // WITH an `otherwise`: everything is accepted, which is worth knowing before
    // pasting forty lines.
    assert_m1.equal(
      inputRunParserLabel_m1(parser({
        split: { kind: "delimited", delimiters: [";"] },
        rules: [
          { when: { kind: "pattern", pattern: "eid" }, emit: "emplId" },
          { when: { kind: "otherwise" }, emit: "name" },
        ],
      })),
      "An employee ID is eight digits beginning 10; anything else is taken exactly as typed.",
    );

    assert_m1.equal(
      inputRunParserLabel_m1(parser({
        split: { kind: "delimited", delimiters: [";"] },
        rules: [{ when: { kind: "pattern", pattern: "eid" }, emit: "emplId" }],
      })),
      "An employee ID is eight digits beginning 10; an entry matching none of these refuses the whole box, "
      + "and nothing is started.",
    );
  });

  it_m1("describes the registered person-lookup surface with no workflow-specific prose anywhere", () => {
    const surface = InputRunSurfaceSchema_m1.parse(personLookupDescriptor_m1.surfaces.inputRun);
    assert_m1.equal(inputRunValueNoun_m1(surface.parser), "employee IDs");
    assert_m1.equal(inputRunSeparatorLabel_m1(surface.parser), "separated by “;” or a new line");
    assert_m1.equal(
      inputRunParserLabel_m1(surface.parser),
      "An employee ID is eight digits beginning 10; anything else is taken exactly as typed.",
    );
  });
});

describe_m1("a declared input-run example", () => {
  const Input = z_m1.union([
    z_m1.strictObject({ emplId: EidSchema_m1, keepNonHdh: z_m1.boolean().default(false) }),
    z_m1.strictObject({ note: z_m1.string().min(3), keepNonHdh: z_m1.boolean().default(false) }),
  ]);
  const CanonicalInput = defineCanonicalInput_m1(
    Input,
    z_m1.union([
      z_m1.strictObject({ emplId: EidSchema_m1, keepNonHdh: z_m1.boolean() }),
      z_m1.strictObject({ note: z_m1.string().min(3), keepNonHdh: z_m1.boolean() }),
    ]),
    [{ emplId: "10800000", keepNonHdh: false }, { note: "note", keepNonHdh: false }],
  );

  const descriptorWith = (examples: InputRunExample_m1[] | undefined) =>
    () => defineWorkflowDescriptor_m1({
      id: "example-fixture",
      version: 1,
      contractFingerprint: FingerprintSchema_m1.parse("b".repeat(64)),
      code: "ex",
      label: "Example Fixture",
      icon: "ShieldCheck",
      category: "operations",
      canonicalInput: CanonicalInput,
      inputSubject: "eid",
      surface: { shape: "single" },
      enqueue: "reject-active",
      actions: STANDARD_WORKFLOW_ACTIONS_m1,
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
        .step("probe", FixtureReadReceipt_m1, {
          dependsOn: [],
          replay: "checkpoint",
          bind: ({ input }) => ({ eid: "emplId" in input ? input.emplId : "10800000" }),
        })
        .build({
          schema: z_m1.strictObject({ present: z_m1.boolean() }),
          dependsOn: ["probe"],
          derive: ({ outputs }) => ({ present: outputs.probe.present }),
        }),
    });

  it_m1("accepts an example that parses and satisfies the workflow's own input schema", () => {
    assert_m1.doesNotThrow(descriptorWith([
      { key: "one", label: "One EID", text: "10800000", note: "the ordinary case" },
      { key: "two", label: "Two", text: "10800000; 10800001", note: "two runs from one box" },
    ]));
  });

  it_m1("REFUSES an example the surface's own parser cannot split — at module load", () => {
    // Empty-ish text is exactly what `parseInputRunText` refuses, so a button
    // offering it would clear the box and then say the box is empty.
    assert_m1.throws(
      descriptorWith([{ key: "blank", label: "Blank", text: "  ;  ", note: "nothing at all" }]),
      /input-run example "blank" does not parse under this surface's own parser/u,
    );
  });

  it_m1("REFUSES an example the workflow's own input schema will not accept", () => {

    assert_m1.throws(
      descriptorWith([{ key: "empty-note", label: "Bad", text: "10800000; x", note: "n" }]),
      /input-run example "empty-note" entry 2 \("x"\) is refused by this workflow's own input schema/u,
    );
  });

  it_m1("REFUSES two examples sharing one key, and accepts a surface declaring none", () => {
    assert_m1.throws(
      descriptorWith([
        { key: "one", label: "A", text: "10800000", note: "n" },
        { key: "one", label: "B", text: "10800001", note: "n" },
      ]),
      /input-run example keys/u,
    );
    assert_m1.doesNotThrow(descriptorWith(undefined));
  });

  it_m1("proves the registered person-lookup examples the same way the factory did", () => {
    const surface = InputRunSurfaceSchema_m1.parse(personLookupDescriptor_m1.surfaces.inputRun);
    assert_m1.deepEqual(
      (surface.examples ?? []).map((example) => example.key),
      ["one-eid", "eid-and-name"],
    );
  });
});
}
