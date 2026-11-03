import { expect, it } from "vitest";
import { i9CheckTrackerTable } from "../../../src/rules/i9-check/workbook.js";
import { i9MatchOutcome, i9RetentionRow } from "../../../src/rules/i9-check/retention.js";
import { i9Candidate, i9CheckInput } from "../../support/fixtures/i9-check.js";

const row = i9RetentionRow({ input: i9CheckInput, initial: i9MatchOutcome({ hits: [], confirmed: [i9Candidate], dropped: [] }) }).row;
it("keeps one retention row per person using the latest retained observation and preserves padded IDs", () => {
  const table = i9CheckTrackerTable([
    { payload: { rows: [{ ...row, notes: "Latest" }] }, projectedAt: "2026-11-02T00:00:00.000Z" },
    { payload: { rows: [row, { ...row, recordId: "another-person" }] }, projectedAt: "2026-11-01T00:00:00.000Z" },
  ]);
  expect(table.columns).toEqual(["Employee Name", "PPS EID", "UCPATH Employee ID", "Hire Date (from I-9)", "Separation Date", "Found in UCPath?", "Action", "Reviewer Name", "Notes"]);
  expect(table.rows).toHaveLength(2);
  expect(table.rows[0].values[1]).toBe("000012345");
  expect(table.rows[0].values[8]).toBe("Latest");
  expect(table.rows[1].values[8]).toBe(row.notes);
  expect(JSON.stringify(table)).not.toContain("ssn");
});
it("refuses corrupt payloads and contradictory observations at the same time", () => {
  expect(() => i9CheckTrackerTable([{ payload: { rows: [] }, projectedAt: "2026-11-01T00:00:00.000Z" }])).toThrow();
  expect(() => i9CheckTrackerTable([
    { payload: { rows: [row] }, projectedAt: "2026-11-01T00:00:00.000Z" },
    { payload: { rows: [{ ...row, notes: "Contradiction" }] }, projectedAt: "2026-11-01T00:00:00.000Z" },
  ])).toThrow("i9-check-tracker-conflicting-observations");
});
