import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";

export function restorePreReadingArtifactRetention(database: DatabaseSync): void {
  const trigger = SQLITE_MIGRATIONS[0].statements.join("\n").match(/CREATE TRIGGER artifacts_retained[\s\S]*?END;/u)?.[0];
  assert.ok(trigger);
  database.exec("DROP TRIGGER artifacts_retained");
  database.exec(trigger);
}
