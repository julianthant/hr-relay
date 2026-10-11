import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../../src/rules/time/clock.js";
import { deriveIdempotencyKeyDigest } from "../../../src/rules/write-safety/write-safety.js";
import { ATOMIC_WRITE_COMMIT as HISTORICAL_ATOMIC_WRITE_COMMIT, NOW, UUID_1, UUID_8, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";
import { currentAtomicWriteFixture, seedAtomicWriteOwner } from "../../support/helpers/timeline-write-fixture.js";

const ATOMIC_WRITE_COMMIT = currentAtomicWriteFixture(HISTORICAL_ATOMIC_WRITE_COMMIT);

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];
const databasePaths = new WeakMap<AuthorityDatabase, string>();
const CLOCK = manualClock(new Date(NOW));

function databasePath(name = "authority.sqlite"): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-rebuild-sqlite-"));
  roots.push(root);
  return join(root, name);
}

function openDatabase(path = databasePath(), busyTimeoutMs = 250): AuthorityDatabase {
  const database = AuthorityDatabase.open({ path, busyTimeoutMs, migrationOwner: "unit-test" }, CLOCK);
  openDatabases.push(database);
  databasePaths.set(database, path);
  return database;
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("authority generation accounting", () => {

  it("rolls back a caught nested fence failure to its savepoint without leaking an intent", () => {
    const database = openDatabase();
    seedAtomicWriteOwner(database, ATOMIC_WRITE_COMMIT, databasePaths.get(database) ?? (() => { throw new Error("missing fixture path"); })());
    database.authority.writeIntents.fenceAttempt({ intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT });
    const generationBefore = database.getMeta().authorityGeneration;
    const competingKey = "10001573|termination|2026-08-03";
    const competingIntent = {
      ...WRITE_INTENT_ATTEMPTING,
      writeIntentId: UUID_8,
      idempotencyKey: competingKey,
      idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", competingKey),
    };
    const competingAttempt = { ...WRITE_ATTEMPT, writeIntentId: UUID_8 };

    database.withAuthorityTransaction(() => {
      assert.throws(
        () => database.authority.writeIntents.fenceAttempt({ intent: competingIntent, attempt: competingAttempt }),
        /retained-identity-conflict/u,
      );
    });

    assert.equal(database.authority.writeIntents.get(UUID_8), undefined);
    assert.equal(database.authority.writeIntents.get(UUID_1)?.status, "attempting");
    assert.equal(database.getMeta().authorityGeneration, generationBefore);
  });
});
