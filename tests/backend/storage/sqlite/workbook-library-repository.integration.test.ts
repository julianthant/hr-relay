import { unexpectedWorkbookSync } from "../../../support/helpers/backend/workbook-sync.js";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createWorkbookLibraryRepository, hasOnlyInitialWorkbookType, WORKBOOK_LIBRARY_MIGRATION, WORKBOOK_MASTER_MIGRATION, WORKBOOK_LIBRARY_CATALOG_MIGRATION, WORKBOOK_LIBRARY_PIN_TAGS_MIGRATION, WORKBOOK_LIBRARY_SYNC_STATUS_MIGRATION, WORKBOOK_PAYLOAD_TABLE } from "../../../../src/backend/storage/sqlite/workbook-library-repository.js";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { createWorkbookLibraryService, readRetainedWorkbookReference, verifyRetainedNamedWorkbookReference } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { bindRunWorkbookReference, encodeSavedWorkbook, parseRunWorkbookReference, WorkbookOperationReceiptSchema, WorkbookOperationSchema } from "../../../../src/models/dashboard/workbooks.js";
import { decodeWorkbookReference } from "../../../../src/models/processing/workbooks/read-reference.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { buildRunWorkbookSection, createRunWorkbookService } from "../../../../src/backend/runs/workbooks.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { CrmDocDownloadCanonicalInput, CrmDocDownloadInput } from "../../../../src/models/workflows/crm-doc-download/input.js";
import { ReadCrmDocumentRows } from "../../../../src/models/workflows/crm-doc-download/read-document-rows.js";
import { ONBOARDING_ROSTER_TYPE_ID } from "../../../../src/models/workflows/onboarding/roster.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { CONFIG_SNAPSHOT, HASH_B, NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { testAdmittedWorker, testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { openBoundDatabaseFixture } from "../../../support/helpers/admission-fixture.js";
import { moveWorkbookPayloads } from "../../../support/fixtures/storage/historical-run-schema.js";
import { randomUUID } from "node:crypto";

const savedAt = "2026-10-12T00:00:00.000Z";

function workbookFixture(database: DatabaseSync, cache = false) {
  for (const migration of [WORKBOOK_LIBRARY_MIGRATION, WORKBOOK_MASTER_MIGRATION, WORKBOOK_LIBRARY_CATALOG_MIGRATION, WORKBOOK_LIBRARY_SYNC_STATUS_MIGRATION, WORKBOOK_PAYLOAD_TABLE]) {
    for (const statement of migration.statements) database.exec(statement);
  }
  const repository = createWorkbookLibraryRepository({ database, mutate: work => work().result, read: work => work(),
    ...(cache ? { changeKey: () => ({ authorityGeneration: 1, dataVersion: 1,
      totalChanges: Number(database.prepare("SELECT total_changes() AS count").get()?.count) }) } : {}),
  });
  const clock = manualClock(new Date(savedAt));
  const service = createWorkbookLibraryService({ repository, clock, sync: unexpectedWorkbookSync });
  const first = service.create({ name: "Roster.xlsx", themes: [], hasFormulas: false, sheets: [{
    id: "people", name: "People", width: 2, hidden: [], headerRow: 1,
    columnBindings: ["email", "fullName"].map((fieldId, sourceColumn) => ({
      id: fieldId, sourceColumn, sourceHeader: fieldId, fieldId, basis: "manual",
    })),
    rows: [
      { id: "header", cells: [{ value: "email" }, { value: "Name" }] },
      { id: "first", cells: [{ value: "LEFT@example.test" }, { value: "Fixture Person" }] },
      { id: "second", cells: [{ value: "other@example.test" }, { value: "Other Person" }] },
    ],
  }] });
  repository.putType({ id: "roster", name: "Roster", keyFieldId: "email", fields: ["email", "fullName"], defaultWorkbookId: null });
  service.operatorOperation(first.libraryId, "assign-roster", { kind: "metadata", expectedVersion: 1,
    metadata: { typeId: "roster", sharePoint: null } });
  return { repository, service, id: first.libraryId };
}

