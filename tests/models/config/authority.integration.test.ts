import { unexpectedWorkbookSync } from "../../support/helpers/backend/workbook-sync.js";
import { encodeEditableWorkbook, type SavedWorkbook, type WorkbookOperation } from "../../../src/models/dashboard/workbooks.js";
import { createWorkbookLibraryService } from "../../../src/backend/workbooks/workbook-library-service.js";
import { createAuthorityAccountingTestWorld } from "../../support/helpers/backend/authority-accounting-world.js";
import { authorityMutationCases, type MutationCase } from "../../support/helpers/backend/authority-accounting-world.js";
import { default as assert } from "node:assert/strict";
import { createProfileFixtureSet, type BoundProfileStorageFixture } from "../../support/helpers/admission-fixture.js";
import { afterAll } from "vitest";
import { afterEach } from "vitest";
import { describe } from "vitest";
import { it } from "vitest";
import { AUTHORITY_RECORD_SCHEMA_REGISTRY } from "../../../src/backend/storage/sqlite/storage-records.js";
import { AUTHORITY_TABLE_REGISTRY } from "../../../src/models/config/authority.js";
import { DryRunScenarioResultSchema } from "../../../src/models/trust/dry-run-scenario-result.js";
import { IsoInstantSchema } from "../../../src/rules/identity/ids.js";

















import { CONFIG_SNAPSHOT } from "../../support/fixtures/phase1c-contract-fixtures.js";























{
describe("dry-run scenario result authority repository", () => {
  it("registers the table and its boot-time record schema", () => {
    assert.equal(
      AUTHORITY_TABLE_REGISTRY.find(({ name }) => name === "dryrun_results")?.classification,
      "authority",
    );
    assert.equal(AUTHORITY_RECORD_SCHEMA_REGISTRY.dryrun_results, DryRunScenarioResultSchema);
  });
});
}

