import { createBoundProfileFixture, createProfileFixtureSet, type BoundProfileStorageFixture } from "../../../support/helpers/admission-fixture.js";
import { AuthorityDatabase as NativeAuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { afterAll } from "vitest";
import { createWorkbookLibraryService } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { fenceWriteFixture } from "../../../support/helpers/write-fence-fixture.js";
import { authorityMutationCases, type MutationCase } from "../../../support/helpers/backend/authority-accounting-world.js";
import { createAuthorityAccountingTestWorld } from "../../../support/helpers/backend/authority-accounting-world.js";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { CONFIG_SNAPSHOT, NOW, UUID_2, UUID_8, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { atomicWriteCheckpoint, seedAtomicWriteOwner } from "../../../support/helpers/timeline-write-fixture.js";

const { ATOMIC_WRITE_COMMIT, cleanup, databasePaths, CLOCK, BULK_COMMAND_ACCEPTANCE, OPERATOR_XLSX_EXPORT, FAILURE_RECORD, DIAGNOSTIC_BUNDLE, RUN_CHECKPOINT, COMMAND_AUDIT, OBSERVED_PRESENT_WRITE_INTENT, databasePath, openDatabase, claimedWorkerId, prepareWorkerSlot, prepareRunning, prepareDelegationOwners, terminalizeForTrust, terminalFailureRequest, terminalSuccessRequest, INTAKE_MANIFEST, OCR_EXTRACTION, DRY_RUN_SCENARIO_RESULT } = createAuthorityAccountingTestWorld();


const profiles = createProfileFixtureSet();
const heldProfiles: BoundProfileStorageFixture[] = [];
afterAll(() => profiles.close());
afterEach(async () => { cleanup(); for (const profile of heldProfiles.splice(0)) await profile.close(); });

describe("native SQLite authority schema", () => {

  it("creates a fresh authority at the current schema with one baseline journal row", async () => {
    const profile = await createBoundProfileFixture({ pending: "storage" });
    heldProfiles.push(profile);
    NativeAuthorityDatabase.initializeProfile(profile.admission, CLOCK);
    const path = profile.path;

    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(Reflect.get(raw.prepare("PRAGMA user_version").get() ?? {}, "user_version"), CURRENT_AUTHORITY_SCHEMA_VERSION);
      const row = raw.prepare(`
        SELECT id, upgrade_id, phase, payload_json
        FROM database_upgrades
      `).get() ?? {};
      const record = JSON.parse(String(Reflect.get(row, "payload_json"))) as Record<string, unknown>;
      assert.deepEqual({
        recordKey: record.recordKey,
        upgradeId: record.upgradeId,
        phase: record.phase,
        fromSchemaVersion: record.fromSchemaVersion,
        toSchemaVersion: record.toSchemaVersion,
        by: record.by,
        recordedAt: record.recordedAt,
      }, {
        recordKey: Reflect.get(row, "id"),
        upgradeId: "fresh",
        phase: "baseline",
        fromSchemaVersion: 0,
        toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION,
        by: "local-operator",
        recordedAt: NOW,
      });
      assert.equal(Reflect.get(row, "upgrade_id"), "fresh");
      assert.equal(Reflect.get(row, "phase"), "baseline");
    } finally {
      raw.close();
    }
  });

  it("fails loud for empty, foreign, newer, locked, and structurally invalid databases", async () => {
    const emptyPath = await databasePath("empty.sqlite");
    writeFileSync(emptyPath, "");
    await assert.rejects(async () => await openDatabase(emptyPath), /exists but is empty/);

    const foreignPath = await databasePath("foreign.sqlite");
    writeFileSync(foreignPath, "not a sqlite database");
    const foreignBytes = readFileSync(foreignPath);
    await assert.rejects(async () => await openDatabase(foreignPath), { code: "ERR_SQLITE_ERROR", errcode: 26, message: "file is not a database" });
    assert.deepEqual(readFileSync(foreignPath), foreignBytes);

    const newerPath = await databasePath("newer.sqlite");
    (await openDatabase(newerPath)).close();
    const newer = new DatabaseSync(newerPath);
    newer.exec(`PRAGMA user_version = ${String(CURRENT_AUTHORITY_SCHEMA_VERSION + 1)}`);
    newer.close();
    await assert.rejects(async () => await openDatabase(newerPath), new RegExp(`authority schema ${CURRENT_AUTHORITY_SCHEMA_VERSION + 1} does not match supported ${CURRENT_AUTHORITY_SCHEMA_VERSION}`));

    const malformedPath = await databasePath("malformed.sqlite");
    (await openDatabase(malformedPath)).close();
    const malformed = new DatabaseSync(malformedPath);
    malformed.exec("DROP TABLE artifacts");
    malformed.close();
    await assert.rejects(async () => await openDatabase(malformedPath), /authority-native-schema-shape-mismatch/);

    const badForeignKeyPath = await databasePath("bad-foreign-key.sqlite");
    (await openDatabase(badForeignKeyPath)).close();
    const badForeignKey = new DatabaseSync(badForeignKeyPath, { enableForeignKeyConstraints: false });
    badForeignKey.prepare(`
      INSERT INTO command_audits (id, command_id, payload_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(UUID_2, UUID_8, JSON.stringify(COMMAND_AUDIT), NOW);
    badForeignKey.close();
    await assert.rejects(async () => await openDatabase(badForeignKeyPath), /foreign-key validation failed/);
  });
});

describe("authority generation accounting", () => {
  const cases: readonly MutationCase[] = authorityMutationCases({ prepareRunning, terminalFailureRequest, terminalSuccessRequest, terminalizeForTrust, DIAGNOSTIC_BUNDLE, FAILURE_RECORD, DRY_RUN_SCENARIO_RESULT, OPERATOR_XLSX_EXPORT, CLOCK, ATOMIC_WRITE_COMMIT, databasePaths, INTAKE_MANIFEST, OCR_EXTRACTION, prepareWorkerSlot, claimedWorkerId, prepareDelegationOwners, COMMAND_AUDIT, RUN_CHECKPOINT, OBSERVED_PRESENT_WRITE_INTENT });

  const declarations = SQLITE_MIGRATIONS.flatMap(({ statements }) => statements.flatMap(statement =>
      [...statement.matchAll(/CREATE TRIGGER\s+([a-z0-9_]+)\s+BEFORE DELETE ON "?([a-z0-9_]+)"?[\s\S]*?BEGIN SELECT RAISE\(ABORT,'([^']+)'\); END;?/gu)]
        .map(match => ({ name: match[1], tableName: match[2], message: match[3] }))));
  const expected = [...new Map(declarations.map(trigger => [trigger.name, trigger])).values()];
  it("#16 enumerates every current deletion guard and each aborts without an admitted owner deletion", async () => {
    assert.ok(expected.length > 0, "deletion guard census must not be empty");
    const profile = await profiles.create(); heldProfiles.push(profile);
    const inventory = await openDatabase(profile.path);
    const inventoryPath = databasePaths.get(inventory); assert.ok(inventoryPath);
    const rawInventory = new DatabaseSync(inventoryPath);
    try {
      const actual = rawInventory.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' AND sql LIKE '%BEFORE DELETE ON%' ORDER BY name").all();
      assert.deepEqual(actual.map(row => row.name), expected.map(trigger => trigger.name).sort());
    } finally { rawInventory.close(); }
  });

  it.each(expected)("#16 deletion guard $name aborts without an admitted owner deletion", async trigger => {
      assert.ok(trigger.tableName); assert.ok(trigger.message); assert.ok(trigger.name);
      assert.match(trigger.tableName, /^[a-z0-9_]+$/u);
      const profile = await profiles.create(); heldProfiles.push(profile);
      const database = await openDatabase(profile.path);
      const path = databasePaths.get(database); assert.ok(path);
      let mutation: MutationCase | undefined;
      if (trigger.name === "commands_bulk_retained") {
        database.authority.commands.acceptBulk(BULK_COMMAND_ACCEPTANCE);
      } else if (trigger.tableName === "timeline_events") {
        seedAtomicWriteOwner(database, ATOMIC_WRITE_COMMIT, path);
        assert.equal(fenceWriteFixture(database, { intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT }).state, "fenced");
        database.commitWriteAttempt(ATOMIC_WRITE_COMMIT, atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT));
      } else if (trigger.tableName === "workbook_library_history") {
        createWorkbookLibraryService({ repository: database.authority.workbooks, clock: CLOCK }).create({
          name: "Retained.xlsx", themes: [], hasFormulas: false,
          sheets: [{ id: "sheet", name: "Sheet", width: 1, hidden: [], rows: [{ id: "row", cells: [{ value: "retained" }] }] }],
        });
      } else if (trigger.tableName !== "database_upgrades") {
        mutation = cases.find(({ table }) => table === trigger.tableName);
        assert.ok(mutation, `${trigger.name} needs a current owner fixture`);
        if (mutation.table !== "settings" && mutation.table !== "settings_snapshots") database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
        mutation.prepare?.(database);
        await mutation.mutate(database);
      }
      const raw = new DatabaseSync(path);
      try {
        const count = raw.prepare(`SELECT count(*) AS count FROM "${trigger.tableName}"`).get();
        assert.ok(typeof count?.count === "number" && count.count > 0, `${trigger.name} must be driven against a real row`);
        assert.throws(() => raw.exec(`DELETE FROM "${trigger.tableName}"`),
          error => error instanceof Error && error.message === trigger.message, trigger.name);
      } finally { raw.close(); }
      mutation?.cleanup?.(database);
  });
});
