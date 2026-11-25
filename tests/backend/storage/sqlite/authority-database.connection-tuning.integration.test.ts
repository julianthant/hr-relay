import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { AUTHORITY_WAL_SIZE_LIMIT_BYTES } from "../../../../src/backend/storage/sqlite/authority-connection.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { openAuthorityBackupSourceReadOnly } from "../../../../src/backend/storage/sqlite/backup-inspection.js";
import { copyAuthorityOffThread } from "../../../../src/backend/storage/sqlite/backup-inspection-worker.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { runRecordOf } from "../../../support/helpers/backend/dashboard-harness.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function seededStore() {
  const bound = await createBoundProfileFixture();
  cleanups.push(() => bound.close());
  const database = AuthorityDatabase.open(bound.admission, { path: bound.path, busyTimeoutMs: 1000, migrationOwner: "connection-tuning" },
    undefined, undefined, undefined, undefined, boundProfileCredentials(bound.admission));
  database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  let seed = 0;
  /** Enqueues `count` runs in one transaction: a burst of writes. */
  const enqueue = (count: number) => database.withAuthorityTransaction(() => {
    for (let index = 0; index < count; index += 1) database.authority.runs.enqueue(runRecordOf({ seed: ++seed, workflow: "person-lookup" }));
  });
  enqueue(1);
  return { bound, database, enqueue };
}

describe("authority connection tuning", () => {
  it("persists planner statistics on a fresh store's first close", async () => {
    const bound = await createBoundProfileFixture({ pending: "storage" });
    cleanups.push(() => bound.close());
    AuthorityDatabase.initializeProfile(bound.admission);

    using reader = new DatabaseSync(bound.path, { readOnly: true });
    expect(reader.prepare("SELECT count(*) AS count FROM sqlite_stat1").get()?.count).toBeGreaterThan(0);
  });

  it("leaves an unanalyzed store unchanged through authority and backup readers", async () => {
    const bound = await createBoundProfileFixture();
    cleanups.push(() => bound.close());
    {
      using writer = new DatabaseSync(bound.path);
      writer.exec("DROP TABLE sqlite_stat1");
    }
    const before = readFileSync(bound.path);
    for (const openMode of ["storage-backup-read-only-no-migrate", "storage-doctor-read-only-no-migrate",
      "storage-upgrade-preflight-read-only-no-migrate"]) {
      const reader = AuthorityDatabase.open(bound.admission, { path: bound.path, busyTimeoutMs: 250,
        migrationOwner: "connection-tuning", openMode });
      reader.close();
    }
    const backup = openAuthorityBackupSourceReadOnly(bound.admission, bound.path);
    backup.close();
    expect(readFileSync(bound.path)).toEqual(before);
  });

  it("returns the WAL to its size limit after a burst written while a backup copy runs", async () => {
    const { bound, database, enqueue } = await seededStore();
    cleanups.push(() => { database.close(); });
    expect(database.inspectSchema().pragmas).toMatchObject({ journalMode: "wal", synchronous: 2 });
    const directory = join(bound.stateRoot, "backups", "authority");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const walBytes = () => statSync(`${bound.path}-wal`).size;
    const copy = copyAuthorityOffThread(bound.admission, bound.path, join(directory, `.authority-${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}.sqlite.tmp`), {});
    // A read snapshot held across the burst, as a copy's read transaction holds one: no checkpoint can reset the WAL meanwhile.
    const snapshot = new DatabaseSync(bound.path, { readOnly: true });
    try {
      snapshot.exec("BEGIN");
      snapshot.prepare("SELECT count(*) AS count FROM runs").get();
      for (let batch = 0; batch < 40 && walBytes() <= AUTHORITY_WAL_SIZE_LIMIT_BYTES; batch += 1) {
        enqueue(250);
        await new Promise(resolve => setImmediate(resolve));
      }
      snapshot.exec("COMMIT");
    } finally { snapshot.close(); }
    await copy;
    expect(walBytes()).toBeGreaterThan(AUTHORITY_WAL_SIZE_LIMIT_BYTES);
    // The first commit runs the automatic checkpoint; the next restarts the WAL from its start.
    enqueue(1);
    enqueue(1);
    expect(walBytes()).toBeLessThanOrEqual(AUTHORITY_WAL_SIZE_LIMIT_BYTES);
  });
});
