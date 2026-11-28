import { expect, it } from "vitest";
import { resolveWorksheetRows } from "../../../src/rules/spreadsheets/reference-rows.js";

const first = { sheetId: "active", values: { eid: "10000001", fullName: "Example Person" } };
const agreeing = { sheetId: "archive", values: { fullName: "Example Person", eid: "10000001" } };
const conflicting = { sheetId: "corrected", values: { eid: "10000001", fullName: "Updated Person" } };

it("uses the first captured row when every value for a key agrees", () => {
  expect(resolveWorksheetRows([first, agreeing], row => row.values)).toEqual({ state: "resolved", row: first });
});

it("keeps all captured choices when any value for a key disagrees", () => {
  const rows = [first, agreeing, conflicting];
  expect(resolveWorksheetRows(rows, row => row.values)).toEqual({ state: "ambiguous", rows });
});

it("identifies keys with no captured row", () => {
  expect(resolveWorksheetRows([], row => row)).toEqual({ state: "missing" });
});
