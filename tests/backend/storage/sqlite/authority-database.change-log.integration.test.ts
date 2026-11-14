import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, describe, it, vi } from "vitest";
import { z } from "zod";
import { CHANGE_LOG_MIGRATION } from "../../../../src/backend/storage/sqlite/authority-change-log.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { runRecordOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());
afterEach(() => { vi.restoreAllMocks(); });

/** A statement only the whole-store check prepares: its walk over every run row. */
const WHOLE_STORE_COVERAGE = "SELECT * FROM runs ORDER BY id";

function prepared(work: () => void): readonly string[] {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- the spy restores the original receiver with call().
  const original = DatabaseSync.prototype.prepare;
  const statements: string[] = [];
  const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (this: DatabaseSync, sql: string) {
    statements.push(sql);
    return original.call(this, sql);
  });
  try { work(); } finally { spy.mockRestore(); }
  return statements;
}

function refusal(work: () => void): string | undefined {
  try { work(); return undefined; } catch (error) {
    const messages: string[] = [];
    for (let current: unknown = error; current instanceof Error; current = current.cause) messages.push(current.message);
    return messages.join(" <- ");
  }
}

async function store(runs = 3) {
  const profile = await profileFixtures.create();
  const clock = manualClock(new Date("2026-11-13T12:00:00Z"));
  const open = (owner: string) => AuthorityDatabase.open({ path: profile.path, busyTimeoutMs: 500, migrationOwner: owner }, clock);
  const writer = open("change-log-writer");
  writer.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  for (let seed = 1; seed <= runs; seed += 1) writer.authority.runs.enqueue(runRecordOf({ seed, workflow: "person-lookup" }));
  const peer = open("change-log-peer");
  const runIds = z.array(z.object({ id: z.string() })).parse(new DatabaseSync(profile.path, { readOnly: true }).prepare("SELECT id FROM runs ORDER BY id").all()).map(({ id }) => id);
  /** One raw connection's committed edit, as another process writes it. */
  const raw = (sql: string, ...values: string[]) => {
    const database = new DatabaseSync(profile.path);
    try { database.exec("PRAGMA foreign_keys=OFF"); database.prepare(sql).run(...values); } finally { database.close(); }
  };
  return { profile, clock, writer, peer, runIds, raw, path: profile.path,
    readers: () => [writer, peer] as const,
    async close() { writer.close(); peer.close(); await profile.close(); } };
}