it("requires unique names for manual SharePoint versions of the same revision", () => {
  using database = new DatabaseSync(":memory:");
  const { id, repository, service } = workbookFixture(database);
  service.operatorOperation(id, "link", { kind: "metadata", expectedVersion: 2,
    metadata: { typeId: "roster", sharePoint: { url: "https://example.sharepoint.com/sites/hr/Roster.xlsx", verifiedAt: savedAt } } });
  const saved = service.read(id), downloaded = encodeSavedWorkbook(saved).workbook;
  const pull = (operationId: string, name: string) => {
    const action = { operationId, expectedRevision: repository.libraryState(id).revision, expectedVersion: saved.version,
      change: { kind: "create-version", name, from: { kind: "sharepoint" }, useNow: false } };
    return { action, result: repository.libraryAction(id, action, savedAt, downloaded) };
  };
  const first = pull("pull-one", " Reviewed ");
  expect(() => pull("duplicate", "Reviewed")).toThrow(expect.objectContaining({ code: "WORKBOOK_VERSION_NAME_EXISTS" }));
  expect(repository.libraryState(id)).toEqual(first.result.result);
  const second = pull("pull-two", "Approved");
  const one = repository.libraryVersion(id, first.action.operationId);
  const two = repository.libraryVersion(id, second.action.operationId);
  expect([one.version.name, two.version.name]).toEqual(["Reviewed", "Approved"]);
  expect([one.version.version, two.version.version]).toEqual([saved.version, saved.version]);
  expect(one.version.snapshotId).not.toBe(two.version.snapshotId);
  expect(two.workbook).toEqual(one.workbook);
  expect(repository.libraryAction(id, second.action, savedAt)).toEqual(second.result);
});

it("stores trimmed version names and refuses a rename to a taken name", () => {
  using database = new DatabaseSync(":memory:");
  const { id, repository, service } = workbookFixture(database);
  const apply = (operationId: string, change: unknown) => repository.libraryAction(id, {
    operationId, expectedRevision: repository.libraryState(id).revision, expectedVersion: service.read(id).version, change,
  }, savedAt);
  apply("copy", { kind: "create-version", name: " Copy ", from: { kind: "version", versionId: "original" }, useNow: false });
  expect(repository.libraryVersion(id, "copy").version.name).toBe("Copy");
  apply("rename-copy", { kind: "rename-version", versionId: "copy", name: " X " });
  expect(repository.libraryVersion(id, "copy").version.name).toBe("X");
  expect(() => apply("rename-original", { kind: "rename-version", versionId: "original", name: " X " }))
    .toThrow(expect.objectContaining({ code: "WORKBOOK_VERSION_NAME_EXISTS" }));
});

it("keeps a generated revision name from colliding with an existing named version", () => {
  using database = new DatabaseSync(":memory:");
  const { id, repository, service } = workbookFixture(database);
  const before = service.read(id);
  repository.libraryAction(id, { operationId: "reserve-next-name", expectedRevision: repository.libraryState(id).revision, expectedVersion: before.version,
    change: { kind: "create-version", name: "Saved revision 3", from: { kind: "version", versionId: "original" }, useNow: false } }, savedAt);
  service.save(id, before.version, before.workbook);
  expect(repository.libraryVersion(id, "reserve-next-name").version.name).toBe("Saved revision 3");
  expect(repository.libraryVersion(id).version.name).toBe("Saved revision 3 (2)");
});

it("keeps decoded rows and snapshots across change keys only within their stored-size budget", () => {
  using database = new DatabaseSync(":memory:");
  for (const migration of [WORKBOOK_LIBRARY_MIGRATION, WORKBOOK_MASTER_MIGRATION, WORKBOOK_LIBRARY_CATALOG_MIGRATION, WORKBOOK_LIBRARY_SYNC_STATUS_MIGRATION, WORKBOOK_PAYLOAD_TABLE]) {
    for (const statement of migration.statements) database.exec(statement);
  }
  let generation = 1;
  const open = (decodedCacheCharacters?: number) => createWorkbookLibraryRepository({ database, mutate: work => work().result, read: work => work(),
    changeKey: () => ({ authorityGeneration: generation, dataVersion: 1, totalChanges: 0 }), decodedCacheCharacters });
  const service = createWorkbookLibraryService({ repository: open(), clock: manualClock(new Date(savedAt)), sync: unexpectedWorkbookSync });
  const [first, second] = ["First.xlsx", "Other.xlsx"].map(name => service.create({ name, themes: [], hasFormulas: false,
    sheets: [{ id: "people", name: "People", width: 1, hidden: [], headerRow: 1, rows: [{ id: "header", cells: [{ value: "x".repeat(16 * 1024) }] }] }] }).libraryId);
  // A row's stored size counts the workbook it names.
  const largest = Number(database.prepare(`SELECT max(length(r.payload_json)+length(p.payload_json)) AS size FROM (SELECT payload_json FROM workbook_library UNION ALL SELECT payload_json FROM workbook_library_snapshots) r
    JOIN workbook_payloads p ON p.digest=json_extract(r.payload_json,'$.workbookDigest')`).get()?.size);
  const rereadFirst = (repository: ReturnType<typeof open>) => {
    const before = [repository.read(first), repository.libraryVersion(first).workbook];
    generation++;
    repository.read(second); repository.libraryVersion(second);
    generation++;
    return { before, after: [repository.read(first), repository.libraryVersion(first).workbook] };
  };
  const roomy = rereadFirst(open(4 * largest));
  roomy.after.forEach((value, index) => expect(value).toBe(roomy.before[index]));
  const tight = rereadFirst(open(Math.floor(1.5 * largest)));
  tight.after.forEach((value, index) => { expect(value).not.toBe(tight.before[index]); expect(value).toEqual(tight.before[index]); });
});

