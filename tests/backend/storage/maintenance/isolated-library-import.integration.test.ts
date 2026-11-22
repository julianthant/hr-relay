import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, it } from "vitest";
import { importIsolatedWorkbookLibrary, IsolatedLibraryImportRefusedError } from "../../../../src/backend/storage/maintenance/isolated-library-import.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { withReadonlyAuthoritySnapshot } from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { createWorkbookLibraryService } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createBackupFixtures } from "../../../support/helpers/storage/backup-fixtures.js";
import { unexpectedWorkbookSync } from "../../../support/helpers/backend/workbook-sync.js";

const CLOCK = manualClock(new Date("2026-11-22T12:00:00.000Z"));
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const { openCurrentWorld, takeBackup } = createBackupFixtures(cleanups, CLOCK);
type World = Awaited<ReturnType<typeof openCurrentWorld>>;

const roster = { name: "Roster", themes: [], hasFormulas: false, sheets: [{ id: "people", name: "People", width: 2, hidden: [], headerRow: 1,
  columnBindings: ["eid", "fullName"].map((fieldId, index) => ({ id: fieldId, sourceColumn: index, sourceHeader: fieldId, fieldId, basis: "manual" })),
  rows: [{ id: "header", cells: [{ value: "EID" }, { value: "Name" }] }, { id: "one", cells: [{ value: "10000001" }, { value: "Example, Avery" }] }] }] };
const dates = { name: "Dates", themes: [], hasFormulas: false, sheets: [{ id: "sheet", name: "Dates", width: 1, hidden: [],
  rows: [{ id: "row", cells: [{ value: new Date("2026-01-01T00:00:00.000Z") }] }] }] };

const binding = (world: World) => ({ installationId: world.admission.profileBinding.installationId, profileId: world.admission.profileBinding.profileId });
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const service = (database: AuthorityDatabase) => createWorkbookLibraryService({ sync: unexpectedWorkbookSync, repository: database.authority.workbooks, clock: CLOCK });

/** Row counts of every stored table outside the workbook library; the derived change log is left out. */
function nonLibraryCounts(world: World): Record<string, number> {
  return withReadonlyAuthoritySnapshot(world.authorityPath, database => Object.fromEntries(database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'workbook%' AND name NOT LIKE 'sqlite_%' AND name<>'authority_changes' ORDER BY name").all()
    .map(row => String((row as { name: string }).name))
    .map(name => [name, Number((database.prepare(`SELECT count(*) AS n FROM "${name}"`).get() as { n: number }).n)])));
}

async function sourceWithLibrary() {
  const source = await openCurrentWorld();
  const library = service(source.database);
  const first = library.create(roster);
  library.putType({ id: "ocr-roster", name: "OCR roster", keyFieldId: "eid", fields: ["eid", "fullName"], defaultWorkbookId: null });
  library.operatorOperation(first.libraryId, "set-type", { kind: "metadata", expectedVersion: 1, metadata: { typeId: "ocr-roster", sharePoint: null } });
  library.putType({ id: "ocr-roster", name: "OCR roster", keyFieldId: "eid", fields: ["eid", "fullName"], defaultWorkbookId: first.libraryId });
  const second = library.create(dates);
  library.save(second.libraryId, 1, { ...second.workbook, name: "Dates saved" });
  const backup = await takeBackup(source);
  return { source, backup, rosterId: first.libraryId };
}

function request(source: World, manifestPath: string, destination: World) {
  return { source: { manifestPath, binding: binding(source) }, destination: binding(destination) };
}

