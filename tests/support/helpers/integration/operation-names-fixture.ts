import { DatabaseSync } from "node:sqlite";
import { AUTHORITY_APPLICATION_ID, SQLITE_MIGRATIONS, databaseStateTable } from "../../../../src/backend/storage/sqlite/migrations.js";
import { WriteAttemptRecordSchema, WriteIntentRecordSchema, deriveIdempotencyKeyDigest } from "../../../../src/rules/write-safety/write-safety.js";
import { AtomicOutboxRecordSchema } from "../../../../src/models/notifications/outbox.js";
import { DeletedRunRecordSchema } from "../../../../src/models/run/deleted-run.js";
import { QUEUED_RUN } from "../../fixtures/phase1f-run-fixtures.js";
import { NOW, LATER, HASH_A, WRITE_INTENT_ATTEMPTING, WRITE_ATTEMPT, SPAN_OUTBOX_RECORD, LEDGER_OUTBOX_RECORD } from "../../fixtures/phase1c-contract-fixtures.js";

export const OPERATION_TABLE_RENAMES = [
  ["write_intents", "run_operations"],
  ["write_attempts", "run_operation_attempts"],
  ["durable_outbox", "operation_outbox"],
] as const;
export const operationFixtureId = (n: number): string => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Populate the released v33/v34 layout, then replay only the requested suffix. */
export function createOperationRenameSource(path: string, version = 34): void {
  const db = new DatabaseSync(path);
  const sourceVersion = Math.min(version, 34);
  try {
    for (const migration of SQLITE_MIGRATIONS.filter((m) => m.version <= sourceVersion)) {
      for (const statement of migration.statements) db.exec(statement);
    }
    db.prepare("INSERT INTO authority_meta(singleton_id,schema_version,authority_generation,updated_at) VALUES (1,?,7,?)").run(sourceVersion, NOW);
    db.exec(`PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}`);
    db.exec(`PRAGMA user_version=${String(sourceVersion)}`);
    const statuses = ["observed-present", "attempting", "committed", "retryable", "parked"] as const;
    for (const [index, status] of statuses.entries()) {
      const writeIntentId = operationFixtureId(index + 1);
      const idempotencyKey = `synthetic-operation-${String(index)}`;
      const idempotencyKeyDigest = deriveIdempotencyKeyDigest("ucpath", idempotencyKey);
      const currentAttemptId = operationFixtureId(index + 11);
      const identity = { writeIntentId, idempotencyKey, idempotencyKeyDigest };
      const settlement = { state: "operator-confirmed-absent", writeIntentId, generation: 1,
        operator: "local-operator", confirmedAt: LATER, evidenceNote: "Synthetic confirmed absence" };
      const base = { ...WRITE_INTENT_ATTEMPTING, ...identity, currentAttemptId, status };
      const record = WriteIntentRecordSchema.parse(status === "observed-present" ? {
        ...identity, system: "ucpath", workflowId: "separation", itemId: WRITE_INTENT_ATTEMPTING.itemId,
        taskId: WRITE_INTENT_ATTEMPTING.taskId, generation: 1, status,
        observedProof: { schemaHash: HASH_A, value: "synthetic-receipt" }, observedAt: NOW,
        version: 1, createdAt: NOW, updatedAt: NOW,
      } : status === "committed" ? { ...base, completionProof: { schemaHash: HASH_A, value: "synthetic-receipt" }, confirmedAt: LATER }
        : status === "retryable" ? { ...base, settlement, resolvedAt: LATER }
          : status === "parked" ? { ...base, parkedCode: "unknown", message: "Synthetic unknown submit" }
            : { ...base, generation: 2, runId: operationFixtureId(50), runAttempt: 3 });
      db.prepare(`INSERT INTO write_intents(record_key,idempotency_key_digest,status,record_json,created_at,system,idempotency_key)
        VALUES (?,?,?,?,?,?,?)`).run(writeIntentId, idempotencyKeyDigest, status, JSON.stringify(record, null, 2), NOW, "ucpath", idempotencyKey);
      if (status === "observed-present") continue;
      const outcome = status === "committed" ? { state: "committed", completionProof: { schemaHash: HASH_A, value: "synthetic-receipt" }, confirmedAt: LATER }
        : status === "retryable" ? { state: "safe-to-retry", settlement }
          : status === "parked" ? { state: "parked", code: "unknown", message: "Synthetic unknown submit" }
            : { state: "attempting" };
      const insertAttempt = (input: unknown) => {
        const attempt = WriteAttemptRecordSchema.parse(input);
        db.prepare("INSERT INTO write_attempts(record_key,write_intent_id,generation,record_json,created_at) VALUES (?,?,?,?,?)")
          .run(attempt.writeAttemptId, writeIntentId, attempt.generation, JSON.stringify(attempt, null, 2), NOW);
      };
      if (status === "attempting") {
        insertAttempt({ ...WRITE_ATTEMPT, writeIntentId, writeAttemptId: operationFixtureId(40),
          outcome: { state: "safe-to-retry", settlement } });
      }
      insertAttempt({ ...WRITE_ATTEMPT, writeIntentId, writeAttemptId: currentAttemptId, outcome,
        ...(status === "attempting" ? { generation: 2, runId: operationFixtureId(50), runAttempt: 3 } : {}) });
      if (status === "committed") {
        for (const input of [LEDGER_OUTBOX_RECORD, SPAN_OUTBOX_RECORD]) {
          const source = AtomicOutboxRecordSchema.parse(input);
          const payload = source.payload.kind === "ledger-entry"
            ? { ...source.payload, entry: { ...source.payload.entry, ...identity } }
            : { ...source.payload, ...identity };
          const outbox = AtomicOutboxRecordSchema.parse({ ...source,
            aggregate: { ...source.aggregate, writeIntentId }, payload,
            // Projected spans need no ledger pointer; a pending ledger remains visible to replay.
            ...(source.payload.kind === "write-committed-span" ? {
              projection: { state: "projected", projectedAt: LATER, projectionFingerprint: HASH_A },
            } : {}),
          });
          db.prepare("INSERT INTO durable_outbox(record_key,write_intent_id,generation,kind,record_json,created_at) VALUES (?,?,?,?,?,?)")
            .run(outbox.outboxId, writeIntentId, 1, outbox.payload.kind, JSON.stringify(outbox, null, 2), LATER);
        }
      }
    }
    const insertRun = (runId: string, attempt: number) => {
      const run = { ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope, runId,
        itemId: WRITE_INTENT_ATTEMPTING.itemId, attempt },
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } };
      db.prepare(`INSERT INTO workflow_runs(record_key,workflow,item_id,state,priority,attempt,
        claim_generation,version,record_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        runId, run.envelope.workflow, run.envelope.itemId, "terminal", run.envelope.priority,
        attempt, run.claimGeneration, run.version, JSON.stringify(run), run.createdAt);
    };
    insertRun(WRITE_INTENT_ATTEMPTING.runId, 1);
    insertRun(operationFixtureId(50), 3);
    insertRun(operationFixtureId(70), 2);

    const deleted = DeletedRunRecordSchema.parse({ runId: operationFixtureId(70), workflow: "separation",
      traceId: "se-120000-2222", origin: "queue", commandId: operationFixtureId(71), deletedAt: NOW,
      itemId: operationFixtureId(72), attempt: 2, runNumber: 7, ordinalSource: "tombstone", tallyVersion: 2,
      removed: [{ table: "durable_outbox", rows: 2 }, { table: "write_attempts", rows: 2 }, { table: "write_intents", rows: 1 }],
    });
    db.prepare(`INSERT INTO deleted_runs(record_key,workflow,trace_id,origin,command_id,deleted_at,record_json,created_at,item_id,attempt,run_number,ordinal_source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(deleted.runId, deleted.workflow, deleted.traceId, deleted.origin,
      deleted.commandId, NOW, JSON.stringify(deleted, null, 2), NOW, deleted.itemId, deleted.attempt, deleted.runNumber, deleted.ordinalSource);
    db.prepare("DELETE FROM workflow_runs WHERE record_key=?").run(deleted.runId);
    for (const migration of SQLITE_MIGRATIONS.filter((m) => m.version > sourceVersion && m.version <= version)) {
      for (const statement of migration.statements) db.exec(statement);
      db.prepare(`UPDATE ${databaseStateTable(migration.version)} SET schema_version=?`).run(migration.version);
      db.exec(`PRAGMA user_version=${String(migration.version)}`);
    }
  } finally { db.close(); }
}
