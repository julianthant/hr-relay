import assert from "node:assert/strict";

import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";

import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";

import { AUTHORITY_TABLE_REGISTRY } from "../../../../src/models/config/authority.js";

import { manualClock } from "../../../../src/rules/time/clock.js";

import { COMMAND_FIXTURES, NOW, UUID_1 } from "../../../support/fixtures/phase1c-contract-fixtures.js";

import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

const fixtures = new Map<string, Awaited<ReturnType<typeof createBoundProfileFixture>>>();
const openDatabases: AuthorityDatabase[] = [];
const CLOCK = manualClock(new Date(NOW));

async function databasePath(): Promise<string> {
  const fixture = await createBoundProfileFixture();
  fixtures.set(fixture.path, fixture);
  return fixture.path;
}

async function openDatabase(path: string | undefined = undefined, busyTimeoutMs = 250): Promise<AuthorityDatabase> {
  path ??= await databasePath();
  const fixture = fixtures.get(path);
  assert.ok(fixture);
  const database = AuthorityDatabase.open(fixture.admission, { path, busyTimeoutMs, migrationOwner: "unit-test" }, CLOCK);
  openDatabases.push(database);
  return database;
}

afterEach(async () => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const fixture of fixtures.values()) await fixture.close();
  fixtures.clear();
});

describe("native SQLite authority schema", () => {

  it("creates every registered table with its exact authority classification and required pragmas", async () => {
    const database = await openDatabase();
    const inspection = database.inspectSchema();
    assert.deepEqual(inspection.tables, [...AUTHORITY_TABLE_REGISTRY]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(({ name, classification }) => ({ name, classification })));
    assert.equal(inspection.schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.equal(inspection.authorityGeneration, 0);
    assert.deepEqual(inspection.pragmas, {
      journalMode: "wal",
      foreignKeys: 1,
      synchronous: 2,
      busyTimeoutMs: 250,
    });
  });

  it("reopens an already-current database without rerunning the migration", async () => {
    const path = await databasePath();
    const first = await openDatabase(path);
    first.authority.commands.insert(COMMAND_FIXTURES[0]);
    const before = first.getMeta();
    first.close();
    const reopened = await openDatabase(path);
    assert.deepEqual(reopened.getMeta(), before);
    assert.deepEqual(reopened.authority.commands.get(UUID_1), COMMAND_FIXTURES[0]);
  });

  it("fails when another connection holds the migration/write lease", async () => {
    const path = await databasePath();
    (await openDatabase(path)).close();
    const locker = new DatabaseSync(path);
    locker.exec("BEGIN EXCLUSIVE");
    const contender = await openDatabase(path, 10);
    assert.throws(() => contender.authority.commands.insert(COMMAND_FIXTURES[0]), /database is locked/);
    assert.equal(contender.getMeta().authorityGeneration, 0);
    locker.exec("ROLLBACK");
    locker.close();
  });
});
