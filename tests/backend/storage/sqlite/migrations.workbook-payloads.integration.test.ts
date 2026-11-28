import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it, vi } from "vitest";
import { z } from "zod";
import { applyAuthorityMigrationsAfter } from "../../../../src/backend/storage/sqlite/authority-upgrades.js";
import { inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-inspection.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, SQLITE_MIGRATIONS, auditMigrationTableCoverage, migrationTableNames } from "../../../../src/backend/storage/sqlite/migrations.js";
import { createWorkbookLibraryRepository, validateWorkbookLibrary, WORKBOOK_PAYLOAD_MIGRATION } from "../../../../src/backend/storage/sqlite/workbook-library-repository.js";
import { encodeSavedWorkbook, type SavedWorkbook } from "../../../../src/models/dashboard/workbooks.js";
import { IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { restoreSchema36QueryIndexes, restoreSchema37WorkbookPayloads } from "../../../support/fixtures/storage/historical-run-schema.js";
import { storageRecoveryFixture } from "../../../support/helpers/integration/storage-recovery-fixture.js";

const CAPTURE = { now: "2026-11-17T00:00:00.000Z", captureFile: () => { throw new Error("no capture expected"); } };
const CREATED = IsoInstantSchema.parse("2026-11-16T00:00:00.000Z"), SAVED = IsoInstantSchema.parse("2026-11-16T01:00:00.000Z"), USED = IsoInstantSchema.parse("2026-11-16T02:00:00.000Z");
const TABLES = ["workbook_library", "workbook_creations", "workbook_library_history", "workbook_library_snapshots"] as const;
const ROWS = 600;

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach(database => database.close()));

/** A roster large enough that each stored copy is measurable in the file. */
function roster(changed: string) {
  return { libraryId: "roster", name: "Roster.xlsx", themes: [], hasFormulas: false, sheets: [{ id: "people", name: "Sheet 1", hidden: [], width: 4,
    rows: [{ id: "header", cells: [{ value: "EID" }, { value: "Name" }, { value: "Department" }, { value: "Status" }] },
      ...Array.from({ length: ROWS }, (_, index) => ({ id: `person-${String(index)}`, cells: [{ value: String(10_000_000 + index) },
        { value: `Synthetic person ${String(index)}` }, { value: "Synthetic department of record" }, { value: index === 0 ? changed : "Active" }] }))] }] };
}

const repositoryOf = (database: DatabaseSync) => createWorkbookLibraryRepository({ database, read: work => work(), mutate: work => work().result });
const present = (record: SavedWorkbook | undefined) => { assert.ok(record); return encodeSavedWorkbook(record); };

/**
 * One spreadsheet with every kind of stored copy: its creation, a named version, a saved revision, and a return to the original,
 * whose snapshot holds the same workbook as the creation.
 */
function seed(database: DatabaseSync): void {
  const repository = repositoryOf(database);
  repository.create({ libraryId: "roster", version: 1, createdAt: CREATED, savedAt: CREATED, workbook: roster("Active") });
  assert.equal(repository.operation("roster", { operationId: "reviewed", source: { kind: "operator" }, at: CREATED,
    change: { kind: "version", expectedVersion: 1, name: "Reviewed" } }).state, "applied");
  repository.save({ libraryId: "roster", version: 2, createdAt: CREATED, savedAt: SAVED, workbook: roster("On leave") }, 1);
  repository.libraryAction("roster", { operationId: "use-original", expectedRevision: 2, expectedVersion: 2, change: { kind: "use-version", versionId: "original" } }, USED);
}

/** Every version of the spreadsheet as the library reads it back: current, creation, named versions, library versions and each revision. */
function readback(database: DatabaseSync): string {
  const repository = repositoryOf(database), state = repository.libraryState("roster");
  return canonicalJsonStringify({ current: present(repository.read("roster")), creation: present(repository.creation("roster")), named: repository.versions("roster"),
    library: state.versions.map(version => repository.libraryVersion("roster", version.id)),
    revisions: [1, 2, 3].map(version => encodeSavedWorkbook(repository.revision("roster", version))) });
}

