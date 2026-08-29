import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { createActivityPersonPseudonymDomain } from "../../src/domain/trust/activity-person-pseudonym.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { QUEUED_RUN } from "./fixtures/phase1f-run-fixtures.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const KEY_HEX = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const NOW = "2026-08-28T20:00:00.000Z";
const roots: string[] = [];
const SEPARATIONS_RUN = {
  ...QUEUED_RUN,
  envelope: {
    ...QUEUED_RUN.envelope,
    runId: RUN_ID,
    workflow: "separations",
    traceId: "sp-200000-1111",
  },
};

function databasePath(): string {
  const root = mkdtempSync(join(tmpdir(), "hrauto-pseudonym-"));
  roots.push(root);
  return join(root, "authority.sqlite");
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("activity person pseudonym domain", () => {
  it("derives the reviewed generation-bound HMAC evidence for one canonical subject", () => {
    const domain = createActivityPersonPseudonymDomain({
      keyGeneration: "activity-person-g1",
      keyHex: KEY_HEX,
    });

    const evidence = domain.deriveEvidence({
      runId: RUN_ID,
      workflowId: "separations",
      canonicalSubject: "10873698",
    });

    assert.deepEqual(evidence, {
      runId: RUN_ID,
      workflowId: "separations",
      keyGeneration: "activity-person-g1",
      pseudonym: "010d6acdd7e42d681de6849d727d0afca66a6a0f8ce82b8df48fd768b3f9d8f2",
      derivation: "hmac-sha-256/activity-person/v1",
    });
  });
});

describe("activity person pseudonym authority", () => {
  it("inserts and reads one immutable row for a run and key generation", () => {
    const database = AuthorityDatabase.open(
      { path: databasePath(), busyTimeoutMs: 250, migrationOwner: "pseudonym-test" },
      manualClock(new Date(NOW)),
    );
    database.authority.runs.enqueue(SEPARATIONS_RUN);
    const domain = createActivityPersonPseudonymDomain({
      keyGeneration: "activity-person-g1",
      keyHex: KEY_HEX,
    });
    const evidence = domain.deriveEvidence({
      runId: RUN_ID,
      workflowId: "separations",
      canonicalSubject: "10873698",
    });

    const inserted = database.authority.activityPersonPseudonyms.insert(evidence);

    assert.deepEqual(inserted, { state: "inserted", record: evidence });
    assert.deepEqual(
      database.authority.activityPersonPseudonyms.get(RUN_ID, "activity-person-g1"),
      evidence,
    );
    database.close();
  });

  it("returns exact replay without advancing authority generation", () => {
    const database = AuthorityDatabase.open(
      { path: databasePath(), busyTimeoutMs: 250, migrationOwner: "pseudonym-test" },
      manualClock(new Date(NOW)),
    );
    database.authority.runs.enqueue(SEPARATIONS_RUN);
    const evidence = createActivityPersonPseudonymDomain({
      keyGeneration: "activity-person-g1",
      keyHex: KEY_HEX,
    }).deriveEvidence({
      runId: RUN_ID,
      workflowId: "separations",
      canonicalSubject: "10873698",
    });
    const first = database.authority.activityPersonPseudonyms.insert(evidence);
    const generationAfterInsert = database.getMeta().authorityGeneration;

    const replay = database.authority.activityPersonPseudonyms.insert(evidence);

    assert.deepEqual({
      first: first.state,
      replay: replay.state,
      generationAfterInsert,
      generationAfterReplay: database.getMeta().authorityGeneration,
    }, {
      first: "inserted",
      replay: "existing",
      generationAfterInsert,
      generationAfterReplay: generationAfterInsert,
    });
    database.close();
  });

  it("refuses divergent replay for the same run and key generation", () => {
    const database = AuthorityDatabase.open(
      { path: databasePath(), busyTimeoutMs: 250, migrationOwner: "pseudonym-test" },
      manualClock(new Date(NOW)),
    );
    database.authority.runs.enqueue(SEPARATIONS_RUN);
    const domain = createActivityPersonPseudonymDomain({
      keyGeneration: "activity-person-g1",
      keyHex: KEY_HEX,
    });
    const original = domain.deriveEvidence({
      runId: RUN_ID,
      workflowId: "separations",
      canonicalSubject: "10873698",
    });
    const divergent = domain.deriveEvidence({
      runId: RUN_ID,
      workflowId: "separations",
      canonicalSubject: "10401814",
    });
    database.authority.activityPersonPseudonyms.insert(original);

    assert.throws(
      () => database.authority.activityPersonPseudonyms.insert(divergent),
      /already exists with different content/u,
    );
    assert.deepEqual(
      database.authority.activityPersonPseudonyms.get(RUN_ID, "activity-person-g1"),
      original,
    );
    database.close();
  });

  it("appends a distinct public generation when the pseudonym domain rotates", () => {
    const database = AuthorityDatabase.open(
      { path: databasePath(), busyTimeoutMs: 250, migrationOwner: "pseudonym-test" },
      manualClock(new Date(NOW)),
    );
    database.authority.runs.enqueue(SEPARATIONS_RUN);
    const generationOne = createActivityPersonPseudonymDomain({
      keyGeneration: "activity-person-g1",
      keyHex: KEY_HEX,
    }).deriveEvidence({
      runId: RUN_ID,
      workflowId: "separations",
      canonicalSubject: "10873698",
    });
    const generationTwo = createActivityPersonPseudonymDomain({
      keyGeneration: "activity-person-g2",
      keyHex: KEY_HEX,
    }).deriveEvidence({
      runId: RUN_ID,
      workflowId: "separations",
      canonicalSubject: "10873698",
    });
    database.authority.activityPersonPseudonyms.insert(generationOne);
    database.authority.activityPersonPseudonyms.insert(generationTwo);

    assert.deepEqual(
      database.authority.activityPersonPseudonyms.listByRun(RUN_ID).map((record) => ({
        keyGeneration: record.keyGeneration,
        pseudonym: record.pseudonym,
      })),
      [
        {
          keyGeneration: "activity-person-g1",
          pseudonym: "010d6acdd7e42d681de6849d727d0afca66a6a0f8ce82b8df48fd768b3f9d8f2",
        },
        {
          keyGeneration: "activity-person-g2",
          pseudonym: "20b9cd664e0803b3f938f51d43ac4e06bda259a2120e2b54050995f6480c82ac",
        },
      ],
    );
    database.close();
  });
});
