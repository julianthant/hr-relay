/**
 * Doc 09 §6's recovery bullets, executed. Each `it` here is one of the four
 * failure modes the doc names: commit-then-crash-before-projection,
 * two projectors racing one partition, a torn JSONL tail, and restore-from-
 * backup reconciliation that may not invent entries the outbox never held.
 */
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { LedgerEntrySchema } from "../../src/domain/ledger.js";
import {
  LedgerPartitionKeySchema,
  deriveLedgerLineDigest,
} from "../../src/domain/ledger-projection.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import {
  createLedgerProjector,
  ledgerFilePath,
  ledgerLineForOutbox,
  listLedgerFiles,
  type LedgerProjector,
} from "../../src/infra/ledger/index.js";
import { NOW } from "./fixtures/phase1c-contract-fixtures.js";
import { ledgerCommitFixture } from "./fixtures/ledger-projection-fixtures.js";

const PARTITION = LedgerPartitionKeySchema.parse({ system: "ucpath", date: "2026-07-31" });
const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "hrauto-ledger-"));
  roots.push(root);
  return root;
}

function open(root: string, owner = "ledger-projector-test"): AuthorityDatabase {
  const database = AuthorityDatabase.open(
    { path: join(root, "state.sqlite"), busyTimeoutMs: 250, migrationOwner: owner },
    manualClock(new Date(NOW)),
  );
  databases.push(database);
  return database;
}

function projector(database: AuthorityDatabase, root: string, projectorId: string): LedgerProjector {
  return createLedgerProjector(database, manualClock(new Date(NOW)), {
    stateRoot: root,
    projectorId,
    leaseMs: 30_000,
  });
}

/** Fence and atomically commit `count` distinct filed transactions. */
function commitEntries(database: AuthorityDatabase, count: number, confirmedAt?: string): readonly string[] {
  const outboxIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const fixture = ledgerCommitFixture(index, confirmedAt === undefined ? {} : { confirmedAt });
    const fenced = database.authority.writeIntents.fenceAttempt({
      intent: fixture.intent,
      attempt: fixture.attempt,
    });
    assert.equal(fenced.state, "fenced");
    database.commitWriteAttempt(fixture.commit);
    outboxIds.push(fixture.outboxId);
  }
  return outboxIds;
}

