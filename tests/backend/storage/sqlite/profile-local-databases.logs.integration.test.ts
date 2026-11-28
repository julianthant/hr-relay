import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";
import { openLogDatabases } from "../../../../src/backend/storage/sqlite/profile-local-databases.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { openAuthorityHarness } from "../../../support/helpers/phase1f-executor-harness.js";

it("opens independently versioned log files and copies the retained log rows with their state cursors", async () => {
  const { database, clock, path, stateRoot, dispose } = await openAuthorityHarness();
  try {
    const repository = database.authority.timelineEvents;
    const note = createNoteTimelineWriter({ repository, clock });
    note.emitNote({ workflow: "person-lookup", address: { workerId: "person-lookup-worker-1", spanPath: "worker" },
      level: "step", message: "Verified benchmark note" });
    note.emitNote({ workflow: "person-lookup", address: { workerId: "person-lookup-worker-1", spanPath: "worker" },
      level: "debug", message: "Excluded benchmark note" });
    createDebugEventWriter({ repository, clock, build: "test" }).emit({
      category: "worker", phase: "settled", area: "log-test", code: "LOG_TEST", correlationId: "be50ab72-e0ca-4e76-8a58-43b30049a360",
    });

    const logs = openLogDatabases(path, stateRoot);
    try {
      logs.reconcile();
      logs.reconcile();
      assert.deepEqual(logs.pragmas(), [
        { journalMode: "wal", synchronous: 1, secureDelete: 1, userVersion: 1 },
        { journalMode: "wal", synchronous: 1, secureDelete: 1, userVersion: 1 },
      ]);
      assert.equal(database.inspectSchema().pragmas.synchronous, 2);
      using state = new DatabaseSync(path, { readOnly: true });
      using timeline = new DatabaseSync(join(stateRoot, "timeline.db"), { readOnly: true });
      using dashboard = new DatabaseSync(join(stateRoot, "dashboard.db"), { readOnly: true });
      for (const [sidecar, table] of [[timeline, "timeline_events"], [dashboard, "debug_events"]] as const) {
        assert.deepEqual(sidecar.prepare(`SELECT * FROM ${table} ORDER BY cursor`).all(),
          state.prepare(`SELECT * FROM ${table} ORDER BY cursor`).all());
      }
      assert.equal(timeline.prepare("SELECT rowid FROM timeline_notes_fts WHERE timeline_notes_fts MATCH 'verified'").all().length, 1);
      assert.equal(timeline.prepare("SELECT rowid FROM timeline_notes_fts WHERE timeline_notes_fts MATCH 'excluded'").all().length, 0);
      repository.pruneBefore("2026-12-01");
      repository.pruneDebugBefore("2026-12-01");
      logs.reconcile();
      assert.equal(timeline.prepare("SELECT rowid FROM timeline_notes_fts").all().length, 0);
      assert.equal(dashboard.prepare("SELECT id FROM debug_events").all().length, 0);
    } finally { logs.close(); }
  } finally { await dispose(); }
});
