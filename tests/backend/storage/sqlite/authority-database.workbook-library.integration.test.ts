import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { AuthorityDatabase, inspectAuthorityBackupReadOnly } from "../../../support/helpers/synthetic-storage-admission.js";
import { createWorkbookLibraryService, WorkbookLibraryError } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

const profiles: Awaited<ReturnType<typeof createBoundProfileFixture>>[] = [];
const clock = manualClock(new Date("2026-10-15T12:00:00.000Z"));
const workbook = { name: "Dates.xlsx", themes: [], hasFormulas: false, sheets: [{ id: "sheet", name: "Dates", width: 1, hidden: [], rows: [{ id: "row", cells: [{ value: new Date("2026-01-01T00:00:00.000Z") }] }] }] };
async function fixture() {
  const profile = await createBoundProfileFixture();
  profiles.push(profile);
  const open = () => AuthorityDatabase.open({ path: profile.path, busyTimeoutMs: 250, migrationOwner: "workbook-test" }, clock);
  return { path: profile.path, open };
}
afterEach(async () => { for (const profile of profiles.splice(0)) await profile.close(); });

it("accounts separately for durable admission and atomic master settlement, persists dates, and refuses stale saves", async () => {
  const f = await fixture();
  let database = f.open();
  try {
    const service = () => createWorkbookLibraryService({ repository: database.authority.workbooks, clock });
    const first = service().create(workbook);
    assert.equal(database.getMeta().authorityGeneration, 1);
    const second = service().save(first.libraryId, 1, { ...first.workbook, name: "Saved.xlsx" });
    assert.equal(database.getMeta().authorityGeneration, 3);
    assert.throws(() => service().save(first.libraryId, 1, first.workbook), { code: "WORKBOOK_VERSION_CONFLICT" });
    assert.equal(database.getMeta().authorityGeneration, 5);
    const inspection = database.inspectSchema();
    const fingerprint = inspectAuthorityBackupReadOnly(f.path).authorityContentFingerprint;
    database.close(); database = f.open();
    assert.deepEqual(service().read(first.libraryId), second);
    assert.deepEqual(service().history(first.libraryId), []);
    assert.deepEqual(database.inspectSchema(), inspection);
    assert.equal(inspectAuthorityBackupReadOnly(f.path).authorityContentFingerprint, fingerprint);
    assert.throws(() => database.withAuthorityTransaction(() => {
      service().save(second.libraryId, 2, { ...second.workbook, name: "Rolled back.xlsx" });
      throw new Error("rollback-workbook");
    }), /rollback-workbook/u);
    assert.equal(database.getMeta().authorityGeneration, 5);
    assert.deepEqual(service().history(first.libraryId), []);
  } finally { database.close(); }
});

it.each(["head", "creation-value", "creation-missing"])("refuses corrupt workbook %s during authority admission", async corruption => {
  const f = await fixture(), database = f.open();
  const service = createWorkbookLibraryService({ repository: database.authority.workbooks, clock });
  const first = service.create(workbook);
  service.save(first.libraryId, 1, { ...first.workbook, name: "Second.xlsx" });
  database.close();
  const raw = new DatabaseSync(f.path);
  try {
    if (corruption === "head") raw.prepare("UPDATE workbook_library SET saved_at=? WHERE id=?").run("2026-10-16T00:00:00.000Z", first.libraryId);
    else {
      const triggers = raw.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND tbl_name='workbook_creations'").all();
      raw.exec("DROP TRIGGER workbook_creations_immutable; DROP TRIGGER workbook_creations_retained");
      if (corruption === "creation-value") raw.prepare("UPDATE workbook_creations SET payload_json='{}' WHERE id=?").run(first.libraryId);
      else raw.prepare("DELETE FROM workbook_creations WHERE id=?").run(first.libraryId);
      for (const trigger of triggers) if (typeof trigger.sql === 'string' && !trigger.sql.includes('BEFORE INSERT')) raw.exec(trigger.sql);

    }
  } finally { raw.close(); }
  assert.throws(f.open, error => error instanceof Error && error.cause instanceof WorkbookLibraryError
    && error.cause.code === "WORKBOOK_STORAGE_CORRUPT");
});
