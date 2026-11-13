import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { validateAuthorityChanges, validateAuthorityStore, type AuthorityRowChange } from "../../../../src/backend/storage/sqlite/authority-database.js";
import type { AuthorityTableName } from "../../../../src/models/config/authority.js";
import { nativeOrdinaryRecordFromRow } from "../../../../src/backend/storage/sqlite/native-record-row.js";
import { runRecordColumns, runRecordFromRow } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { createTimelineRepository } from "../../../../src/backend/storage/sqlite/timeline-repository.js";
import { timelineCheckpointReference } from "../../../../src/models/events/timeline.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { fixtureUuid } from "../../../support/fixtures/ledger-projection-fixtures.js";
import { seedCheckClosureStore } from "../../../support/fixtures/storage/check-closure-store.js";

type Row = Record<string, unknown>;
const RowSchema = z.record(z.string(), z.unknown());

/** The message and every cause message, so a refusal can be matched by the invariant or row error that raised it. */
function refusal(work: () => void): string | undefined {
  try { work(); return undefined; } catch (error) {
    const messages: string[] = [];
    for (let current: unknown = error; current instanceof Error; current = current.cause) messages.push(current.message);
    return messages.join(" <- ");
  }
}

describe("authority check closure regressions", () => {
  let store: Awaited<ReturnType<typeof seedCheckClosureStore>>;
  let raw: DatabaseSync;
  beforeAll(async () => {
    store = await seedCheckClosureStore({ activeRuns: true });
    store.closeDatabase();
    raw = new DatabaseSync(store.databasePath);
    // Another process's raw writer: no foreign keys and no guard triggers, inside a transaction this test rolls back.
    raw.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE");
    for (const trigger of z.array(z.object({ name: z.string() })).parse(raw.prepare("SELECT name FROM sqlite_schema WHERE type='trigger'").all())) {
      raw.exec(`DROP TRIGGER "${trigger.name}"`);
    }
  });
  afterAll(async () => {
    raw.exec("ROLLBACK");
    raw.close();
    await store.cleanup();
  });

  const select = (sql: string, ...values: string[]): Row[] => z.array(RowSchema).parse(raw.prepare(sql).all(...values));
  const one = (sql: string, ...values: string[]): Row => {
    const rows = select(sql, ...values);
    expect(rows).toHaveLength(1);
    return RowSchema.parse(rows[0]);
  };
  const read = (table: AuthorityTableName, column: string, id: string): Row => one(`SELECT * FROM ${table} WHERE ${column}=?`, id);
  const text = (value: unknown): string => z.string().parse(value);

  /** Runs `edit` inside a savepoint that is always rolled back, handing it the stored rows to change. */
  function edited<T>(edit: () => T): T {
    raw.exec("SAVEPOINT regression_case");
    try { return edit(); } finally { raw.exec("ROLLBACK TO regression_case; RELEASE regression_case"); }
  }

  it("starts from a store both checks accept", () => {
    expect(refusal(() => validateAuthorityStore(raw))).toBeUndefined();
    expect(refusal(() => validateAuthorityChanges(raw, []))).toBeUndefined();
  });

  it("refuses a settled command whose outcome names another audit", () => {
    // A command that targets no run and whose audit names none, so only the command key reaches the audit row.
    const target = one(`SELECT c.id AS command_id, a.id AS audit_id FROM commands c JOIN command_audits a ON a.command_id=c.id
      WHERE json_extract(c.outcome_json,'$.auditId')=a.id AND c.target_id IS NULL AND instr(a.payload_json,'runId')=0 AND instr(c.outcome_json,'runId')=0
      ORDER BY c.id LIMIT 1`);
    const other = one("SELECT id AS audit_id FROM command_audits WHERE id<>? ORDER BY id LIMIT 1", text(target.audit_id));
    const command = read("commands", "id", text(target.command_id));
    const otherAuditId = text(other.audit_id);

    edited(() => {
      const outcome = RowSchema.parse(JSON.parse(text(command.outcome_json)));
      raw.prepare("UPDATE commands SET outcome_json=? WHERE id=?").run(JSON.stringify({ ...outcome, auditId: otherAuditId }), text(command.id));
      const change: AuthorityRowChange = { table: "commands", before: command, after: read("commands", "id", text(command.id)) };
      expect(refusal(() => validateAuthorityStore(raw))).toBeDefined();
      expect(refusal(() => validateAuthorityChanges(raw, [change]))).toContain("command-audit-settlement-mismatch");
    });
  });

  it("refuses a second active run on one worker", () => {
    const [a, b] = select("SELECT id, owner_worker_id FROM runs WHERE state IN ('claimed','validating','running') ORDER BY id");
    expect(a && b).toBeTruthy();
    expect(select("SELECT id FROM runs WHERE state IN ('claimed','validating','running')")).toHaveLength(2);
    const workerA = text(a?.owner_worker_id);
    const before = read("runs", "id", text(b?.id));
    expect(text(before.owner_worker_id)).not.toBe(workerA);
    const unrelated = one("SELECT * FROM timeline_events WHERE rowid=(SELECT min(rowid) FROM timeline_events)");
    edited(() => {
      const record = RowSchema.parse(JSON.parse(text(before.lifecycle_json)));
      const lifecycle = RowSchema.parse(record.lifecycle);
      raw.prepare("UPDATE runs SET owner_worker_id=?, lifecycle_json=? WHERE id=?")
        .run(workerA, JSON.stringify({ ...record, lifecycle: { ...lifecycle, workerId: workerA } }), text(before.id));
      const change: AuthorityRowChange = { table: "runs", before, after: read("runs", "id", text(before.id)) };
      // Only the cross-row invariant refuses, not the row's own validation.
      expect(refusal(() => validateAuthorityStore(raw, "none"))).toBe("current composite authority is invalid");
      expect(refusal(() => validateAuthorityChanges(raw, [change], "none"))).toBe("current composite authority is invalid");
      expect(refusal(() => validateAuthorityChanges(raw, [{ table: "timeline_events", before: unrelated, after: unrelated }], "none"))).toBeUndefined();
    });
  });

  // Every table that names a run through a column also validates the row against that run, so no single-column move leaves the
  // new owner valid while the old owner breaks: the after image alone always refuses. The old owner is still checked, through
  // the before image, which is what a reader holding only the vacated side of the move relies on.
  it("checks a moved row under its old owner", () => {
    const result = one("SELECT * FROM run_results WHERE json_extract(terminal_run_json,'$.lifecycle.outcome')='done'");
    const oldOwner = text(result.run_id);
    const newOwner = text(one("SELECT id FROM runs WHERE state='queued' ORDER BY id LIMIT 1").id);
    expect(newOwner).not.toBe(oldOwner);
    edited(() => {
      raw.prepare("UPDATE run_results SET run_id=? WHERE run_id=?").run(newOwner, oldOwner);
      const after = read("run_results", "run_id", newOwner);
      const composite = "current composite authority is invalid";
      expect(refusal(() => validateAuthorityStore(raw, "none"))).toBeDefined();
      expect(refusal(() => validateAuthorityChanges(raw, [{ table: "run_results", before: result, after }], "none"))).toBeDefined();
      expect(refusal(() => validateAuthorityChanges(raw, [{ table: "run_results", after }], "none"))).toBeDefined();
      expect(refusal(() => validateAuthorityChanges(raw, [{ table: "run_results", before: result }], "none"))).toBe(composite);
    });
  });

  it("accepts a run removed with its search row and refuses one removed alone", () => {
    const published = one("SELECT * FROM run_search WHERE run_id=(SELECT id FROM runs WHERE state='queued' ORDER BY id LIMIT 1)");
    edited(() => {
      raw.prepare("DELETE FROM run_search WHERE run_id=?").run(text(published.run_id));
      expect(refusal(() => validateAuthorityStore(raw))).toBeDefined();
      expect(refusal(() => validateAuthorityChanges(raw, [{ table: "run_search", before: published }]))).toContain("run-search-source-coverage-invalid");
    });

    const deleted = text(one("SELECT run_id FROM deleted_runs").run_id);
    expect(select("SELECT 1 FROM runs WHERE id=?", deleted)).toHaveLength(0);
    expect(select("SELECT 1 FROM run_search WHERE run_id=?", deleted)).toHaveLength(0);
    expect(refusal(() => validateAuthorityStore(raw))).toBeUndefined();
    expect(refusal(() => validateAuthorityChanges(raw, [
      { table: "runs", before: { id: deleted, owner_worker_id: null } },
      { table: "run_search", before: { run_id: deleted } },
    ]))).toBeUndefined();
  });

  it("re-checks a checkpoint's replays in the other runs of its work item", () => {
    // The checkpoint is replayed by a later attempt of the same item, and its own recorded event is gone: the whole check
    // accepts that store, and refuses it once the checkpoint itself is deleted.
    const checkpoint = one("SELECT * FROM run_checkpoints WHERE run_id=?", fixtureUuid("closure-checkpoint-run"));
    edited(() => {
      const owner = runRecordFromRow(read("runs", "id", text(checkpoint.run_id)));
      const maxRunNumber = z.object({ n: z.number().int() }).parse(raw.prepare("SELECT coalesce(max(run_number),0) AS n FROM runs").get()).n;
      const peer = RunRecordSchema.parse({ ...owner, runNumber: maxRunNumber + 1,
        envelope: { ...owner.envelope, runId: fixtureUuid("closure-checkpoint-peer"), attempt: owner.envelope.attempt + 1 } });
      const columns = runRecordColumns(peer);
      raw.prepare(`INSERT INTO runs(${Object.keys(columns).join(",")}) VALUES(${Object.keys(columns).map(() => "?").join(",")})`).run(...Object.values(columns));
      createTimelineRepository({ database: raw, mutate: work => work().result, read: work => work(), assertOwner: () => undefined }).append({
        schemaVersion: 1, eventId: fixtureUuid("closure-checkpoint-replay"), workflow: peer.envelope.workflow, scope: { kind: "run", runId: peer.envelope.runId },
        occurredAt: peer.createdAt, recordedAt: peer.createdAt, retentionDate: peer.createdAt.slice(0, 10), source: { kind: "native" },
        payload: { kind: "checkpoint-replayed", runId: peer.envelope.runId, workflow: peer.envelope.workflow, attempt: peer.envelope.attempt, claimGeneration: 1,
          checkpoint: timelineCheckpointReference(RunCheckpointRecordSchema.parse(nativeOrdinaryRecordFromRow("run_checkpoints", checkpoint))) },
      });
      raw.prepare("DELETE FROM timeline_events WHERE run_id=? AND kind='checkpoint-recorded'").run(text(checkpoint.run_id));
      expect(refusal(() => validateAuthorityStore(raw, "none"))).toBeUndefined();

      raw.prepare("DELETE FROM run_checkpoints WHERE id=?").run(text(checkpoint.id));
      expect(refusal(() => validateAuthorityStore(raw, "none"))).toContain("timeline-checkpoint-reference-mismatch");
      expect(refusal(() => validateAuthorityChanges(raw, [{ table: "run_checkpoints", before: checkpoint }], "none"))).toContain("timeline-checkpoint-reference-mismatch");
    });
  });
});
