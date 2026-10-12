import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { testWorkerPorts } from "../../fixtures/run-lifecycle-fixtures.js";
import { personLookupDescriptor } from "../registered-workflows.js";
import { AuthorityDatabase } from "../synthetic-storage-admission.js";

export function openPersonLookupReceiptDatabase(
  roots: string[],
  databases: AuthorityDatabase[],
  prefix: string,
  migrationOwner: string,
): AuthorityDatabase {
  const root = mkdtempSync(join(realpathSync(tmpdir()), prefix));
  roots.push(root);
  const database = AuthorityDatabase.open(
    { path: join(root, "state.sqlite"), busyTimeoutMs: 250, migrationOwner },
    manualClock(new Date("2026-08-04T00:11:13.500Z")),
  );
  testWorkerPorts(database, manualClock(new Date("2026-08-04T00:11:13.500Z")), {
    path: join(root, "state.sqlite"),
    descriptor: personLookupDescriptor,
    poolIndex: 1,
  });
  databases.push(database);
  return database;
}
