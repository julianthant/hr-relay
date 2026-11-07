import type { DatabaseSync } from "node:sqlite";
import { settlePredecessorRunEvidence } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { WORKER_CUSTODY_CONVERSION_ID, WORKER_CUSTODY_MIGRATION_STATEMENTS, WORKER_CUSTODY_SCAN_ID, WORKER_CUSTODY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { assertWorkerCustodyConverted, convertWorkerCustody, execMigrationStatement } from "../../../../src/backend/storage/sqlite/worker-custody-migration.js";

type CaptureFile = Parameters<typeof convertWorkerCustody>[2];

/** Runs the custody statements and their markers and sets the custody schema version in one transaction, as the stopped upgrader does. */
export function migrateWorkerCustody(database: DatabaseSync, now: string, captureFile: CaptureFile = () => { throw new Error("artifact-unexpected"); }): void {
  database.exec("BEGIN EXCLUSIVE");
  try {
    for (const statement of WORKER_CUSTODY_MIGRATION_STATEMENTS) {
      if (statement.includes(WORKER_CUSTODY_CONVERSION_ID)) convertWorkerCustody(database, now, captureFile, (record, run) => settlePredecessorRunEvidence(database, record, run));
      execMigrationStatement(database, statement);
      if (statement.includes(WORKER_CUSTODY_SCAN_ID)) assertWorkerCustodyConverted(database);
    }
    database.exec(`UPDATE database_states SET schema_version=${String(WORKER_CUSTODY_SCHEMA_VERSION)} WHERE id=1; PRAGMA user_version=${String(WORKER_CUSTODY_SCHEMA_VERSION)}`);
    database.exec("COMMIT");
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}
