import { createRunLifecycleStorage, LifecycleSourceSnapshotSchema } from "../../../../../../src/backend/storage/sqlite/run-lifecycle-storage.js";
import { ArchivedTransactionsSchema } from "../../../../../../src/models/archive/model.js";
import { HistoricalOperationSourceSchema } from "../../../../../../src/models/events/timeline.js";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { RunRecordSchema } from "../../../../../../src/models/run/record.js";
import { fixtureUuid } from "../../../../../support/fixtures/ledger-projection-fixtures.js";
import { TimelineSourceManifestSchema } from "../../../../../../src/backend/storage/events/timeline-import.js";
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { canonicalJsonStringify } from "../../../../../../src/rules/validation/canonical-json.js";
import { createTransactionHistory } from "../../../../../../src/backend/storage/sqlite/transaction-history.js";
import { upgradeStorage } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { historyWorld, historicalWorld, historyClock } from "../../../../../support/helpers/storage/transaction-history-fixture.js";
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
  it("keeps the released span-only source grammar and versions ledger provenance separately", () => {
    const base = { sourceDatabaseIdentity: "a".repeat(64), backupSha256: "b".repeat(64), authorityGeneration: 1,
      files: [{ relativePath: "spans/separation-2026-07-31.jsonl", sha256: "c".repeat(64), bytes: 1, lines: 1 }] };
    assert.equal(TimelineSourceManifestSchema.safeParse({ ...base, version: 1 }).success, true);
    const ledger = { ...base, files: [{ ...base.files[0], relativePath: "ledger/ucpath-2026-07-31.jsonl" }] };
    assert.equal(TimelineSourceManifestSchema.safeParse({ ...ledger, version: 1 }).success, false);
    assert.equal(TimelineSourceManifestSchema.safeParse({ ...ledger, version: 2 }).success, true);
  });
  it("keeps converted retry-shared evidence until final-owner deletion without resurrecting transactions", async () => {
    const w = historicalWorld(); cleanup.push(() => w.dispose()); await w.backup(); await w.upgrade();
    const db = w.open(); try {
      const fixture = w.fixtures[0]; const run = db.authority.runs.get(fixture.commit.transaction.runId); assert.ok(run);
      const now = "2026-09-09T12:00:00.000Z";
      db.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: run.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: now }, now });
      const retry = RunRecordSchema.parse({ ...run, envelope: { ...run.envelope, runId: fixtureUuid("converted-retry"), traceId: "se-120000-7777", attempt: 2, retryOf: run.envelope.runId, enqueuedAt: now }, lifecycle: { state: "queued" }, version: 1, createdAt: now, updatedAt: now });
      db.authority.runs.enqueue(retry);
      db.authority.runs.delete({ runId: run.envelope.runId, origin: "queue", commandId: fixtureUuid("converted-delete-source"), now });
      assert.ok(db.authority.writeIntents.get(fixture.commit.writeIntentId));
      assert.equal(db.authority.historicalOperationSources.list().length, 2);
      assert.equal(createTransactionHistory(db.authority).query(range).rows.length, 1);
      db.authority.runs.transition({ runId: retry.envelope.runId, expectedVersion: retry.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: now }, now });
      db.authority.runs.delete({ runId: retry.envelope.runId, origin: "queue", commandId: fixtureUuid("converted-delete-retry"), now });
      assert.equal(db.authority.writeIntents.get(fixture.commit.writeIntentId), undefined);
      assert.equal(db.authority.historicalOperationSources.list().length, 1);
      assert.equal(db.authority.deletedRuns.get(retry.envelope.runId)?.removed.find((row) => row.table === "timeline_operation_sources")?.rows, 1);
      assert.equal(createTransactionHistory(db.authority).query(range).rows.length, 1);
    } finally { db.close(); }
  });
  it.each(["span-proof", "span-output", "shared-proof", "projection"] as const)("refuses changed retained %s evidence on inspection and reads", async (fault) => {
    const w = historicalWorld({ files: fault !== "shared-proof" }); cleanup.push(() => w.dispose()); await w.backup(); await w.upgrade();
    const db = w.open();
    try {
      const fixture = w.fixtures[0];
      if (fault === "shared-proof") {
        const run = db.authority.runs.get(fixture.commit.transaction.runId); assert.ok(run);
        const now = "2026-09-09T12:00:00.000Z";
        db.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: run.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: now }, now });
        db.authority.runs.enqueue(RunRecordSchema.parse({ ...run, envelope: { ...run.envelope, runId: fixtureUuid("source-corruption-retry"), traceId: "se-120000-7777", attempt: 2, retryOf: run.envelope.runId, enqueuedAt: now }, lifecycle: { state: "queued" }, version: 1, createdAt: now, updatedAt: now }));
        db.authority.runs.delete({ runId: run.envelope.runId, origin: "queue", commandId: fixtureUuid("source-corruption-delete"), now });
        assert.equal(createTransactionHistory(db.authority).query(range).rows.length, 1);
      }
      const raw = new DatabaseSync(w.path);
      try {
        const row = raw.prepare("SELECT record_json FROM timeline_operation_sources WHERE record_key=?").get(`${fixture.commit.writeIntentId}:1`); assert.ok(row);
        const source = JSON.parse(String(row.record_json)) as { spanOutbox: { payload: { outcome: { proof: { value: unknown }; output: { value: unknown } } } }; ledgerOutbox: { payload: { entry: { proof: { value: unknown } } } }; projection: { seq: number } };
        if (fault === "span-output") source.spanOutbox.payload.outcome.output.value = "divergent-output";
        else if (fault === "projection") source.projection.seq += 1;
        else {
          source.spanOutbox.payload.outcome.proof.value = "divergent-proof";
          if (fault === "shared-proof") source.ledgerOutbox.payload.entry.proof.value = "divergent-proof";
        }
        if (fault === "span-output" || fault === "shared-proof") assert.equal(HistoricalOperationSourceSchema.safeParse(source).success, true);
        const triggers = raw.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='timeline_operation_sources' AND sql LIKE '%BEFORE UPDATE%'").all();
        assert.equal(triggers.length, 1);
        for (const trigger of triggers) raw.exec(`DROP TRIGGER "${String(trigger.name)}"`);
        raw.prepare("UPDATE timeline_operation_sources SET record_json=? WHERE record_key=?").run(canonicalJsonStringify(source), `${fixture.commit.writeIntentId}:1`);
        for (const trigger of triggers) raw.exec(String(trigger.sql));
      } finally { raw.close(); }
      assert.throws(() => AuthorityDatabase.inspectExistingReadOnly(w.path), /historical.*(?:source|settlement)|confirmed-history/u);
      assert.throws(() => createTransactionHistory(db.authority).query(range), /historical.*(?:source|settlement)|confirmed-history/u);
    } finally { db.close(); }
  });
  it.each([false, true])("converts two days with exact raw provenance, files present: %s", async (files) => {
    const w = historicalWorld({ files }); cleanup.push(() => w.dispose());
    const bytes = w.lines.map((line) => readFileSync(line.path));
    await w.backup(); assert.equal((await w.upgrade()).state, "converted");
    const db = w.open();
    try {
      const history = createTransactionHistory(db.authority); const rows = history.query(range).rows;
      assert.equal(rows.length, 2); assert.deepEqual(rows.map((row) => row.ledger), w.fixtures.map((fixture) => fixture.commit.transaction));
      const sources = db.authority.historicalOperationSources.list(); assert.equal(sources.length, 2);
      for (const source of sources) {
        const fixture = w.fixtures.find((item) => item.commit.writeIntentId === source.operationId); assert.ok(fixture);
        assert.equal(canonicalJsonStringify(source.ledgerOutbox), canonicalJsonStringify(fixture.historicalCommit.ledgerOutbox));
        assert.equal(canonicalJsonStringify(source.spanOutbox), canonicalJsonStringify(fixture.historicalCommit.terminalSpanOutbox));
        assert.equal(source.file !== null, files);
      }
      assert.deepEqual(history.foldActivityRange(range.from, range.to).systems, [{ system: "ucpath", entries: 2, prod: 1, test: 1 }]);
      for (const [index, line] of w.lines.entries()) assert.deepEqual(readFileSync(line.path), bytes[index]);
      for (const line of w.lines) rmSync(line.path);
      assert.deepEqual(history.query(range).rows, rows);
    } finally { db.close(); }
    assert.equal((await w.upgrade()).state, "already-upgraded");
    const after = readFileSync(w.path); assert.equal((await w.upgrade()).state, "already-upgraded"); assert.deepEqual(readFileSync(w.path), after);
  });
  it("preserves historical archive and transaction bytes through retirement and inert replay", async () => {
    const w = historicalWorld({ files: true, archive: true }); cleanup.push(() => w.dispose());
    const readArchive = () => { const raw = new DatabaseSync(w.path, { readOnly: true });
      try { return raw.prepare("SELECT record_key,record_json,content_digest FROM archived_runs").get(); } finally { raw.close(); } };
    const original = readArchive(); assert.ok(original); await w.backup(); await w.upgrade();
    const db = w.open(); try {
      const runId=String(original.record_key),storage=createRunLifecycleStorage(db);
      const report=storage.readReport(runId);assert.ok(report);
      const source=LifecycleSourceSnapshotSchema.parse(JSON.parse(report.content.sources[0].json));
      assert.equal(source.records.find(group=>group.table==="archived_runs")?.rows[0].json,original.record_json);
      const supplement=JSON.parse(source.records.find(group=>group.table==="archive_transactions")?.rows[0].json ?? "null") as {json:string};
      const section=ArchivedTransactionsSchema.parse(JSON.parse(supplement.json));
      assert.equal(section.contentDigest,original.content_digest);
      const before=db.getMeta();
      assert.throws(()=>db.authority.archivedRuns.insert(JSON.parse(String(original.record_json))),/writer-retired/u);
      assert.throws(()=>db.authority.archivedRuns.enrichTransactions(section),/writer-retired/u);
      assert.deepEqual(db.getMeta(),before);
      for(const line of w.lines)rmSync(line.path);
      assert.deepEqual(storage.readReport(runId),report);
      assert.equal((await w.upgrade()).state,"already-upgraded");
    } finally { db.close(); }
  });
  it.each(["torn", "divergent", "orphan"] as const)("refuses %s ledger evidence without retiring history", async (fault) => {
    const w = historicalWorld({ files: true, sourceVersion: 39 }); cleanup.push(() => w.dispose());
    const line = w.lines[0];
    if (fault === "torn") writeFileSync(line.path, line.text.slice(0, -1));
    else {
      const value = JSON.parse(line.text) as { outboxId: string; payload: { operator: string } };
      if (fault === "divergent") value.payload.operator = "different-historical-actor";
      else value.outboxId = "11111111-1111-4111-8111-111111111111";
      writeFileSync(line.path, `${canonicalJsonStringify(value)}\n`);
    }
    await w.backup(); const before = readFileSync(w.path);
    await assert.rejects(w.upgrade(), /authority-below-floor.*original compatible release/u);
    assert.deepEqual(readFileSync(w.path), before);
  });
  it("rolls back changed source bytes at precommit and resumes only the committed copied source", async () => {
    const w = historicalWorld({ files: true }); cleanup.push(() => w.dispose()); await w.backup();
    await assert.rejects(upgradeStorage({ ...w.input, hooks: { beforeCommit: () => writeFileSync(w.lines[0].path, `${w.lines[0].text}\n`) } }, historyClock), /timeline-source-/u);
    const raw = new DatabaseSync(w.path, { readOnly: true }); try { assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version, 46); } finally { raw.close(); }
    writeFileSync(w.lines[0].path, w.lines[0].text);
    await assert.rejects(upgradeStorage({ ...w.input, hooks: { afterCommit: () => { throw new Error("injected-settlement-interruption"); } } }, historyClock), /injected-settlement-interruption/u);
    for (const line of w.lines) rmSync(line.path);
    assert.equal((await w.upgrade()).state, "converted");
    const db = w.open(); try { assert.equal(createTransactionHistory(db.authority).query(range).rows.length, 2); } finally { db.close(); }
  });
});
