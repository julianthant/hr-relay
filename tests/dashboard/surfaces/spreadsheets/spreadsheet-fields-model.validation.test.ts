import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { spreadsheetValueMatches } from "../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-fields-model.js";

describe("reviewed architecture guard manifest", () => {

  it("keeps reviewed spreadsheet validation failures distinct from missing field definitions", () => {
    assert.equal(spreadsheetValueMatches("personalEmail", "invalid@"), false);
    assert.equal(spreadsheetValueMatches("personalEmail", ""), true);
    assert.throws(() => spreadsheetValueMatches("unregistered-field", "value"), /SPREADSHEET_FIELD_NOT_FOUND/u);
  });
});