it("reads a saved revision and a following metadata revision with a retained key annotation", () => {
  using database = new DatabaseSync(":memory:");
  const { id, repository, service } = workbookFixture(database);
  const workbook = structuredClone(service.read(id).workbook);
  workbook.sheets[0].rows[1].cells[1].value = "Edited Person";
  const saved = service.save(id, 2, workbook);
  const last = repository.journal(id).at(-1);
  if (last === undefined) throw new Error("fixture save receipt missing");
  expect(last?.changes).toMatchObject([{ key: "LEFT@example.test", newValue: "Edited Person" }]);
  service.operatorOperation(id, "metadata-after-save", { kind: "metadata", expectedVersion: saved.version,
    metadata: { typeId: "roster", sharePoint: null } });
  const metadataOnly = service.read(id);
  service.save(id, metadataOnly.version, { ...metadataOnly.workbook, name: "Latest.xlsx" });

  database.exec("DROP TRIGGER workbook_operations_immutable");
  database.prepare("UPDATE workbook_operations SET receipt_json=json_set(receipt_json,'$.changes[0].key',?) WHERE sequence=?")
    .run("left@example.test", last.sequence);
  expect(repository.journal(id)[1]?.changes[0]?.key).toBe("left@example.test");
  expect(service.revision(id, saved.version)).toEqual(saved);
  expect(service.revision(id, metadataOnly.version)).toEqual(metadataOnly);
  database.prepare("UPDATE workbook_operations SET receipt_json=json_set(receipt_json,'$.version',99) WHERE sequence=?").run(last.sequence);
  expect(() => service.revision(id, saved.version)).toThrow(expect.objectContaining({ code: "WORKBOOK_STORAGE_CORRUPT" }));
});