{
const { ATOMIC_WRITE_COMMIT, cleanup, databasePaths, CLOCK, OPERATOR_XLSX_EXPORT, FAILURE_RECORD, DIAGNOSTIC_BUNDLE, RUN_CHECKPOINT, COMMAND_AUDIT, OBSERVED_PRESENT_WRITE_INTENT, openDatabase, claimedWorkerId, prepareWorkerSlot, prepareRunning, prepareDelegationOwners, terminalizeForTrust, terminalFailureRequest, terminalSuccessRequest, INTAKE_MANIFEST, OCR_EXTRACTION, DRY_RUN_SCENARIO_RESULT } = createAuthorityAccountingTestWorld();

describe("authority generation accounting", () => {
const profiles = createProfileFixtureSet();
const heldProfiles: BoundProfileStorageFixture[] = [];
afterEach(async () => {
  cleanup();
  for (const profile of heldProfiles.splice(0)) await profile.close();
});
afterAll(() => profiles.close());
  type AccountingDatabase = Parameters<MutationCase['mutate']>[0];
  const accountingWorkbooks = new WeakMap<AccountingDatabase, SavedWorkbook>();
  const createAccountingWorkbook = (database: AccountingDatabase) => createWorkbookLibraryService({ sync: unexpectedWorkbookSync, repository: database.authority.workbooks, clock: CLOCK })
    .create({ name: "Accounting.xlsx", themes: [], hasFormulas: false,
      sheets: [{ id: "sheet", name: "Rows", width: 1, hidden: [], rows: [{ id: "row", cells: [{ value: "synthetic" }] }] }] });
  const prepareAccountingWorkbook = (database: AccountingDatabase) => { accountingWorkbooks.set(database, createAccountingWorkbook(database)); };
  const accountingWorkbook = (database: AccountingDatabase) => {
    const saved = accountingWorkbooks.get(database); assert.ok(saved); return saved;
  };
  const accountingSave = (saved: SavedWorkbook): WorkbookOperation => ({ operationId: 'accounting-save', source: { kind: 'operator' }, at: IsoInstantSchema.parse(CLOCK.now().toISOString()),
    change: { kind: 'save', expectedVersion: 1, workbook: encodeEditableWorkbook({ ...saved.workbook, name: 'Settled.xlsx' }) } });
  const accountingVersion = (_saved: SavedWorkbook): WorkbookOperation => ({ operationId: 'accounting-version', source: { kind: 'operator' }, at: IsoInstantSchema.parse(CLOCK.now().toISOString()),
    change: { kind: 'version', expectedVersion: 1, name: 'Reviewed' } });
  const renameAccountingVersion = (database: AccountingDatabase) => {
    const saved = accountingWorkbook(database), state = database.authority.workbooks.libraryState(saved.libraryId);
    const record = database.authority.workbooks.libraryAction(saved.libraryId, { operationId: 'accounting-version-name', expectedVersion: saved.version,
      expectedRevision: state.revision, change: { kind: 'rename-version', versionId: state.selectedVersionId, name: 'Reviewed original' } }, CLOCK.now().toISOString());
    assert.deepEqual(database.authority.workbooks.libraryActionRecord(saved.libraryId, record.action.operationId), record);
    assert.deepEqual(database.authority.workbooks.libraryState(saved.libraryId), record.result);
    assert.equal(record.result.versions[0].name, 'Reviewed original');
  };
  const cases: readonly MutationCase[] = [...authorityMutationCases({ prepareRunning, terminalFailureRequest, terminalSuccessRequest, terminalizeForTrust, DIAGNOSTIC_BUNDLE, FAILURE_RECORD, DRY_RUN_SCENARIO_RESULT, OPERATOR_XLSX_EXPORT, CLOCK, ATOMIC_WRITE_COMMIT, databasePaths, INTAKE_MANIFEST, OCR_EXTRACTION, prepareWorkerSlot, claimedWorkerId, prepareDelegationOwners, COMMAND_AUDIT, RUN_CHECKPOINT, OBSERVED_PRESENT_WRITE_INTENT }),
    { table: "workbook_library_actions", prepare: prepareAccountingWorkbook, mutate: renameAccountingVersion },
    { table: "workbook_library_state", prepare: prepareAccountingWorkbook, mutate: renameAccountingVersion },
    { table: "workbook_library_snapshots", mutate: database => {
      const saved = createAccountingWorkbook(database), version = database.authority.workbooks.libraryVersion(saved.libraryId);
      assert.equal(version.version.id, 'original');
      assert.deepEqual(version.workbook, encodeEditableWorkbook(saved.workbook));
    } },
    { table: "workbook_creations", mutate: database => {
      const saved = createAccountingWorkbook(database);
      assert.deepEqual(database.authority.workbooks.creation(saved.libraryId), saved);
      assert.deepEqual(database.authority.workbooks.revision(saved.libraryId, 1), saved);
      assert.deepEqual(database.authority.workbooks.history(saved.libraryId), []);
    } },
    { table: "workbook_types", mutate: database => {
      const type = { id: 'accounting', name: 'Accounting type', keyFieldId: null, fields: ['roster.accounting'], defaultWorkbookId: null };
      assert.deepEqual(database.authority.workbooks.putType(type), type);
      assert.deepEqual(database.authority.workbooks.types().find(value => value.id === type.id), type);
    } },
    { table: "workbook_operations", prepare: prepareAccountingWorkbook, mutate: database => {
      const saved = accountingWorkbook(database), request = accountingSave(saved);
      const sequence = database.authority.workbooks.enqueue(saved.libraryId, request);
      assert.ok(sequence > 0);
      assert.equal(database.authority.workbooks.enqueue(saved.libraryId, request), sequence);
      assert.deepEqual(database.authority.workbooks.read(saved.libraryId), saved);
      assert.deepEqual(database.authority.workbooks.journal(saved.libraryId), []);
      assert.deepEqual(database.authority.workbooks.history(saved.libraryId), []);
    } },
    { table: "workbook_library", prepare: database => {
      prepareAccountingWorkbook(database);
      const saved = accountingWorkbook(database);
      database.authority.workbooks.enqueue(saved.libraryId, accountingSave(saved));
    }, mutate: database => {
      const saved = accountingWorkbook(database);
      database.authority.workbooks.drain(saved.libraryId);
      const changed = database.authority.workbooks.read(saved.libraryId);
      assert.ok(changed); assert.equal(changed.version, 2); assert.equal(changed.workbook.name, 'Settled.xlsx');
      assert.deepEqual(database.authority.workbooks.creation(saved.libraryId), saved);
      assert.deepEqual(database.authority.workbooks.revision(saved.libraryId, 1), saved);
      assert.deepEqual(database.authority.workbooks.history(saved.libraryId), []);
      const receipt = database.authority.workbooks.journal(saved.libraryId)[0];
      assert.equal(receipt.state, 'applied');
      assert.deepEqual(database.authority.workbooks.operation(saved.libraryId, accountingSave(saved)), receipt);
    } },
    { table: "workbook_library_history", prepare: database => {
      prepareAccountingWorkbook(database);
      const saved = accountingWorkbook(database);
      database.authority.workbooks.enqueue(saved.libraryId, accountingVersion(saved));
    }, mutate: database => {
      const saved = accountingWorkbook(database);
      database.authority.workbooks.drain(saved.libraryId);
      assert.deepEqual(database.authority.workbooks.history(saved.libraryId), [saved]);
      assert.deepEqual(database.authority.workbooks.versions(saved.libraryId).map(({ name, provenance }) => ({ name, provenance })), [{ name: 'Reviewed', provenance: 'operator' }]);
      assert.deepEqual(database.authority.workbooks.creation(saved.libraryId), saved);
      assert.deepEqual(database.authority.workbooks.read(saved.libraryId), saved);
      const receipt = database.authority.workbooks.journal(saved.libraryId)[0];
      assert.equal(receipt.state, 'applied');
      assert.deepEqual(database.authority.workbooks.operation(saved.libraryId, accountingVersion(saved)), receipt);
      assert.deepEqual(database.authority.workbooks.history(saved.libraryId), [saved]);
    } },
  ];

  it("accounts for every authority table", () => {
    assert.deepEqual([...new Set(cases.map(({ table }) => table))].sort(), AUTHORITY_TABLE_REGISTRY
      .filter(({ classification, name }) => classification === "authority"
        && !["database_states", "database_upgrades"].includes(name))
      .map(({ name }) => name)
      .sort());
  });
  it.each(cases)("records authority generation for one outer mutation: $table", async mutation => {
      const profile = await profiles.create(); heldProfiles.push(profile);
      const database = await openDatabase(profile.path);
      if (mutation.table !== "settings" && mutation.table !== "settings_snapshots" && database.authority.runtimeConfig.get() === undefined) {
        database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
      }
      mutation.prepare?.(database);
      const before = database.getMeta().authorityGeneration;
      try {
        await mutation.mutate(database);
        const commits = mutation.table === "assistant_model_preference" ? 2 : 1;
        assert.equal(database.getMeta().authorityGeneration, before + commits, mutation.table);
      } finally { mutation.cleanup?.(database); }
  });
});
}
