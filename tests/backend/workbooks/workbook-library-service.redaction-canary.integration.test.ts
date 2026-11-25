import { unexpectedWorkbookSync } from "../../support/helpers/backend/workbook-sync.js";
import { testWorkerPorts } from "../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../../src/rules/time/clock.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";
import { createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";
import { NOW } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { EditableWorkbookSchema, WorkbookCreateRequestSchema, decodeEditableWorkbook, encodeEditableWorkbook, decodeSavedWorkbook, encodeSavedWorkbook } from "../../../src/models/dashboard/workbooks.js";
import { createWorkbookLibraryService } from "../../../src/backend/workbooks/workbook-library-service.js";
import { personLookupDescriptor } from "../../support/helpers/registered-workflows.js";

/* ── (a) the declaration audit ───────────────────────────────────────────── */

describe("redaction surface scan — the declaration audit", () => {

  it("preserves HR-bearing workbook identities through the canonical codec and real library service", async () => {
    const canary = "10999881777";
    const workbook = EditableWorkbookSchema.parse({
      name: "Roster.xlsx", themes: [], hasFormulas: false,
      sheets: [{ id: canary, name: "People", width: 1, hidden: [],
        columnBindings: [{ id: canary, sourceColumn: 0, sourceHeader: "Employee", fieldId: `roster.SyntheticEmployee${canary}`, basis: "manual" }],
        rows: [{ id: canary, cells: [{ value: new Date(NOW) }] }] }],
    });
    assert.deepEqual(decodeEditableWorkbook(encodeEditableWorkbook(workbook)), workbook);
    const incoming = { ...workbook, libraryId: canary };
    assert.equal(WorkbookCreateRequestSchema.parse({ workbook: encodeEditableWorkbook(incoming) }).workbook.libraryId, canary);
    const service = createWorkbookLibraryService({ sync: unexpectedWorkbookSync, repository: (await openDatabase()).authority.workbooks, clock: manualClock(new Date(NOW)) });
    assert.throws(() => service.create(incoming), { code: "WORKBOOK_INVALID" });
    const created = service.create(workbook);
    assert.notEqual(created.libraryId, canary);
    const saved = service.save(created.libraryId, 1, created.workbook);
    for (const record of [service.read(created.libraryId), ...service.list(), ...service.history(created.libraryId)]) {
      const served = decodeSavedWorkbook(encodeSavedWorkbook(record));
      assert.deepEqual(served.workbook.sheets, workbook.sheets);
      assert.equal(served.libraryId, created.libraryId);
      assert.equal(served.workbook.libraryId, created.libraryId);
    }
    assert.equal(saved.version, 2);
  });
});

const databases: AuthorityDatabase[] = [];
const profileFixtures: Awaited<ReturnType<typeof createBoundProfileFixture>>[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const fixture of profileFixtures.splice(0)) await fixture.close();
});

async function openDatabase(): Promise<AuthorityDatabase> {
  const fixture = await createBoundProfileFixture();
  profileFixtures.push(fixture);
  const database = AuthorityDatabase.open(
    { path: fixture.path, busyTimeoutMs: 250, migrationOwner: "unit-test" },
    manualClock(new Date(NOW)),
  );
  testWorkerPorts(database, manualClock(new Date(NOW)), { path: fixture.path, descriptor: personLookupDescriptor, poolIndex: 1 });
  databases.push(database);
  return database;
}
