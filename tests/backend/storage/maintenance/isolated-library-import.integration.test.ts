import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, linkSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, it } from "vitest";
import { importIsolatedWorkbookLibrary, IsolatedLibraryImportRefusedError } from "../../../../src/backend/storage/maintenance/isolated-library-import.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { withReadonlyAuthoritySnapshot } from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { createWorkbookLibraryService } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createBackupFixtures } from "../../../support/helpers/storage/backup-fixtures.js";
import { unexpectedWorkbookSync } from "../../../support/helpers/backend/workbook-sync.js";
import { runRecordOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { WorkbookLibraryOriginSchema } from "../../../../src/models/dashboard/workbook-library.js";

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

it("imports the library under derived IDs, reopens it through the normal entry point and leaves the source and everything else untouched", async () => {
  const { source, backup, rosterId } = await sourceWithLibrary();
  const destination = await openCurrentWorld();
  const backupPath = join(dirname(backup.manifestPath), backup.manifest.backupFileName);
  const sourceDigest = sha256(backupPath), sourceGeneration = source.database.getMeta().authorityGeneration;
  const before = nonLibraryCounts(destination);

  const report = await importIsolatedWorkbookLibrary(destination.admission, destination.database, request(source, backup.manifestPath, destination), CLOCK);
  assert.deepEqual({ ...report, sourceBackup: { ...report.sourceBackup } }, { created: 2, refreshed: 0, unchanged: 0, keptLocal: 0, createdTypes: 1, skippedWorkflowOutputs: 0,
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

    const generation = reopened.getMeta().authorityGeneration;
    const repeat = await importIsolatedWorkbookLibrary(destination.admission, reopened, request(source, backup.manifestPath, destination), CLOCK);
    assert.deepEqual([repeat.created, repeat.refreshed, repeat.unchanged, repeat.keptLocal, repeat.createdTypes], [0, 0, 2, 0, 0]);
    assert.equal(reopened.getMeta().authorityGeneration, generation);
  } finally { reopened.close(); }
});

it("refreshes only entries nothing but the import changed and keeps the copy's own work", async () => {
  const { source, backup, rosterId } = await sourceWithLibrary();
  const destination = await openCurrentWorld();
  await importIsolatedWorkbookLibrary(destination.admission, destination.database, request(source, backup.manifestPath, destination), CLOCK);
  const copy = service(destination.database);
  const local = copy.create({ ...dates, name: "Copy only" });
  const datesCopy = copy.list().find(record => record.workbook.name === "Dates saved");
  assert.ok(datesCopy !== undefined);
  copy.save(datesCopy.libraryId, datesCopy.version, { ...datesCopy.workbook, name: "Edited in copy" });

  const production = service(source.database);
  const rosterNow = production.read(rosterId);
  production.save(rosterId, rosterNow.version, { ...rosterNow.workbook, name: "Roster v2" });
  const datesSource = production.list().find(record => record.workbook.name === "Dates saved");
  assert.ok(datesSource !== undefined);
  production.save(datesSource.libraryId, datesSource.version, { ...datesSource.workbook, name: "Dates v3" });
  production.create({ ...dates, name: "New in production" });
  const later = await takeBackup(source);

  const report = await importIsolatedWorkbookLibrary(destination.admission, destination.database, request(source, later.manifestPath, destination), CLOCK);
  assert.deepEqual([report.created, report.refreshed, report.unchanged, report.keptLocal], [1, 1, 0, 1]);
  const names = destination.database.authority.workbooks.catalog().map(entry => entry.name).sort();
  assert.deepEqual(names, ["Copy only", "Edited in copy", "New in production", "Roster v2"]);
  const roster = destination.database.authority.workbooks.catalog().find(entry => entry.name === "Roster v2");
  assert.equal(roster?.metadata.typeId, "ocr-roster");
  assert.deepEqual(copy.read(local.libraryId), local);
});

it("rolls back every write when the import fails part way", async () => {
  const { source, backup } = await sourceWithLibrary();
  const destination = await openCurrentWorld();
  const generation = destination.database.getMeta().authorityGeneration;
  const real = destination.database.authority.workbooks;
  let creates = 0;
  const failing = { ...real, create: (...args: Parameters<typeof real.create>) => {
    if (++creates === 2) throw new Error("injected-second-create-failure");
    return real.create(...args);
  } };
  const database = new Proxy(destination.database, { get(target, property) {
    if (property === "authority") return { ...target.authority, workbooks: failing };
    const value: unknown = Reflect.get(target, property, target);
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
  } });
  await assert.rejects(importIsolatedWorkbookLibrary(destination.admission, database, request(source, backup.manifestPath, destination), CLOCK),
    (error: unknown) => error instanceof Error && error.cause instanceof Error && error.cause.message === "injected-second-create-failure");
  assert.equal(creates, 2);
  assert.equal(real.catalog().length, 0);
  assert.deepEqual(real.types().map(type => type.id), ["general"]);
  assert.equal(destination.database.getMeta().authorityGeneration, generation);
});

it("refuses a source type that differs from the copy's type of the same ID before writing", async () => {
  const { source, backup } = await sourceWithLibrary();
  const destination = await openCurrentWorld();
  service(destination.database).putType({ id: "ocr-roster", name: "Copy roster", keyFieldId: "eid", fields: ["eid"], defaultWorkbookId: null });
  await assert.rejects(importIsolatedWorkbookLibrary(destination.admission, destination.database, request(source, backup.manifestPath, destination), CLOCK),
    (error: unknown) => error instanceof IsolatedLibraryImportRefusedError && error.reason === "destination-type-diverged");
  assert.equal(destination.database.authority.workbooks.catalog().length, 0);
});

it("refuses ambiguous identities, unbound stores, the source's own installation and changed or shared backup bytes without writing", async () => {
  const { source, backup } = await sourceWithLibrary();
  const destination = await openCurrentWorld();
  const valid = request(source, backup.manifestPath, destination);
  const refuses = (reason: string, input: unknown, world: World = destination, database: AuthorityDatabase = world.database) => assert.rejects(
    importIsolatedWorkbookLibrary(world.admission, database, input, CLOCK),
    (error: unknown) => error instanceof IsolatedLibraryImportRefusedError && error.reason === reason);

  await refuses("source-binding-mismatch", { ...valid, source: { ...valid.source, binding: { ...binding(source), installationId: randomUUID() } } });
  await refuses("source-binding-mismatch", { ...valid, source: { ...valid.source, binding: { ...binding(source), profileId: randomUUID() } } });
  await refuses("destination-binding-mismatch", { ...valid, destination: binding(source) });
  await refuses("destination-not-isolated", request(source, backup.manifestPath, source), source);
  await assert.rejects(importIsolatedWorkbookLibrary(destination.admission, destination.database, { ...valid, extra: true }, CLOCK));
  // Another person's open store, even with matching request identities, is not this admission's store.
  await refuses("destination-store-unbound", valid, destination, source.database);
  const shared = await openCurrentWorld({ sharedMachine: true });
  await refuses("destination-store-unbound", request(source, backup.manifestPath, shared), shared);
  assert.equal(shared.database.authority.workbooks.catalog().length, 0);

  const backupPath = join(dirname(backup.manifestPath), backup.manifest.backupFileName);
  const bytes = readFileSync(backupPath);
  bytes[bytes.length - 1] ^= 0xff;
  writeFileSync(backupPath, bytes);
  await assert.rejects(importIsolatedWorkbookLibrary(destination.admission, destination.database, valid, CLOCK), /checksum does not match/u);
  assert.equal(destination.database.authority.workbooks.catalog().length, 0);
  writeFileSync(backupPath, readFileSync(backupPath).map((byte, index) => index === bytes.length - 1 ? byte ^ 0xff : byte));
  assert.equal(sha256(backupPath), backup.manifest.sha256);

  // A second name for the backup file means its bytes can change behind the verifier; the read-only copy admission refuses it.
  const elsewhere = mkdtempSync(join(tmpdir(), "relay-import-link-"));
  cleanups.push(() => { rmSync(elsewhere, { recursive: true, force: true }); });
  linkSync(backupPath, join(elsewhere, "linked.sqlite"));
  await assert.rejects(importIsolatedWorkbookLibrary(destination.admission, destination.database, valid, CLOCK), /unsafe shape/u);
  rmSync(join(elsewhere, "linked.sqlite"));
  assert.equal(destination.database.authority.workbooks.catalog().length, 0);
  assert.equal((await importIsolatedWorkbookLibrary(destination.admission, destination.database, valid, CLOCK)).created, 2);
});

it("keeps an imported entry with a pending local operation as it is and leaves the operation queued", async () => {
  const { source, backup, rosterId } = await sourceWithLibrary();
  const destination = await openCurrentWorld();
  await importIsolatedWorkbookLibrary(destination.admission, destination.database, request(source, backup.manifestPath, destination), CLOCK);
  const target = destination.database.authority.workbooks;
  const imported = target.list().find(record => record.workbook.name === "Roster");
  assert.ok(imported !== undefined);
  target.enqueue(imported.libraryId, { operationId: "copy-pending-save", source: { kind: "operator" }, at: CLOCK.now().toISOString(),
    change: { kind: "save", expectedVersion: imported.version, workbook: { ...imported.workbook, name: "Pending in copy" } } });

  const production = service(source.database);
  const current = production.read(rosterId);
  production.save(rosterId, current.version, { ...current.workbook, name: "Roster v2" });
  const later = await takeBackup(source);
  const report = await importIsolatedWorkbookLibrary(destination.admission, destination.database, request(source, later.manifestPath, destination), CLOCK);
  assert.deepEqual([report.created, report.refreshed, report.unchanged, report.keptLocal], [0, 0, 1, 1]);
  assert.equal(target.hasQueuedOperation(imported.libraryId), true);
  assert.deepEqual(target.read(imported.libraryId), imported);

  // The copy's own intent still applies afterwards, unchanged by the import.
  target.drain(imported.libraryId);
  assert.equal(target.hasQueuedOperation(imported.libraryId), false);
  assert.equal(target.read(imported.libraryId)?.workbook.name, "Pending in copy");
});

it("leaves the source's credentials, queued runs and workflow outputs behind when a fresh person reopens its import", async () => {
  const { source } = await sourceWithLibrary();
  const credentialsDirectory = join(source.stateRoot, "credentials");
  assert.ok(existsSync(credentialsDirectory) && readdirSync(credentialsDirectory).length > 0, "signed-up source holds synthetic credentials");
  const run = runRecordOf({ seed: 1, enqueuedAt: CLOCK.now().toISOString(), descriptor: personLookupDescriptor });
  if (source.database.authority.runtimeConfig.get() === undefined) source.database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  source.database.authority.runs.enqueue(run);
  const origin = WorkbookLibraryOriginSchema.parse({ kind: "workflow", runId: run.envelope.runId, partitionDay: "2026-11-22",
    workflowId: run.envelope.workflow, workflowLabel: "Person lookup", rowCount: 1, rowSubject: "person" });
  const local = service(source.database).create({ ...dates, name: "Local dates" });
  source.database.authority.workbooks.create({ ...local, libraryId: "workflow-result", workbook: { ...local.workbook, name: "Workflow output", libraryId: "workflow-result" } }, origin);
  assert.ok(nonLibraryCounts(source).runs > 0);
  const backup = await takeBackup(source);

  const destination = await openCurrentWorld();
  const before = nonLibraryCounts(destination);
  const destinationCredentials = join(destination.stateRoot, "credentials");
  const credentialFiles = () => readdirSync(destinationCredentials, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
    .map(entry => [join(entry.parentPath, entry.name), sha256(join(entry.parentPath, entry.name))]).sort();
  const credentialsBefore = credentialFiles();
  const report = await importIsolatedWorkbookLibrary(destination.admission, destination.database, request(source, backup.manifestPath, destination), CLOCK);
  assert.deepEqual([report.created, report.skippedWorkflowOutputs], [3, 1]);

  destination.closeDatabase();
  const reopened = AuthorityDatabase.open(destination.admission, { path: destination.authorityPath, busyTimeoutMs: 250, migrationOwner: "import-test" },
    CLOCK, undefined, undefined, undefined, destination.credentials);
  try {
    const catalog = reopened.authority.workbooks.catalog();
    assert.deepEqual(catalog.map(entry => entry.name).sort(), ["Dates saved", "Local dates", "Roster"]);
    assert.ok(catalog.every(entry => entry.state.origin.kind === "local"));
  } finally { reopened.close(); }
  assert.deepEqual(nonLibraryCounts(destination), before);
  assert.deepEqual(credentialFiles(), credentialsBefore);
});
