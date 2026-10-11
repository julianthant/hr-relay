import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { createTransactionHistory } from "../../../../../../src/backend/storage/sqlite/transaction-history.js";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { historyWorld, historyClock } from "../../../../../support/helpers/storage/transaction-history-fixture.js";
const cleanup: (() => void)[] = [];
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose(); });
const range = { from: "2026-07-01", to: "2026-09-09" };
describe("native committed history readers", () => {
  it("two independent database readers and a restarted reader see the same committed identities", () => {
    const w = historyWorld(); cleanup.push(() => w.dispose()); w.commit(401);
    const reader = AuthorityDatabase.open({ path: w.path, busyTimeoutMs: 250, migrationOwner: "second-history-reader" }, historyClock);
    try {
      assert.deepEqual(createTransactionHistory(reader.authority).query(range), w.history.query(range));
      w.commit(402); assert.equal(createTransactionHistory(reader.authority).query(range).rows.length, 2);
      w.reopen(); assert.deepEqual(createTransactionHistory(reader.authority).query(range), w.history.query(range));
    } finally { reader.close(); }
  });
});
