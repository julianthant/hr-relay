import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_SNAPSHOT } from "../../fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";
import { personLookupDescriptor } from "../registered-workflows.js";
import { AuthorityDatabase } from "../synthetic-storage-admission.js";

export function createPersonLookupStartFixtures(
  roots: string[],
  databases: AuthorityDatabase[],
  clock: NonNullable<Parameters<typeof AuthorityDatabase.open>[1]>,
  planTtlMs: number,
) {
  function openDatabase(): AuthorityDatabase {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-rebuild-start-"));
    roots.push(root);
    const database = AuthorityDatabase.open(
      { path: join(root, "state.sqlite"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
      clock,
    );
    database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    databases.push(database);
    return database;
  }

  function plannerDeps(authority: AuthorityDatabase, ids = sequentialIdFactory()) {
    return { authority, clock, ids, planTtlMs };
  }

  function baseRequest(submissions: readonly unknown[], overrides: Record<string, unknown> = {}) {
    return {
      descriptor: personLookupDescriptor,
      submissions,
      dryRun: false,
      priority: "bulk" as const,
      shape: "single" as const,
      configFingerprint: CONFIG_SNAPSHOT.fingerprint,
      configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId,
      plannedBy: "local-operator",
      ...overrides,
    };
  }

  return { openDatabase, plannerDeps, baseRequest };
}
