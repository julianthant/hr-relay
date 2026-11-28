
import assert from "node:assert/strict";
import { afterAll, afterEach,describe,it } from "vitest";
import { requireParkedWriteCheckTarget } from "../../../../src/backend/runtime/writes/write-recovery.js";
import { defineTaskContract } from "../../../../src/models/task/task-contract.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { taskImplFingerprint } from "../../../../src/workflow-kit/fingerprints.js";
import { REFERENCE_CHECK } from "../../../../src/models/processing/workbooks/verify-person.js";
import { REFERENCE_CHECK_REVIEW_GATE, ReferenceCheckReviewSchema } from "../../../../src/models/processing/workbooks/reference-check-stop.js";
import { SeparationsReadReferenceStop } from "../../../../src/models/workflows/separations/read-reference-stop.js";
import { currentBuildId } from "../../../../src/backend/runtime/build-id.js";
import { UcpathDeletePendingTerminations, ucpathPendingSweepIdempotencyKey, ucpathPersonSweepIdempotencyKey } from "../../../../src/models/systems/ucpath/delete-pending-terminations.js";
import { UcpathStagePendingTerminationSweep } from "../../../../src/models/systems/ucpath/stage-pending-termination-sweep.js";
import { UCPATH_SMART_HR_TERMINATION_STAGED, UcpathPendingSweepTargetSchema } from "../../../../src/models/ui/ucpath-smart-hr-termination.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { fenceWriteFixture } from "../../../support/helpers/write-fence-fixture.js";
import { createUcpathPendingRowFixtures } from "../../../support/helpers/ucpath-pending-row-fixtures.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { ParkedWriteCheckTargetSchema } from "../../../../src/rules/commands/commands.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { createParkedWriteRoundTripTestWorld } from "../../../support/helpers/backend/parked-write-round-trip-world.js";
import {
evaluateWriteResolutionBinding,
requireWriteResolutionBinding,
type WriteBindingCheck,
type WriteBindingRepositories,
type WriteResolutionBinding,
} from "../../../../src/backend/runtime/writes/write-resolution-binding.js";
import { runClaim, RunRecordSchema,type RunRecord } from "../../../../src/models/run/record.js";
import { repeatOccurrenceKey } from "../../../../src/models/run/rerun.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import {
deriveIdempotencyKeyDigest,
deriveWriteAuthorityReason,
deriveWriteBindingProofDigest,
WriteIntentRecordSchema,
type WriteIntentRecord,
} from "../../../../src/rules/write-safety/write-safety.js";
import { UUID_5,UUID_6,UUID_7,UUID_8 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import {
WriteFixtureCommit,
WriteFixturePrepare,
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
writeFixtureDescriptorWithMovedKeySameContract,
writeFixtureQueuedRun,
writeFixtureSaveDescriptorAfterUnrelatedEdit,
} from "../../../support/fixtures/write-sequencer-fixtures.js";
import { openBoundDatabaseFixture, createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());

const COMMIT_TASK_ID = "ucpath/submit-write-fixture";

function descriptorWithRetiredKey(fencedRule: "current" | "retired" = "retired") {
  const { __sealed: _sealed, ...original } = WriteFixtureCommit;
  const policy = original.writeSafety.idempotency;
  const otherKey: typeof policy.key = input => `v2|${policy.key(input)}`;
  const commit = defineTaskContract({
    ...original,
    writeSafety: { ...original.writeSafety, idempotency: {
      ...policy, key: fencedRule === "current" ? policy.key : otherKey,
      retiredKeys: [{ key: fencedRule === "current" ? otherKey : policy.key, reason: "Earlier encoding of the same fixture transaction" }],
    } },
  });
  const input = original.input;
  return defineWorkflowDescriptor({
    id: writeFixtureDescriptor.id, version: 1, contractFingerprint: WRITE_FIXTURE_MOVED_FINGERPRINT,
    code: "wf", label: "Write Fixture", icon: "ShieldCheck", category: "operations",
    canonicalInput: defineCanonicalInput(input, input, [{ eid: WRITE_FIXTURE_EID }]), inputSubject: "eid",
    surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {}, details: [], identity: { matchKey: value => `eid:${value.eid}` },
    presentation: { title: () => "Write fixture" }, scenarios: ["write-fixture/happy"],
    flow: flow(input).transaction(WRITE_FIXTURE_NODE_ID, {
      dependsOn: [], prepare: { uses: WriteFixturePrepare, bind: ({ input }) => input },
      commit: { uses: commit, bind: ({ input }) => input }, dryRun: "stop-after-prepare",
      probePolicy: "always", probeToFenceMaxMs: 30_000,
    }).build({ schema: original.output, dependsOn: [WRITE_FIXTURE_NODE_ID],
      derive: ({ outputs }) => outputs[WRITE_FIXTURE_NODE_ID].output }),
  });
}

const disposers: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});


