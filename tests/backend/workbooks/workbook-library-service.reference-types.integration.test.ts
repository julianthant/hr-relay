import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { createWorkbookLibraryRepository, WORKBOOK_LIBRARY_MIGRATION, WORKBOOK_MASTER_MIGRATION, WORKBOOK_LIBRARY_CATALOG_MIGRATION } from "../../../src/backend/storage/sqlite/workbook-library-repository.js";
import { createWorkbookLibraryService } from "../../../src/backend/workbooks/workbook-library-service.js";
import { DESCRIPTORS } from "../../../src/backend/app/registries/workflow-registry.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { unexpectedWorkbookSync } from "../../support/helpers/backend/workbook-sync.js";

const databases: DatabaseSync[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });
function store() {
  const database = new DatabaseSync(":memory:"); databases.push(database);
  for (const statement of [...WORKBOOK_LIBRARY_MIGRATION.statements, ...WORKBOOK_MASTER_MIGRATION.statements, ...WORKBOOK_LIBRARY_CATALOG_MIGRATION.statements]) database.exec(statement);
  const transaction = <T>(work: () => T): T => {
    database.exec("BEGIN IMMEDIATE");
    try { const result = work(); database.exec("COMMIT"); return result; }
    catch (error) { database.exec("ROLLBACK"); throw error; }
  };
  const repository = createWorkbookLibraryRepository({ database, mutate: work => transaction(() => work().result), read: transaction });
  const open = () => createWorkbookLibraryService({ sync: unexpectedWorkbookSync, repository, clock: manualClock(new Date("2026-10-12T12:00:00.000Z")) });
  return { database, open };
}
const typeRows = (database: DatabaseSync) => database.prepare("SELECT id, payload_json FROM workbook_types ORDER BY id").all();

it("gives a fresh store every type a registered workflow requires, with the columns its reference reads", () => {
  const service = store().open(), types = new Map(service.types().map(type => [type.id, type]));
  expect(types.get("ocr-roster")).toMatchObject({ name: "OCR roster", keyFieldId: "eid", fields: ["eid", "fullName"], defaultWorkbookId: null });
  for (const id of DESCRIPTORS.flatMap(descriptor => descriptor.requiredWorkbookTypeIds)) expect(types.has(id), id).toBe(true);
  expect(types.has("general")).toBe(true);
});

it("adds only the missing types to an existing store and changes nothing on the next open", () => {
  const { database, open } = store();
  open();
  const complete = typeRows(database);
  database.exec("DELETE FROM workbook_types WHERE id='ocr-roster'");
  expect(typeRows(database)).toHaveLength(complete.length - 1);
  open();
  expect(typeRows(database)).toEqual(complete);
  open();
  expect(typeRows(database)).toEqual(complete);
});

it("leaves an operator-edited type with a declared id alone", () => {
  const { database, open } = store();
  const edited = { ...open().types().find(type => type.id === "ocr-roster")!, name: "Our roster", fieldLabels: { eid: "Student ID", fullName: "Student" } };
  open().putType(edited);
  const before = typeRows(database);
  expect(open().types().find(type => type.id === "ocr-roster")).toEqual(edited);
  expect(typeRows(database)).toEqual(before);
});