function currentStore(): DatabaseSync {
  const database = new DatabaseSync(":memory:"); databases.push(database);
  database.exec("PRAGMA foreign_keys=ON");
  for (const migration of SQLITE_MIGRATIONS) for (const statement of migration.statements) database.exec(statement);
  database.exec(`PRAGMA user_version=${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
  return database;
}

/** Each schema-37 row's payload, canonical, with its embedded workbook. */
const embedded = (database: DatabaseSync) => TABLES.map(table => database.prepare(`SELECT payload_json FROM ${table} ORDER BY rowid`).all()
  .map(row => canonicalJsonStringify(JSON.parse(z.object({ payload_json: z.string() }).parse(row).payload_json))));
/** Each schema-38 row's payload with its stored workbook put back in SQL, canonical. */
const reassembled = (database: DatabaseSync) => TABLES.map(table => database.prepare(`SELECT json_set(json_remove(source.payload_json,'$.workbookDigest'),'$.workbook',json(stored.payload_json)) AS payload_json
    FROM ${table} AS source JOIN workbook_payloads AS stored ON stored.digest=json_extract(source.payload_json,'$.workbookDigest') ORDER BY source.rowid`).all()
  .map(row => canonicalJsonStringify(JSON.parse(z.object({ payload_json: z.string() }).parse(row).payload_json))));
const storedBytes = (database: DatabaseSync, tables: readonly string[]) => tables.reduce((total, table) =>
  total + z.object({ bytes: z.number() }).parse(database.prepare(`SELECT coalesce(sum(length(payload_json)),0) AS bytes FROM ${table}`).get()).bytes, 0);

describe("workbook payload migration 38", () => {
  it("is under the current schema 49 and adds only the payload table", () => {
    assert.equal(WORKBOOK_PAYLOAD_MIGRATION.version, 38);
    assert.equal(CURRENT_AUTHORITY_SCHEMA_VERSION, 49);
    assert.deepEqual(migrationTableNames(38).filter(table => !migrationTableNames(37).includes(table)), ["workbook_payloads"]);
    assert.deepEqual(auditMigrationTableCoverage(), []);
  });

  it("stores each distinct workbook once and reads every version back unchanged", () => {
    const database = currentStore();
    seed(database);
    const before = readback(database);
    restoreSchema37WorkbookPayloads(database);
    const rows = embedded(database);
    assert.deepEqual(rows.map(table => table.length), [1, 1, 1, 3]);
    const copies = storedBytes(database, TABLES);
    database.exec("BEGIN");
    applyAuthorityMigrationsAfter(database, 37, CAPTURE);
    database.exec("COMMIT");
    assert.deepEqual(reassembled(database), rows);
    assert.equal(readback(database), before);
    const payloads = z.array(z.object({ digest: z.string(), payload_json: z.string() })).parse(database.prepare("SELECT digest,payload_json FROM workbook_payloads").all());
    assert.equal(payloads.length, 2);
    for (const payload of payloads) assert.equal(sha256Hex(payload.payload_json), payload.digest);
    assert.ok(storedBytes(database, [...TABLES, "workbook_payloads"]) * 2 < copies);
    assert.ok(validateWorkbookLibrary(database) > 0);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  });

  it("keeps the creation record and retained versions immutable and never removes a payload a row still names", () => {
    const database = currentStore();
    seed(database);
    const digest = (table: string, where: string) => z.object({ digest: z.string() })
      .parse(database.prepare(`SELECT json_extract(payload_json,'$.workbookDigest') AS digest FROM ${table} WHERE ${where}`).get()).digest;
    const original = digest("workbook_creations", "id='roster'");
    assert.throws(() => database.exec("UPDATE workbook_creations SET payload_json=payload_json"), /workbook-evidence-immutable/u);
    assert.throws(() => database.exec("DELETE FROM workbook_creations"), /workbook-evidence-retained/u);
    assert.throws(() => database.exec("UPDATE workbook_library_history SET payload_json=payload_json"), /workbook-evidence-immutable/u);
    assert.throws(() => database.exec("DELETE FROM workbook_library_history"), /workbook-evidence-retained/u);
    assert.throws(() => database.exec("UPDATE workbook_library_snapshots SET payload_json=payload_json"), /workbook-library-snapshot-immutable/u);
    assert.throws(() => database.exec("UPDATE workbook_payloads SET payload_json=payload_json"), /workbook-evidence-immutable/u);
    assert.throws(() => database.prepare("DELETE FROM workbook_payloads WHERE digest=?").run(original), /workbook-payload-referenced/u);
    // A snapshot removal, were one ever allowed, leaves the workbook the creation record and the library still name.
    database.exec("DROP TRIGGER workbook_library_snapshots_delete");
    database.exec(`DELETE FROM workbook_library_snapshots WHERE id='["roster","original"]'`);
    assert.equal(digest("workbook_library", "id='roster'"), original);
    assert.throws(() => database.prepare("DELETE FROM workbook_payloads WHERE digest=?").run(original), /workbook-payload-referenced/u);
    database.prepare("INSERT INTO workbook_payloads(digest,payload_json) VALUES(?,?)").run(sha256Hex("{}"), "{}");
    assert.equal(database.prepare("DELETE FROM workbook_payloads WHERE digest=?").run(sha256Hex("{}")).changes, 1);
  });

  it("refuses a schema-37 workbook row that is not strict schema-37 data, changing nothing", () => {
    const database = currentStore();
    seed(database);
    restoreSchema37WorkbookPayloads(database);
    database.exec("UPDATE workbook_library SET payload_json=json_set(payload_json,'$.workbook.libraryId','other')");
    const rows = embedded(database);
    database.exec("BEGIN");
    assert.throws(() => applyAuthorityMigrationsAfter(database, 37, CAPTURE));
    database.exec("ROLLBACK");
    assert.deepEqual(embedded(database), rows);
  });

  it("validates a stopped schema-36 store's library in its own layout through read-only inspection", async () => {
    const f = await storageRecoveryFixture(7);
    try {
      const database = new DatabaseSync(f.path);
      try {
        database.exec("PRAGMA foreign_keys=ON");
        for (const migration of SQLITE_MIGRATIONS) if (migration.version > 7) for (const statement of migration.statements) database.exec(statement);
        database.prepare("UPDATE database_states SET schema_version=?").run(CURRENT_AUTHORITY_SCHEMA_VERSION);
        database.exec(`PRAGMA user_version=${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
        seed(database);
        restoreSchema36QueryIndexes(database);
      } finally { database.close(); }
      const inspect = () => {
        const copy = new DatabaseSync(f.path, { readOnly: true });
        try { return inspectNativeAuthority(copy, 36).schemaVersion; } finally { copy.close(); }
      };
      assert.equal(inspect(), 36);
      const writer = new DatabaseSync(f.path);
      try {
        writer.prepare("UPDATE workbook_library_state SET sync_json=? WHERE id='roster'")
          .run(JSON.stringify({ url: "https://example.sharepoint.com/sites/hr/Roster.csv", finishedAt: USED, result: "failed", code: "download timed out" }));
      } finally { writer.close(); }
      assert.throws(inspect);
    } finally { await f.dispose(); }
  });

  it("keeps a committed upgrade and reports it upgraded when compaction fails", async () => {
    const f = await storageRecoveryFixture(7);
    try {
      let before: string;
      const database = new DatabaseSync(f.path);
      try {
        database.exec("PRAGMA foreign_keys=ON");
        for (const migration of SQLITE_MIGRATIONS) if (migration.version > 7) for (const statement of migration.statements) database.exec(statement);
        database.prepare("UPDATE database_states SET schema_version=?").run(CURRENT_AUTHORITY_SCHEMA_VERSION);
        database.exec(`PRAGMA user_version=${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
        seed(database);
        before = readback(database);
        restoreSchema37WorkbookPayloads(database);
      } finally { database.close(); }
      const exec: unknown = Reflect.get(DatabaseSync.prototype, "exec");
      assert.ok(typeof exec === "function");
      let refused = 0;
      const vacuum = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql: string) {
        if (sql === "VACUUM") { refused++; throw new Error("database or disk is full"); }
        Reflect.apply(exec, this, [sql]);
      });
      try {
        const report = await f.run();
        assert.equal(report.state, "upgraded");
        assert.equal(report.compaction, "failed");
      } finally { vacuum.mockRestore(); }
      assert.equal(refused, 1);
      const manifests = () => readdirSync(join(dirname(f.path), "backups", "authority")).filter(name => name.endsWith(".manifest.json"));
      const backups = manifests();
      assert.equal(backups.length, 1);
      const sizeFailed = statSync(f.path).size;
      const upgraded = new DatabaseSync(f.path, { readOnly: true });
      try {
        assert.equal(inspectNativeAuthority(upgraded).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
        assert.equal(readback(upgraded), before);
        assert.deepEqual(upgraded.prepare("SELECT phase FROM database_upgrades").all().map(row => row.phase), ["settled"]);
      } finally { upgraded.close(); }
      // An already-current store with free pages is never rewritten: compaction is attempted once, inside the upgrade.
      let vacuums = 0;
      const later = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql: string) {
        if (sql === "VACUUM") vacuums++;
        Reflect.apply(exec, this, [sql]);
      });
      try {
        const again = await f.run();
        assert.equal(again.state, "already-upgraded");
        assert.equal(again.compaction, undefined);
      } finally { later.mockRestore(); }
      assert.equal(vacuums, 0);
      assert.equal(statSync(f.path).size, sizeFailed);
      const untouched = new DatabaseSync(f.path, { readOnly: true });
      try {
        assert.ok(Number(untouched.prepare("PRAGMA freelist_count").get()?.freelist_count) > 0);
        assert.equal(readback(untouched), before);
        assert.deepEqual(untouched.prepare("SELECT phase FROM database_upgrades").all().map(row => row.phase), ["settled"]);
      } finally { untouched.close(); }
      assert.deepEqual(manifests(), backups);
    } finally { await f.dispose(); }
  });

  it("upgrades a schema-37 store through the store upgrade and compacts the file", async () => {
    const f = await storageRecoveryFixture(7);
    try {
      let before: string;
      const database = new DatabaseSync(f.path);
      try {
        database.exec("PRAGMA foreign_keys=ON");
        for (const migration of SQLITE_MIGRATIONS) if (migration.version > 7) for (const statement of migration.statements) database.exec(statement);
        database.prepare("UPDATE database_states SET schema_version=?").run(CURRENT_AUTHORITY_SCHEMA_VERSION);
        database.exec(`PRAGMA user_version=${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
        seed(database);
        before = readback(database);
        restoreSchema37WorkbookPayloads(database);
        assert.equal(inspectNativeAuthority(database, 37).schemaVersion, 37);
      } finally { database.close(); }
      const sizeBefore = statSync(f.path).size;
      const report = await f.run();
      assert.equal(report.state, "upgraded");
      assert.equal(report.fromSchemaVersion, 37);
      const sizeAfter = statSync(f.path).size;
      const upgraded = new DatabaseSync(f.path, { readOnly: true });
      try {
        assert.equal(inspectNativeAuthority(upgraded).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
        assert.equal(readback(upgraded), before);
        // Six stored copies of two workbooks become two: the file gives back at least three copies' worth of pages.
        assert.ok(sizeBefore - sizeAfter > 3 * storedBytes(upgraded, ["workbook_payloads"]) / 2, `${String(sizeBefore)} -> ${String(sizeAfter)} bytes`);
      } finally { upgraded.close(); }
    } finally { await f.dispose(); }
  });
});
