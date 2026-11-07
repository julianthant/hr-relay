
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { OCR_FORM_TYPES,declaredPaths,ocrForm } from "../../../src/models/ocr/form-registry.js";
import { buildAnswerSkeleton,buildExtractionInstruction } from "../../../src/models/ocr/instruction.js";

describe("every route is told the same thing", () => {
  it("generates an instruction covering exactly the declared fields", () => {
    for (const formType of OCR_FORM_TYPES) {
      const instruction = buildExtractionInstruction(formType);
      for (const path of declaredPaths(formType)) {
        assert.equal(instruction.includes(`\`${path}\``), true, `${formType} instruction omits ${path}`);
      }
      // The closed absence vocabulary reaches every producer verbatim.
      for (const reason of ["not-on-form", "blank", "illegible"]) {
        assert.equal(instruction.includes(reason), true, `${formType} instruction omits ${reason}`);
      }
    }
  });

  it("emits a skeleton whose shape the gate accepts once filled in", () => {
    for (const formType of OCR_FORM_TYPES) {
      const skeleton = buildAnswerSkeleton(formType) as { record: { answers: Record<string, unknown> } };
      // Same keys as the form declares — both directions.
      assert.deepEqual(
        Object.keys(skeleton.record.answers).toSorted((left, right) => left.localeCompare(right)),
        [...declaredPaths(formType)],
      );
    }
  });

  it("carries the form's hard-won extraction notes to every route", () => {

    const oath = buildExtractionInstruction("oath");
    assert.equal(oath.includes("do NOT drop the leading `10`"), true);
    assert.equal(oath.includes("top margin"), true);
    const contact = buildExtractionInstruction("emergency-contact");
    assert.equal(contact.includes("10493848"), true, "the observed digit transposition is named");
    assert.equal(contact.includes("Morath"), true, "the observed letter drop is named");
    assert.equal(contact.includes("NEVER skip the contact's address"), true);
  });

  it("tells every route the page holds one person, and to classify before extracting", () => {
    for (const formType of OCR_FORM_TYPES) {
      const instruction = buildExtractionInstruction(formType);
      assert.equal(instruction.includes("ONE person per page"), true);
      assert.equal(instruction.includes("CLASSIFY the page first"), true);
      // The full page vocabulary reaches the brief, so a producer can name what
      // it actually saw rather than forcing it into the expected form.
      for (const kind of ["i9-section1", "boilerplate", "unrelated", "blank"]) {
        assert.equal(instruction.includes(kind), true, `${formType}: ${kind} never offered`);
      }
    }
  });

  it("cannot silently stop asking for a field, because the prompt is derived", () => {

    const instruction = buildExtractionInstruction("emergency-contact");
    const spec = ocrForm("emergency-contact");
    for (const entry of spec.fields) assert.equal(instruction.includes(entry.prompt), true, entry.path);
    assert.equal(instruction.includes("(mandatory)"), true);
  });
});
