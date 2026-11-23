import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { applyAuthorityMigrationsAfter } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, SQLITE_MIGRATIONS, auditMigrationTableCoverage, migrationTableNames } from "../../../../src/backend/storage/sqlite/migrations.js";
import { DEBUG_EVENTS_MIGRATION, createTimelineRepository } from "../../../../src/backend/storage/sqlite/timeline-repository.js";
import { TimelineEventRecordSchema } from "../../../../src/models/events/timeline.js";
import { WorkerIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { restoreSchema38DebugEvents } from "../../../support/fixtures/storage/historical-run-schema.js";

const CAPTURE = { now: "2026-11-23T00:00:00.000Z", captureFile: () => { throw new Error("no capture expected"); } };
const AT = new Date("2026-11-20T12:00:00.000Z");
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach(database => database.close()));

function currentStore() {
  const database = new DatabaseSync(":memory:"); databases.push(database);
  database.exec("PRAGMA foreign_keys=ON");
  for (const migration of SQLITE_MIGRATIONS) for (const statement of migration.statements) database.exec(statement);
  database.exec(`PRAGMA user_version=${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
  const repository = createTimelineRepository({ database, read: work => work(), assertOwner: () => {}, mutate: work => work().result });
  return { database, repository };
}

/** Debug entries between notes, pinned and not, as a schema-38 store held them in its timeline. */
function seed(repository: ReturnType<typeof currentStore>["repository"]) {
  const clock = manualClock(AT);
  const debug = createDebugEventWriter({ repository, clock, build: "test" });
  const notes = createNoteTimelineWriter({ repository, clock, pid: 1 });
  for (let index = 0; index < 6; index++) {
    debug.emit({ category: index % 2 === 0 ? "http" : "sse", phase: "settled", correlationId: `request-${String(index)}`, pinned: index === 3 },
      index === 4 ? { kind: "worker", workerId: WorkerIdSchema.parse("worker-1") } : undefined);
    notes.emitNote({ workflow: "person-lookup", address: { workerId: "worker-1", spanPath: "worker-1" }, level: "step", message: `step ${String(index)}` });
  }
}

/** The schema-38 timeline as stored, read without the current reader, which refuses a debug row there. */
const storedTimeline = (database: DatabaseSync) => database.prepare("SELECT payload_json FROM timeline_events ORDER BY cursor").all()
  .map(row => TimelineEventRecordSchema.parse(JSON.parse(z.object({ payload_json: z.string() }).parse(row).payload_json)));
const count = (database: DatabaseSync, sql: string) => z.object({ n: z.number() }).parse(database.prepare(`SELECT count(*) AS n FROM ${sql}`).get()).n;
const sequence = (database: DatabaseSync, table: string) => z.object({ seq: z.number() }).optional()
  .parse(database.prepare("SELECT seq FROM sqlite_sequence WHERE name=?").get(table))?.seq ?? 0;

describe("debug event migration 39", () => {
  it("is the current schema and adds only the debug table", () => {
    assert.equal(DEBUG_EVENTS_MIGRATION.version, 39);
    assert.equal(CURRENT_AUTHORITY_SCHEMA_VERSION, 39);
    assert.deepEqual(migrationTableNames(39).filter(table => !migrationTableNames(38).includes(table)), ["debug_events"]);
    assert.deepEqual(auditMigrationTableCoverage(), []);
  });

  it("moves every debug row out of the timeline with its cursor, leaving every other reader's rows and no change entries", () => {
    const { database, repository } = currentStore();
    seed(repository);
    restoreSchema38DebugEvents(database);
    const timeline = storedTimeline(database);
    const debug = timeline.filter(record => record.payload.kind === "debug");
    const others = timeline.filter(record => record.payload.kind !== "debug");
    assert.deepEqual([debug.length, others.length], [6, 6]);
    const changes = { entries: count(database, "authority_changes"), high: sequence(database, "authority_changes") };
    const timelineHigh = sequence(database, "timeline_events");

    database.exec("BEGIN");
    applyAuthorityMigrationsAfter(database, 38, CAPTURE);
    database.exec("COMMIT");

    assert.equal(count(database, "debug_events"), debug.length);
    assert.equal(count(database, "timeline_events"), timeline.length - debug.length);
    assert.deepEqual(repository.page({ limit: 1000 }), others);
    assert.deepEqual(repository.debugPage({ limit: 1000 }), debug);
    assert.equal(count(database, "debug_events WHERE pinned=1"), 1);
    assert.equal(repository.highWaterMark(), timelineHigh);
    assert.equal(repository.debugHighWaterMark(), Math.max(...debug.map(record => record.cursor)));
    // The move adds no change entry and drops the entries that named the moved rows.
    assert.equal(sequence(database, "authority_changes"), changes.high);
    assert.equal(count(database, "authority_changes"), changes.entries - debug.length);
    assert.equal(count(database, `authority_changes WHERE table_name='timeline_events'
      AND json_extract(row_key,'$[0]') IN (SELECT cursor FROM debug_events)`), 0);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  });

  it("keeps debug entries immutable and the timeline's protected rows guarded after the move", () => {
    const { database, repository } = currentStore();
    seed(repository);
    assert.throws(() => database.exec("UPDATE debug_events SET payload_json=payload_json"), /debug-event-immutable/u);
    database.exec(`INSERT INTO timeline_events(id,workflow,run_id,worker_id,kind,occurred_at,recorded_at,retention_date,retention_class,payload_json)
      SELECT id||'-guard',workflow,run_id,worker_id,'note',occurred_at,recorded_at,retention_date,'protected',payload_json FROM timeline_events LIMIT 1`);
    assert.throws(() => database.exec("DELETE FROM timeline_events WHERE retention_class='protected'"), /protected-timeline-owner-deletion-required/u);
  });
});
