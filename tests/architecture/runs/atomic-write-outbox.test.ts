import { createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";
import { fenceWriteFixture } from "../../support/helpers/write-fence-fixture.js";
import { currentAtomicWriteFixture, atomicWriteCheckpoint, releaseSeededWriteOwners, seedAtomicWriteOwner } from "../../support/helpers/timeline-write-fixture.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../../src/rules/time/clock.js";
import {
  deriveIdempotencyKeyDigest,
  deriveWriteBindingProofDigest,
} from "../../../src/rules/write-safety/write-safety.js";
import {
  AtomicWriteCommitReportSchema,
  AtomicWriteCommitStorageStepSchema,
  AuthorityDatabase,
  type AuthorityWriteCommitHooks,
} from "../../support/helpers/synthetic-storage-admission.js";
import {
  ATOMIC_WRITE_COMMIT,
  LEDGER_OUTBOX_RECORD,
  NOW,
  SUBJECT_EVIDENCE,
  UNSCOPED_PROOF,
  SPAN_OUTBOX_RECORD,
  UUID_4,
  WRITE_ATTEMPT,
  WRITE_INTENT_ATTEMPTING,
} from "../../support/fixtures/phase1c-contract-fixtures.js";
import { gitVisibleFiles, REPO_ROOT } from "../support/helpers/guard-files.js";

function commitHistory(database: AuthorityDatabase, input: unknown, checkpoint: unknown) {
  return database.commitWriteAttempt(currentAtomicWriteFixture(input), checkpoint);
}

const CLOCK = manualClock(new Date(NOW));
const profiles: Awaited<ReturnType<typeof createBoundProfileFixture>>[] = [];
const databases: AuthorityDatabase[] = [];
const paths = new WeakMap<AuthorityDatabase, string>();

async function databasePath(): Promise<string> {
  const profile = await createBoundProfileFixture();
  profiles.push(profile);
  return profile.path;
}

function open(path: string, hooks?: AuthorityWriteCommitHooks): AuthorityDatabase {
  const database = AuthorityDatabase.open(
    { path, busyTimeoutMs: 250, migrationOwner: "atomic-write-test" },
    CLOCK,
    hooks,
  );
  databases.push(database);
  paths.set(database, path);
  return database;
}

function fence(database: AuthorityDatabase): void {
  const path = paths.get(database);
  assert.ok(path);
  seedAtomicWriteOwner(database, ATOMIC_WRITE_COMMIT, path);
  const result = fenceWriteFixture(database, {
    intent: WRITE_INTENT_ATTEMPTING,
    attempt: WRITE_ATTEMPT,
  });
  assert.equal(result.state, "fenced");
}

afterEach(async () => {
  for (const database of databases) releaseSeededWriteOwners(database, NOW);
  for (const database of databases.splice(0)) database.close();
  for (const profile of profiles.splice(0)) await profile.close();
});
describe("atomic write authority commit", () => {
  it.each(["written-at", "output"] as const)("refuses a mismatched confirmation checkpoint %s before settlement", async (field) => {
    const database = open(await databasePath());
    fence(database);
    const checkpoint = atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT);
    const invalid = field === "written-at"
      ? { ...checkpoint, writtenAt: "2026-01-01T00:00:00.000Z" }
      : { ...checkpoint, output: { ...checkpoint.output, value: {} } };
    const before = database.getMeta().authorityGeneration;
    assert.throws(() => commitHistory(database, ATOMIC_WRITE_COMMIT, invalid), /confirmed-history-checkpoint-outcome-mismatch/u);
    assert.equal(database.getMeta().authorityGeneration, before);
    assert.equal(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)?.status, "attempting");
    assert.equal(database.authority.writeAttempts.get(UUID_4)?.outcome.state, "attempting");
    assert.equal(database.authority.timelineEvents.page({}).filter((row) => row.payload.kind === "operation-confirmed").length, 0);
    assert.equal(database.authority.timelineEvents.page({}).filter((row) => row.payload.kind === "operation-confirmed").length, 0);
    assert.deepEqual(database.authority.timelineEvents.page({}), []);
  });

  it("commits intent, attempt, ledger outbox, and terminal outcome span all-or-none", async () => {
    const database = open(await databasePath());
    fence(database);
    const generationBeforeCommit = database.getMeta().authorityGeneration;
    const report = commitHistory(database, ATOMIC_WRITE_COMMIT, atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT));

    assert.equal(AtomicWriteCommitReportSchema.safeParse(report).success, true);
    assert.equal(report.intent.status, "committed");
    assert.equal(report.attempt.outcome.state, "committed");
    assert.deepEqual(report.transaction, LEDGER_OUTBOX_RECORD.payload.entry);
    assert.deepEqual(report.committedSpan, SPAN_OUTBOX_RECORD.payload);
    assert.deepEqual(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId), report.intent);
    assert.deepEqual(database.authority.writeAttempts.get(UUID_4), report.attempt);
    assert.equal(database.authority.timelineEvents.page({}).filter((row) => row.payload.kind === "operation-confirmed").length, 1);
    assert.equal("durableOutbox" in database.authority, false);
    assert.equal(database.getMeta().authorityGeneration, generationBeforeCommit + 1);
    const checkpoint = atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT);
    assert.deepEqual(database.authority.runCheckpoints.get(checkpoint.workflowId, checkpoint.itemId,
      checkpoint.nodeId, checkpoint.attempt, checkpoint.claimGeneration), checkpoint);
    assert.deepEqual(database.authority.timelineEvents.page({}).map((event) => event.payload.kind),
      ["checkpoint-recorded", "operation-confirmed"]);
  });

  for (const failedStep of AtomicWriteCommitStorageStepSchema.options) {
    it(`rolls back every authority row and generation after ${failedStep} failure`, async () => {
      const hooks: AuthorityWriteCommitHooks = {
        afterStorageStep(step) {
          if (step === failedStep) throw new Error(`injected failure after ${step}`);
        },
      };
      const path = await databasePath();
      const database = open(path, hooks);
      fence(database);
      const generationBeforeCommit = database.getMeta().authorityGeneration;

      assert.throws(
        () => commitHistory(database, ATOMIC_WRITE_COMMIT, atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT)),
        new RegExp(`injected failure after ${failedStep}`),
      );
      assert.equal(database.getMeta().authorityGeneration, generationBeforeCommit);
      assert.equal(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)?.status, "attempting");
      assert.equal(database.authority.writeAttempts.get(UUID_4)?.outcome.state, "attempting");
      assert.equal(database.authority.timelineEvents.page({}).filter((row) => row.payload.kind === "operation-confirmed").length, 0);
      assert.equal(database.authority.timelineEvents.page({}).filter((row) => row.payload.kind === "operation-confirmed").length, 0);
      assert.deepEqual(database.authority.timelineEvents.page({}), []);
      const checkpoint = atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT);
      assert.equal(database.authority.runCheckpoints.get(checkpoint.workflowId, checkpoint.itemId,
        checkpoint.nodeId, checkpoint.attempt, checkpoint.claimGeneration), undefined);
      assert.equal(AuthorityDatabase.inspectExistingReadOnly(path).invariants.state, "valid");
    });
  }

  it("rejects mismatched generic outcome and outbox identities before changing authority", async () => {
    const database = open(await databasePath());
    fence(database);
    const generationBeforeCommit = database.getMeta().authorityGeneration;
    assert.throws(() => commitHistory(database, {
      ...ATOMIC_WRITE_COMMIT,
      committedSpan: {
          ...ATOMIC_WRITE_COMMIT.committedSpan,
          outcome: {
            ...SPAN_OUTBOX_RECORD.payload.outcome,
            output: { schemaHash: "a".repeat(64), value: "different-output" },
          },
      },
    }, atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT)), /atomic confirmation proof and outcome must agree/);
    assert.equal(database.getMeta().authorityGeneration, generationBeforeCommit);
    assert.equal(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)?.status, "attempting");
    assert.equal(database.authority.timelineEvents.page({}).filter((row) => row.payload.kind === "operation-confirmed").length, 0);
  });

  it("rejects mismatched ledger/terminal trace identity before changing authority", async () => {
    const database = open(await databasePath());
    fence(database);
    const generationBeforeCommit = database.getMeta().authorityGeneration;
    assert.throws(() => commitHistory(database, {
      ...ATOMIC_WRITE_COMMIT,
      transaction: { ...ATOMIC_WRITE_COMMIT.transaction, traceId: "se-120001-2222" },
    }, atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT)), /atomic confirmation traceId mismatch/);
    assert.equal(database.getMeta().authorityGeneration, generationBeforeCommit);
    assert.equal(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)?.status, "attempting");
    assert.equal(database.authority.timelineEvents.page({}).filter((row) => row.payload.kind === "operation-confirmed").length, 0);
  });

  it("rejects ledger subject evidence that disagrees with the fenced subject proof", async () => {
    const database = open(await databasePath());
    fence(database);
    const generationBeforeCommit = database.getMeta().authorityGeneration;
    assert.throws(() => commitHistory(database, {
      ...ATOMIC_WRITE_COMMIT,
      transaction: {
            ...ATOMIC_WRITE_COMMIT.transaction,
            subject: { state: "present", value: { ...SUBJECT_EVIDENCE, bindingDigest: "b".repeat(64) } },
      },
    }, atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT)), /ledger subject does not match the fenced binding proof/);
    assert.equal(database.getMeta().authorityGeneration, generationBeforeCommit);
    assert.equal(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)?.status, "attempting");
    assert.equal(database.authority.timelineEvents.page({}).filter((row) => row.payload.kind === "operation-confirmed").length, 0);
  });

  it("rejects subject-bearing ledger output for an explicitly unscoped fence", async () => {
    const database = open(await databasePath());
    const idempotencyKey = "document-44444444|upload|2026-08-01";
    const idempotencyKeyDigest = deriveIdempotencyKeyDigest("onbase", idempotencyKey);
    const bindingProofDigest = deriveWriteBindingProofDigest(UNSCOPED_PROOF);
    const intent = {
      ...WRITE_INTENT_ATTEMPTING,
      taskId: UNSCOPED_PROOF.taskId,
      system: "onbase",
      idempotencyKey,
      idempotencyKeyDigest,
      bindingProof: UNSCOPED_PROOF,
      bindingProofDigest,
    };
    const attempt = {
      ...WRITE_ATTEMPT,
      bindingProof: UNSCOPED_PROOF,
      bindingProofDigest,
    };
    assert.equal(fenceWriteFixture(database, { intent, attempt }).state, "fenced");
    const transaction = {
          ...ATOMIC_WRITE_COMMIT.transaction,
          system: "onbase",
          idempotencyKey,
          idempotencyKeyDigest,
          bindingProofDigest,
    };
    const committedSpan = {
        ...ATOMIC_WRITE_COMMIT.committedSpan,
        system: "onbase",
        idempotencyKey,
        idempotencyKeyDigest,
        bindingProofDigest,
    };
    const generationBeforeCommit = database.getMeta().authorityGeneration;
    assert.throws(() => commitHistory(database, {
      ...ATOMIC_WRITE_COMMIT,
      transaction,
      committedSpan,
    }, atomicWriteCheckpoint(ATOMIC_WRITE_COMMIT)), /ledger subject must be absent for unscoped binding proof/);
    assert.equal(database.getMeta().authorityGeneration, generationBeforeCommit);
    assert.equal(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)?.status, "attempting");
  });

  it("keeps standalone attempt/outbox mutation private and routes the commit through one authority transaction", async () => {
    const database = open(await databasePath());

    assert.deepEqual(Object.keys(database.authority.writeAttempts), ["get", "listByIntent"]);
    assert.equal("durableOutbox" in database.authority, false);

    const adapterPath = join(REPO_ROOT, "src/backend/storage/sqlite/authority-database.ts");
    const adapter = readFileSync(adapterPath, "utf8");
    assert.match(adapter, /commitWriteAttempt\(input: unknown, checkpointInput: unknown\)[\s\S]*?return this\.withAuthorityTransaction\(\(\) => \{/);
    assert.doesNotMatch(adapter, /writeAttempts:\s*Object\.freeze\(\{\s*insert:/);
    assert.doesNotMatch(adapter, /durableOutbox:\s*Object\.freeze\(\{\s*insert:/);

    const sourceText = gitVisibleFiles(["src"])
      .filter((path) => path.endsWith(".ts") || path.endsWith(".tsx"))
      .map((path) => readFileSync(join(REPO_ROOT, path), "utf8"))
      .join("\n");
    assert.doesNotMatch(sourceText, /\.authority\.writeAttempts\.insert\s*\(/);
    assert.doesNotMatch(sourceText, /\.authority\.durableOutbox\.insert\s*\(/);
  });
});
