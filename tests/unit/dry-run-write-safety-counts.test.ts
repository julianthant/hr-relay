import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import {
  ATOMIC_WRITE_COMMIT,
  NOW,
  WRITE_ATTEMPT,
  WRITE_INTENT_ATTEMPTING,
} from "../fixtures/phase1c-contract-fixtures.js";

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("dry-run write-safety evidence query", () => {
  it("counts only rows joined from the named run's intents", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-dry-run-counts-"));
    roots.push(root);
    const database = AuthorityDatabase.open(
      { path: join(root, "state.db"), busyTimeoutMs: 250, migrationOwner: "dry-run-count-test" },
      manualClock(new Date(NOW)),
    );
    databases.push(database);

    database.authority.writeIntents.fenceAttempt({
      intent: WRITE_INTENT_ATTEMPTING,
      attempt: WRITE_ATTEMPT,
    });
    assert.deepEqual(
      database.authority.writeIntents.countDryRunEvidenceByRun(WRITE_INTENT_ATTEMPTING.runId),
      { writeIntents: 1, writeAttempts: 1, durableOutbox: 0 },
    );
    assert.deepEqual(
      database.authority.writeIntents.countDryRunEvidenceByRun("55555555-5555-4555-8555-555555555555"),
      { writeIntents: 0, writeAttempts: 0, durableOutbox: 0 },
    );

    database.commitWriteAttempt(ATOMIC_WRITE_COMMIT);
    assert.deepEqual(
      database.authority.writeIntents.countDryRunEvidenceByRun(WRITE_INTENT_ATTEMPTING.runId),
      { writeIntents: 1, writeAttempts: 1, durableOutbox: 2 },
    );
  });
});
