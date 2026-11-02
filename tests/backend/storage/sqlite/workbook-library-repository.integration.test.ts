import { unexpectedWorkbookSync } from "../../../support/helpers/backend/workbook-sync.js";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createWorkbookLibraryRepository, hasOnlyInitialWorkbookType, WORKBOOK_LIBRARY_MIGRATION, WORKBOOK_MASTER_MIGRATION } from "../../../../src/backend/storage/sqlite/workbook-library-repository.js";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { createWorkbookLibraryService } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

it("adds workbook storage to the baseline without changing existing schema or records, and persists after reopen", () => {
  const root = mkdtempSync(join(tmpdir(), "relay-workbook-")), path = join(root, "authority.sqlite");
  let database = new DatabaseSync(path);
  try {
    for (const statement of SQLITE_MIGRATIONS[0].statements) database.exec(statement);
    database.prepare("INSERT INTO database_states(id,schema_version,authority_generation,updated_at,search_state) VALUES(1,1,17,?,'unbuilt')").run("2026-10-12T00:00:00.000Z");
    const existingSchema = database.prepare("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all();
    const state = database.prepare("SELECT * FROM database_states").get();
    database.exec("BEGIN IMMEDIATE");
    for (const statement of [...WORKBOOK_LIBRARY_MIGRATION.statements, ...WORKBOOK_MASTER_MIGRATION.statements]) database.exec(statement);
    database.exec("COMMIT");
    const after = database.prepare("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all();
    expect(after.filter(row => existingSchema.some(before => before.name === row.name))).toEqual(existingSchema);
    expect(database.prepare("SELECT * FROM database_states").get()).toEqual(state);
    const transaction = <T>(work: () => T): T => {
      database.exec("BEGIN IMMEDIATE");
      try { const result = work(); database.exec("COMMIT"); return result; }
      catch (error) { database.exec("ROLLBACK"); throw error; }
    };
    const service = () => createWorkbookLibraryService({ sync: unexpectedWorkbookSync,
      clock: manualClock(new Date("2026-10-12T00:00:00.000Z")),
      repository: createWorkbookLibraryRepository({ database, mutate: work => transaction(() => work().result), read: transaction }),
    });
    const first = service().create({ name: "Dates.xlsx", themes: [], hasFormulas: false, sheets: [{ id: "sheet", name: "Dates", width: 1, hidden: [], rows: [{ id: "source-1", cells: [{ value: new Date("2026-01-01T00:00:00.000Z") }] }] }] });
    const second = service().save(first.libraryId, 1, { ...first.workbook, name: "Saved.xlsx" });
    database.close();
    database = new DatabaseSync(path);
    expect(service().read(first.libraryId)).toEqual(second);
    expect(service().history(first.libraryId)).toEqual([]);
    expect(service().list()).toEqual([second]);
    expect(database.prepare("SELECT * FROM database_states").get()).toEqual(state);
  } finally { database.close(); rmSync(root, { recursive: true, force: true }); }
});

it("does not initialize schema implicitly when constructing the repository", () => {
  const database = new DatabaseSync(":memory:");
  try {
    const repository = createWorkbookLibraryRepository({ database, mutate: work => work().result, read: work => work() });
    expect(database.prepare("SELECT name FROM sqlite_master").all()).toEqual([]);
    expect(() => repository.list()).toThrow(expect.objectContaining({ code: "WORKBOOK_STORAGE_FAILED" }));
  } finally { database.close(); }
});

it('recognizes only the exact single seeded type without hiding its raw inventory count', () => {
  const database = new DatabaseSync(':memory:');
  try {
    for (const statement of [...WORKBOOK_LIBRARY_MIGRATION.statements, ...WORKBOOK_MASTER_MIGRATION.statements]) database.exec(statement);
    const original = { id: 'general', name: 'General workbook', keyFieldId: null, fields: [], defaultWorkbookId: null };
    expect(hasOnlyInitialWorkbookType(database)).toBe(true);
    expect(database.prepare('SELECT COUNT(*) AS count FROM workbook_types').get()?.count).toBe(1);
    for (const changed of [
      { ...original, name: 'Edited' }, { ...original, fields: ['eid'] },
      { ...original, keyFieldId: 'eid', fields: ['eid'] }, { ...original, defaultWorkbookId: 'workbook' },
      { ...original, id: 'other' },
    ]) {
      database.prepare('UPDATE workbook_types SET payload_json=? WHERE id=?').run(JSON.stringify(changed), 'general');
      const before = database.prepare('SELECT * FROM workbook_types').all();
      expect(hasOnlyInitialWorkbookType(database)).toBe(false);
      expect(database.prepare('SELECT * FROM workbook_types').all()).toEqual(before);
    }
    database.prepare('UPDATE workbook_types SET payload_json=?').run(JSON.stringify(original));
    database.prepare('INSERT INTO workbook_types VALUES(?,?)').run('extra', JSON.stringify({ ...original, id: 'extra' }));
    expect(hasOnlyInitialWorkbookType(database)).toBe(false);
    expect(database.prepare('SELECT COUNT(*) AS count FROM workbook_types').get()?.count).toBe(2);
    database.exec('DELETE FROM workbook_types');
    expect(hasOnlyInitialWorkbookType(database)).toBe(false);
  } finally { database.close(); }
});
