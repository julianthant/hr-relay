import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { AUTHORITY_WAL_SIZE_LIMIT_BYTES, AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { copyAuthorityOffThread } from "../../../../src/backend/storage/sqlite/backup-inspection-worker.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { runRecordOf } from "../../../support/helpers/backend/dashboard-harness.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function seededStore(runs: number) {
  const bound = await createBoundProfileFixture();
  cleanups.push(() => bound.close());
  const open = () => AuthorityDatabase.open(bound.admission, { path: bound.path, busyTimeoutMs: 1000, migrationOwner: "connection-tuning" },
    undefined, undefined, undefined, undefined, boundProfileCredentials(bound.admission));
  const database = open();
  database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  let seed = 0;
  /** Enqueues `count` runs in one transaction: a burst of writes. */
  const enqueue = (count: number) => database.withAuthorityTransaction(() => {
    for (let index = 0; index < count; index += 1) database.authority.runs.enqueue(runRecordOf({ seed: ++seed, workflow: "person-lookup" }));
  });
  enqueue(runs);
  return { bound, database, open, enqueue };
}

/** Tables the planner has statistics for, read from another connection. */
function analyzedTables(path: string): readonly string[] {
  const raw = new DatabaseSync(path, { readOnly: true });
  try {
    if (raw.prepare("SELECT name FROM sqlite_schema WHERE name='sqlite_stat1'").get() === undefined) return [];
    return raw.prepare("SELECT DISTINCT tbl FROM sqlite_stat1 ORDER BY tbl").all().map(row => String(row.tbl));
  } finally { raw.close(); }
}

describe("authority connection tuning", () => {
  it("leaves planner statistics for the runs it wrote after a session that read them", async () => {
    const { bound, database } = await seededStore(200);
    database.summaryWorkflows();
    database.authority.runs.search({ q: "EID", scope: "trace", facets: {}, limit: 25 });
    expect(analyzedTables(bound.path)).not.toContain("runs");
    database.close();
    expect(analyzedTables(bound.path)).toContain("runs");
  });

  it("returns the WAL to its size limit after a burst written while a backup copy runs", async () => {
    const { bound, database, enqueue } = await seededStore(1);
    cleanups.push(() => { database.close(); });
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
