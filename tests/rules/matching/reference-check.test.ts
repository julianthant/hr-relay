import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { checkReferenceRows, referenceCheckLine, referenceCheckResult } from "../../../src/rules/matching/reference-check.js";

describe("reference spreadsheet check", () => {
  it("finds the person on the first row that carries the Employee ID when the sheet has no name column", () => {
    assert.deepEqual(checkReferenceRows("Quillan, Petra A.", [{ row: 7, name: null }, { row: 9, name: null }]), { outcome: "found", row: 7 });
  });

  it("reports a person missing from the sheet without a row", () => {
    assert.deepEqual(checkReferenceRows("Quillan, Petra A.", []), { outcome: "not-found", row: null });
  });

  it("accepts the name in either order and with a spelling variant", () => {
    assert.deepEqual(checkReferenceRows("Quillan, Petra A.", [{ row: 4, name: "Petra A Quillan" }]), { outcome: "found", row: 4 });
    assert.deepEqual(checkReferenceRows("Quillan, Petra", [{ row: 4, name: "Petra Quilan" }]), { outcome: "found", row: 4 });
  });

  it("reports a different name on the row that carries the Employee ID", () => {
    assert.deepEqual(checkReferenceRows("Quillan, Petra A.", [{ row: 12, name: "Bea Morrow" }]), { outcome: "name-differs", row: 12 });
  });

  it("prefers the row whose name agrees over an earlier row whose name differs", () => {
    assert.deepEqual(checkReferenceRows("Quillan, Petra A.", [{ row: 3, name: "Bea Morrow" }, { row: 8, name: "Petra Quillan" }]), { outcome: "found", row: 8 });
  });

  it("compares no name when the run found none or the cell is blank", () => {
    assert.deepEqual(checkReferenceRows(null, [{ row: 5, name: "Bea Morrow" }]), { outcome: "found", row: 5 });
    assert.deepEqual(checkReferenceRows("Quillan, Petra A.", [{ row: 5, name: "  " }]), { outcome: "found", row: 5 });
  });

  it("writes the Logs line from the spreadsheet, the sheet and the row number only", () => {
    assert.equal(referenceCheckLine("Fall roster", "Hires", { outcome: "found", row: 7 }), "Fall roster · Hires: found in row 7");
    assert.equal(referenceCheckLine("Fall roster", "Hires", { outcome: "not-found", row: null }), "Fall roster · Hires: not found");
    assert.equal(referenceCheckLine("Fall roster", "Hires", { outcome: "name-differs", row: 12 }), "Fall roster · Hires: name differs in row 12");
  });

  it("confirms the person only when every picked spreadsheet holds them", () => {
    assert.equal(referenceCheckResult(["found", "found"]), "confirmed");
    assert.equal(referenceCheckResult(["found", "not-found"]), "unconfirmed");
    assert.equal(referenceCheckResult(["name-differs"]), "unconfirmed");
  });
});
