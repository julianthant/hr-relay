import assert from "node:assert/strict";
import { it } from "vitest";
import { ocrForm } from "../../../src/models/ocr/form-registry.js";

it.each(["page kinds", "extraction notes", "field page kinds"] as const)("refuses writes to OCR %s", part => {
  const form = ocrForm("i9");
  const field = form.fields.find(({ path }) => path === "dateOfBirth");
  assert.ok(field?.onPageKinds);
  const lists = { "page kinds": form.pageKinds, "extraction notes": form.extractionNotes, "field page kinds": field.onPageKinds };
  const list = lists[part];
  assert.throws(() => Object.assign(list, { 0: list[0] }), TypeError);
});
