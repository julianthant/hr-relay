/**
 * D136 — a parked write's resolvability binds to the semantic surface a
 * resolution consumes, not to the descriptor's whole source-closure hash.
 *
 * Both directions are pinned here, because both are safety properties:
 *   - an INCIDENTAL closure move (an unrelated module in the same import
 *     graph) leaves every named check held, so the ref write-safety §4.1 arms stay open;
 *   - a SEMANTIC move (version bump, the transaction's commit task, the
 *     canonical-input schema, the permanent key, the retained binding proof)
 *     refuses, names the exact check that moved, and never reports an
 *     unevaluated check as held.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import {
  evaluateWriteResolutionBinding,
  requireWriteResolutionBinding,
  type WriteBindingCheck,
  type WriteBindingRepositories,
  type WriteResolutionBinding,
} from "../../src/core/write-resolution-binding.js";
import { manualClock } from "../../src/domain/clock.js";
import { FingerprintSchema } from "../../src/domain/ids.js";
import { RunRecordSchema, type RunRecord } from "../../src/domain/run/record.js";
import {
  deriveWriteBindingProofDigest,
  WriteIntentRecordSchema,
  type WriteIntentRecord,
} from "../../src/domain/write-safety.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { UUID_5, UUID_6, UUID_7, UUID_8 } from "./fixtures/phase1c-contract-fixtures.js";
import {
  WRITE_FIXTURE_ITEM_ID,
  WRITE_FIXTURE_EID,
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
  writeFixtureDescriptorWithMovedKey,
  writeFixtureQueuedRun,
  writeFixtureSaveDescriptorAfterUnrelatedEdit,
} from "./fixtures/write-sequencer-fixtures.js";

const COMMIT_TASK_ID = "ucpath/submit-write-fixture";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

/**
 * The evaluation only READS durable state, and the fixture transaction node
 * depends on nothing — but a real repository pair is used anyway so a future
 * dependency edge exercises the real reader instead of a stub that lies.
 */
function repositories(): WriteBindingRepositories {
  const clock = manualClock(new Date(WRITE_FIXTURE_NOW));
  const root = mkdtempSync(join(tmpdir(), "hrauto-write-binding-"));
  const database = AuthorityDatabase.open(
    { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "write-binding-test" },
    clock,
  );
  disposers.push(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  return database.authority;
}

function parkedRun(overrides: Readonly<{ parsedSchemaHash?: string }> = {}): RunRecord {
  const raw = writeFixtureQueuedRun();
  if (overrides.parsedSchemaHash !== undefined) {
    const input = raw.input as { parsed: { schemaHash: string } };
    input.parsed.schemaHash = overrides.parsedSchemaHash;
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
  });
}

function evaluate(
  descriptor: Parameters<typeof evaluateWriteResolutionBinding>[0]["descriptor"],
  options: Readonly<{ parsedSchemaHash?: string; proofTaskId?: string }> = {},
): WriteResolutionBinding {
  return evaluateWriteResolutionBinding({
    arm: "operator-confirmed-absent",
    descriptor,
    run: parkedRun({ ...(options.parsedSchemaHash === undefined ? {} : { parsedSchemaHash: options.parsedSchemaHash }) }),
    intent: parkedIntent({ ...(options.proofTaskId === undefined ? {} : { proofTaskId: options.proofTaskId }) }),
    repositories: repositories(),
  });
}

function stateOf(binding: WriteResolutionBinding, check: WriteBindingCheck): string {
  const result = binding.checks.find((candidate) => candidate.check === check);
  assert.ok(result, `the check table must report ${check}`);
  return result.state;
}

describe("D136 write-resolution binding — what a parked write may survive", () => {
  it("reports identical when the contract closure is byte-identical", () => {
    const binding = evaluate(writeFixtureDescriptor);
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

  it("stays resolvable after an unrelated edit anywhere in the contract closure", () => {
    const binding = evaluate(writeFixtureDescriptorAfterUnrelatedEdit);
    assert.ok(binding.state === "compatible", "an incidental closure move is not a semantic move");
    assert.equal(binding.storedContractFingerprint, writeFixtureDescriptor.contractFingerprint);
    assert.equal(binding.currentContractFingerprint, WRITE_FIXTURE_MOVED_FINGERPRINT);
    assert.deepEqual(binding.checks.filter((check) => check.state !== "held"), []);
    // The load-bearing evidence: the permanent key was RE-DERIVED, not assumed.
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
      repositories: repositories(),
    });
    assert.equal(String(required.node.id), WRITE_FIXTURE_NODE_ID);
  });

  it("refuses loudly when the commit bind makes the permanent key name another transaction", () => {
    const binding = evaluate(writeFixtureDescriptorWithMovedKey);
    assert.ok(binding.state === "incompatible");
    assert.equal(binding.moved, "permanent-key-identity");
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
    assert.throws(
      () => requireWriteResolutionBinding({
        arm: "operator-confirmed-present",
        descriptor: writeFixtureDescriptorWithMovedKey,
        run: parkedRun(),
        intent: parkedIntent(),
        repositories: repositories(),
      }),
      /permanent-key-identity moved/,
    );
  });

  it("refuses a declared version bump and never re-derives it away", () => {
    const binding = evaluate(writeFixtureDescriptorAtVersion2);
    assert.ok(binding.state === "incompatible");
    assert.equal(binding.moved, "descriptor-version");
    assert.ok(binding.message.includes("a version bump declares that semantics moved"));
    for (const check of ["transaction-node", "canonical-input", "permanent-key-identity", "binding-proof-identity"] as const) {
      assert.equal(stateOf(binding, check), "not-evaluated", `${check} must never read as held after a version bump`);
    }
  });

  it("refuses when the transaction that commits this task left the graph", () => {
    const binding = evaluate(writeFixtureSaveDescriptorAfterUnrelatedEdit);
    assert.ok(binding.state === "incompatible");
    assert.equal(binding.moved, "transaction-node");
    assert.ok(binding.message.includes(COMMIT_TASK_ID));
    assert.equal(stateOf(binding, "permanent-key-identity"), "not-evaluated");
  });

  it("refuses when the run's stored input is bound to a superseded canonical schema", () => {
    const stale = FingerprintSchema.parse("c".repeat(64));
    const binding = evaluate(writeFixtureDescriptorAfterUnrelatedEdit, { parsedSchemaHash: stale });
    assert.ok(binding.state === "incompatible");
    assert.equal(binding.moved, "canonical-input");
    assert.ok(binding.message.includes(stale.slice(0, 12)), "the stored canonical schema hash must be named");
    assert.equal(stateOf(binding, "permanent-key-identity"), "not-evaluated");
  });

  it("refuses when the retained binding proof is bound to another task", () => {
    const binding = evaluate(writeFixtureDescriptorAfterUnrelatedEdit, { proofTaskId: "ucpath/save-write-fixture" });
    assert.ok(binding.state === "incompatible");
    assert.equal(binding.moved, "binding-proof-identity");
    assert.ok(binding.message.includes("ucpath/save-write-fixture"));
    assert.equal(stateOf(binding, "permanent-key-identity"), "held", "the key still re-derived; only the proof moved");
  });
});