function preCatalogueWorkbook(database: DatabaseSync) {
  const id = "retained-roster", eid = "10800000";
  const metadata = { typeId: "roster", sharePoint: null };
  const first = encodeSavedWorkbook({ libraryId: id, version: 1, createdAt: savedAt, savedAt,
    workbook: { libraryId: id, name: "Roster.xlsx", themes: [], hasFormulas: false, sheets: [{
      id: "people", name: "People", width: 2, hidden: [], headerRow: 1,
      columnBindings: ["eid", "fullName"].map((fieldId, sourceColumn) => ({ id: fieldId, sourceColumn, sourceHeader: fieldId, fieldId, basis: "manual" })),
      rows: [{ id: "header", cells: [{ value: "EID" }, { value: "Name" }] },
        { id: "text-key", cells: [{ value: eid }, { value: null }] }, { id: "numeric-key", cells: [{ value: Number(eid) }, { value: null }] }],
    }] },
  });
  for (const statement of WORKBOOK_LIBRARY_MIGRATION.statements) database.exec(statement);
  for (const table of ["workbook_library", "workbook_library_history"]) {
    database.prepare(`INSERT INTO ${table} VALUES(?,?,?,?,?)`).run(id, 1, savedAt, savedAt, JSON.stringify(first));
  }
  for (const statement of WORKBOOK_MASTER_MIGRATION.statements) database.exec(statement);
  database.prepare("INSERT INTO workbook_types VALUES(?,?)").run("roster",
    JSON.stringify({ id: "roster", name: "Roster", keyFieldId: "eid", fields: ["eid", "fullName"], defaultWorkbookId: null }));

  const resolvedRow = { sheetId: "people", rowId: "text-key" };
  const insert = database.prepare("INSERT INTO workbook_operations(sequence,workbook_id,operation_id,digest,request_json,receipt_json) VALUES(?,?,?,?,?,?)");
  function settle(sequence: number, input: unknown, effects: object) {
    const request = WorkbookOperationSchema.parse(input);
    const json = canonicalJsonStringify(request);
    const receipt = WorkbookOperationReceiptSchema.parse({ operationId: request.operationId, sequence, libraryId: id,
      source: request.source, state: "applied", version: sequence + 1, at: savedAt, candidates: [], changes: [], ...effects });
    insert.run(sequence, id, request.operationId, sha256Hex(json), json, JSON.stringify(receipt));
  }
  settle(1, { operationId: "assign-type", at: savedAt, source: { kind: "operator" }, change: { kind: "metadata", expectedVersion: 1, metadata } }, {});
  function migrate(head: typeof first, ownerRow: string, value: string, operatorRow?: string) {
    database.prepare("UPDATE workbook_library SET version=?, payload_json=?, metadata_json=?, ownership_json=? WHERE id=?")
      .run(head.version, JSON.stringify(head), JSON.stringify(metadata), JSON.stringify({
        [JSON.stringify(["people", ownerRow, "fullName"])]: { owner: "relay", value },
        ...(operatorRow === undefined ? {} : { [JSON.stringify(["people", operatorRow, "fullName"])]: { owner: "operator" } }),
      }), id);
    for (const migration of [WORKBOOK_LIBRARY_CATALOG_MIGRATION, WORKBOOK_LIBRARY_PIN_TAGS_MIGRATION, WORKBOOK_LIBRARY_SYNC_STATUS_MIGRATION]) {
      for (const statement of migration.statements) database.exec(statement);
    }
    moveWorkbookPayloads(database);
    const repository = createWorkbookLibraryRepository({ database, mutate: work => work().result, read: work => work() });
    const service = createWorkbookLibraryService({ repository, clock: manualClock(new Date(savedAt)), sync: unexpectedWorkbookSync });
    const live = service.read(id);
    service.save(id, live.version, { ...live.workbook, name: "Latest.xlsx" });
    return service;
  }
  function patch(expectedVersion: number, oldValue: string | null, newValue: string) {
    settle(expectedVersion, { operationId: `fill-${expectedVersion}`, at: savedAt,
      source: { kind: "run", runId: "10000000-0000-4000-8000-000000000001" },
      change: { kind: "patch", expectedVersion, key: eid, values: { fullName: newValue } } },
    { key: eid, candidates: [resolvedRow], changes: [{ ...resolvedRow, fieldId: "fullName", oldValue, newValue }] });
  }
  return { first, id, migrate, patch, settle };
}

it.each([[3, "named history"], [4, "journal only"], [5, "migration current"]] as const)("reads revision %s from earlier keyed settlements (%s)", (version, _source) => {
  using database = new DatabaseSync(":memory:");
  const { first, id, migrate, patch } = preCatalogueWorkbook(database);
  const names = ["First Fixture", "Second Fixture", "Third Fixture"];
  names.forEach((newValue, index) => {
    patch(index + 2, names[index - 1] ?? null, newValue);
  });
  const retained = (revision: number) => {
    const workbook = structuredClone(first.workbook);
    workbook.sheets[0].rows[1].cells[1].value = names[revision - 3];
    return { ...first, version: revision, workbook };
  };
  database.prepare("INSERT INTO workbook_library_history VALUES(?,?,?,?,?,?,?)")
    .run(id, "Reviewed", "operator", 3, savedAt, savedAt, JSON.stringify(retained(3)));
  const service = migrate(retained(5), "text-key", names[2]);
  expect(service.revision(id, version)).toEqual(retained(version));
});

