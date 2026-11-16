import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { exclusiveLeaseFixture } from "../../../support/helpers/exclusive-session-leases.js";
import { SQLITE_MIGRATIONS, migrationTableNames, auditMigrationTableCoverage } from "../../../../src/backend/storage/sqlite/migrations.js";
import { DatabaseSync } from "node:sqlite";
import { BrowserSessionIdSchema, PositiveIntSchema } from "../../../../src/rules/identity/ids.js";

const first = { identityKey: "a".repeat(64), workerId: "onbase-worker-1", sessionId: "11111111-1111-4111-8111-111111111111", now: "2026-11-02T12:00:00.000Z" };
const second = { ...first, workerId: "onbase-worker-2", sessionId: "22222222-2222-4222-8222-222222222222" };

describe("durable exclusive identity-session leases", () => {
  it("serializes handles sharing an identity and advances only after exact-owner release", () => {
    const a = exclusiveLeaseFixture();
    try {
      const owned = a.repository.acquire(first); assert.equal(owned.state, "acquired");
      assert.equal(a.repository.acquire(second).state, "held");
      assert.equal(a.repository.acquire(first).state, "held", "same worker cannot acquire a second session");
      assert.throws(() => a.repository.release({ ...owned.lease, sessionId: BrowserSessionIdSchema.parse(second.sessionId) }, first.now), /release-refused/u);
      assert.throws(() => a.repository.release({ ...owned.lease, generation: PositiveIntSchema.parse(2) }, first.now), /release-refused/u);
      a.repository.release(owned.lease, first.now);
      const next = a.repository.acquire(second); assert.equal(next.state, "acquired"); assert.equal(next.lease.generation, 2);
      assert.throws(() => a.repository.release(owned.lease, first.now), /release-refused/u);
      assert.equal(a.repository.get(first.identityKey)?.sessionId, second.sessionId);
    } finally { a.database.close(); }
  });

  it("retains ownership across connection closure, time passage and worker retirement", () => {
    const root = mkdtempSync(join(tmpdir(), "onbase-lease-")), path = join(root, "state.db");
    try {
      const a = exclusiveLeaseFixture(path), owned = a.repository.acquire(first);
      const other = exclusiveLeaseFixture(path, false);
      try { assert.equal(other.repository.acquire(second).state, "held"); } finally { other.database.close(); }
      a.database.prepare("UPDATE runs SET state='terminal' WHERE owner_worker_id=?").run(first.workerId);
      a.database.prepare("UPDATE worker_slots SET retired_at=? WHERE id=?").run(first.now, first.workerId);
      a.database.close();
      const reopened = exclusiveLeaseFixture(path, false);
      try {
        assert.equal(reopened.repository.acquire({ ...second, now: "2030-11-02T12:00:00.000Z" }).state, "held");
        assert.deepEqual(reopened.repository.get(first.identityKey), owned.lease);
        assert.throws(() => reopened.database.exec("DELETE FROM exclusive_session_leases"), /retained/u);
        assert.throws(() => reopened.database.exec("UPDATE exclusive_session_leases SET generation=generation+1"), /transition-refused/u);
      } finally { reopened.database.close(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("allows independent identities but refuses a new lease for a worker with no claim or a missing worker", () => {
    const { database, repository } = exclusiveLeaseFixture();
    try {
      assert.equal(repository.acquire(first).state, "acquired");
      const other = repository.acquire({ ...second, identityKey: "b".repeat(64) });
      assert.equal(other.state, "acquired"); assert.equal(other.lease.workerLeaseGeneration, 2, "the fence is the held run's claim generation");
      database.prepare("UPDATE runs SET state='terminal' WHERE owner_worker_id=?").run(second.workerId);
      assert.throws(() => repository.acquire({ ...second, identityKey: "c".repeat(64) }), /owner-unproved/u);
      assert.throws(() => repository.acquire({ ...second, identityKey: "c".repeat(64), workerId: "unknown-worker" }), /owner-unproved/u);
    } finally { database.close(); }
  });

  it("admits an idle Reopen only for the same unretired worker replacing its own released session, keeping its claim generation", () => {
    const { database, repository } = exclusiveLeaseFixture();
    try {
      const owned = repository.acquire(first); assert.equal(owned.state, "acquired");
      database.prepare("UPDATE runs SET state='terminal'").run();
      const replacement = { ...first, sessionId: "33333333-3333-4333-8333-333333333333", replacesSessionId: first.sessionId };
      assert.equal(repository.acquire(replacement).state, "held", "a held lease is never replaced");
      repository.release(owned.lease, first.now);
      assert.throws(() => repository.acquire({ ...replacement, replacesSessionId: undefined }), /owner-unproved/u);
      assert.throws(() => repository.acquire({ ...replacement, replacesSessionId: second.sessionId }), /owner-unproved/u, "only the released session's id authenticates");
      assert.throws(() => repository.acquire({ ...replacement, workerId: second.workerId, sessionId: second.sessionId }), /owner-unproved/u, "another worker cannot inherit it");
      database.prepare("UPDATE worker_slots SET retired_at=? WHERE id=?").run(first.now, first.workerId);
      assert.throws(() => repository.acquire(replacement), /owner-unproved/u, "a retired slot cannot reopen");
      database.prepare("UPDATE worker_slots SET retired_at=NULL WHERE id=?").run(first.workerId);
      const reopened = repository.acquire(replacement);
      assert.equal(reopened.state, "acquired");
      assert.deepEqual([reopened.lease.generation, reopened.lease.workerLeaseGeneration, reopened.lease.sessionId], [2, owned.lease.workerLeaseGeneration, replacement.sessionId]);
    } finally { database.close(); }
  });

  it("adds only its table and triggers at fourteen while retaining all thirteen-layout rows", () => {
    const database = new DatabaseSync(":memory:");
    try {
      for (const migration of SQLITE_MIGRATIONS.filter(value => value.version <= 13)) for (const statement of migration.statements) database.exec(statement);
      const prior = migrationTableNames(13).map(table => ({ table, rows: database.prepare(`SELECT * FROM ${table}`).all() }));
      const migration = SQLITE_MIGRATIONS.find(value => value.version === 14); assert.ok(migration);
      for (const statement of migration.statements) database.exec(statement);
      assert.deepEqual(prior.map(({ table }) => ({ table, rows: database.prepare(`SELECT * FROM ${table}`).all() })), prior);
      assert.deepEqual(migrationTableNames(14).filter(table => !migrationTableNames(13).includes(table)), ["exclusive_session_leases"]);
      assert.deepEqual(auditMigrationTableCoverage(), []);
    } finally { database.close(); }
  });
});
