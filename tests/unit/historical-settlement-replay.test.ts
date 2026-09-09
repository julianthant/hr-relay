import { ActorIdSchema } from "../../src/domain/ids.js";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { z } from "zod";
import { RunRecordService, workerRunLifecyclePort } from "../../src/core/run-record-service.js";
import { executeSequencedWriteCommit } from "../../src/core/write-sequencer.js";
import { manualClock } from "../../src/domain/clock.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/authority-database.js";
import { AUTHORITY_APPLICATION_ID, SQLITE_MIGRATIONS } from "../../src/infra/sqlite/migrations.js";
import { backupStoppedAuthority, upgradeStorage } from "../../src/server/storage/upgrade.js";
import { currentAtomicWriteFixture } from "./helpers/timeline-write-fixture.js";
import { SequencedWriteCommitInputSchema } from "../../src/infra/sqlite/write-commit-contracts.js";

it("replays an actual released settlement after conversion without rewriting its journal or accepting changed evidence", async () => {
  // Captured from the pinned baseline after a successful settlement and exact replay.
  const fixture = z.object({ bundle: z.object({ run: z.unknown(), checkpoint: z.unknown(), commit: z.unknown() }),
    transition: z.object({ kind: z.literal("advance-running"), claim: z.object({ workerId: z.string(), claimGeneration: z.number() }), claimedAt: z.string() }),
    tables: z.record(z.string(), z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()])))),
  }).parse(JSON.parse(readFileSync(new URL("../fixtures/historical-settlement-replay.json", import.meta.url), "utf8")));
  const root = mkdtempSync(join(tmpdir(), "historical-settlement-")); const path = join(root, "state.db");
  const bundle = SequencedWriteCommitInputSchema.parse({ ...fixture.bundle, commit: currentAtomicWriteFixture(fixture.bundle.commit) });
  const clock = manualClock(new Date(bundle.commit.confirmedAt));
  const raw = new DatabaseSync(path);
  try {
    for (const migration of SQLITE_MIGRATIONS.filter((entry) => entry.version <= 39)) for (const statement of migration.statements) raw.exec(statement);
    raw.prepare("INSERT INTO database_state(singleton_id,schema_version,authority_generation,updated_at) VALUES (1,39,7,?)").run(bundle.commit.confirmedAt);
    raw.exec(`PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}; PRAGMA user_version=39`);
    for (const [table, rows] of Object.entries(fixture.tables)) for (const row of rows) {
      const columns = Object.keys(row);
      raw.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...Object.values(row));
    }
  } finally { raw.close(); }
  const journal = () => {
    const reader = new DatabaseSync(path, { readOnly: true });
    try { return reader.prepare("SELECT record_json FROM commands WHERE family='run-lifecycle' ORDER BY record_key").all(); } finally { reader.close(); }
  };
  try {
    const before = journal(); assert.equal(before.length, 3);
    await backupStoppedAuthority(root, clock);
    assert.equal((await upgradeStorage({ stateRoot: root, processLockRoot: join(root, "locks"), environmentFile: join(root, ".env"), plan: false }, clock)).state, "converted");
    assert.deepEqual(journal(), before);
    const db = AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "historical-replay-test" }, clock);
    try {
      const service = new RunRecordService({ database: db, clock, ids: { uuid: () => { throw new Error("replay must not mint ids"); } }, publishQueued: () => { throw new Error("replay must not enqueue"); } });
      const transition = { ...fixture.transition, claim: bundle.run.claim!, port: workerRunLifecyclePort(service) };
      const meta = db.getMeta(); const run = db.authority.runs.get(bundle.run.runId);
      assert.deepEqual(executeSequencedWriteCommit(db, bundle, transition).run, run);
      assert.deepEqual(executeSequencedWriteCommit(db, bundle, transition).report.transaction, bundle.commit.transaction);
      const changed = structuredClone(bundle); changed.commit.transaction.operator = ActorIdSchema.parse("different-operator");
      assert.throws(() => executeSequencedWriteCommit(db, changed, transition), /historical evidence/u);
      assert.throws(() => executeSequencedWriteCommit(db, { ...bundle, run: { ...bundle.run, expectedVersion: bundle.run.expectedVersion + 1 } }, transition), /replay|lifecycle/u);
      assert.deepEqual(db.getMeta(), meta); assert.deepEqual(journal(), before);
    } finally { db.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