function ledgerLines(root: string): readonly string[] {
  const path = ledgerFilePath(root, PARTITION.system, PARTITION.date);
  return readFileSync(path, "utf8").split("\n").filter((line) => line !== "");
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("doc 09 §6 ledger projector", () => {
  it("projects each committed outbox exactly once, in sequence, with actor attribution", () => {
    const root = newRoot();
    const database = open(root);
    const outboxIds = commitEntries(database, 3);

    const reports = projector(database, root, "projector-a").projectAll();
    assert.equal(reports.length, 1);
    const report = reports[0];
    assert.equal(report.state, "projected");
    if (report.state !== "projected") return;
    assert.equal(report.nextSeq, 3);
    assert.deepEqual(report.appended.map(({ outboxId }) => outboxId).toSorted(), [...outboxIds].sort());

    const entries = ledgerLines(root).map((line) => LedgerEntrySchema.parse(JSON.parse(line)));
    assert.deepEqual(entries.map(({ seq }) => seq), [0, 1, 2]);
    assert.deepEqual(entries.map(({ outboxId }) => String(outboxId)).toSorted(), [...outboxIds].sort());
    for (const entry of entries) assert.equal(entry.payload.operator, "local-operator");
    for (const outboxId of outboxIds) {
      assert.equal(database.authority.ledgerProjection.getOutbox(outboxId)?.projection.state, "projected");
    }

    // Idempotent by outbox id: a second sweep is a no-op, not a second line.
    const again = projector(database, root, "projector-a").projectAll();
    assert.deepEqual(again, []);
    assert.equal(ledgerLines(root).length, 3);
    assert.deepEqual(listLedgerFiles(root).map(({ system, date }) => `${system}-${date}`), ["ucpath-2026-07-31"]);
  });

  it("catches up a commit that crashed before its line was ever projected", () => {
    const root = newRoot();
    const database = open(root);
    const [first] = commitEntries(database, 1);
    // The commit is durable; the projector never ran. This IS the crash window.
    assert.equal(database.authority.ledgerProjection.getProjection(first), undefined);

    const report = projector(database, root, "projector-a").project(PARTITION);
    assert.equal(report.state, "projected");
    if (report.state !== "projected") return;
    assert.deepEqual(report.appended.map(({ seq }) => seq), [0]);

    const entries = ledgerLines(root).map((line) => LedgerEntrySchema.parse(JSON.parse(line)));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].seq, 0);
    assert.equal(entries[0].outboxId, first);
    assert.equal(database.authority.ledgerProjection.getProjection(first)?.lifecycle.state, "appended");
  });

  it("re-appends only the assigned line a crash left missing, re-deriving its exact bytes", () => {
    const root = newRoot();
    const database = open(root);
    const outboxIds = commitEntries(database, 2);
    projector(database, root, "projector-a").project(PARTITION);

    // Simulate the crash between sequence assignment and the file append: a
    // third entry gains a sequence but its line never lands.
    const third = ledgerCommitFixture(2);
    const fenced = database.authority.writeIntents.fenceAttempt({ intent: third.intent, attempt: third.attempt });
    assert.equal(fenced.state, "fenced");
    database.commitWriteAttempt(third.commit);
    const outbox = database.authority.ledgerProjection.getOutbox(third.outboxId);
    assert.notEqual(outbox, undefined);
    if (outbox === undefined) return;
    const lease = database.authority.ledgerProjection.acquireLease({
      ...PARTITION, projectorId: "projector-crash", now: NOW, expiresAt: "2026-07-31T17:30:00.000Z",
    });
    assert.equal(lease.state, "acquired");
    if (lease.state !== "acquired") return;
    const assigned = database.authority.ledgerProjection.assignSequence({
      ...PARTITION,
      projectorId: "projector-crash",
      leaseGeneration: lease.partition.leaseGeneration,
      outboxId: third.outboxId,
      lineDigest: deriveLedgerLineDigest(ledgerLineForOutbox(outbox, 2)),
      assignedAt: NOW,
    });
    assert.equal(assigned.seq, 2);
    assert.equal(assigned.lifecycle.state, "assigned");
    database.authority.ledgerProjection.releaseLease({
      ...PARTITION, projectorId: "projector-crash", leaseGeneration: lease.partition.leaseGeneration, now: NOW,
    });

    // The stored digest was computed from the SAME canonical shape the
    // projector re-derives, so recovery must append it rather than stall.
    const report = projector(database, root, "projector-b").project(PARTITION);
    assert.equal(report.state, "projected");
    if (report.state !== "projected") return;
    assert.deepEqual(report.repaired.map(({ seq }) => seq), [2]);
    assert.deepEqual(report.appended, []);
    const entries = ledgerLines(root).map((entry) => LedgerEntrySchema.parse(JSON.parse(entry)));
    assert.deepEqual(entries.map(({ seq }) => seq), [0, 1, 2]);
    assert.equal(entries[2].outboxId, third.outboxId);
    assert.deepEqual(
      entries.map(({ outboxId }) => String(outboxId)).toSorted(),
      [...outboxIds, third.outboxId].sort(),
    );
  });

  it("serializes two projectors racing one (system,date) lease with no duplicate sequence", () => {
    const root = newRoot();
    const database = open(root);
    const outboxIds = commitEntries(database, 4);

    const first = database.authority.ledgerProjection.acquireLease({
      ...PARTITION, projectorId: "projector-a", now: NOW, expiresAt: "2026-07-31T17:30:00.000Z",
    });
    assert.equal(first.state, "acquired");

    // While A holds the lease, B must not touch the partition at all.
    const blocked = projector(database, root, "projector-b").project(PARTITION);
    assert.equal(blocked.state, "lease-held");
    if (blocked.state !== "lease-held") return;
    assert.equal(blocked.holder, "projector-a");

    if (first.state !== "acquired") return;
    database.authority.ledgerProjection.releaseLease({
      ...PARTITION, projectorId: "projector-a", leaseGeneration: first.partition.leaseGeneration, now: NOW,
    });

    // Now they interleave: each sweep takes the lease, projects, and releases.
    const reports = [
      projector(database, root, "projector-b").project(PARTITION),
      projector(database, root, "projector-a").project(PARTITION),
      projector(database, root, "projector-b").project(PARTITION),
    ];
    for (const report of reports) assert.equal(report.state, "projected");

    const entries = ledgerLines(root).map((line) => LedgerEntrySchema.parse(JSON.parse(line)));
    assert.deepEqual(entries.map(({ seq }) => seq), [0, 1, 2, 3]);
    assert.equal(new Set(entries.map(({ outboxId }) => outboxId)).size, 4);
    assert.deepEqual(entries.map(({ outboxId }) => String(outboxId)).toSorted(), [...outboxIds].sort());
    assert.equal(database.authority.ledgerProjection.getPartition(PARTITION.system, PARTITION.date)?.nextSeq, 4);
  });

  it("refuses to advance past a torn tail, a rewritten line, a gap, or a duplicate", () => {
    const path = (root: string): string => ledgerFilePath(root, PARTITION.system, PARTITION.date);
    const cases = [
      {
        name: "torn tail",
        reason: "malformed-tail",
        corrupt: (root: string) => {
          writeFileSync(path(root), `${ledgerLines(root).join("\n")}\n{"outboxId":"partial`);
        },
      },
      {
        name: "rewritten line",
        reason: "line-digest-mismatch",
        corrupt: (root: string) => {
          const lines = [...ledgerLines(root)];
          const entry = LedgerEntrySchema.parse(JSON.parse(lines[0]));
          lines[0] = JSON.stringify({ ...entry, payload: { ...entry.payload, operator: "someone-else" } });
          writeFileSync(path(root), `${lines.join("\n")}\n`);
        },
      },
      {
        name: "sequence gap",
        reason: "sequence-gap",
        corrupt: (root: string) => {
          const lines = [...ledgerLines(root)];
          const entry = LedgerEntrySchema.parse(JSON.parse(lines[1]));
          lines[1] = JSON.stringify({ ...entry, seq: 7 });
          writeFileSync(path(root), `${lines.join("\n")}\n`);
        },
      },
      {
        name: "duplicated line",
        reason: "unrecorded-line",
        corrupt: (root: string) => {
          const lines = ledgerLines(root);
          writeFileSync(path(root), `${[...lines, lines[0]].join("\n")}\n`);
        },
      },
    ] as const;

    for (const scenario of cases) {
      const root = newRoot();
      const database = open(root);
      commitEntries(database, 2);
      projector(database, root, "projector-a").project(PARTITION);
      const before = readFileSync(path(root), "utf8");
      scenario.corrupt(root);
      const corrupted = readFileSync(path(root), "utf8");

      // A third commit is waiting; a degraded partition must NOT project it.
      const pending = ledgerCommitFixture(9);
      database.authority.writeIntents.fenceAttempt({ intent: pending.intent, attempt: pending.attempt });
      database.commitWriteAttempt(pending.commit);

      const report = projector(database, root, "projector-b").project(PARTITION);
      assert.equal(report.state, "degraded", scenario.name);
      if (report.state !== "degraded") continue;
      assert.equal(report.reason, scenario.reason, scenario.name);
      assert.equal(readFileSync(path(root), "utf8"), corrupted, `${scenario.name} rewrote the ledger`);
      assert.notEqual(corrupted, before);
      assert.equal(
        database.authority.ledgerProjection.getOutbox(pending.outboxId)?.projection.state,
        "pending",
        `${scenario.name} projected past the corruption`,
      );
    }
  });

  it("replays a restored backup's outbox rows and invents nothing the outbox never held", () => {
    const root = newRoot();
    const database = open(root);
    const committed = commitEntries(database, 2);

    // The verified backup is taken AFTER those two commits and BEFORE the
    // projector has run: two pending outbox rows, no assignments, no file. The
    // store is closed first so the WAL is checkpointed into the copied file.
    database.close();
    databases.splice(databases.indexOf(database), 1);
    const backupPath = join(root, "backup.sqlite");
    copyFileSync(join(root, "state.sqlite"), backupPath);

    // Live keeps going and files a third transaction, then the DB is lost.
    const live = open(root);
    const third = ledgerCommitFixture(5);
    live.authority.writeIntents.fenceAttempt({ intent: third.intent, attempt: third.attempt });
    live.commitWriteAttempt(third.commit);
    projector(live, root, "projector-a").project(PARTITION);
    assert.equal(ledgerLines(root).length, 3);
    live.close();
    databases.splice(databases.indexOf(live), 1);

    // Restore the backup with a clean ledger directory: the replay must append
    // exactly the two entries that authority holds — never the third, whose
    // outbox row the restored database does not contain.
    const replayRoot = newRoot();
    copyFileSync(backupPath, join(replayRoot, "state.sqlite"));
    const replayed = open(replayRoot, "ledger-restore-test");
    assert.equal(replayed.authority.ledgerProjection.getOutbox(third.outboxId), undefined);
    const report = projector(replayed, replayRoot, "projector-restore").project(PARTITION);
    assert.equal(report.state, "projected");
    if (report.state !== "projected") return;
    assert.deepEqual(report.appended.map(({ outboxId }) => outboxId).toSorted(), [...committed].sort());
    assert.equal(report.nextSeq, 2);
    const entries = ledgerLines(replayRoot).map((line) => LedgerEntrySchema.parse(JSON.parse(line)));
    assert.deepEqual(entries.map(({ outboxId }) => String(outboxId)).toSorted(), [...committed].sort());
    assert.equal(replayed.authority.ledgerProjection.getProjection(third.outboxId), undefined);

    // Restoring the same older authority ALONGSIDE the newer three-line file
    // must stop rather than renumber, delete, or accept unaccounted history.
    const staleRoot = newRoot();
    copyFileSync(backupPath, join(staleRoot, "state.sqlite"));
    const staleLedger = ledgerFilePath(staleRoot, PARTITION.system, PARTITION.date);
    mkdirSync(dirname(staleLedger), { recursive: true });
    copyFileSync(ledgerFilePath(root, PARTITION.system, PARTITION.date), staleLedger);
    const stale = open(staleRoot, "ledger-restore-test");
    const degradedReport = projector(stale, staleRoot, "projector-restore").project(PARTITION);
    assert.equal(degradedReport.state, "degraded");
    if (degradedReport.state !== "degraded") return;
    assert.equal(degradedReport.reason, "unrecorded-line");
    assert.equal(readFileSync(staleLedger, "utf8").split("\n").filter((line) => line !== "").length, 3);
  });
});
