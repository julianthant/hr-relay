import assert from "node:assert/strict";
import { lstatSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { afterEach, describe, it } from "vitest";
import { exportTransactions, parseTransactionExportArgs } from "../../src/server/storage/transaction-export.js";
import { historyWorld } from "./transaction-history-fixture.js";
const cleanup: (() => void)[] = [];
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose(); });
const range = { from: "2026-07-01", to: "2026-09-09" };
describe("explicit transaction export", () => {
  it("requires a complete valid explicit selection and rejects duplicate and unknown options", () => {
    for (const args of [[], ["--from", range.from], ["--from", range.from, "--from", range.from], ["--unknown", "value"], ["--output"]]) assert.throws(() => parseTransactionExportArgs(args));
    assert.throws(() => parseTransactionExportArgs(["--from", range.to, "--to", range.from, "--output", "report.json"]));
    assert.deepEqual(parseTransactionExportArgs(["--help"]), { kind: "help" });
    assert.deepEqual(parseTransactionExportArgs(["--from", range.from, "--to", range.to, "--output", "report.json", "--system", "ucpath"]),
      { kind: "export", request: { ...range, output: "report.json", system: "ucpath" } });
  });
  it("pins one database snapshot and produces deterministic private-file public presentation", () => {
    const w = historyWorld(); cleanup.push(() => w.dispose()); w.commit(301);
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
  it("refuses existing output and symlinks without changing either owner", () => {
    const w = historyWorld(); cleanup.push(() => w.dispose()); w.commit(303);
    const output = `${w.root}/owned.json`; writeFileSync(output, "other-owner");
    assert.throws(() => exportTransactions(w.history, { ...range, output }), /EEXIST/u);
    assert.equal(readFileSync(output, "utf8"), "other-owner");
    const link = `${w.root}/link.json`; symlinkSync(output, link);
    assert.throws(() => exportTransactions(w.history, { ...range, output: link }), /EEXIST/u);
    assert.equal(lstatSync(link).isSymbolicLink(), true); assert.equal(readFileSync(output, "utf8"), "other-owner");
  });
});