async function repositories(): Promise<WriteBindingRepositories> {
  const opened = await openBoundDatabaseFixture("write-binding-test", manualClock(new Date(WRITE_FIXTURE_NOW)), undefined, undefined, undefined, undefined, profileFixtures.create);
  disposers.push(async () => await opened.close());
  return opened.database.authority;
}

function parkedRun(overrides: Readonly<{ parsedSchemaHash?: string; parsedValue?: unknown; buildId?: string }> = {}): RunRecord {
  const raw = writeFixtureQueuedRun();
  if (overrides.buildId !== undefined) (raw.envelope as { buildId: string }).buildId = overrides.buildId;
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
  options: Readonly<{ parsedSchemaHash?: string; parsedValue?: unknown; proofTaskId?: string; buildId?: string }> = {},
): Promise<WriteResolutionBinding> {
  return evaluateWriteResolutionBinding({
    arm: "operator-confirmed-absent",
    descriptor,
    run: parkedRun({
      ...(options.parsedSchemaHash === undefined ? {} : { parsedSchemaHash: options.parsedSchemaHash }),
      ...(options.parsedValue === undefined ? {} : { parsedValue: options.parsedValue }),
      ...(options.buildId === undefined ? {} : { buildId: options.buildId }),
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

async function parkUnderOriginalKey(descriptor = descriptorWithRetiredKey()) {
  const world = createParkedWriteRoundTripTestWorld();
  disposers.push(world.cleanup);
  const h = await world.roundTrip(descriptor);
  await h.park();
  const authority = h.database.authority;
  const intent = world.parkedIntent(h.database);
  assert.ok(intent.status === "parked");
  const run = authority.runs.get(intent.runId);
  assert.ok(run?.lifecycle.state === "parked-write");
  h.world.events.length = 0;
  return { descriptor, world, h, authority, intent, run };
}

function checkTarget(run: RunRecord, intent: Extract<WriteIntentRecord, { status: "parked" }>) {
  return ParkedWriteCheckTargetSchema.parse({
    workerId: "write-fixture-worker-1", expectedVersion: 1, lifetimeId: UUID_5, installationId: UUID_6, profileId: UUID_7,
    workflowId: intent.workflowId, itemId: intent.itemId, runId: intent.runId, runVersion: run.version,
    runAttempt: intent.runAttempt, traceId: run.envelope.traceId, nodeId: WRITE_FIXTURE_NODE_ID,
    writeIntentId: intent.writeIntentId, intentVersion: intent.version, intentGeneration: intent.generation,
    writeAttemptId: intent.currentAttemptId, bindingProofDigest: intent.bindingProofDigest,
    occurrenceKeyDigest: intent.idempotencyKeyDigest,
  });
}

async function parkPendingSweep(keyRule: "current" | "retired" = "retired", review?: "optional" | "required-source") {
  const queued = RunRecordSchema.parse(writeFixtureQueuedRun());
  const input = WriteFixtureCommit.input;
  const { eid } = input.parse(queued.input.parsed.value);
  const name = "Fixture Employee";
  const { row } = createUcpathPendingRowFixtures(eid, name, "06/11/2026");
  const target = (transactionId: string) => UcpathPendingSweepTargetSchema.parse({
    emplId: eid, expectedName: name, observedSet: { kind: "ucpath-pending-termination-set", emplId: eid,
      eligible: [row({ transactionId })], protected: [], observedAt: WRITE_FIXTURE_NOW, source: "ss-smart-hr-detail-read" },
  });
  const original = target("T002209631"), changed = target("T002209999");
  const oldKey = ucpathPersonSweepIdempotencyKey(original);
  assert.equal(ucpathPersonSweepIdempotencyKey(changed), oldKey);
  assert.notEqual(ucpathPendingSweepIdempotencyKey(original), ucpathPendingSweepIdempotencyKey(changed));
  const commit = UcpathDeletePendingTerminations;
  assert.ok(commit.subject.kind === "person");
  const normalizedName = name.toLowerCase();
  const subject = { kind: "person", identifierKind: "email", displaySuffix: normalizedName.slice(-4),
    bindingDigest: sha256Hex(`hrauto:subject-binding:v1\0name\0${normalizedName}`) };
  const bindingProof = { kind: "subject-match", version: 1, proofId: UUID_7, leaseId: UUID_6,
    taskId: commit.id, runId: queued.envelope.runId, attempt: queued.envelope.attempt,
    observedAt: WRITE_FIXTURE_NOW, afterPrepareSpanPath: `${queued.envelope.traceId}/${WRITE_FIXTURE_NODE_ID}/prepare`,
    observationId: commit.subject.observe, pageStateId: UCPATH_SMART_HR_TERMINATION_STAGED,
    expected: subject, observed: subject, match: "match" };
  const descriptor = defineWorkflowDescriptor({
    id: writeFixtureDescriptor.id, version: 1, contractFingerprint: review === undefined ? WRITE_FIXTURE_MOVED_FINGERPRINT : queued.envelope.contractFingerprint,
    workbookCheck: REFERENCE_CHECK,
    code: "wf", label: "Sweep fixture", icon: "ShieldCheck", category: "operations",
    canonicalInput: defineCanonicalInput(input, input, [{ eid }]), inputSubject: "eid",
    surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {}, details: [], identity: { matchKey: value => `eid:${value.eid}` },
    presentation: { title: () => "Sweep fixture" }, scenarios: ["write-fixture/happy"],
    flow: flow(input).step("reference-stop", SeparationsReadReferenceStop, {
      dependsOn: [], replay: "always-rerun", bind: () => ({ check: null, writes: true }),
      when: review === "required-source" ? { kind: "equals", of: { from: "input", path: "eid" }, value: eid }
        : { kind: "is-present", of: { from: "reference", typeId: REFERENCE_CHECK.id } },
    }).gate(REFERENCE_CHECK_REVIEW_GATE, {
      dependsOn: ["reference-stop"], resolvedBy: "operator", label: "Review reference spreadsheets", result: ReferenceCheckReviewSchema,
      when: { kind: "is-present", of: { from: "node", nodeId: "reference-stop", path: "ask" } },
    }).transaction(WRITE_FIXTURE_NODE_ID, {
      dependsOn: review === undefined ? [] : [REFERENCE_CHECK_REVIEW_GATE],
      prepare: { uses: UcpathStagePendingTerminationSweep, bind: () => changed },
      commit: { uses: commit, bind: () => changed }, dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000,
    }).build({ schema: commit.output, dependsOn: [WRITE_FIXTURE_NODE_ID], derive: ({ outputs }) => outputs[WRITE_FIXTURE_NODE_ID].output }),
  });
  const world = createParkedWriteRoundTripTestWorld();
  disposers.push(world.cleanup);
  const h = await world.roundTrip(descriptor);
  const authority = h.database.authority;
  testWorkerPorts(h.database, h.clock, { path: h.profile.path, descriptor, poolIndex: 1 });
  const config = authority.runtimeConfig.get();
  assert.ok(config);
  const envelope = { ...queued.envelope, configSnapshotId: config.configSnapshotId, configFingerprint: config.configFingerprint };
  assert.equal(authority.runs.enqueue({ ...queued, envelope }).state, "inserted");
  const attempt = { writeAttemptId: UUID_5, writeIntentId: UUID_8, generation: 1, runId: envelope.runId,
    runAttempt: envelope.attempt, leaseId: bindingProof.leaseId, bindingProof,
    bindingProofDigest: deriveWriteBindingProofDigest(bindingProof), fencedAt: WRITE_FIXTURE_NOW,
    recordedAt: WRITE_FIXTURE_NOW, outcome: { state: "attempting" } };
  const key = keyRule === "current" ? ucpathPendingSweepIdempotencyKey(changed) : oldKey;
  const fence = { writeIntentId: attempt.writeIntentId, workflowId: envelope.workflow, itemId: envelope.itemId,
    taskId: commit.id, system: "ucpath", idempotencyKey: key, idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", key),
    currentAttemptId: attempt.writeAttemptId, generation: 1, runId: envelope.runId, runAttempt: envelope.attempt,
    bindingProof, bindingProofDigest: attempt.bindingProofDigest, fencedAt: WRITE_FIXTURE_NOW, version: 1,
    createdAt: WRITE_FIXTURE_NOW, updatedAt: WRITE_FIXTURE_NOW, status: "attempting" };
  assert.equal(fenceWriteFixture(h.database, { intent: fence, attempt }).state, "fenced");
  const owner = authority.runs.get(envelope.runId);
  assert.ok(owner);
  const claim = runClaim(owner);
  assert.ok(claim);
  const intent = authority.writeIntents.parkAttempt({ writeIntentId: fence.writeIntentId, generation: 1,
    expectedVersion: 1, now: WRITE_FIXTURE_NOW, code: "unknown", message: "Synthetic sweep outcome unknown",
    authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "synthetic sweep") });
  assert.ok(intent.status === "parked");
  const transition = authority.runs.transition({ runId: envelope.runId, expectedVersion: owner.version,
    claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration }, now: WRITE_FIXTURE_NOW,
    lifecycle: { state: "parked-write", writeIntentId: intent.writeIntentId, intentGeneration: intent.generation,
      parkedAt: WRITE_FIXTURE_NOW, code: intent.parkedCode, message: intent.message } });
  assert.ok(transition.state === "applied");
  const run = transition.run;
  return { world, h, authority, intent, run, descriptor };
}

describe("write-resolution binding — what a parked write may survive", () => {
  it.each(["recovery-probe", "operator-confirmed-absent"] as const)("%s refuses a different pending transaction set for the same employee", async arm => {
    const { world, h, authority, intent, run, descriptor } = await parkPendingSweep();
    if (arm === "recovery-probe") {
      assert.throws(() => requireParkedWriteCheckTarget(authority, checkTarget(run, intent), descriptor),
        /retired key cannot prove the complete original target/i);
    } else {
      const command = world.resolutionCommand("resolve-write-absent", { runId: intent.runId, expectedVersion: run.version,
        writeIntentId: intent.writeIntentId, intentGeneration: intent.generation }, {});
      assert.throws(() => h.kernel.execute(command), /retired key cannot prove the complete original target/i);
    }
    assert.deepEqual(authority.writeIntents.get(intent.writeIntentId), intent);
    assert.deepEqual(authority.runs.get(intent.runId), run);
    const attempts = authority.writeAttempts.listByIntent(intent.writeIntentId);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]?.outcome.state, "parked");
    assert.deepEqual(h.world.events, []);
  });

  it.each(["resolve-write-absent", "recheck-write"] as const)("%s admits the current sweep key after same-build spreadsheet review was skipped", async type => {
    const { world, h, authority, intent, run, descriptor } = await parkPendingSweep("current", "optional");
    assert.equal(run.envelope.buildId, currentBuildId());
    assert.equal(run.envelope.contractFingerprint, descriptor.contractFingerprint);
    assert.equal(run.input.workbookReferences?.length ?? 0, 0);
    assert.equal(authority.gateResults.listByRun(intent.runId).length, 0);
    const command = world.resolutionCommand(type, { runId: intent.runId, expectedVersion: run.version,
      writeIntentId: intent.writeIntentId, intentGeneration: intent.generation }, {});
    assert.equal(h.kernel.execute(command).state, "applied");
    const stored = authority.writeIntents.get(intent.writeIntentId);
    assert.ok(stored?.status === "parked");
    assert.equal(stored.recheck?.commandId, command.commandId);
    assert.equal(stored.currentAttemptId, intent.currentAttemptId);
    assert.equal(authority.writeAttempts.listByIntent(intent.writeIntentId).length, 1);
    assert.deepEqual(h.world.events, []);
  });

  it("refuses absent condition evidence when the review source was required", async () => {
    const { descriptor, run, intent, authority } = await parkPendingSweep("current", "required-source");
    assert.throws(() => requireWriteResolutionBinding({ arm: "operator-confirmed-absent", descriptor, run, intent, repositories: authority }), /missing-evidence/);
    assert.deepEqual(authority.writeIntents.get(intent.writeIntentId), intent);
  });

  it.each([null, true] as const)("uses the recorded review decision (ask=%s) when the gate result is absent", async ask => {
    const { descriptor, run, intent, authority } = await parkPendingSweep("current", "required-source");
    const source = SeparationsReadReferenceStop;
    assert.equal(authority.runCheckpoints.insert({
      workflowId: intent.workflowId, itemId: intent.itemId, nodeId: "reference-stop", attempt: intent.runAttempt,
      claimGeneration: run.claimGeneration, runId: intent.runId, descriptorVersion: descriptor.version,
      contractFingerprint: descriptor.contractFingerprint, implFingerprint: taskImplFingerprint(source),
      output: { schemaHash: deriveSchemaHash(source.output, "output"), value: { ask } }, provenance: [], writtenAt: WRITE_FIXTURE_NOW,
    }).state, "inserted");
    const evaluate = () => requireWriteResolutionBinding({ arm: "operator-confirmed-absent", descriptor, run, intent, repositories: authority });
    if (ask === null) assert.equal(evaluate().binding.state, "identical");
    else assert.throws(evaluate, /missing-evidence/);
  });

  it("keeps a retired sweep key parked after a provable same-build gate skip", async () => {
    const { descriptor, run, intent, authority } = await parkPendingSweep("retired", "optional");
    for (const arm of ["recovery-probe", "operator-confirmed-absent"] as const) {
      assert.throws(() => requireWriteResolutionBinding({ arm, descriptor, run, intent, repositories: authority }), /retired key cannot prove the complete original target/i);
    }
    assert.deepEqual(authority.writeIntents.get(intent.writeIntentId), intent);
  });

  it("checks the original target when the current rule reproduces its fence", async () => {
    const { descriptor, h, authority, intent, run } = await parkUnderOriginalKey(descriptorWithRetiredKey("current"));
    const target = checkTarget(run, intent);
    assert.deepEqual(requireParkedWriteCheckTarget(authority, target, descriptor).commitInput, { eid: WRITE_FIXTURE_EID });
    assert.deepEqual(authority.writeIntents.get(intent.writeIntentId), intent);
    assert.deepEqual(h.world.events, []);
  });

  it("requests an absence read against the original attempt when the current rule reproduces its fence", async () => {
    const { world, h, authority, intent, run } = await parkUnderOriginalKey(descriptorWithRetiredKey("current"));
    const command = world.resolutionCommand("resolve-write-absent", {
      runId: intent.runId, expectedVersion: run.version, writeIntentId: intent.writeIntentId, intentGeneration: intent.generation,
    }, {});
    assert.equal(h.kernel.execute(command).state, "applied");
    const resolved = authority.writeIntents.get(intent.writeIntentId);
    assert.ok(resolved?.status === "parked");
    assert.equal(resolved.recheck?.commandId, command.commandId);
    assert.equal(resolved.idempotencyKey, WRITE_FIXTURE_KEY);
    assert.equal(resolved.idempotencyKeyDigest, WRITE_FIXTURE_KEY_DIGEST);
    assert.equal(resolved.currentAttemptId, intent.currentAttemptId);
    assert.equal(authority.writeAttempts.listByIntent(intent.writeIntentId).length, 1);
    assert.deepEqual(h.world.events, []);
  });

  it("refuses another target's valid earlier key and digest, and keeps Saved recheck on the current rule", async () => {
    const { descriptor, run, intent, authority } = await parkUnderOriginalKey();
    const input = { descriptor, run, intent, repositories: authority };
    const foreignKey = `${WRITE_FIXTURE_MOVED_EID}|fixture-termination`;
    const tampered = WriteIntentRecordSchema.parse({ ...input.intent,
      idempotencyKey: foreignKey, idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", foreignKey) });
    for (const arm of ["recovery-probe", "operator-confirmed-absent"] as const) {
      assert.throws(() => requireWriteResolutionBinding({ ...input, arm, intent: tampered }), /permanent-key-identity moved/);
      const sameBuildRun = RunRecordSchema.parse({ ...run, envelope: { ...run.envelope, contractFingerprint: descriptor.contractFingerprint } });
      assert.throws(() => requireWriteResolutionBinding({ ...input, arm, run: sameBuildRun }), /permanent-key-identity moved/);
    }
    assert.throws(() => requireWriteResolutionBinding({ ...input, arm: "recheck" }), /permanent-key-identity moved/);
  });

  it("requires the current business key and original confirmation for a repeated occurrence", async () => {
    const { descriptor, run, intent, authority } = await parkUnderOriginalKey();
    const warning = { nodeId: WRITE_FIXTURE_NODE_ID, taskId: intent.taskId, system: intent.system,
      businessKeyDigest: intent.idempotencyKeyDigest, writeIntentId: UUID_8, evidenceDigest: "a".repeat(64) };
    const source = { runId: UUID_6, expectedVersion: 2, intent: "rerun", selectedStepKeys: [WRITE_FIXTURE_NODE_ID], copiedFrom: [] };
    const warningDigest = "b".repeat(64);
    const repeatRun = RunRecordSchema.parse({ ...run, envelope: { ...run.envelope, sourceBound: {
      source, warnings: [warning], confirmationCommandId: UUID_5, warningDigest, acknowledgment: warningDigest,
    } } });
    function repeatedIntent(confirmationCommandId: string) {
      const occurrence = { ...warning, confirmationCommandId, sourceRunId: source.runId, sourceVersion: source.expectedVersion,
        warningDigest, baselineEvidence: [{ writeIntentId: warning.writeIntentId, evidenceDigest: warning.evidenceDigest }] };
      const key = repeatOccurrenceKey(warning.businessKeyDigest, confirmationCommandId, warning.nodeId);
      return WriteIntentRecordSchema.parse({ ...intent, occurrence, idempotencyKey: key,
        idempotencyKeyDigest: deriveIdempotencyKeyDigest(intent.system, key) });
    }
    const input = { arm: "operator-confirmed-absent" as const, descriptor, run: repeatRun, repositories: authority };
    assert.throws(() => requireWriteResolutionBinding({ ...input, intent: repeatedIntent(UUID_5) }), /retired key cannot prove the complete original target/i);
    const current = { ...input, descriptor: descriptorWithRetiredKey("current") };
    assert.equal(requireWriteResolutionBinding({ ...current, intent: repeatedIntent(UUID_5) }).binding.state, "compatible");
    assert.throws(() => requireWriteResolutionBinding({ ...current, intent: repeatedIntent(UUID_7) }), /permanent-key-identity moved/);
    assert.throws(() => requireWriteResolutionBinding({ ...input, intent: repeatedIntent(UUID_7) }), /permanent-key-identity moved/);
  });

  it("reports identical for the same contract under the same build", async () => {
    const binding = await evaluate(writeFixtureDescriptor);
    assert.equal(binding.state, "identical");
    assert.ok(binding.state === "identical");
    assert.equal(binding.contractFingerprint, writeFixtureDescriptor.contractFingerprint);
    assert.equal(String(binding.node.id), WRITE_FIXTURE_NODE_ID);
    assert.deepEqual(
      binding.checks.filter((check) => check.state !== "held"),
      [],
      "same contract and same build prove every check at once",
    );
  });

  it("runs every identity check when the contract is equal but the approving build differs", async () => {
    const otherBuild = "0".repeat(64);
    const compatible = await evaluate(writeFixtureDescriptor, { buildId: otherBuild });
    assert.ok(compatible.state === "compatible", "equal contracts under another build are not proof of identical code");
    assert.deepEqual(compatible.checks.filter((check) => check.state !== "held"), []);
    assert.equal(compatible.checks.some((check) => check.detail.includes("same contract and same build")), false);

    const moved = await evaluate(writeFixtureDescriptorWithMovedKeySameContract, { buildId: otherBuild });
    assert.equal(writeFixtureDescriptorWithMovedKeySameContract.contractFingerprint, writeFixtureDescriptor.contractFingerprint);
    assert.ok(moved.state === "incompatible", "a changed key under an equal contract must refuse, not shortcut");
    assert.equal(moved.moved, "permanent-key-identity");
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
