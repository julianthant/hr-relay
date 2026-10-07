import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  FileAcceptSpecSchema,
  InputParserSpecSchema,
  UploadFieldSpecSchema,
  assertFileAccepted,
  parseInputRunText,
  renderTextTemplate,
  resolveUploadFields,
  toRawSubmission,
} from "../../../../../src/models/workflow/ingress.js";
import { personLookupDescriptor } from "../../../../support/helpers/registered-workflows.js";

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
    // The panel's flags ride every entry, and never displace the parsed field.
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
    // A silently dropped entry is an EID the operator believes is queued.
    assert.throws(() => parseInputRunText(eidOnly, "10873698; Battistessa"), /matched no parser rule/);
  });

  it("hands the caller a raw submission the workflow's own schema then parses", () => {
    const [entry] = parseInputRunText(PARSER, "10873698");
    const submission = toRawSubmission(entry);
    assert.deepEqual(submission, { emplId: "10873698", keepNonHdh: false });
    // The parser never mints a validated input — ingress stays the one gate.
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