it.each([[4, false], [5, false], [5, true]] as const)("reads revision %s after an earlier Sync (corrupt Sync receipt %s)", (version, corruptSync) => {
  using database = new DatabaseSync(":memory:");
  const { first, id, migrate, patch, settle } = preCatalogueWorkbook(database);
  const name = "Earlier Relay fill", external = "Updated in SharePoint";
  patch(2, null, name);
  const incoming = structuredClone(first.workbook);
  incoming.sheets[0].rows[1].id = "imported-key";
  incoming.sheets[0].rows[1].cells[1].value = "SharePoint cell";
  incoming.sheets[0].rows[2].cells[1].value = external;
  settle(3, { operationId: "earlier-sync", at: savedAt, source: { kind: "sync", syncId: "earlier-sync" },
    change: { kind: "sync", expectedVersion: 3, workbook: incoming } },
  { changes: [{ sheetId: "people", rowId: "numeric-key", fieldId: "fullName", oldValue: null, newValue: external }] });
  const synced = { ...first, version: 4, workbook: structuredClone(incoming) };
  synced.workbook.sheets[0].rows[1].cells[1].value = name;
  const saved = { ...synced, version: 5, workbook: structuredClone(synced.workbook) };
  saved.workbook.name = "Earlier save.xlsx";
  const savedName = "Independent save cell";
  saved.workbook.sheets[0].rows[2].cells[1].value = savedName;
  settle(4, { operationId: "earlier-save", at: savedAt, source: { kind: "operator" },
    change: { kind: "save", expectedVersion: 4, workbook: saved.workbook } },
  { changes: [{ sheetId: "people", rowId: "numeric-key", fieldId: "fullName", oldValue: external, newValue: savedName }] });
  const service = migrate(saved, "imported-key", name, "numeric-key");

  if (corruptSync) {
    database.exec("DROP TRIGGER workbook_operations_immutable");
    database.prepare("UPDATE workbook_operations SET receipt_json=json_set(receipt_json,'$.changes[0].newValue','Wrong fixture') WHERE operation_id='earlier-sync'").run();
    expect(() => service.revision(id, synced.version)).toThrow(expect.objectContaining({ code: "WORKBOOK_STORAGE_CORRUPT" }));
  }
  expect(service.revision(id, version)).toEqual(version === 4 ? synced : saved);
  if (corruptSync) {
    database.prepare("UPDATE workbook_operations SET receipt_json=json_set(receipt_json,'$.changes[0].newValue','Wrong fixture') WHERE operation_id='earlier-save'").run();
    expect(() => service.revision(id, saved.version)).toThrow(expect.objectContaining({ code: "WORKBOOK_STORAGE_CORRUPT" }));
  }
});

it.each(["oldValue", "newValue"] as const)("rejects a retained patch receipt with a contradictory %s", field => {
  using database = new DatabaseSync(":memory:");
  const { id, repository, service } = workbookFixture(database);
  const workbook = structuredClone(service.read(id).workbook);
  const key = "blank@example.test";
  workbook.sheets[0].rows.push({ id: "blank", cells: [{ value: key }, { value: null }] });
  const before = service.save(id, 2, workbook);
  const patch = repository.operation(id, { operationId: "fill", at: savedAt, source: { kind: "run", runId: "fixture-run" },
    change: { kind: "patch", expectedVersion: before.version, key, values: { fullName: "Stored Name" } } });
  expect(patch).toMatchObject({ state: "applied", changes: [{ oldValue: null, newValue: "Stored Name" }] });
  const after = service.read(id);
  service.save(id, after.version, { ...after.workbook, name: "Latest.xlsx" });
  expect(service.revision(id, patch.version)).toEqual(after);

  database.exec("DROP TRIGGER workbook_operations_immutable");
  database.prepare("UPDATE workbook_operations SET receipt_json=json_set(receipt_json,?,?) WHERE sequence=?")
    .run(`$.changes[0].${field}`, "Contradictory Name", patch.sequence);
  expect(() => service.revision(id, patch.version)).toThrow(expect.objectContaining({ code: "WORKBOOK_STORAGE_CORRUPT" }));
});

it.each([["save", "oldValue"], ["save", "newValue"], ["sync", "oldValue"], ["sync", "newValue"]] as const)(
  "rejects a snapshot-backed %s receipt with a contradictory %s", (kind, field) => {
    using database = new DatabaseSync(":memory:");
    const { id, repository, service } = workbookFixture(database);
    const before = service.read(id), workbook = structuredClone(before.workbook);
    workbook.sheets[0].rows[1].cells[1].value = "Saved Fixture";
    if (kind === "save") service.save(id, before.version, workbook);
    else repository.operation(id, { operationId: "fixture-sync", at: savedAt, source: { kind: "sync", syncId: "fixture-sync" },
      change: { kind: "sync", expectedVersion: before.version, workbook: encodeSavedWorkbook({ ...before, workbook }).workbook } });
    const settled = repository.journal(id).at(-1);
    if (settled === undefined) throw new Error("fixture content receipt missing");
    expect(settled).toMatchObject({ state: "applied", changes: [{ oldValue: "Fixture Person", newValue: "Saved Fixture" }] });
    const after = service.read(id);
    service.save(id, after.version, { ...after.workbook, name: "Latest.xlsx" });
    expect(service.revision(id, settled.version)).toEqual(after);

    database.exec("DROP TRIGGER workbook_operations_immutable");
    database.prepare("UPDATE workbook_operations SET receipt_json=json_set(receipt_json,?,?) WHERE sequence=?")
      .run(`$.changes[0].${field}`, "Wrong Fixture", settled.sequence);
    expect(() => service.revision(id, settled.version)).toThrow(expect.objectContaining({ code: "WORKBOOK_STORAGE_CORRUPT" }));
  },
);

