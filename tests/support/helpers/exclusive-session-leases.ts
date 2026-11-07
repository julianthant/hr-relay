import { DatabaseSync } from "node:sqlite";
import { createExclusiveSessionLeaseRepository, EXCLUSIVE_SESSION_LEASE_MIGRATION } from "../../../src/backend/storage/sqlite/exclusive-session-leases.js";

export function exclusiveLeaseFixture(path = ":memory:", initialize = true) {
  const database = new DatabaseSync(path);
  database.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000");
  if (initialize) {
    database.exec("CREATE TABLE worker_slots(id TEXT PRIMARY KEY,retired_at TEXT); CREATE TABLE worker_leases(worker_id TEXT,lease_generation INTEGER,state TEXT)");
    for (const worker of ["onbase-worker-1", "onbase-worker-2"]) {
      database.prepare("INSERT INTO worker_slots VALUES(?,NULL)").run(worker);
      database.prepare("INSERT INTO worker_leases VALUES(?,1,'idle')").run(worker);
    }
    for (const statement of EXCLUSIVE_SESSION_LEASE_MIGRATION.statements) database.exec(statement);
  }
  const repository = createExclusiveSessionLeaseRepository({ database, read: work => work(), mutate: work => {
    database.exec("BEGIN IMMEDIATE");
    try { const result = work().result; database.exec("COMMIT"); return result; }
    catch (error) { database.exec("ROLLBACK"); throw error; }
  } });
  return { database, repository };
}
