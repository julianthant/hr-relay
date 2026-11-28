import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { applyAuthorityMigrationsAfter } from "../../../../src/backend/storage/sqlite/authority-upgrades.js";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { createWorkbookLibraryRepository, validateWorkbookLibrary } from "../../../../src/backend/storage/sqlite/workbook-library-repository.js";
import { IsoInstantSchema } from "../../../../src/rules/identity/ids.js";

it("assigns the first free suffix to existing duplicate names while retaining snapshots and actions", () => {
  using database = new DatabaseSync(":memory:");
  const predecessorVersion = 47;
  for (const migration of SQLITE_MIGRATIONS.filter(migration => migration.version <= predecessorVersion)) {
    for (const statement of migration.statements) database.exec(statement);
  }
  const repository = createWorkbookLibraryRepository({ database, read: work => work(), mutate: work => work().result });
  const libraryId = "roster", at = IsoInstantSchema.parse("2026-11-02T00:00:00.000Z");
  repository.create({ libraryId, version: 1, createdAt: at, savedAt: at, workbook: { libraryId, name: "Roster.xlsx", themes: [],
    hasFormulas: false, sheets: [{ id: "people", name: "People", hidden: [], width: 1, rows: [{ id: "header", cells: [{ value: "EID" }] }] }] } });
  for (const [operationId, name] of [["first", "Reviewed"], ["second", "Before migration"], ["third", "Reviewed (2)"]]) {
    repository.libraryAction(libraryId, { operationId, expectedRevision: repository.libraryState(libraryId).revision, expectedVersion: 1,
      change: { kind: "create-version", name, from: { kind: "version", versionId: "original" }, useNow: operationId === "second" } }, at);
  }
  database.prepare("UPDATE workbook_library_state SET payload_json=json_set(payload_json,'$.versions[2].name',?) WHERE id=?").run("Reviewed", libraryId);
  const before = repository.libraryState(libraryId);
  const selected = repository.libraryVersion(libraryId);
  const receipt = repository.libraryActionRecord(libraryId, "second");
  expect(selected.version.name).toBe("Reviewed");
  expect(receipt).toBeDefined();

  database.exec("BEGIN");
  applyAuthorityMigrationsAfter(database, predecessorVersion, { now: at, captureFile: () => { throw new Error("no capture expected"); } });
  database.exec("COMMIT");

  const updated = { ...selected.version, name: "Reviewed (3)" };
  expect(repository.libraryState(libraryId)).toEqual({ ...before, versions: [before.versions[0], before.versions[1], updated, before.versions[3]] });
  expect(repository.libraryVersion(libraryId)).toEqual({ ...selected, version: updated });
  expect(repository.libraryActionRecord(libraryId, "second")).toEqual(receipt);
  expect(validateWorkbookLibrary(database)).toBeGreaterThan(0);
});