it("retains recorded key matches while authenticating the values against the named sheet", () => {
  using database = new DatabaseSync(":memory:");
  const { id, repository } = workbookFixture(database);
  const request = { typeId: "roster", libraryId: id, versionId: "original", keys: ["LEFT@example.test"], fields: ["fullName"] };
  const snapshot = structuredClone(repository.snapshot(request));
  const storedKey = "left@example.test";
  snapshot.rows[0].key = storedKey;
  const storedRequest = { ...request, keys: [storedKey] };
  const command = { typeId: "roster", keys: [storedKey, "other@example.test"] };
  const bound = bindRunWorkbookReference(storedRequest, snapshot);
  const read = readRetainedWorkbookReference(repository, bound, command);
  expect(decodeWorkbookReference(read.reference).snapshot.rows).toEqual([
    { key: storedKey, state: "matched", matches: [{ sheetId: "people", rowId: "first", values: { fullName: "Fixture Person" } }] },
    { key: "other@example.test", state: "matched", matches: [{ sheetId: "people", rowId: "second", values: { fullName: "Other Person" } }] },
  ]);

  snapshot.rows[0].matches[0].values.fullName = "Changed Person";
  const changed = bindRunWorkbookReference(storedRequest, snapshot);
  expect(() => readRetainedWorkbookReference(repository, changed, command)).toThrow(expect.objectContaining({ code: "WORKBOOK_STORAGE_CORRUPT" }));
});

it("scans a retained worksheet linearly across a batch of late keys", () => {
  using database = new DatabaseSync(":memory:");
  const { id, repository, service } = workbookFixture(database);
  const keys = Array.from({ length: 64 }, (_, index) => `fixture-${index}@example.test`);
  const workbook = structuredClone(service.read(id).workbook);
  workbook.sheets[0].rows.push(...keys.map((key, index) => ({ id: `row-${index}`, cells: [{ value: key }, { value: `Fixture ${index}` }] })));
  workbook.sheets[0].rows.push({ id: "duplicate", cells: [{ value: keys[0] }, { value: "Duplicate" }] });
  const saved = service.save(id, 2, workbook);
  const request = { typeId: "roster", libraryId: id, versionId: `revision:${saved.version}`, keys: [], fields: ["fullName"] };
  const bound = bindRunWorkbookReference(request, repository.snapshot(request));
  const selected = repository.libraryVersion(id, request.versionId), sheet = selected.workbook.sheets[0];
  let rowReads = 0;
  const rows = new Proxy(sheet.rows, { get(array, key): unknown {
    if (typeof key === "string" && /^\d+$/u.test(key)) rowReads++;
    return Reflect.get(array, key);
  } });
  const readVersion = vi.spyOn(repository, "libraryVersion").mockReturnValue({ ...selected, workbook: { ...selected.workbook, sheets: [{ ...sheet, rows }] } });
  try {
    const read = readRetainedWorkbookReference(repository, bound, { typeId: "roster", keys });
    expect(decodeWorkbookReference(read.reference).snapshot.rows.map(row => row.matches[0]?.rowId))
      .toEqual(keys.map((_, index) => `row-${index}`));
    expect(rowReads).toBeLessThanOrEqual(2 * rows.length);
    rowReads = 0;
    const { matchesFor } = verifyRetainedNamedWorkbookReference(repository, parseRunWorkbookReference(bound), "retained");
    expect(matchesFor(keys[0]).map(({ row, rowNumber }) => [row.id, rowNumber])).toEqual([["row-0", 4], ["duplicate", 68]]);
    expect(rowReads).toBeLessThanOrEqual(rows.length);
  } finally { readVersion.mockRestore(); }
});

