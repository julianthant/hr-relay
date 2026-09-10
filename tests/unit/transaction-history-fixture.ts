import { ARCHIVED_RUN, VERSION_BUMP_APPLICATION, VERSION_PLAN_ROW } from "../fixtures/archive-fixtures.js";
import { QUEUED_RUN } from "../fixtures/phase1f-run-fixtures.js";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { manualClock } from "../../src/domain/clock.js";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { AtomicOutboxRecordSchema } from "../../src/domain/outbox.js";
import { deriveLedgerLineDigest } from "../../src/domain/ledger-projection.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/authority-database.js";
import { AUTHORITY_APPLICATION_ID, SQLITE_MIGRATIONS } from "../../src/infra/sqlite/migrations.js";
import { createTransactionHistory } from "../../src/infra/sqlite/transaction-history.js";
import { backupStoppedAuthority, upgradeStorage } from "../../src/server/storage/upgrade.js";
import { atomicWriteCheckpoint, seedAtomicWriteOwner } from "./helpers/timeline-write-fixture.js";
import { ledgerCommitFixture, fixtureUuid } from "./fixtures/ledger-projection-fixtures.js";

export const HISTORY_NOW = "2026-09-09T12:00:00.000Z";
export const historyClock = manualClock(new Date(HISTORY_NOW));
export function historyWorld() {
  const root = mkdtempSync(join(tmpdir(), "history-views-"));
  const path = join(root, "state.db");
  const open = () => AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "transaction-history-test" }, historyClock);
  let database = open();
  return { root, path, get database() { return database; }, get history() { return createTransactionHistory(database.authority); },
    commit(index: number, overrides: Parameters<typeof ledgerCommitFixture>[1] = {}) {
      const fixture = ledgerCommitFixture(index, { runId: fixtureUuid(`history-run-${String(index)}`), itemId: fixtureUuid(`history-item-${String(index)}`), ...overrides });
      seedAtomicWriteOwner(database, fixture.commit);
      assert.equal(database.authority.writeIntents.fenceAttempt({ intent: fixture.intent, attempt: fixture.attempt }).state, "fenced");
      database.commitWriteAttempt(fixture.commit, atomicWriteCheckpoint(fixture.commit));
      return fixture;
    },
    reopen() { database.close(); database = open(); },
    dispose() { database.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

/** Real released v39 DDL with populated exact historical bytes, not a fake repository. */
export function historicalWorld(options: { files?: boolean; confirmation?: boolean; archive?: boolean } = {}) {
  const world = historyWorld();
  const fixtures = [world.commit(101, { confirmedAt: "2026-07-31T17:30:00.000Z" }),
    world.commit(102, { confirmedAt: "2026-08-01T17:30:00.000Z", instance: "test" })];
  if (options.archive) {
    world.database.authority.runs.enqueue(QUEUED_RUN);
    world.database.authority.runs.transition({runId:QUEUED_RUN.envelope.runId,expectedVersion:QUEUED_RUN.version,lifecycle:{state:"terminal",outcome:"cancelled",endedAt:HISTORY_NOW},now:HISTORY_NOW});
  }
  const root = mkdtempSync(join(tmpdir(), "history-conversion-"));
  const path = join(root, "state.db");
  const source = new DatabaseSync(world.path, { readOnly: true });
  const target = new DatabaseSync(path);
  const lines: { path: string; text: string }[] = [];
  try {
    for (const migration of SQLITE_MIGRATIONS.filter((entry) => entry.version <= 39)) for (const statement of migration.statements) target.exec(statement);
    target.prepare("INSERT INTO database_state(singleton_id,schema_version,authority_generation,updated_at) VALUES (1,39,7,?)").run(HISTORY_NOW);
    target.exec(`PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}; PRAGMA user_version=39`);
    for (const table of ["workflow_runs", "run_operations", "run_operation_attempts", "run_checkpoints", ...(options.confirmation ? ["timeline_events"] : [])]) {
      for (const row of source.prepare(`SELECT * FROM ${table}`).all()) {
        const columns = Object.keys(row).filter((column) => column !== "transactions_json" && column !== "transactions_digest");
        target.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...columns.map((column) => row[column]));
      }
    }
    if(options.archive) {
      const plan={...VERSION_PLAN_ROW,state:"applied",version:2,appliedAt:VERSION_BUMP_APPLICATION.appliedAt};
      target.prepare("INSERT INTO version_plans VALUES (?,?,?)").run(plan.versionPlanId,canonicalJsonStringify(plan),plan.createdAt);
      const app=VERSION_BUMP_APPLICATION;
      target.prepare("INSERT INTO version_bump_applications VALUES (?,?,?,?,?,?,?,?)").run(app.applicationId,app.versionPlanId,app.scope.kind,app.targetVersion,app.appliedAppVersion,app.archivedRunIds.length,canonicalJsonStringify(app),app.appliedAt);
      const archive=ARCHIVED_RUN;
      target.prepare("INSERT INTO archived_runs VALUES (?,?,?,?,?,?,?,?,?)").run(archive.runId,archive.applicationId,archive.workflowId,archive.archivedIdentity.descriptorVersion,archive.archivedIdentity.contractFingerprint,archive.appVersion.state === "present" ? archive.appVersion.value : null,archive.contentDigest,canonicalJsonStringify(archive),archive.archivedAt);
    }
    for (const fixture of fixtures) {
      for (const value of [fixture.historicalCommit.ledgerOutbox, fixture.historicalCommit.terminalSpanOutbox]) {
        const outbox = AtomicOutboxRecordSchema.parse(value);
        target.prepare("INSERT INTO operation_outbox(record_key,write_intent_id,generation,kind,record_json,created_at) VALUES (?,?,?,?,?,?)")
          .run(outbox.outboxId, outbox.aggregate.writeIntentId, outbox.aggregate.generation, outbox.payload.kind, canonicalJsonStringify(outbox), outbox.createdAt);
      }
      if (options.files) {
        const ledger = fixture.commit.transaction; const date = ledger.confirmedAt.slice(0, 10); const key = `${ledger.system}:${date}`;
        const line = canonicalJsonStringify({ outboxId: fixture.outboxId, seq: 0, payload: ledger });
        const partition = { system: ledger.system, date, nextSeq: 1, lease: { state: "unleased" }, leaseGeneration: 1, version: 1, createdAt: HISTORY_NOW, updatedAt: HISTORY_NOW };
        const projection = { outboxId: fixture.outboxId, system: ledger.system, date, seq: 0, lineDigest: deriveLedgerLineDigest(line), projectedBy: "historical-projector", lifecycle: { state: "assigned" }, assignedAt: HISTORY_NOW };
        target.prepare("INSERT INTO ledger_partitions(record_key,system,ledger_date,next_seq,lease_generation,version,record_json,created_at) VALUES (?,?,?,1,1,1,?,?)")
          .run(key, ledger.system, date, canonicalJsonStringify(partition), HISTORY_NOW);
        target.prepare("INSERT INTO ledger_projections(record_key,partition_key,system,ledger_date,seq,state,line_digest,assigned_at,record_json,created_at) VALUES (?,?,?,?,0,'assigned',?,?,?,?)")
          .run(fixture.outboxId, key, ledger.system, date, projection.lineDigest, HISTORY_NOW, canonicalJsonStringify(projection), HISTORY_NOW);
        mkdirSync(join(root, "ledger"), { recursive: true });
        const file = join(root, "ledger", `${ledger.system}-${date}.jsonl`); writeFileSync(file, `${line}\n`); lines.push({ path: file, text: `${line}\n` });
      }
    }
  } finally { source.close(); target.close(); world.dispose(); }
  const input = { stateRoot: root, processLockRoot: join(root, "locks"), environmentFile: join(root, ".env"), plan: false };
  return { root, path, fixtures, lines, input, backup: () => backupStoppedAuthority(root, historyClock),
    upgrade: () => upgradeStorage(input, historyClock),
    open: () => AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "converted-history-test" }, historyClock),
    dispose() { rmSync(root, { recursive: true, force: true }); } };
}
