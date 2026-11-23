import assert from "node:assert/strict";
import { it } from "vitest";
import { TransactionHistorySelectionSchema, TransactionSelectionRecordSchema } from "../../../src/rules/write-safety/transaction-selection.js";

const range = { from: "2026-09-09", to: "2026-09-10" };
const record = {
  eventId: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
  confirmedAt: "2026-09-09T17:00:00.000Z",
  system: "ucpath",
  operationId: "33333333-3333-4333-8333-333333333333",
  generation: 1,
};

it("refuses reversed transaction history bounds", () => {
  assert.deepEqual(TransactionHistorySelectionSchema.parse(range), range);
  const result = TransactionHistorySelectionSchema.safeParse({ from: range.to, to: range.from });
  assert.ok(!result.success);
  assert.deepEqual(result.error.issues, [{ code: "custom", path: [], message: "transaction range ends before it starts" }]);
});

it.each([
  { label: "query", schema: TransactionHistorySelectionSchema, value: range },
  { label: "record", schema: TransactionSelectionRecordSchema, value: record },
])("refuses unknown transaction selection $label fields", ({ schema, value }) => {
  const result = schema.safeParse({ ...value, extra: true });
  assert.ok(!result.success);
  const [issue] = result.error.issues;
  assert.equal(result.error.issues.length, 1);
  assert.ok(issue?.code === "unrecognized_keys");
  assert.deepEqual(issue.keys, ["extra"]);
});

it("refuses a transaction selection record with a nonpositive generation", () => {
  assert.deepEqual(TransactionSelectionRecordSchema.parse(record), record);
  const result = TransactionSelectionRecordSchema.safeParse({ ...record, generation: 0 });
  assert.ok(!result.success);
  assert.deepEqual(result.error.issues.map(({ code, path }) => ({ code, path })), [{ code: "too_small", path: ["generation"] }]);
});
