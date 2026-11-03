import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { DEBUG_LEVEL_MIGRATION, upgradeDebugLevelRow } from "../../../../src/backend/storage/sqlite/debug-level-migration.js";
import { timelineEventFromRow } from "../../../../src/backend/storage/sqlite/timeline-repository.js";

describe("native debug level migration", () => {
  it("preserves retained history and restores immutability after adding levels", () => {
    const database = new DatabaseSync(":memory:");
    try {
      for (const migration of SQLITE_MIGRATIONS.filter(migration => migration.version < 19)) {
        for (const statement of migration.statements) database.exec(statement);
      }
      const at = "2026-11-03T00:00:00.000Z";
      for (const [index, phase] of ["failed", "reset", "acquired"].entries()) {
        const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, "0")}`;
        const record = { schemaVersion: 1, eventId: id, cursor: index + 1, scope: { kind: "transport", connectionId: "local" },
          occurredAt: at, recordedAt: at, retentionDate: "2026-11-02", source: { kind: "native" },
          payload: { kind: "debug", event: { category: "http", phase, correlationId: id, build: "retained", pid: 1, pinned: false } } };
        database.prepare("INSERT INTO timeline_events(cursor,id,kind,occurred_at,recorded_at,retention_date,retention_class,payload_json) VALUES(?,?,'debug',?,?,'2026-11-02','ordinary',?)")
          .run(index + 1, id, at, at, JSON.stringify(record));
      }
      const before = database.prepare("SELECT * FROM timeline_events ORDER BY cursor").all();
      const expected = before.map(row => timelineEventFromRow(upgradeDebugLevelRow(row)));
      for (const statement of DEBUG_LEVEL_MIGRATION.statements) database.exec(statement);
      const records = database.prepare("SELECT * FROM timeline_events ORDER BY cursor").all().map(timelineEventFromRow);
      assert.deepEqual(records, expected);
      assert.deepEqual(records.map(record => record.payload.kind === "debug" ? record.payload.event.level : undefined), ["error", "warn", "info"]);
      assert.throws(() => database.exec("UPDATE timeline_events SET payload_json='{}'"), /timeline-history-immutable/u);
    } finally { database.close(); }
  });
});
