import { createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";
import { fenceWriteFixture, writeFenceFixtureInput } from "../../support/helpers/write-fence-fixture.js";
import { atomicWriteCheckpoint, releaseSeededWriteOwners, seedAtomicWriteOwner } from "../../support/helpers/timeline-write-fixture.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../../src/rules/time/clock.js";
import {
  deriveIdempotencyKeyDigest,
  deriveWriteBindingProofDigest,
} from "../../../src/rules/write-safety/write-safety.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";
import {
  ATOMIC_WRITE_COMMIT,
  IDEMPOTENCY_KEY,
  IDEMPOTENCY_KEY_DIGEST,
  NOW,
  SUBJECT_PROOF,
  UUID_1,
  UUID_3,
  UUID_4,
  UUID_7,
  WRITE_ATTEMPT,
  WRITE_INTENT_ATTEMPTING,
} from "../../support/fixtures/phase1c-contract-fixtures.js";

const CLOCK = manualClock(new Date(NOW));
const profiles: ReturnType<typeof createBoundProfileFixture>[] = [];
const databases: AuthorityDatabase[] = [];
const UUID_9 = "99999999-9999-4999-8999-999999999999";
const UUID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OBSERVED_KEY = "10101010|termination|2026-08-02";

function authorityPath(): string {
  const profile = createBoundProfileFixture();
  profiles.push(profile);
  return profile.path;
}

function open(path: string): AuthorityDatabase {
  const database = AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "permanent-key-test" }, CLOCK);
  databases.push(database);
  return database;
}

function competingFence() {
  return {
    intent: {
      ...WRITE_INTENT_ATTEMPTING,
      writeIntentId: UUID_9,
      currentAttemptId: UUID_A,
    },
    attempt: {
      ...WRITE_ATTEMPT,
      writeIntentId: UUID_9,
      writeAttemptId: UUID_A,
    },
  };
}

function observedPresentIntent() {
  return {
    writeIntentId: UUID_7,
    workflowId: "separation",
    itemId: UUID_3,
    taskId: "ucpath/terminate-person",
    system: "ucpath",
    idempotencyKey: OBSERVED_KEY,
    idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", OBSERVED_KEY),
    generation: 1,
    status: "observed-present",
    observedProof: { schemaHash: "a".repeat(64), value: "T123456" },
    observedAt: NOW,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

afterEach(() => {
  for (const database of databases) releaseSeededWriteOwners(database, NOW);
  for (const database of databases.splice(0)) database.close();
  for (const profile of profiles.splice(0)) profile.close();
});

describe("permanent system-scoped write keys", () => {
  it("keeps a committed key permanent across a later sequential starter", () => {
    const path = authorityPath();
    const database = open(path);
    assert.equal(fenceWriteFixture(database, {
      intent: WRITE_INTENT_ATTEMPTING,
      attempt: WRITE_ATTEMPT,
    }).state, "fenced");
    seedAtomicWriteOwner(database, ATOMIC_WRITE_COMMIT, path);
    database.commitWriteAttempt(ATOMIC_WRITE_COMMIT, atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT));
    const generationAfterCommit = database.getMeta().authorityGeneration;

    const replay = fenceWriteFixture(database, competingFence());
    assert.equal(replay.state, "existing");
    assert.equal(replay.intent.writeIntentId, UUID_1);
    assert.equal(replay.intent.status, "committed");
    assert.equal(database.getMeta().authorityGeneration, generationAfterCommit);
  });

  it("deduplicates the same key through an independently opened competing connection", () => {
    const path = authorityPath();
    const first = open(path);
    const contender = open(path);
    assert.equal(fenceWriteFixture(first, {
      intent: WRITE_INTENT_ATTEMPTING,
      attempt: WRITE_ATTEMPT,
    }).state, "fenced");

    const generationAfterFence = first.getMeta().authorityGeneration;
    const result = fenceWriteFixture(contender, competingFence());
    assert.equal(result.state, "existing");
    assert.equal(result.intent.writeIntentId, UUID_1);
    assert.equal(contender.authority.writeAttempts.get(UUID_A), undefined);
    assert.equal(contender.getMeta().authorityGeneration, generationAfterFence);
  });

  it("records observed-present permanently with zero attempt, ledger, or span outbox", () => {
    const path = authorityPath();
    const database = open(path);
    const observed = observedPresentIntent();
    writeFenceFixtureInput(database, competingFence());
    const first = database.authority.writeIntents.recordObservedPresent(observed);
    assert.equal(first.state, "recorded-observed-present");
    const generation = database.getMeta().authorityGeneration;
    const inspection = AuthorityDatabase.inspectExistingReadOnly(path);
    assert.equal(inspection.counts.unresolvedWriteIntents, 0);
    assert.equal("durableOutbox" in inspection.counts, false);
    assert.equal(database.authority.writeAttempts.get(UUID_4), undefined);
    assert.deepEqual(database.authority.timelineEvents.page({}).filter((event) => event.payload.kind === "operation-confirmed"), []);

    const replay = fenceWriteFixture(database, {
      intent: {
        ...WRITE_INTENT_ATTEMPTING,
        writeIntentId: UUID_9,
        currentAttemptId: UUID_A,
        idempotencyKey: OBSERVED_KEY,
        idempotencyKeyDigest: observed.idempotencyKeyDigest,
      },
      attempt: {
        ...WRITE_ATTEMPT,
        writeIntentId: UUID_9,
        writeAttemptId: UUID_A,
      },
    });
    assert.equal(replay.state, "existing");
    assert.equal(replay.intent.status, "observed-present");
    assert.equal(database.getMeta().authorityGeneration, generation);
  });

  it("fails loud when the natural key or binding proof does not match its digest", () => {
    const database = open(authorityPath());
    assert.throws(() => fenceWriteFixture(database, {
      intent: { ...WRITE_INTENT_ATTEMPTING, idempotencyKey: `${IDEMPOTENCY_KEY}|changed` },
      attempt: WRITE_ATTEMPT,
    }), /idempotency key digest does not match/);
    assert.throws(() => fenceWriteFixture(database, {
      intent: { ...WRITE_INTENT_ATTEMPTING, idempotencyKeyDigest: "b".repeat(64) },
      attempt: WRITE_ATTEMPT,
    }), /idempotency key digest does not match/);
    assert.throws(() => fenceWriteFixture(database, {
      intent: { ...WRITE_INTENT_ATTEMPTING, bindingProofDigest: "c".repeat(64) },
      attempt: WRITE_ATTEMPT,
    }), /binding proof digest does not match/);
    assert.equal(IDEMPOTENCY_KEY_DIGEST, deriveIdempotencyKeyDigest("ucpath", IDEMPOTENCY_KEY));
    assert.equal(WRITE_INTENT_ATTEMPTING.bindingProofDigest, deriveWriteBindingProofDigest(SUBJECT_PROOF));
    assert.equal(database.getMeta().authorityGeneration, 0);
  });
});
