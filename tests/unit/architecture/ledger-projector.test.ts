/** T replaces projector authority with confirmed SQLite history; old source evidence remains read-only. */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import { deriveLedgerLineDigest } from "../../../src/domain/ledger-projection.js";
import { historyWorld, historicalWorld } from "../transaction-history-fixture.js";
import { gitVisibleFiles, REPO_ROOT } from "./helpers/guard-files.js";
interface Source { path: string; content: string }
export function retiredLedgerConsumerViolations(sources: readonly Source[]) {
  return sources.filter(({ content }) => /(?:from\s+["'][^"']*infra\/ledger\/|\.authority\.(?:durableOutbox|ledgerProjection)\b|(?:createLedgerProjector|createLedgerReadThrough)\s*\()/u.test(content)).map(({ path }) => path);
}
export function ledgerSoleWriterViolations(sources: readonly Source[]) {
  return sources.filter(({ content }) => /ledger(?:FilePath|Directory)|["'`]ledger["'`]/u.test(content)
    && /\bappendFile(?:Sync)?\s*\(|openSync\s*\([^)]*["']a["']/u.test(content)).map(({ path }) => path);
}
export function ledgerPruneReachabilityViolations(sources: readonly Source[]) {
  // Historical source preservation owns scratch-copy cleanup. Current consumers never own ledger paths.
  return sources.filter(({ path }) => path !== "src/infra/events/timeline-import.ts")
    .filter(({ content }) => /ledger(?:FilePath|Directory)|["'`]ledger["'`]/u.test(content) && /\b(?:unlinkSync|rmSync|truncateSync)\s*\(/u.test(content)).map(({ path }) => path);
}
function sources() { return gitVisibleFiles(["src"]).filter((path) => /\.tsx?$/u.test(path) && existsSync(join(REPO_ROOT, path))).map((path) => ({ path, content: readFileSync(join(REPO_ROOT, path), "utf8") })); }
describe("ledger projector retirement", () => {
  it("keeps current consumers absent and catches an injected read-through or repository alias", () => {
    assert.deepEqual(retiredLedgerConsumerViolations(sources()), []);
    for (const content of ['import { x } from "../infra/ledger/index.js";', 'db.authority.ledgerProjection.list()', 'db.authority.durableOutbox.get(id)', 'createLedgerReadThrough(root)']) assert.deepEqual(retiredLedgerConsumerViolations([{ path: "violating.ts", content }]), ["violating.ts"]);
  });
  it("allows no ledger appender or current cleanup path, with violating controls", () => {
    assert.deepEqual(ledgerSoleWriterViolations(sources()), []); assert.deepEqual(ledgerPruneReachabilityViolations(sources()), []);
    assert.deepEqual(ledgerSoleWriterViolations([{ path: "bad.ts", content: 'appendFileSync(ledgerFilePath(root), line)' }]), ["bad.ts"]);
    assert.deepEqual(ledgerPruneReachabilityViolations([{ path: "bad.ts", content: 'rmSync(ledgerDirectory(root))' }]), ["bad.ts"]);
  });
  it("has no retired tables or repositories on a fresh database", () => {
    const w = historyWorld(); try {
      w.commit(601); const db = new DatabaseSync(w.path, { readOnly: true }); try {
        const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
        for (const retired of ["operation_outbox", "ledger_partitions", "ledger_projections"]) assert.equal(names.includes(retired), false);
      } finally { db.close(); }
      for (const key of ["durableOutbox", "ledgerProjection"]) assert.equal(key in w.database.authority, false);
      assert.equal(w.history.query({ from: "2026-01-01", to: "2027-01-01" }).rows.length, 1);
    } finally { w.dispose(); }
  });
  it("preserves the separated historical line hash and detects changed content", () => {
    const line = canonicalJsonStringify({ seq: 0, payload: "historical" });
    assert.equal(deriveLedgerLineDigest(line), deriveLedgerLineDigest(line));
    assert.notEqual(deriveLedgerLineDigest(line), deriveLedgerLineDigest(`${line} `));
    assert.notEqual(deriveLedgerLineDigest(line), deriveLedgerLineDigest(canonicalJsonStringify({ seq: 1, payload: "historical" })));
  });
  it("retains historical dense-sequence refusal before allowing conversion", async () => {
    const w = historicalWorld({ files: true }); try {
      const raw = new DatabaseSync(w.path); try { raw.exec("UPDATE ledger_partitions SET next_seq=5, version=version+1, record_json=json_set(record_json,'$.nextSeq',5,'$.version',2)"); } finally { raw.close(); }
      await assert.rejects(w.backup(), /ledger-partition-sequence-is-dense/u);
    } finally { w.dispose(); }
  });
  it("forbids changing retained historical operation source bytes", async () => {
    const w = historicalWorld(); try { await w.backup(); await w.upgrade(); const raw = new DatabaseSync(w.path); try {
      assert.throws(() => raw.exec("UPDATE timeline_operation_sources SET record_json=record_json"), /immutable/u);
      assert.throws(() => raw.exec("DELETE FROM timeline_operation_sources"), /deletion|tombstone|owned/u);
    } finally { raw.close(); } } finally { w.dispose(); }
  });
  it("retains this guard's inventory identity", () => { assert.equal(relative(REPO_ROOT, import.meta.filename), "tests/unit/architecture/ledger-projector.test.ts"); });
});
