import { createBoundProfileFixture, boundProfileCredentials } from "../admission-fixture.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { testWorkerPorts } from "../../fixtures/run-lifecycle-fixtures.js";
import { personLookupDescriptor } from "../registered-workflows.js";
import { AuthorityDatabase } from "../synthetic-storage-admission.js";

const profiles = new WeakMap<AuthorityDatabase, Awaited<ReturnType<typeof createBoundProfileFixture>>>();

export async function closePersonLookupReceiptDatabase(database: AuthorityDatabase): Promise<void> {
  const profile = profiles.get(database);
  if (profile === undefined) { database.close(); return; }
  database.close();
  await profile.close();
  profiles.delete(database);
}

export async function openPersonLookupReceiptDatabase(
  roots: string[],
  databases: AuthorityDatabase[],
  _prefix: string,
  migrationOwner: string,
): Promise<AuthorityDatabase> {
  const profile = await createBoundProfileFixture();
  roots.push(profile.workspace);
  let database: AuthorityDatabase;
  try {
    database = AuthorityDatabase.open({ path: profile.path, busyTimeoutMs: 250, migrationOwner },
      manualClock(new Date("2026-08-04T00:11:13.500Z")), undefined, undefined, undefined, boundProfileCredentials(profile.admission));
  } catch (error) {
    const failures: unknown[] = [error];
    try { await profile.close(); } catch (cleanupError) { failures.push(cleanupError); }
    if (failures.length > 1) throw new AggregateError(failures, "receipt fixture opening cleanup failed", { cause: error });
    throw error;
  }
  profiles.set(database, profile);
  testWorkerPorts(database, manualClock(new Date("2026-08-04T00:11:13.500Z")), {
    path: profile.path,
    descriptor: personLookupDescriptor,
    poolIndex: 1,
  });
  databases.push(database);
  return database;
}
