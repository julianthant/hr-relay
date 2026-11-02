
import assert from "node:assert/strict";
import { afterAll, afterEach,describe,it } from "vitest";
import {
evaluateWriteResolutionBinding,
requireWriteResolutionBinding,
type WriteBindingCheck,
type WriteBindingRepositories,
type WriteResolutionBinding,
} from "../../../../src/backend/runtime/writes/write-resolution-binding.js";
import { RunRecordSchema,type RunRecord } from "../../../../src/models/run/record.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import {
deriveWriteAuthorityReason,
deriveWriteBindingProofDigest,
WriteIntentRecordSchema,
type WriteIntentRecord,
} from "../../../../src/rules/write-safety/write-safety.js";
import { UUID_5,UUID_6,UUID_7,UUID_8 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import {
WRITE_FIXTURE_EID,
WRITE_FIXTURE_ITEM_ID,
WRITE_FIXTURE_KEY,
WRITE_FIXTURE_KEY_DIGEST,
WRITE_FIXTURE_MOVED_EID,
WRITE_FIXTURE_MOVED_FINGERPRINT,
WRITE_FIXTURE_NODE_ID,
WRITE_FIXTURE_NOW,
WRITE_FIXTURE_OBSERVATION,
WRITE_FIXTURE_RUN_ID,
WRITE_FIXTURE_STAGED_STATE,
WRITE_FIXTURE_WORKFLOW_ID,
writeFixtureDescriptor,
writeFixtureDescriptorAfterUnrelatedEdit,
writeFixtureDescriptorAtVersion2,
writeFixtureDescriptorWithDependencyAfterUnrelatedEdit,
writeFixtureDescriptorWithMovedKey,
writeFixtureQueuedRun,
writeFixtureSaveDescriptorAfterUnrelatedEdit,
} from "../../../support/fixtures/write-sequencer-fixtures.js";
import { openBoundDatabaseFixture, createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());

const COMMIT_TASK_ID = "ucpath/submit-write-fixture";

const disposers: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});


async function repositories(): Promise<WriteBindingRepositories> {
  const opened = await openBoundDatabaseFixture("write-binding-test", manualClock(new Date(WRITE_FIXTURE_NOW)), undefined, undefined, undefined, undefined, profileFixtures.create);
  disposers.push(async () => await opened.close());
  return opened.database.authority;
}

function parkedRun(overrides: Readonly<{ parsedSchemaHash?: string; parsedValue?: unknown }> = {}): RunRecord {
  const raw = writeFixtureQueuedRun();
  if (overrides.parsedSchemaHash !== undefined) {
    const input = raw.input as { parsed: { schemaHash: string } };
    input.parsed.schemaHash = overrides.parsedSchemaHash;
  }
  if (overrides.parsedValue !== undefined) {
    const input = raw.input as { parsed: { value: unknown } };
    input.parsed.value = overrides.parsedValue;
  }
  return RunRecordSchema.parse(raw);
}

function parkedIntent(overrides: Readonly<{ proofTaskId?: string }> = {}): WriteIntentRecord {
  const bindingProof = {
    kind: "subject-match",
    version: 1,
    proofId: UUID_7,
    runId: WRITE_FIXTURE_RUN_ID,
    attempt: 1,
    leaseId: UUID_6,
    taskId: overrides.proofTaskId ?? COMMIT_TASK_ID,
    observationId: WRITE_FIXTURE_OBSERVATION,
    pageStateId: WRITE_FIXTURE_STAGED_STATE,
    expected: { kind: "person", identifierKind: "eid", bindingDigest: "a".repeat(64), displaySuffix: "2345" },
    observed: { kind: "person", identifierKind: "eid", bindingDigest: "a".repeat(64), displaySuffix: "2345" },
    match: "match",
    observedAt: WRITE_FIXTURE_NOW,
    afterPrepareSpanPath: "wf-090000-2222/submit-write/prepare",
  };
  return WriteIntentRecordSchema.parse({
    writeIntentId: UUID_8,
    workflowId: WRITE_FIXTURE_WORKFLOW_ID,
    itemId: WRITE_FIXTURE_ITEM_ID,
    taskId: COMMIT_TASK_ID,
    system: "ucpath",
    idempotencyKey: WRITE_FIXTURE_KEY,
    idempotencyKeyDigest: WRITE_FIXTURE_KEY_DIGEST,
    currentAttemptId: UUID_5,
    generation: 1,
    runId: WRITE_FIXTURE_RUN_ID,
    runAttempt: 1,
    bindingProof,
    bindingProofDigest: deriveWriteBindingProofDigest(bindingProof),
    fencedAt: WRITE_FIXTURE_NOW,
    version: 1,
    createdAt: WRITE_FIXTURE_NOW,
    updatedAt: WRITE_FIXTURE_NOW,
    status: "parked",
    parkedCode: "unknown",
    message: "clicked, cannot prove it landed",
    authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown","probe","binding fixture indeterminate probe"),
  });
}