it("imports the library under new IDs, reopens it through the normal entry point and leaves the source and everything else untouched", async () => {
  const { source, backup, rosterId } = await sourceWithLibrary();
  const destination = await openCurrentWorld();
  const backupPath = join(dirname(backup.manifestPath), backup.manifest.backupFileName);
  const sourceDigest = sha256(backupPath), sourceGeneration = source.database.getMeta().authorityGeneration;
  const before = nonLibraryCounts(destination);

  const report = await importIsolatedWorkbookLibrary(destination.admission, destination.database, request(source, backup.manifestPath, destination), CLOCK);
  assert.deepEqual({ ...report, sourceBackup: { ...report.sourceBackup } }, { importedWorkbooks: 2, importedTypes: 1, skippedWorkflowOutputs: 0,
    sourceBackup: { backupFileName: backup.manifest.backupFileName, sha256: backup.manifest.sha256, authorityGeneration: backup.manifest.authorityGeneration } });
  assert.deepEqual(nonLibraryCounts(destination), before);
  assert.equal(sha256(backupPath), sourceDigest);
  assert.equal(source.database.getMeta().authorityGeneration, sourceGeneration);

  destination.closeDatabase();
  const reopened = AuthorityDatabase.open(destination.admission, { path: destination.authorityPath, busyTimeoutMs: 250, migrationOwner: "import-test" },
    CLOCK, undefined, undefined, undefined, destination.credentials);
  try {
    assert.deepEqual(reopened.getMeta().installationId, binding(destination).installationId);
    assert.deepEqual(reopened.getMeta().profileId, binding(destination).profileId);
    const catalog = reopened.authority.workbooks.catalog();
    assert.deepEqual(catalog.map(entry => entry.name).sort(), ["Dates saved", "Roster"]);
    assert.ok(catalog.every(entry => entry.libraryId !== rosterId && entry.state.origin.kind === "local" && entry.metadata.sharePoint === null));
    const imported = catalog.find(entry => entry.name === "Roster");
    assert.ok(imported !== undefined);
    assert.equal(imported.metadata.typeId, "ocr-roster");
    const type = reopened.authority.workbooks.types().find(entry => entry.id === "ocr-roster");
    assert.equal(type?.defaultWorkbookId, imported.libraryId);
    const dated = reopened.authority.workbooks.read(catalog.find(entry => entry.name === "Dates saved")?.libraryId ?? "");
    assert.deepEqual(dated?.workbook.sheets[0].rows[0].cells[0].value, new Date("2026-01-01T00:00:00.000Z"));
    assert.equal(dated?.version, 1);
    assert.equal(reopened.authority.workbooks.history(dated.libraryId).length, 0);

    await assert.rejects(importIsolatedWorkbookLibrary(destination.admission, reopened, request(source, backup.manifestPath, destination), CLOCK),
      (error: unknown) => error instanceof IsolatedLibraryImportRefusedError && error.reason === "destination-library-not-empty");
    assert.equal(reopened.authority.workbooks.catalog().length, 2);
  } finally { reopened.close(); }
});

it("refuses ambiguous identities, the source's own installation, production paths and changed backup bytes without writing", async () => {
  const { source, backup } = await sourceWithLibrary();
  const destination = await openCurrentWorld();
  const valid = request(source, backup.manifestPath, destination);
  const refuses = (reason: string, input: unknown, world: World = destination, productionWorkspace?: string) => assert.rejects(
    importIsolatedWorkbookLibrary(world.admission, world.database, input, CLOCK, productionWorkspace),
    (error: unknown) => error instanceof IsolatedLibraryImportRefusedError && error.reason === reason);

  await refuses("source-binding-mismatch", { ...valid, source: { ...valid.source, binding: { ...binding(source), installationId: randomUUID() } } });
  await refuses("source-binding-mismatch", { ...valid, source: { ...valid.source, binding: { ...binding(source), profileId: randomUUID() } } });
  await refuses("destination-binding-mismatch", { ...valid, destination: binding(source) });
  await refuses("destination-not-isolated", request(source, backup.manifestPath, source), source);
  await refuses("destination-not-isolated", valid, destination, destination.workspace);
  await assert.rejects(importIsolatedWorkbookLibrary(destination.admission, destination.database, { ...valid, extra: true }, CLOCK));

  const backupPath = join(dirname(backup.manifestPath), backup.manifest.backupFileName);
  const bytes = readFileSync(backupPath);
  bytes[bytes.length - 1] ^= 0xff;
  writeFileSync(backupPath, bytes);
  await assert.rejects(importIsolatedWorkbookLibrary(destination.admission, destination.database, valid, CLOCK), /checksum does not match/u);
  assert.equal(destination.database.authority.workbooks.catalog().length, 0);
});
