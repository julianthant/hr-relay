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
  const cases: readonly MutationCase[] = [...authorityMutationCases({ prepareRunning, terminalFailureRequest, terminalSuccessRequest, terminalizeForTrust, DIAGNOSTIC_BUNDLE, FAILURE_RECORD, DRY_RUN_SCENARIO_RESULT, OPERATOR_XLSX_EXPORT, CLOCK, ATOMIC_WRITE_COMMIT, databasePaths, INTAKE_MANIFEST, OCR_EXTRACTION, prepareWorkerSlot, claimedWorkerId, prepareDelegationOwners, COMMAND_AUDIT, RUN_CHECKPOINT, OBSERVED_PRESENT_WRITE_INTENT }),
    ...(["workbook_library", "workbook_library_history"] as const).map(table => ({ table,
      mutate: (database: Parameters<MutationCase["mutate"]>[0]) => {
        const service = createWorkbookLibraryService({ repository: database.authority.workbooks, clock: CLOCK });
        const saved = service.create({ name: "Accounting.xlsx", themes: [], hasFormulas: false,
          sheets: [{ id: "sheet", name: "Rows", width: 1, hidden: [], rows: [{ id: "row", cells: [{ value: "synthetic" }] }] }] });
        assert.deepEqual(database.authority.workbooks.read(saved.libraryId), saved);
        assert.deepEqual(database.authority.workbooks.history(saved.libraryId), [saved]);
      },
    })),
  ];

  it("accounts for every authority table", () => {
    assert.deepEqual([...new Set(cases.map(({ table }) => table))].sort(), AUTHORITY_TABLE_REGISTRY
      .filter(({ classification, name }) => classification === "authority"
        && !["database_states", "database_upgrades"].includes(name))
      .map(({ name }) => name)
      .sort());
  });
  it.each(cases)("increments once per outer authority mutation: $table", async mutation => {
      const profile = await profiles.create(); heldProfiles.push(profile);
      const database = await openDatabase(profile.path);
      if (mutation.table !== "settings" && mutation.table !== "settings_snapshots" && database.authority.runtimeConfig.get() === undefined) {
        database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
      }
      mutation.prepare?.(database);
      const before = database.getMeta().authorityGeneration;
      try {
        await mutation.mutate(database);
        assert.equal(database.getMeta().authorityGeneration, before + 1, mutation.table);
      } finally { mutation.cleanup?.(database); }
  });
});
}
