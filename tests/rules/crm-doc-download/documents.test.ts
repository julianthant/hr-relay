import assert from "node:assert/strict";
import { it } from "vitest";
import { crmDocumentFileName, crmDocumentFolderName, crmDocumentIndices } from "../../../src/rules/crm-doc-download/documents.js";

it("names the person from legal and lived reference names with the literal EID suffix", () => {
  assert.equal(crmDocumentFolderName({ legalName: { firstName: "SAMUEL", lastName: "O'NEILL", middleName: "Matthew" }, livedName: { firstName: "Sam", lastName: "O'Neill", middleName: "" } }), "O'Neill, Samuel (Sam) M. EID");
  assert.equal(crmDocumentFolderName({ legalName: { firstName: "Sam", lastName: "Fixture", middleName: "" }, livedName: { firstName: "SAM", lastName: "Fixture", middleName: "" } }), "Fixture, Sam EID");
  assert.equal(crmDocumentFolderName({ legalName: { firstName: "Sam Matthew", lastName: "Fixture", middleName: "" }, livedName: null }), "Fixture, Sam M. EID");
  assert.equal(crmDocumentFolderName({ legalName: { firstName: "Sam", lastName: "Fixture", middleName: "." }, livedName: null }), "Fixture, Sam EID");
  assert.throws(() => crmDocumentFolderName({ legalName: { firstName: "", lastName: "Fixture", middleName: "" }, livedName: null }));
  assert.throws(() => crmDocumentFolderName({ legalName: { firstName: "Sam", lastName: "unsafe/path", middleName: "" }, livedName: null }));
});

it("selects only mapped default layouts and validates the complete explicit selection before download", () => {
  for (const count of [9, 11]) assert.deepEqual(crmDocumentIndices(count), [0, 2]);
  for (const count of [1, 2, 5]) assert.deepEqual(crmDocumentIndices(count), [0]);
  assert.throws(() => crmDocumentIndices(3));
  assert.deepEqual(crmDocumentIndices(3, [1]), [1]);
  for (const indices of [[], [0, 0], [0, 3], [-1], [0.5]]) assert.throws(() => crmDocumentIndices(3, indices));
});

it("uses the proven document identities and safe header names for other positions", () => {
  assert.equal(crmDocumentFileName(0, 'attachment; filename="opaque-id.pdf"'), "Signed Offer Letter.pdf");
  assert.equal(crmDocumentFileName(2, undefined), "EE Data Gathering Form.pdf");
  assert.equal(crmDocumentFileName(1, "attachment; filename*=UTF-8''Hiring%20form.pdf"), "Hiring form.pdf");
  assert.equal(crmDocumentFileName(1, 'attachment; filename="path/document.pdf"'), "document.pdf");
  for (const name of ["CON.pdf", "unsafe:file.pdf", ".hidden.pdf", "bad%XX.pdf", "not-a-pdf.html"]) {
    assert.equal(crmDocumentFileName(1, `attachment; filename="${name}"`), "document-2.pdf");
  }
});