async function evaluate(
  descriptor: Parameters<typeof evaluateWriteResolutionBinding>[0]["descriptor"],
  options: Readonly<{ parsedSchemaHash?: string; parsedValue?: unknown; proofTaskId?: string }> = {},
): Promise<WriteResolutionBinding> {
  return evaluateWriteResolutionBinding({
    arm: "operator-confirmed-absent",
    descriptor,
    run: parkedRun({
      ...(options.parsedSchemaHash === undefined ? {} : { parsedSchemaHash: options.parsedSchemaHash }),
      ...(options.parsedValue === undefined ? {} : { parsedValue: options.parsedValue }),
    }),
    intent: parkedIntent({ ...(options.proofTaskId === undefined ? {} : { proofTaskId: options.proofTaskId }) }),
    repositories: await repositories(),
  });
}

function stateOf(binding: WriteResolutionBinding, check: WriteBindingCheck): string {
  const result = binding.checks.find((candidate) => candidate.check === check);
  assert.ok(result, `the check table must report ${check}`);
  return result.state;
}

describe("write-resolution binding — what a parked write may survive", () => {
  it("reports identical when the contract closure is byte-identical", async () => {
    const binding = await evaluate(writeFixtureDescriptor);
    assert.equal(binding.state, "identical");
    assert.ok(binding.state === "identical");
    assert.equal(binding.contractFingerprint, writeFixtureDescriptor.contractFingerprint);
    assert.equal(String(binding.node.id), WRITE_FIXTURE_NODE_ID);
    assert.deepEqual(
      binding.checks.filter((check) => check.state !== "held"),
      [],
      "byte identity of the closure proves every check at once",
    );
  });

  it("stays resolvable after an unrelated edit anywhere in the contract closure", async () => {
    const binding = await evaluate(writeFixtureDescriptorAfterUnrelatedEdit);
    assert.ok(binding.state === "compatible", "an incidental closure move is not a semantic move");
    assert.equal(binding.storedContractFingerprint, writeFixtureDescriptor.contractFingerprint);
    assert.equal(binding.currentContractFingerprint, WRITE_FIXTURE_MOVED_FINGERPRINT);
    assert.deepEqual(binding.checks.filter((check) => check.state !== "held"), []);

    const key = binding.checks.find((check) => check.check === "permanent-key-identity");
    assert.ok(key, "the check table must report permanent-key-identity");
    assert.equal(key.detail.includes(WRITE_FIXTURE_KEY), false);
    assert.equal(key.detail.includes(WRITE_FIXTURE_EID), false);
    assert.ok(key.detail.includes(WRITE_FIXTURE_KEY_DIGEST.slice(0, 12)));
    assert.ok(key.detail.includes("same external transaction"));
    // `requireWriteResolutionBinding` hands the caller the transaction node.
    const required = requireWriteResolutionBinding({
      arm: "operator-confirmed-absent",
      descriptor: writeFixtureDescriptorAfterUnrelatedEdit,
      run: parkedRun(),
      intent: parkedIntent(),
      repositories: await repositories(),
    });
    assert.equal(String(required.node.id), WRITE_FIXTURE_NODE_ID);
  });

  it("refuses loudly when the commit bind makes the permanent key name another transaction", async () => {
    const binding = await evaluate(writeFixtureDescriptorWithMovedKey);
    assert.ok(binding.state === "incompatible");
    assert.equal(binding.moved, "permanent-key-identity");
    assert.equal(
      binding.checks.find((check) => check.check === "permanent-key-identity")?.rederiveFailure?.category,
      "key-drift",
    );
    // The message names the arm, BOTH fingerprints, and safe references for both keys.
    assert.ok(binding.message.includes("operator-confirmed-absent"));
    assert.ok(binding.message.includes(writeFixtureDescriptor.contractFingerprint.slice(0, 12)));
    assert.ok(binding.message.includes(WRITE_FIXTURE_MOVED_FINGERPRINT.slice(0, 12)));
    assert.equal(binding.message.includes(WRITE_FIXTURE_KEY), false);
    assert.equal(binding.message.includes(WRITE_FIXTURE_MOVED_EID), false);
    assert.ok(binding.message.includes(WRITE_FIXTURE_KEY_DIGEST.slice(0, 12)), "the fenced digest must be named");
    // The whole table is rendered: what held, what moved, what could not run.
    assert.ok(binding.message.includes("[held]  transaction-node"));
    assert.ok(binding.message.includes("[MOVED] permanent-key-identity"));
    assert.ok(binding.message.includes("[skip]  binding-proof-identity"));
    assert.equal(stateOf(binding, "binding-proof-identity"), "not-evaluated");
    await assert.rejects(
      async () => requireWriteResolutionBinding({
        arm: "recheck",
        descriptor: writeFixtureDescriptorWithMovedKey,
        run: parkedRun(),
        intent: parkedIntent(),
        repositories: await repositories(),
      }),
      /permanent-key-identity moved/,
    );
  });

  it("refuses a declared version bump and never re-derives it away", async () => {
    const binding = await evaluate(writeFixtureDescriptorAtVersion2);
    assert.ok(binding.state === "incompatible");
    assert.equal(binding.moved, "descriptor-version");
    assert.ok(binding.message.includes("a version bump declares that semantics moved"));
    for (const check of ["transaction-node", "canonical-input", "permanent-key-identity", "binding-proof-identity"] as const) {
      assert.equal(stateOf(binding, check), "not-evaluated", `${check} must never read as held after a version bump`);
    }
  });

  it("refuses when the transaction that commits this task left the graph", async () => {
    const binding = await evaluate(writeFixtureSaveDescriptorAfterUnrelatedEdit);
    assert.ok(binding.state === "incompatible");
    assert.equal(binding.moved, "transaction-node");
    assert.ok(binding.message.includes(COMMIT_TASK_ID));
    assert.equal(stateOf(binding, "permanent-key-identity"), "not-evaluated");
  });

  it("refuses when the run's stored input is bound to a superseded canonical schema", async () => {
    const stale = FingerprintSchema.parse("c".repeat(64));
    const binding = await evaluate(writeFixtureDescriptorAfterUnrelatedEdit, { parsedSchemaHash: stale });
    assert.ok(binding.state === "incompatible");
    assert.equal(binding.moved, "canonical-input");
    assert.ok(binding.message.includes(stale.slice(0, 12)), "the stored canonical schema hash must be named");
    assert.equal(stateOf(binding, "permanent-key-identity"), "not-evaluated");
  });

  it("classifies missing dependency evidence separately from schema failure", async () => {
    const missing = await evaluate(writeFixtureDescriptorWithDependencyAfterUnrelatedEdit);
    assert.ok(missing.state === "incompatible");
    const missingCheck = missing.checks.find((check) => check.check === "permanent-key-identity");
    assert.equal(missingCheck?.rederiveFailure?.category, "missing-evidence");
    assert.match(missingCheck?.rederiveFailure?.evidenceDigest ?? "", /^[a-f0-9]{64}$/u);

    const invalid = await evaluate(writeFixtureDescriptorAfterUnrelatedEdit, { parsedValue: { eid: "not-an-eid" } });
    assert.ok(invalid.state === "incompatible");
    const invalidCheck = invalid.checks.find((check) => check.check === "permanent-key-identity");
    assert.equal(invalidCheck?.rederiveFailure?.category, "schema-failure");
    assert.notEqual(
      invalidCheck?.rederiveFailure?.evidenceDigest,
      missingCheck?.rederiveFailure?.evidenceDigest,
    );
  });

  it("refuses when the retained binding proof is bound to another task", async () => {
    const binding = await evaluate(writeFixtureDescriptorAfterUnrelatedEdit, { proofTaskId: "ucpath/save-write-fixture" });
    assert.ok(binding.state === "incompatible");
    assert.equal(binding.moved, "binding-proof-identity");
    assert.ok(binding.message.includes("ucpath/save-write-fixture"));
    assert.equal(stateOf(binding, "permanent-key-identity"), "held", "the key still re-derived; only the proof moved");
  });
});
