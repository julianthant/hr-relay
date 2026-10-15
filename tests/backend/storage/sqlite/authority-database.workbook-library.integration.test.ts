import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { AuthorityDatabase, inspectAuthorityBackupReadOnly } from "../../../support/helpers/synthetic-storage-admission.js";
import { createWorkbookLibraryService, WorkbookLibraryError } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

const roots: string[] = [];
const clock = manualClock(new Date("2026-10-15T12:00:00.000Z"));
const workbook = { name: "Dates.xlsx", themes: [], hasFormulas: false, sheets: [{ id: "sheet", name: "Dates", width: 1, hidden: [], rows: [{ id: "row", cells: [{ value: new Date("2026-01-01T00:00:00.000Z") }] }] }] };
function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "workbook-authority-"));
  roots.push(root);
  const path = join(root, "state.db");
  const open = () => AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "workbook-test" }, clock);
  return { path, open };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("accounts for workbook snapshots and history in one authority generation, persists dates, and refuses stale saves", () => {
  const f = fixture();
  let database = f.open();
  try {
    const service = () => createWorkbookLibraryService({ repository: database.authority.workbooks, clock });
    const first = service().create(workbook);
    assert.equal(database.getMeta().authorityGeneration, 1);
    const second = service().save(first.libraryId, 1, { ...first.workbook, name: "Saved.xlsx" });
    assert.equal(database.getMeta().authorityGeneration, 2);
    assert.throws(() => service().save(first.libraryId, 1, first.workbook), { code: "WORKBOOK_VERSION_CONFLICT" });
    assert.equal(database.getMeta().authorityGeneration, 2);
    const inspection = database.inspectSchema();
    const fingerprint = inspectAuthorityBackupReadOnly(f.path).authorityContentFingerprint;
    database.close(); database = f.open();
    assert.deepEqual(service().read(first.libraryId), second);
    assert.deepEqual(service().history(first.libraryId), [first, second]);
    assert.deepEqual(database.inspectSchema(), inspection);
    assert.equal(inspectAuthorityBackupReadOnly(f.path).authorityContentFingerprint, fingerprint);
    assert.throws(() => database.withAuthorityTransaction(() => {
      service().save(second.libraryId, 2, { ...second.workbook, name: "Rolled back.xlsx" });
      throw new Error("rollback-workbook");
    }), /rollback-workbook/u);
    assert.equal(database.getMeta().authorityGeneration, 2);
    assert.deepEqual(service().history(first.libraryId), [first, second]);
  } finally { database.close(); }
});

it.each(["head", "history-value", "history-gap"])("refuses corrupt workbook %s during authority admission", corruption => {
  const f = fixture(), database = f.open();
  const service = createWorkbookLibraryService({ repository: database.authority.workbooks, clock });
  const first = service.create(workbook);
  service.save(first.libraryId, 1, { ...first.workbook, name: "Second.xlsx" });
  database.close();
  const raw = new DatabaseSync(f.path);
  try {
    if (corruption === "head") raw.prepare("UPDATE workbook_library SET saved_at=? WHERE id=?").run("2026-10-16T00:00:00.000Z", first.libraryId);
    else {
      raw.exec("DROP TRIGGER workbook_library_history_immutable; DROP TRIGGER workbook_library_history_retained");
      if (corruption === "history-value") raw.prepare("UPDATE workbook_library_history SET payload_json='{}' WHERE workbook_id=? AND version=1").run(first.libraryId);
      else raw.prepare("DELETE FROM workbook_library_history WHERE workbook_id=? AND version=1").run(first.libraryId);
      raw.exec("CREATE TRIGGER workbook_library_history_immutable BEFORE UPDATE ON workbook_library_history BEGIN SELECT RAISE(ABORT,'workbook-history-immutable'); END");
      raw.exec("CREATE TRIGGER workbook_library_history_retained BEFORE DELETE ON workbook_library_history BEGIN SELECT RAISE(ABORT,'workbook-history-retained'); END");
    }
  } finally { raw.close(); }
  assert.throws(f.open, error => error instanceof Error && error.cause instanceof WorkbookLibraryError
    && error.cause.code === "WORKBOOK_STORAGE_CORRUPT");
});