describe("authority change log reader", () => {
  it("refuses a peer's raw insert, in-place update and delete on the next read of every connection, and admits the repair", async () => {
    const f = await store();
    try {
      const [first, second] = f.runIds;
      assert.ok(first !== undefined && second !== undefined);
      for (const reader of f.readers()) assert.equal(refusal(() => reader.summaryWorkflows()), undefined);
      const edits = [
        { edit: () => { f.raw("UPDATE run_search SET workflow='forged' WHERE run_id=?", first); },
          repair: () => { f.raw("UPDATE run_search SET workflow='person-lookup' WHERE run_id=?", first); } },
        { edit: () => {
          const database = new DatabaseSync(f.path);
          try { database.exec(`PRAGMA foreign_keys=OFF; CREATE TEMP TABLE copy AS SELECT * FROM run_search WHERE run_id='${second}'; UPDATE copy SET run_id='00000000-0000-4000-8000-00000000abcd'; INSERT INTO main.run_search SELECT * FROM copy;`); }
          finally { database.close(); }
        }, repair: () => { f.raw("DELETE FROM run_search WHERE run_id='00000000-0000-4000-8000-00000000abcd'"); } },
      ];
      for (const { edit, repair } of edits) {
        edit();
        for (const reader of f.readers()) assert.match(refusal(() => reader.summaryWorkflows()) ?? "", /run-search-index-rebuild-required/u);
        repair();
        for (const reader of f.readers()) assert.equal(refusal(() => reader.summaryWorkflows()), undefined);
      }
      const database = new DatabaseSync(f.path);
      const row = z.record(z.string(), z.union([z.string(), z.number(), z.null()])).parse(database.prepare("SELECT * FROM run_search WHERE run_id=?").get(first));
      database.close();
      f.raw("DELETE FROM run_search WHERE run_id=?", first);
      for (const reader of f.readers()) assert.match(refusal(() => reader.summaryWorkflows()) ?? "", /run-search-source-coverage-invalid/u);
      const columns = Object.keys(row);
      const restore = new DatabaseSync(f.path);
      try { restore.exec("PRAGMA foreign_keys=OFF"); restore.prepare(`INSERT INTO run_search(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`).run(...Object.values(row)); } finally { restore.close(); }
      for (const reader of f.readers()) assert.equal(refusal(() => reader.summaryWorkflows()), undefined);
    } finally { await f.close(); }
  });

  it("refuses the next read after a capture trigger is dropped, keeps refusing a later raw edit, and attests a restored schema with the whole-store check", async () => {
    const f = await store();
    try {
      const [first] = f.runIds;
      assert.ok(first !== undefined);
      assert.equal(refusal(() => f.peer.summaryWorkflows()), undefined);
      f.raw("DROP TRIGGER run_search_change_update");
      assert.match(refusal(() => f.peer.summaryWorkflows()) ?? "", /run-search-index-rebuild-required <- .*schema/u);
      f.raw("UPDATE run_search SET workflow='forged' WHERE run_id=?", first);
      assert.match(refusal(() => f.peer.summaryWorkflows()) ?? "", /run-search-index-rebuild-required <- .*run_search/u);
      const trigger = CHANGE_LOG_MIGRATION.statements.find(statement => statement.startsWith("CREATE TRIGGER run_search_change_update "));
      assert.ok(trigger);
      f.raw(trigger);
      // The schema matches again, but the edit made while the trigger was gone left no entry: only the whole-store check finds it.
      let refused: string | undefined;
      assert.ok(prepared(() => { refused = refusal(() => f.peer.summaryWorkflows()); }).includes(WHOLE_STORE_COVERAGE));
      assert.match(refused ?? "", /run-search-index-rebuild-required/u);
      f.raw("UPDATE run_search SET workflow='person-lookup' WHERE run_id=?", first);
      assert.equal(refusal(() => f.peer.summaryWorkflows()), undefined);
    } finally { await f.close(); }
  });

  it("refuses every read after any other schema object changes while every row stays valid, until the schema matches again", async () => {
    const f = await store();
    try {
      assert.equal(refusal(() => f.peer.summaryWorkflows()), undefined);
      const database = new DatabaseSync(f.path, { readOnly: true });
      const guard = z.object({ sql: z.string() }).parse(database.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='command_audits_immutable'").get()).sql;
      database.close();
      f.raw("DROP TRIGGER command_audits_immutable");
      for (const reader of f.readers()) for (let attempt = 0; attempt < 2; attempt += 1) {
        assert.match(refusal(() => reader.summaryWorkflows()) ?? "", /run-search-index-rebuild-required <- authority-native-schema-shape-mismatch/u);
      }
      f.raw("CREATE TRIGGER extra_runtime_trigger BEFORE INSERT ON notifications BEGIN SELECT 1; END");
      f.raw(guard);
      assert.match(refusal(() => f.peer.summaryWorkflows()) ?? "", /authority-native-schema-shape-mismatch/u);
      f.raw("DROP TRIGGER extra_runtime_trigger");
      for (const reader of f.readers()) assert.equal(refusal(() => reader.summaryWorkflows()), undefined);
    } finally { await f.close(); }
  });

  it("runs the whole-store check when entries above the cursor are missing, and the scoped check otherwise", async () => {
    const f = await store();
    try {
      const [first] = f.runIds;
      assert.ok(first !== undefined);
      assert.equal(refusal(() => f.peer.summaryWorkflows()), undefined);
      f.raw("UPDATE run_search SET workflow=workflow WHERE run_id=?", first);
      assert.ok(!prepared(() => { f.peer.summaryWorkflows(); }).includes(WHOLE_STORE_COVERAGE));
      f.raw("UPDATE run_search SET workflow=workflow WHERE run_id=?", first);
      f.raw("DELETE FROM authority_changes WHERE seq=(SELECT max(seq) FROM authority_changes)");
      assert.ok(prepared(() => { f.peer.summaryWorkflows(); }).includes(WHOLE_STORE_COVERAGE));
      f.raw("UPDATE run_search SET workflow=workflow WHERE run_id=?", first);
      assert.ok(!prepared(() => { f.peer.summaryWorkflows(); }).includes(WHOLE_STORE_COVERAGE));
    } finally { await f.close(); }
  });

  it("prunes all but the newest 100,000 entries at most once a minute inside its own writes; a reader below the floor runs the whole-store check", async () => {
    const f = await store();
    try {
      assert.equal(refusal(() => f.peer.summaryWorkflows()), undefined);
      const floor = () => {
        const database = new DatabaseSync(f.path, { readOnly: true });
        try { return z.object({ low: z.number(), high: z.number() }).parse(database.prepare("SELECT min(seq) AS low, max(seq) AS high FROM authority_changes").get()); }
        finally { database.close(); }
      };
      f.raw(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<100010)
        INSERT INTO authority_changes(table_name,row_key,op,keys_json) SELECT 'notifications','["absent"]','update','[]' FROM n`);
      // The seeding writes pruned at this instant already; the next prune is due a minute later.
      f.clock.advanceWall(60_000);
      f.writer.authority.runs.enqueue(runRecordOf({ seed: 50, workflow: "person-lookup" }));
      const pruned = floor();
      assert.equal(pruned.high - pruned.low + 1, 100_000);
      f.raw("INSERT INTO authority_changes(table_name,row_key,op,keys_json) VALUES('notifications','[\"absent\"]','update','[]')");
      f.clock.advanceWall(59_000);
      f.writer.authority.runs.enqueue(runRecordOf({ seed: 51, workflow: "person-lookup" }));
      assert.equal(floor().low, pruned.low);
      f.clock.advanceWall(1_000);
      f.writer.authority.runs.enqueue(runRecordOf({ seed: 52, workflow: "person-lookup" }));
      const later = floor();
      assert.equal(later.high - later.low + 1, 100_000);
      assert.ok(prepared(() => { f.peer.summaryWorkflows(); }).includes(WHOLE_STORE_COVERAGE));
      assert.equal(refusal(() => f.writer.summaryWorkflows()), undefined);
    } finally { await f.close(); }
  });
});