it("checks duplicate person matches in physical row order with one worksheet scan", async () => {
  const clock = manualClock(new Date(NOW));
  const f = await openBoundDatabaseFixture("retained-workbook-person-check", clock);
  try {
    const { authority } = f.database, repository = authority.workbooks;
    const runtimeConfig = authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    const library = createWorkbookLibraryService({ repository, clock, sync: unexpectedWorkbookSync });
    const eid = "10800000", name = "Target Fixture", typeId = "reference-check";
    const { libraryId } = library.create({ name: "People.xlsx", themes: [], hasFormulas: false,
      sheets: [{ id: "people", name: "People", width: 2, hidden: [], headerRow: 1,
        columnBindings: ["eid", "fullName"].map((fieldId, sourceColumn) => ({ id: fieldId, fieldId, sourceColumn, sourceHeader: fieldId, basis: "manual" })),
        rows: [{ id: "header", cells: [{ value: "Employee ID" }, { value: "Name" }] },
          ...Array.from({ length: 64 }, (_, index) => ({ id: `row-${index}`, cells: [{ value: eid }, { value: index === 63 ? name : "Other Person" }] }))],
      }],
    });
    const request = { typeId, libraryId, versionId: "original", keys: [], fields: ["eid"] };
    const snapshot = library.snapshot({ ...request, kind: "selected-source", mode: "keys", sheetId: "people", expectedVersion: 1, keyFieldId: "eid", writableFields: [] });
    const queued = RunRecordSchema.parse({ ...QUEUED_RUN, input: { ...QUEUED_RUN.input, workbookReferences: [bindRunWorkbookReference(request, snapshot)] } });
    authority.runs.enqueue(queued);
    const workflow = queued.envelope.workflow;
    const { workerId } = testAdmittedWorker(f.database, clock, { path: f.path, workflow, poolIndex: 1, browserSystems: [] });
    const lifecycle = testRunService(f.database, clock);
    const claimed = lifecycle.claimNext({ commandId: randomUUID(), workflow, workerId, runtimeConfig: {
      generation: runtimeConfig.generation, settingsRevision: runtimeConfig.settingsRevision,
      settingsFingerprint: runtimeConfig.settingsFingerprint, configFingerprint: runtimeConfig.configFingerprint,
    } });
    if (claimed.state !== "applied") throw new Error("fixture claim refused");
    const runId = queued.envelope.runId, claim = { workerId, claimGeneration: claimed.run.claimGeneration };
    for (const state of ["validating", "running"] as const) {
      expect(lifecycle.workerTransition({ commandId: randomUUID(), runId, claim,
        lifecycle: { state, workerId, claimedAt: NOW, heartbeatAt: NOW } }).state).toBe("applied");
    }
    const running = authority.runs.get(runId);
    if (running === undefined) throw new Error("fixture running record missing");
    const selected = repository.libraryVersion(libraryId, request.versionId), sheet = selected.workbook.sheets[0];
    let rowReads = 0;
    const rows = new Proxy(sheet.rows, { get(array, key): unknown {
      if (typeof key === "string" && /^\d+$/u.test(key)) rowReads++;
      return Reflect.get(array, key);
    } });
    const readVersion = vi.spyOn(repository, "libraryVersion").mockReturnValue({ ...selected, workbook: { ...selected.workbook, sheets: [{ ...sheet, rows }] } });
    try {
      const result = createRunWorkbookService({ database: f.database, clock }).readReferenceFields(running, { typeId, key: eid, columns: ["fullName"] });
      expect(result.state).toBe("read-fields");
      expect(result.sheets.map(({ sheet, rows: found }) => [sheet, found])).toEqual([["People",
        Array.from({ length: 64 }, (_, index) => ({ row: index + 2, values: [{ field: "fullName", value: index === 63 ? name : "Other Person" }] })),
      ]]);
      expect(rowReads).toBeLessThanOrEqual(rows.length);
    } finally {
      readVersion.mockRestore();
      expect(lifecycle.requeue({ commandId: randomUUID(), runId, expectedVersion: running.version, claim, cause: "recovery" }).state).toBe("applied");
    }
  } finally { await f.close(); }
});

it("reuses selected workbook compatibility metadata until its catalogue changes", () => {
  using database = new DatabaseSync(":memory:");
  const { id, repository, service } = workbookFixture(database, true);
  const readVersion = vi.spyOn(repository, "libraryVersion");
  try {
    const before = service.compatibility([]);
    expect(service.compatibility([])).toEqual(before);
    expect(readVersion).toHaveBeenCalledTimes(1);

    const editable = structuredClone(service.read(id).workbook);
    delete editable.sheets[0].columnBindings;
    const saved = service.save(id, 2, editable);
    expect(service.compatibility([]).libraries).toEqual([{ libraryId: id, versionId: `revision:${saved.version}`,
      sheets: [{ sheetId: "people", sheetName: "People", mappings: [], workflows: [] }] }]);
    expect(readVersion).toHaveBeenCalledTimes(2);
  } finally { readVersion.mockRestore(); }
});

