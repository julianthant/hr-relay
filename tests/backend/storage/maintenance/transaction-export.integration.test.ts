import { default as assert } from "node:assert/strict";
import { lstatSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { exportTransactions, parseTransactionExportArgs } from "../../../../src/backend/storage/maintenance/transaction-export.js";
import { fixtureUuid } from "../../../support/fixtures/ledger-projection-fixtures.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { historyClock, historyWorld } from "../../../support/helpers/storage/transaction-history-fixture.js";

{

const cleanup: (() => void | Promise<void>)[] = [];
const _afterEachFixture0 = async () => { for (const dispose of cleanup.splice(0)) await dispose(); };
const range = { from: "2026-07-01", to: "2026-09-09" };
describe("explicit transaction export", () => {
afterEach(_afterEachFixture0);

  it("requires a complete valid explicit selection and rejects duplicate and unknown options", () => {
    for (const args of [[], ["--from", range.from], ["--from", range.from, "--from", range.from], ["--unknown", "value"], ["--output"]]) assert.throws(() => parseTransactionExportArgs(args));
    assert.throws(() => parseTransactionExportArgs(["--from", range.to, "--to", range.from, "--output", "report.json"]));
    assert.deepEqual(parseTransactionExportArgs(["--help"]), { kind: "help" });
    assert.deepEqual(parseTransactionExportArgs(["--from", range.from, "--to", range.to, "--output", "report.json", "--system", "ucpath"]),
      { kind: "export", request: { ...range, output: "report.json", system: "ucpath" } });
  });
  it("pins one database snapshot and produces deterministic private-file public presentation", async () => {
    const w = await historyWorld(); cleanup.push(async () => await w.dispose()); w.commit(301);
    const snapshot = w.history.query(range); w.commit(302);
    const pinned = { ...w.history, query: () => snapshot };
    const first = exportTransactions(pinned, { ...range, output: `${w.root}/first.json` });
    const second = exportTransactions(pinned, { ...range, output: `${w.root}/second.json` });
    assert.equal(first.transactions, 1); assert.equal(first.sourceDigest, second.sourceDigest);
    assert.deepEqual(readFileSync(first.output), readFileSync(second.output));
    assert.equal(lstatSync(first.output).mode & 0o777, 0o600);
    const text = readFileSync(first.output, "utf8");
    assert.equal(text.includes('"bindingProof"'), false); assert.equal(text.includes('"idempotencyKey"'), false);
    assert.equal(exportTransactions(w.history, { ...range, system: "kuali", output: `${w.root}/filtered.json` }).transactions, 0);
  });
  it("refuses existing output and symlinks without changing either owner", async () => {
    const w = await historyWorld(); cleanup.push(async () => await w.dispose()); w.commit(303);
    const output = `${w.root}/owned.json`; writeFileSync(output, "other-owner");
    assert.throws(() => exportTransactions(w.history, { ...range, output }), /EEXIST/u);
    assert.equal(readFileSync(output, "utf8"), "other-owner");
    const link = `${w.root}/link.json`; symlinkSync(output, link);
    assert.throws(() => exportTransactions(w.history, { ...range, output: link }), /EEXIST/u);
    assert.equal(lstatSync(link).isSymbolicLink(), true); assert.equal(readFileSync(output, "utf8"), "other-owner");
  });
});
}

{

const range = { from: "2026-07-01", to: "2026-09-09" };

for (const stop of ["before-delete", "after-delete"] as const) {
  it(`keeps exact transactions through ${stop} rollback, restart, deletion and replay`, async () => {
    const w = await historyWorld({ terminalize: true });
    try {
      const fixture = w.commit(801);
      w.commit(802, { instance: "test" });
      const runId = fixture.commit.transaction.runId;
      const run = w.database.authority.runs.get(runId); assert.ok(run);
      const proof = w.database.authority.writeIntents.get(fixture.commit.transaction.writeIntentId); assert.ok(proof);
      const before = w.history.query(range);
      const exported = exportTransactions(w.history, { ...range, output: join(w.root, "before.json") });
      assert.equal(before.rows.length, 2);
      const request = { commandId: fixtureUuid(`history-delete-${stop}`), runId, expectedVersion: run.version };
      assert.throws(() => w.database.withAuthorityTransaction(() => {
        if (stop === "after-delete") assert.equal(testRunService(w.database, historyClock).delete(request).state, "deleted");
        throw new Error("injected-history-delete");
      }), /injected-history-delete/u);
      assert.equal(w.database.authority.deletedRuns.get(runId), undefined);
      assert.deepEqual(w.database.authority.runs.get(runId), run);
      assert.deepEqual(w.history.query(range), before);
      w.reopen();
      assert.deepEqual(w.history.query(range), before);
      assert.equal(testRunService(w.database, historyClock).delete(request).state, "deleted");
      assert.equal(w.database.authority.runs.get(runId), undefined);
      assert.ok(w.database.authority.deletedRuns.get(runId));
      const after = w.history.query(range);
      assert.equal(after.rows.length, 2);
      assert.deepEqual(w.database.authority.writeIntents.get(fixture.commit.transaction.writeIntentId), proof);
      assert.deepEqual(after.rows.map(row => row.ledger), before.rows.map(row => row.ledger));
      assert.deepEqual(after.rows.map(row => row.checkpoint), before.rows.map(row => row.checkpoint));
      assert.deepEqual(w.history.foldActivityRange(range.from, range.to).systems,
        [{ system: "ucpath", entries: 2, prod: 1, test: 1 }]);
      assert.equal(w.history.query({ ...range, system: "kuali" }).rows.length, 0);
      const exportAfter = exportTransactions(w.history, { ...range, output: join(w.root, "after.json") });
      assert.notEqual(exportAfter.sourceDigest, exported.sourceDigest);
      assert.equal(exportAfter.transactions, exported.transactions);
      assert.notDeepEqual(readFileSync(exportAfter.output), readFileSync(exported.output));
      const bytes = readFileSync(exportAfter.output);
      w.reopen();
      assert.equal(testRunService(w.database, historyClock).delete(request).state, "applied-already");
      assert.deepEqual(w.history.query(range), after);
      const replay = exportTransactions(w.history, { ...range, output: join(w.root, "replay.json") });
      assert.deepEqual(readFileSync(replay.output), bytes);
    } finally { await w.dispose(); }
  });
}
}
