import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { afterEach, describe, it } from "vitest";
import { historyWorld } from "../../../../../support/helpers/storage/transaction-history-fixture.js";
const cleanup: (() => void)[] = [];
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose(); });
const range = { from: "2026-07-01", to: "2026-09-09" };
describe("confirmed database transaction history", () => {
  it("counts distinct operations at the same timestamp once after restart and ignores stale files", () => {
    const w = historyWorld(); cleanup.push(() => w.dispose());
    w.commit(1); w.commit(2); const before = w.history.query(range);
    assert.equal(before.rows.length, 2); assert.equal(new Set(before.rows.map((row) => row.eventId)).size, 2);
    w.reopen(); assert.deepEqual(w.history.query(range), before);
    writeFileSync(`${w.root}/obsolete-ledger.jsonl`, "corrupt stale file\n");
    assert.deepEqual(w.history.query(range), before);
    assert.deepEqual(w.history.foldActivityRange(range.from, range.to).systems, [{ system: "ucpath", entries: 2, prod: 2, test: 0 }]);
    assert.equal(w.history.query({ ...range, system: "kuali" }).rows.length, 0);
  });
});