it("reads a terminal CRM workbook checkpoint produced by an earlier implementation", async () => {
  const clock = manualClock(new Date(NOW));
  const f = await openBoundDatabaseFixture("retained-workbook-checkpoint", clock);
  try {
    const { authority } = f.database;
    authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    const library = createWorkbookLibraryService({ repository: authority.workbooks, clock, sync: unexpectedWorkbookSync });
    const { libraryId } = library.create({ name: "Roster.xlsx", themes: [], hasFormulas: false,
      sheets: [{ id: "people", name: "People", width: 1, hidden: [], headerRow: 1,
        columnBindings: [{ id: "email", fieldId: "email", sourceColumn: 0, sourceHeader: "Email", basis: "manual" }],
        rows: [{ id: "header", cells: [{ value: "Email" }] }] }] });
    const request = { typeId: ONBOARDING_ROSTER_TYPE_ID, libraryId, versionId: "original", keys: [], fields: ["email"] };
    const snapshot = library.snapshot({ ...request, kind: "selected-source", mode: "keys", sheetId: "people", expectedVersion: 1, keyFieldId: "email", writableFields: [] });
    const bound = bindRunWorkbookReference(request, snapshot);
    const referenceDigest = sha256Hex(canonicalJsonStringify(bound));
    const { people: [person] } = ReadCrmDocumentRows.example;
    const value = ReadCrmDocumentRows.output.parse({ referenceDigest, sourceDigests: [referenceDigest], state: "resolve-required",
      people: [{ ...person, resolution: { state: "resolve-required", reason: "row-missing", candidates: [] } }],
    });
    const raw = { people: person.subject.value };
    const queued = RunRecordSchema.parse({ ...QUEUED_RUN, claimGeneration: 1,
      envelope: { ...QUEUED_RUN.envelope, workflow: "crm-doc-download", traceId: "crm-170000-2222" },
      input: { ...QUEUED_RUN.input, raw, parsed: { schemaHash: deriveSchemaHash(CrmDocDownloadCanonicalInput, "output"), protectedBindings: [],
        value: CrmDocDownloadInput.parse(raw) }, workbookReferences: [bound] },
    });
    authority.runs.enqueue(queued);
    const transition = testRunService(f.database, clock).transition({ commandId: randomUUID(), runId: queued.envelope.runId,
      expectedVersion: queued.version, lifecycle: { state: "terminal", outcome: "discarded", endedAt: NOW } });
    if (transition.state !== "applied") throw new Error("fixture terminal transition refused");
    authority.runCheckpoints.insert({ workflowId: queued.envelope.workflow, itemId: queued.envelope.itemId,
      nodeId: "document-rows", attempt: queued.envelope.attempt, claimGeneration: 1, runId: queued.envelope.runId,
      output: { schemaHash: deriveSchemaHash(ReadCrmDocumentRows.output, "output"), value }, descriptorVersion: queued.envelope.descriptorVersion,
      contractFingerprint: queued.envelope.contractFingerprint, implFingerprint: HASH_B, provenance: [], writtenAt: NOW,
    });
    expect(() => buildRunWorkbookSection(authority, queued)).toThrow(expect.objectContaining({ code: "WORKBOOK_STORAGE_CORRUPT" }));
    expect(buildRunWorkbookSection(authority, transition.run).referenceChoices).toMatchObject([{
      libraryId, referenceDigest, key: person.subject.value, reason: "row-missing",
      resolution: { state: "unavailable", code: "WORKBOOK_ROW_CHOICE_UNAVAILABLE", candidates: [] },
    }]);
  } finally { await f.close(); }
});

it("adds workbook storage to the baseline without changing existing schema or records, and persists after reopen", () => {
  const root = mkdtempSync(join(tmpdir(), "relay-workbook-")), path = join(root, "authority.sqlite");
  let database = new DatabaseSync(path);
  try {
    for (const statement of SQLITE_MIGRATIONS[0].statements) database.exec(statement);
    database.prepare("INSERT INTO database_states(id,schema_version,authority_generation,updated_at,search_state) VALUES(1,1,17,?,'unbuilt')").run("2026-10-12T00:00:00.000Z");
    const existingSchema = database.prepare("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all();
    const state = database.prepare("SELECT * FROM database_states").get();
    database.exec("BEGIN IMMEDIATE");
    for (const statement of [...WORKBOOK_LIBRARY_MIGRATION.statements, ...WORKBOOK_MASTER_MIGRATION.statements, ...WORKBOOK_LIBRARY_CATALOG_MIGRATION.statements, ...WORKBOOK_LIBRARY_SYNC_STATUS_MIGRATION.statements, ...WORKBOOK_PAYLOAD_TABLE.statements]) database.exec(statement);
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
    for (const statement of [...WORKBOOK_LIBRARY_MIGRATION.statements, ...WORKBOOK_MASTER_MIGRATION.statements, ...WORKBOOK_LIBRARY_CATALOG_MIGRATION.statements, ...WORKBOOK_LIBRARY_SYNC_STATUS_MIGRATION.statements, ...WORKBOOK_PAYLOAD_TABLE.statements]) database.exec(statement);
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
