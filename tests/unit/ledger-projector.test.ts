/** Retired projector guarantees now belong to stopped conversion and atomic history. */
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { createTransactionHistory } from "../../src/infra/sqlite/transaction-history.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/authority-database.js";
import { historyWorld, historicalWorld, historyClock } from "./transaction-history-fixture.js";
const cleanup: (() => void)[] = [];
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose(); });
const range = { from: "2026-07-01", to: "2026-09-09" };
describe("retired projector completeness and recovery", () => {
  it("preserves assigned identities and actor attribution without issuing a second projection", async () => {
    const w = historicalWorld({ files: true, confirmation: true }); cleanup.push(() => w.dispose()); await w.backup(); await w.upgrade();
    const db = w.open(); try {
      const rows = createTransactionHistory(db.authority).query(range).rows; assert.equal(rows.length, 2);
      assert.deepEqual(rows.map((row) => row.presentation.pointer.sequence), [0, 0]);
      assert.deepEqual(rows.map((row) => row.ledger.operator), ["local-operator", "local-operator"]);
      assert.equal(db.authority.timelineEvents.page({}).filter((row) => row.payload.kind === "operation-confirmed").length, 2);
    } finally { db.close(); }
  });
  it("retains a pending commit whose file was never projected", async () => {
    const w = historicalWorld(); cleanup.push(() => w.dispose()); await w.backup(); await w.upgrade();
    const db = w.open(); try {
      assert.equal(createTransactionHistory(db.authority).query(range).rows.length, 2);
      assert.ok(db.authority.historicalOperationSources.list().every((source) => source.file === null && source.projection === null));
    } finally { db.close(); }
  });
  it("retains exact assignments when an append crashed before its file existed", async () => {
    const w = historicalWorld({ files: true, missingFile: true }); cleanup.push(() => w.dispose()); for (const line of w.lines) rmSync(line.path);
    await w.backup(); await w.upgrade(); const db = w.open(); try {
      const sources = db.authority.historicalOperationSources.list();
      assert.equal(sources.length, 2); assert.ok(sources.every((source) => source.projection?.seq === 0 && source.file === null));
    } finally { db.close(); }
  });
  it("two independent database readers and a restarted reader see the same committed identities", () => {
    const w = historyWorld(); cleanup.push(() => w.dispose()); w.commit(401);
    const reader = AuthorityDatabase.open({ path: w.path, busyTimeoutMs: 250, migrationOwner: "second-history-reader" }, historyClock);
    try {
      assert.deepEqual(createTransactionHistory(reader.authority).query(range), w.history.query(range));
      w.commit(402); assert.equal(createTransactionHistory(reader.authority).query(range).rows.length, 2);
      w.reopen(); assert.deepEqual(createTransactionHistory(reader.authority).query(range), w.history.query(range));
    } finally { reader.close(); }
  });
  it.each(["torn", "rewritten", "gap", "duplicate"] as const)("refuses %s historical lines without repair or retirement", async (fault) => {
    const w = historicalWorld({ files: true, sourceVersion: 39 }); cleanup.push(() => w.dispose()); const line = w.lines[0];
    const value = JSON.parse(line.text) as { seq: number; payload: { operator: string } };
    if (fault === "gap") value.seq = 4;
    if (fault === "rewritten") value.payload.operator = "changed-actor";
    const text = fault === "torn" ? line.text.slice(0, -1) : fault === "duplicate" ? line.text.repeat(2) : `${JSON.stringify(value)}\n`;
    writeFileSync(line.path, text); await w.backup(); const before = readFileSync(w.path);
    await assert.rejects(w.upgrade(), /authority-below-floor/u); assert.deepEqual(readFileSync(w.path), before); assert.equal(readFileSync(line.path, "utf8"), text);
  });
  it("never invents transactions from an unrecorded line after database restore", async () => {
    const w = historicalWorld({ files: true, sourceVersion: 39 }); cleanup.push(() => w.dispose());
    const raw = new DatabaseSync(w.path); try {
      // A real restore can put the database behind files. Remove all owned rows in a fixture-only DDL bypass.
      const triggers = raw.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name IN ('ledger_projections','operation_outbox','ledger_partitions')").all();
      for (const trigger of triggers) raw.exec(`DROP TRIGGER "${String(trigger.name)}"`);
      raw.exec("DELETE FROM ledger_projections; DELETE FROM operation_outbox; DELETE FROM ledger_partitions");
      for (const trigger of triggers) raw.exec(String(trigger.sql));
    } finally { raw.close(); }
    await w.backup(); await assert.rejects(w.upgrade(), /authority-below-floor/u);
  });
});
