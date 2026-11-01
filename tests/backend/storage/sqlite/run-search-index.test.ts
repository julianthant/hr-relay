import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,expect,it,vi } from "vitest";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { runRecordColumns,runRecordFromRow } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { createRunSearchIndex,runSearchIndexFromRow } from "../../../../src/backend/storage/sqlite/run-search-index.js";
import { RunSearchPublicationSchema } from "../../../../src/models/dashboard/search-index.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture() {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false }); databases.push(db);
  for (const migration of SQLITE_MIGRATIONS) for (const sql of migration.statements) db.exec(sql);
  db.prepare("INSERT INTO database_states(id,schema_version,authority_generation,updated_at,search_generation,search_state,installation_id,profile_id) VALUES(1,1,0,?,0,'ready',?,?)")
    .run(QUEUED_RUN.createdAt, "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222");
  const index = createRunSearchIndex(db); index.installTracking();
  index.register([{ workflow: QUEUED_RUN.envelope.workflow, version: 1, contractFingerprint: QUEUED_RUN.envelope.contractFingerprint, subjectProjection: null }], QUEUED_RUN.createdAt);
  const add = (sequence: number, date: string) => {
    const row = runRecordColumns(RunRecordSchema.parse({ ...QUEUED_RUN,
      envelope: { ...QUEUED_RUN.envelope, runId: `10000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`, itemId: `20000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`, enqueuedAt: date },
      createdAt: date, updatedAt: date }));
    db.prepare(`INSERT INTO runs (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
    return row.id;
  };
  const publish = () => {
    db.prepare("UPDATE database_states SET authority_generation=authority_generation+1,search_generation=NULL,search_state='invalid'").run();
    index.publishChanges(1, QUEUED_RUN.createdAt, RunSearchPublicationSchema.parse({ state: "published", sourceGeneration: 0, afterRun: null, rowCount: 0 }));
  };
  return { db, index, add, publish };
}
const query = { q: "", scope: "all", facets: {}, limit: 1 };
describe("native one-row search", () => {
  it.each([0, 1000, 10000])("does not rescan %i unrelated audits for a pure heartbeat", population => {
    const f = fixture(); const id = f.add(1, "2026-10-01T12:00:00.000Z"); f.publish();
    const insert = f.db.prepare("INSERT INTO command_audits(id,command_id,payload_json,created_at) VALUES(?,?,?,?)");
    f.db.exec("BEGIN");
    for (let ordinal = 0; ordinal < population; ordinal++) insert.run(`audit-${String(ordinal)}`, `command-${String(ordinal)}`,
      JSON.stringify({ request: { family: "lifecycle" }, result: { state: "applied", affectedTargets: [{ family: "run", runId: id }] } }), QUEUED_RUN.createdAt);
    f.db.exec("COMMIT");
    const prepare = vi.spyOn(f.db, "prepare");
    f.db.prepare("UPDATE runs SET version=version+1,lifecycle_json=json_set(lifecycle_json,'$.version',version+1) WHERE id=?").run(id);
    f.db.prepare("UPDATE database_states SET authority_generation=2,search_generation=NULL,search_state='invalid'").run();
    f.index.publishChanges(2, QUEUED_RUN.createdAt, RunSearchPublicationSchema.parse({ state: "published", sourceGeneration: 1, afterRun: null, rowCount: 1 }));
    expect(prepare.mock.calls.filter(([sql]) => sql.includes("FROM command_audits"))).toHaveLength(0);
    expect(f.index.search(query, 2).rows[0]?.metadata.actor).toEqual({ state: "unavailable", reason: "not-recorded" });
  });
  it("invalidates actor provenance for contributing audit insert, update and deletion including old bindings", () => {
    const f = fixture(); const id = f.add(1, "2026-10-01T12:00:00.000Z"), other = f.add(2, "2026-10-01T13:00:00.000Z"); f.publish();
    const payload = (runId: string) => JSON.stringify({ request: { family: "start" }, result: { state: "applied", affectedTargets: [{ family: "run", runId }] } });
    const dirty = () => f.db.prepare("SELECT run_id FROM search_actor_dirty ORDER BY run_id").all();
    f.db.prepare("INSERT INTO command_audits(id,command_id,payload_json,created_at) VALUES('audit','command',?,?)").run(payload(id), QUEUED_RUN.createdAt);
    expect(dirty()).toEqual([{ run_id: id }]);
    f.db.exec("DELETE FROM search_actor_dirty; DELETE FROM search_dirty");
    f.db.exec("DROP TRIGGER command_audits_immutable");
    f.db.prepare("UPDATE command_audits SET payload_json=? WHERE id='audit'").run(payload(other));
    expect(dirty()).toEqual([{ run_id: id }, { run_id: other }]);
    expect(() => f.index.publishChanges(2, QUEUED_RUN.createdAt, RunSearchPublicationSchema.parse({ state: "published", sourceGeneration: 1, afterRun: null, rowCount: 2 }))).toThrow();
    f.db.exec("DELETE FROM search_actor_dirty; DELETE FROM search_dirty; DROP TRIGGER command_audits_retained; DELETE FROM command_audits WHERE id='audit'");
    expect(dirty()).toEqual([{ run_id: other }]);
  });

  it("freezes declaration identity and serves literal ranked results with full count and keyset order", () => {
    const f = fixture(); const old = f.add(1, "2026-10-01T12:00:00.000Z"), recent = f.add(2, "2026-10-02T12:00:00.000Z"); f.publish();
    const page = f.index.search(query, 1);
    expect(page.totalMatches).toBe(2);
    expect(page.rows.map(row => row.record.envelope.runId)).toEqual([recent]);
    expect(f.index.search({ ...query, after: { matchRank: 0, enqueuedAt: page.rows[0]?.record.envelope.enqueuedAt, runId: recent } }, 1).rows.map(row => row.record.envelope.runId)).toEqual([old]);
    expect(f.index.search({ ...query, q: "%" }, 1).totalMatches).toBe(0);
    expect(f.index.search({ ...query, q: "_" }, 1).totalMatches).toBe(0);
    expect(f.index.search({ ...query, q: recent, scope: "run" }, 1).rows[0]?.record.envelope.runId).toBe(recent);
    expect(f.index.search({ ...query, facets: { from: "2026-10-02", to: "2026-10-02" } }, 1).totalMatches).toBe(1);
    expect(f.db.prepare("SELECT declaration_json FROM run_search").all()).toHaveLength(2);
    expect(f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'run_search%'").all()).toEqual([{ name: "run_search" }]);
  });

  it("preserves the frozen declaration when rebuilding after the current registry is unavailable", () => {
    const f = fixture(); f.add(1, "2026-10-01T12:00:00.000Z"); f.publish();
    const before = f.db.prepare("SELECT declaration_json,actor_source_json,created_at FROM run_search").get();
    f.db.exec("DELETE FROM search_declarations; UPDATE database_states SET search_state='invalid',search_generation=NULL");
    expect(f.index.rebuild({ restart: true, limit: 1 }, 1, "2026-10-10T12:00:00.000Z").state).toBe("published");
    expect(f.db.prepare("SELECT declaration_json,actor_source_json,created_at FROM run_search").get()).toEqual(before);
    expect(f.index.search(query, 1).totalMatches).toBe(1);
  });

  it("rejects corrupt search scalars and admits retained identity while a stale projection is unavailable", () => {
    const f = fixture(); const id = f.add(1, "2026-10-01T12:00:00.000Z"); f.publish();
    const run = runRecordFromRow(f.db.prepare("SELECT * FROM runs WHERE id=?").get(id));
    const row = f.db.prepare("SELECT * FROM run_search WHERE run_id=?").get(id);
    expect(() => runSearchIndexFromRow({ ...row,actor_id:"forged-actor" },run)).toThrow(/corrupt/u);
    expect(() => runSearchIndexFromRow({ ...row,systems_json:'["kuali"]' },run)).toThrow(/corrupt/u);
    expect(() => runSearchIndexFromRow(row,RunRecordSchema.parse({ ...run,version:run.version+1 }))).toThrow(/corrupt/u);
    expect(runSearchIndexFromRow(row,RunRecordSchema.parse({ ...run,version:run.version+1 }),false).sourceVersion).toBe(run.version);
    f.db.exec("UPDATE database_states SET search_state='invalid',search_generation=NULL");
    expect(() => f.index.search(query,1)).toThrow(/rebuild-required/u);
  });

  it("keeps invalid generations unavailable until a complete bounded rebuild publishes", () => {
    const f = fixture(); f.add(1, "2026-10-01T12:00:00.000Z"); f.add(2, "2026-10-02T12:00:00.000Z");
    f.db.exec("UPDATE database_states SET search_state='invalid',search_generation=NULL");
    expect(() => f.index.search(query, 0)).toThrow(/rebuild-required/u);
    expect(f.index.rebuild({ restart: true, limit: 1 }, 0, QUEUED_RUN.createdAt).state).toBe("building");
    expect(() => f.index.search(query, 0)).toThrow(/rebuild-required/u);
    expect(f.index.rebuild({ limit: 1 }, 0, QUEUED_RUN.createdAt).state).toBe("published");
    expect(f.index.search(query, 0).totalMatches).toBe(2);
  });
});
