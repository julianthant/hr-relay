import { defineTaskStoreRegistry } from "../../src/base/store.js";
import { buildWriteFixtureRegistry } from "./fixtures/write-sequencer-fixtures.js";
import { PlannedRunSchema, StartPlanRecordSchema, derivePlannedInputFingerprint } from "../../src/domain/run/start-plan.js";
import { sourceBoundReadDescriptor, sourceBoundReadStores } from "./fixtures/source-bound-read-fixtures.js";
import { CreateRunRequestSchema } from "../../src/core/run-record-service.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { WriteFixtureProofSchema, writeFixtureOmittableDescriptor, writeFixtureDescriptor, writeFixtureParallelDescriptor, writeFixtureMemoDescriptor, writeFixtureDocumentDescriptor } from "./fixtures/write-sequencer-fixtures.js";
import { WriteIntentRecordSchema, deriveIdempotencyKeyDigest } from "../../src/domain/write-safety.js";
import { repeatOccurrenceKey } from "../../src/domain/run/rerun.js";
import { PositiveIntSchema } from "../../src/domain/ids.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { sourceBoundHarness } from "./fixtures/source-bound-fixtures.js";
import { absentProbeEvidence } from "./fixtures/write-sequencer-fixtures.js";

const disposers: (() => void)[] = [];
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); });
function harness(parallel = false) { const h = sourceBoundHarness(parallel ? writeFixtureParallelDescriptor : writeFixtureDescriptor); disposers.push(h.dispose); return h; }
async function completed(h: ReturnType<typeof harness>) {
  const run = h.start(h.proposal());
  h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
  const outcome = await h.execute(run);
  assert.equal(outcome.state, "done", JSON.stringify(outcome.state === "failed" ? h.database.authority.failures.get(outcome.failureId) : outcome));
  return h.fresh(run);
}
function effects(h: ReturnType<typeof harness>) {
  return { runs: h.database.authority.runs.listByWorkflow(h.descriptor.id).length,
    identities: h.lifecycleIds.minted().length, queueRoots: h.queueRoots.length,
    intents: h.database.authority.writeIntents.listByBusinessKey("ucpath",
      h.database.authority.writeIntents.listByRun(h.database.authority.runs.listByWorkflow(h.descriptor.id)[0].envelope.runId)[0].idempotencyKeyDigest) };
}

describe("source-bound repeat through planner, kernel, service and interpreter (D334/D335)", () => {
  it("keeps protected source proof and key digests out of serialized rerun warnings", async () => {
    const documentHarness = () => { const h = sourceBoundHarness(writeFixtureDocumentDescriptor); disposers.push(h.dispose); return h; };
    const original = documentHarness(); const completedSource = await completed(original);
    const { sessionId: _sessionId, ...sourceWithoutSession } = completedSource;
    const originalIntent = original.database.authority.writeIntents.listByRun(completedSource.envelope.runId)[0];
    assert.ok(originalIntent.status === "committed");
    const proposal = async (documentNumber: string) => {
      const h = documentHarness();
      const source = { ...sourceWithoutSession, envelope: { ...sourceWithoutSession.envelope,
        runId: "eeeeeeee-0001-4000-8000-000100000000" }, input: { ...completedSource.input,
        raw: { eid: "10812345", documentNumber }, parsed: { ...completedSource.input.parsed,
          value: { eid: "10812345", documentNumber }, protectedBindings: [{ kind: "test-data-local",
            inputPath: "documentNumber", name: "separationsKualiFinalizationCanaryDocumentNumber",
            sourceId: "10000000-0000-4000-8000-000000000001" }] } } };
      assert.equal(h.database.authority.runs.enqueue({ ...source, lifecycle: { state: "queued" } }).state, "inserted");
      const claimed = h.database.authority.runs.claimNext({ workflow: source.envelope.workflow,
        workerId: "fixture-owner", now: h.clock.now().toISOString() });
      assert.ok(claimed.state === "claimed");
      assert.equal(h.database.authority.runs.transition({ runId: source.envelope.runId, expectedVersion: claimed.run.version,
        claim: { workerId: "fixture-owner", claimGeneration: claimed.run.claimGeneration },
        lifecycle: { state: "terminal", outcome: "interrupted", endedAt: h.clock.now().toISOString() },
        now: h.clock.now().toISOString() }).state, "applied");
      const { runId: _runId, runAttempt: _attempt, currentAttemptId: _attemptId, bindingProof: _binding,
        bindingProofDigest: _bindingDigest, fencedAt: _fenced, confirmedAt: _confirmed,
        completionProof, ...identity } = originalIntent;
      h.database.authority.writeIntents.recordObservedPresent({ ...identity, status: "observed-present",
        observedAt: originalIntent.confirmedAt,
        observedProof: { ...completionProof, value: { transactionId: "T123456", documentNumber } } });
      const storedSource = h.database.authority.runs.get(source.envelope.runId); assert.ok(storedSource);
      const selectedStepKeys = h.descriptor.timeline.map((step) => step.key);
      const wire = h.planner.plan({ workflowId: h.descriptor.id, submissions: [{ eid: "10812345", documentNumber }],
        dryRun: true, selectedStepKeys, rerunSource: { runId: storedSource.envelope.runId,
          expectedVersion: storedSource.version, intent: "rerun", selectedStepKeys } });
      const stored = h.database.authority.startPlans.get(wire.startPlanId); assert.ok(stored);
      assert.ok(wire.rerun);
      assert.equal(wire.rerun.warnings[0].businessKeyDigest, "withheld-protected-input");
      assert.ok(!JSON.stringify(wire.rerun).includes(documentNumber));
      assert.ok(!JSON.stringify(wire.rerun).includes(originalIntent.idempotencyKeyDigest));
      assert.equal(stored.rerun?.warnings[0].businessKeyDigest, originalIntent.idempotencyKeyDigest);
      const accepted = h.planner.plan({ workflowId: h.descriptor.id, submissions: [{ eid: "10812345", documentNumber }],
        dryRun: true, selectedStepKeys, warningAcknowledgment: wire.rerun.warningDigest,
        rerunSource: { runId: storedSource.envelope.runId, expectedVersion: storedSource.version, intent: "rerun", selectedStepKeys } });
      const preview = h.start(accepted);
      h.world.probeResults.push({ state: "present", proof: { transactionId: "T123456", documentNumber } });
      const result = await h.execute(preview);
      assert.equal(result.state, "done", JSON.stringify(result.state === "failed" ? h.database.authority.failures.get(result.failureId) : result));
      assert.equal(h.world.events.filter((event) => event.startsWith("commit-click")).length, 0);
      assert.deepEqual(h.database.authority.writeIntents.listByRun(preview.envelope.runId), []);
      const livePlan = h.planner.plan({ workflowId: h.descriptor.id, submissions: [{ eid: "10812345", documentNumber }],
        dryRun: false, selectedStepKeys, warningAcknowledgment: wire.rerun.warningDigest,
        rerunSource: { runId: storedSource.envelope.runId, expectedVersion: storedSource.version, intent: "rerun", selectedStepKeys } });
      const repeat = h.start(livePlan);
      h.world.probeResults.push({ state: "present", proof: { transactionId: "T123456", documentNumber } });
      h.world.commitOutput = { transactionId: "T234567", documentNumber };
      const committed = await h.execute(repeat);
      assert.equal(committed.state, "done", JSON.stringify(committed.state === "failed" ? h.database.authority.failures.get(committed.failureId) : committed));
      const newIntent = h.database.authority.writeIntents.listByRun(repeat.envelope.runId)[0];
      assert.ok(newIntent.status === "committed" && newIntent.occurrence);
      assert.equal(newIntent.occurrence.businessKeyDigest, originalIntent.idempotencyKeyDigest);
      assert.equal(h.world.events.filter((event) => event.startsWith("commit-click")).length, 1);
      return wire.rerun;
    };
    assert.deepEqual(await proposal("12345678"), await proposal("87654321"));
  });
  it("warning acknowledgment spends no lifecycle identity; final submission commits afresh and exact replay publishes once", async () => {
    const h = harness(); const source = await completed(h);
    const original = canonicalJsonStringify({ run: source,
      intents: h.database.authority.writeIntents.listByRun(source.envelope.runId),
      checkpoints: h.database.authority.runCheckpoints.listByItem(h.descriptor.id, source.envelope.itemId) });
    const before = effects(h);
    const warning = h.proposal(source);
    assert.ok(warning.rerun); assert.equal(warning.rerun.warnings.length, 1);
    assert.ok(warning.planned.every((entry) => !Object.hasOwn(entry, "runId") && !Object.hasOwn(entry, "traceId")));
    const unacknowledged = h.command(warning);
    assert.equal(h.kernel.execute(unacknowledged).state, "confirmation-required");
    assert.equal(h.database.authority.startPlans.get(warning.startPlanId)?.consumedBy, undefined);
    assert.equal(h.database.authority.commands.get(unacknowledged.commandId), undefined);
    assert.deepEqual(effects(h), before);
    const accepted = h.proposal(source, warning.rerun.warningDigest);
    assert.deepEqual(effects(h), before, "warning Confirm only acknowledges a plan");
    const command = h.command(accepted);
    const result = h.kernel.execute(command); assert.equal(result.state, "applied");
    assert.equal(h.kernel.execute(command).state, "already-applied");
    assert.equal(h.queueRoots.length, before.queueRoots + 1);
    const repeat = h.database.authority.runs.listByWorkflow(h.descriptor.id).find((run) => run.envelope.runId !== source.envelope.runId);
    assert.ok(repeat); assert.equal(repeat.envelope.retryOf, source.envelope.runId);
    h.world.events.length = 0;
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T123456" } });
    h.world.commitOutput = { transactionId: "T234567" };
    assert.equal((await h.execute(repeat)).state, "done");
    assert.ok(h.world.events.some((event) => event.startsWith("prepare")));
    assert.equal(h.world.events.filter((event) => event.startsWith("commit-click")).length, 1);
    const intent = h.database.authority.writeIntents.listByRun(repeat.envelope.runId)[0];
    assert.equal(intent.status, "committed");
    assert.ok(intent.occurrence);
    assert.notEqual(intent.idempotencyKeyDigest, before.intents[0].idempotencyKeyDigest);
    assert.equal(canonicalJsonStringify({ run: h.fresh(source),
      intents: h.database.authority.writeIntents.listByRun(source.envelope.runId),
      checkpoints: h.database.authority.runCheckpoints.listByItem(h.descriptor.id, source.envelope.itemId).filter((row) => row.runId === source.envelope.runId) }), original);
  });

  it("refuses stale source and stale consent before consuming a plan or minting work", async () => {
    const h = harness(); const source = await completed(h);
    const warning = h.proposal(source); assert.ok(warning.rerun);
    const wrong = h.proposal(source, "f".repeat(64)); const before = effects(h);
    assert.equal(h.kernel.execute(h.command(wrong)).state, "confirmation-required");
    assert.deepEqual(effects(h), before);
    assert.throws(() => h.proposal({ ...source, version: PositiveIntSchema.parse(source.version + 1) }), /revision changed/);
    assert.deepEqual(effects(h), before);
  });

  it("dry-run repeats prepare against the acknowledged baseline with zero write effects", async () => {
    const h = harness(); const source = await completed(h);
    const warning = h.proposal(source); assert.ok(warning.rerun);
    const preview = h.start(h.proposal(source, warning.rerun.warningDigest, true));
    const intents = effects(h).intents;
    h.world.events.length = 0;
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T123456" } });
    const outcome = await h.execute(preview);
    assert.equal(outcome.state, "done", JSON.stringify(outcome));
    assert.ok(h.world.events.some((event) => event.startsWith("prepare")));
    assert.equal(h.world.events.filter((event) => event.startsWith("commit-click")).length, 0);
    assert.deepEqual(effects(h).intents, intents);
    assert.deepEqual(h.database.authority.writeIntents.listByRun(preview.envelope.runId), []);
  });

  it("old-only post-click receipt parks the new occurrence without changing the source", async () => {
    const h = harness(); const source = await completed(h);
    const warning = h.proposal(source); assert.ok(warning.rerun);
    const repeat = h.start(h.proposal(source, warning.rerun.warningDigest));
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T123456" } });
    await h.execute(repeat);
    assert.equal(h.fresh(repeat).lifecycle.state, "parked-write");
    const intent = h.database.authority.writeIntents.listByRun(repeat.envelope.runId)[0];
    assert.equal(intent.status, "parked");
    assert.deepEqual(h.fresh(source), source);
    assert.equal(h.database.authority.runCheckpoints.listByItem(h.descriptor.id, source.envelope.itemId)
      .filter((row) => row.runId === repeat.envelope.runId).length, 0);
  });
  it("requires exact-occurrence attestation and rejects old proof before atomic positive settlement", async () => {
    const h = harness(); const source = await completed(h);
    const warning = h.proposal(source); assert.ok(warning.rerun);
    const repeat = h.start(h.proposal(source, warning.rerun.warningDigest));
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T123456" } });
    await h.execute(repeat);
    const parked = h.fresh(repeat);
    const intent = h.database.authority.writeIntents.listByRun(repeat.envelope.runId)[0];
    assert.equal(intent.status, "parked");
    const base = { requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard", family: "run", type: "resolve-write-present",
      target: { runId: repeat.envelope.runId, expectedVersion: parked.version, writeIntentId: intent.writeIntentId, intentGeneration: intent.generation } };
    const payload = { proof: { schemaHash: deriveSchemaHash(WriteFixtureProofSchema, "output"), value: { transactionId: "T123456" } }, evidenceNote: "Exact occurrence receipt inspected" };
    assert.equal(h.kernel.execute({ ...base, commandId: h.ids.uuid(), payload }).state, "rejected");
    assert.equal(h.kernel.execute({ ...base, commandId: h.ids.uuid(), payload: { ...payload, occurrenceKeyDigest: intent.idempotencyKeyDigest } }).state, "rejected");
    assert.deepEqual(h.fresh(repeat), parked);
    assert.deepEqual(h.database.authority.writeIntents.get(intent.writeIntentId), intent);
    const command = { ...base, commandId: h.ids.uuid(), payload: { ...payload, occurrenceKeyDigest: intent.idempotencyKeyDigest,
      proof: { ...payload.proof, value: { transactionId: "T345678" } } } };
    assert.equal(h.kernel.execute(command).state, "applied");
    assert.equal(h.kernel.execute(command).state, "already-applied");
    const clicks = h.world.events.filter((event) => event.startsWith("commit-click")).length;
    assert.equal((await h.execute(h.fresh(repeat))).state, "done");
    assert.equal(h.world.events.filter((event) => event.startsWith("commit-click")).length, clicks, "own-run checkpoint resumes without another click");
    assert.deepEqual(h.fresh(source), source);
  });

  it("serializes distinct confirmations against an unresolved sibling and keeps orphan intents fenced", async () => {
    const h = harness(true); const source = await completed(h);
    const warning = h.proposal(source); assert.ok(warning.rerun);
    const one = h.start(h.proposal(source, warning.rerun.warningDigest));
    const two = h.start(h.proposal(source, warning.rerun.warningDigest));
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T123456" } });
    await h.execute(one); assert.equal(h.fresh(one).lifecycle.state, "parked-write");
    const clicks = h.world.events.filter((event) => event.startsWith("commit-click")).length;
    await h.execute(two);
    assert.equal(h.world.events.filter((event) => event.startsWith("commit-click")).length, clicks);
    assert.deepEqual(h.database.authority.writeIntents.listByRun(two.envelope.runId), []);
    const ordinary = h.start(h.proposal()); await h.execute(ordinary);
    assert.equal(h.world.events.filter((event) => event.startsWith("commit-click")).length, clicks, "ordinary writes also honor the repeat fence");
    assert.deepEqual(h.database.authority.writeIntents.listByRun(ordinary.envelope.runId), []);
    const unresolved = h.database.authority.writeIntents.listByRun(one.envelope.runId)[0];
    assert.equal(unresolved.status, "parked"); assert.ok(unresolved.occurrence);
    // Feed the real fenced record to a fresh adapter with no originating lifecycle row.
    const orphan = harness();
    const attempt = h.database.authority.writeAttempts.listByIntent(unresolved.writeIntentId)[0];
    const { parkedCode, message, authorityReason, ...identity } = unresolved;
    void parkedCode; void message; void authorityReason;
    const fenced = WriteIntentRecordSchema.parse({ ...identity, status: "attempting" });
    // The baseline is copied as immutable settled evidence; neither originating run exists here.
    const baseline = h.database.authority.writeIntents.listByRun(source.envelope.runId)[0];
    assert.equal(baseline.status, "committed");
    const { runId, runAttempt, currentAttemptId, bindingProof, bindingProofDigest, fencedAt, confirmedAt, completionProof, ...baseIdentity } = baseline;
    void runId; void runAttempt; void currentAttemptId; void bindingProof; void bindingProofDigest; void fencedAt;
    orphan.database.authority.writeIntents.recordObservedPresent({ ...baseIdentity, status: "observed-present", observedProof: completionProof, observedAt: confirmedAt });
    orphan.database.authority.writeIntents.fenceAttempt({ intent: fenced, attempt: { ...attempt, outcome: { state: "attempting" } } });
    assert.equal(orphan.database.authority.runs.get(one.envelope.runId), undefined);
    const otherCommand = orphan.ids.uuid();
    const key = repeatOccurrenceKey(unresolved.occurrence.businessKeyDigest, otherCommand, unresolved.occurrence.nodeId);
    const next = { ...fenced, writeIntentId: orphan.ids.uuid(), idempotencyKey: key, idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", key),
      occurrence: { ...unresolved.occurrence, confirmationCommandId: otherCommand } };
    assert.throws(() => orphan.database.authority.writeIntents.fenceAttempt({ intent: next,
      attempt: { ...attempt, writeIntentId: next.writeIntentId, outcome: { state: "attempting" } } }), /unresolved write occurrence/);
  });

  it("retains acknowledgment across changed/cleared non-key values while keeping submitted input authoritative", async () => {
    const h = sourceBoundHarness(writeFixtureMemoDescriptor); disposers.push(h.dispose);
    const sourceRun = h.start(h.proposal(undefined, undefined, false, undefined, "old memo"));
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
    assert.equal((await h.execute(sourceRun)).state, "done");
    const source = h.fresh(sourceRun);
    const warning = h.proposal(source, undefined, false, undefined, "old memo"); assert.ok(warning.rerun);
    const changed = h.proposal(source, warning.rerun.warningDigest, false, undefined, "new memo");
    const cleared = h.proposal(source, warning.rerun.warningDigest, false, undefined, "");
    assert.equal(changed.rerun?.warningDigest, warning.rerun.warningDigest);
    assert.equal(cleared.rerun?.warningDigest, warning.rerun.warningDigest);
    assert.notEqual(changed.fingerprints.inputFingerprint, cleared.fingerprints.inputFingerprint);
    const run = h.start(cleared);
    assert.deepEqual(run.input.raw, { eid: "10812345", memo: "" });
    assert.deepEqual(run.input.parsed.value, { eid: "10812345", memo: "" });
    assert.deepEqual(h.fresh(source), source);
  });

  it("requires renewed consent after a competing confirmation creates fresh completion evidence", async () => {
    const h = harness(true); const source = await completed(h);
    const warning = h.proposal(source); assert.ok(warning.rerun);
    const one = h.start(h.proposal(source, warning.rerun.warningDigest));
    const two = h.start(h.proposal(source, warning.rerun.warningDigest));
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T123456" } });
    h.world.commitOutput = { transactionId: "T234567" };
    assert.equal((await h.execute(one)).state, "done");
    const clicks = h.world.events.filter(event => event.startsWith("commit-click")).length;
    const second = await h.execute(two); assert.equal(second.state, "failed");
    assert.equal(h.world.events.filter(event => event.startsWith("commit-click")).length, clicks);
    assert.deepEqual(h.database.authority.writeIntents.listByRun(two.envelope.runId), []);
    const stale = h.proposal(source, warning.rerun.warningDigest);
    assert.notEqual(stale.rerun?.warningDigest, warning.rerun.warningDigest);
    const before = effects(h); assert.equal(h.kernel.execute(h.command(stale)).state, "confirmation-required");
    assert.deepEqual(effects(h), before);
  });

  it("deletion between planning and final submission refuses before consumption or new identities", async () => {
    const h = harness(); const source = await completed(h);
    const warning = h.proposal(source); assert.ok(warning.rerun);
    const accepted = h.proposal(source, warning.rerun.warningDigest);
    assert.equal(h.lifecycle.delete({ commandId: h.ids.uuid(), runId: source.envelope.runId, expectedVersion: source.version }).state, "deleted");
    const minted = h.lifecycleIds.minted().length; const roots = h.queueRoots.length;
    const result = h.kernel.execute(h.command(accepted));
    assert.equal(result.state, "rejected"); if (result.state === "rejected") assert.equal(result.code, "target-deleted");
    assert.equal(h.lifecycleIds.minted().length, minted); assert.equal(h.queueRoots.length, roots);
    assert.equal(h.database.authority.startPlans.get(accepted.startPlanId)?.consumedBy, undefined);
  });

  it("rolls back the plan, session, first creation and publication when the second real service create refuses", () => {
    const h = harness(true);
    const plan = h.planner.plan({ workflowId: h.descriptor.id, submissions: [{ eid: "10812345" }, { eid: "10812346" }], dryRun: false });
    const create = h.lifecycle.create.bind(h.lifecycle); let calls = 0;
    h.lifecycle.create = (input, publication) => {
      calls++;
      const request = CreateRunRequestSchema.parse(input);
      return create(calls === 2 ? { ...request, configFingerprint: "f".repeat(64) } : request, publication);
    };
    const result = h.kernel.execute(h.command(plan)); assert.equal(result.state, "rejected");
    assert.equal(calls, 2);
    assert.deepEqual(h.database.authority.runs.listByWorkflow(h.descriptor.id), []);
    assert.deepEqual(h.database.authority.runSessions.listByWorkflow(h.descriptor.id), []);
    assert.equal(h.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
    assert.deepEqual(h.queueRoots, []);
  });

  it.each(["old", "new", "absent"] as const)("after claim loss, %s recovery evidence follows the occurrence boundary", async (evidence) => {
    const h = harness(); const source = await completed(h);
    const warning = h.proposal(source); assert.ok(warning.rerun);
    const repeat = h.start(h.proposal(source, warning.rerun.warningDigest));
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T123456" } });
    h.world.onCommitClick = () => {
      const running = h.fresh(repeat);
      h.clock.advanceWall(1000);
      const routed = h.lifecycle.requeue({ commandId: h.ids.uuid(), runId: repeat.envelope.runId,
        expectedVersion: running.version, cause: "recovery", staleBefore: h.clock.now().toISOString() });
      assert.equal(routed.state, "recovery-required");
      throw new Error("synthetic process loss after fencing");
    };
    const interrupted = await h.execute(repeat);
    assert.equal(interrupted.state, "abandoned");
    delete h.world.onCommitClick;
    const intent = h.database.authority.writeIntents.listByRun(repeat.envelope.runId)[0];
    assert.equal(intent.status, "attempting", "the crashed process left its real fence unresolved");
    h.world.probeResults.push(evidence === "absent" ? absentProbeEvidence(h.clock.now().toISOString())
      : { state: "present", proof: { transactionId: evidence === "old" ? "T123456" : "T456789" } });
    const recovered = await h.recovery.recover({ descriptor: h.descriptor, writeIntentId: intent.writeIntentId, signal: new AbortController().signal });
    const settled = h.database.authority.writeIntents.get(intent.writeIntentId); assert.ok(settled);
    assert.equal(settled.status, evidence === "new" ? "committed" : "parked", JSON.stringify(recovered));
    assert.deepEqual(h.fresh(source), source);
    if (evidence === "new") {
      const clicks = h.world.events.filter((event) => event.startsWith("commit-click")).length;
      assert.equal((await h.execute(h.fresh(repeat))).state, "done");
      assert.equal(h.world.events.filter((event) => event.startsWith("commit-click")).length, clicks);
    }
  });

  it("executes selected reads from submitted cleared values and preserves source checkpoints", async () => {
    const h = sourceBoundHarness(sourceBoundReadDescriptor, sourceBoundReadStores); disposers.push(h.dispose);
    const first = h.start(h.proposal(undefined, undefined, false, undefined, "old memo"));
    const outcome = await h.execute(first);
    assert.equal(outcome.state, "done", JSON.stringify(outcome.state === "failed" ? h.database.authority.failures.get(outcome.failureId) : outcome)); const source = h.fresh(first);
    const sourceRows = h.database.authority.runCheckpoints.listByItem(h.descriptor.id, source.envelope.itemId);
    const plan = h.proposal(source, undefined, false, undefined, "");
    const repeat = h.start(plan); assert.equal((await h.execute(repeat)).state, "done");
    assert.deepEqual(h.world.events, ["read:old memo", "read:"]);
    const rows = h.database.authority.runCheckpoints.listByItem(h.descriptor.id, source.envelope.itemId);
    assert.deepEqual(rows.filter((row) => row.runId === source.envelope.runId), sourceRows);
    assert.deepEqual(rows.find((row) => row.runId === repeat.envelope.runId)?.output.value, { eid: "10812345" });
    assert.deepEqual(h.fresh(source), source);
  });

  it("derives a fresh item without false retry lineage when submitted match key changes", async () => {
    const h = sourceBoundHarness(sourceBoundReadDescriptor, sourceBoundReadStores); disposers.push(h.dispose);
    const first = h.start(h.proposal()); assert.equal((await h.execute(first)).state, "done");
    const source = h.fresh(first);
    const repeat = h.start(h.proposal(source, undefined, false, "10812346"));
    assert.notEqual(repeat.envelope.itemId, source.envelope.itemId);
    assert.equal(repeat.envelope.retryOf, undefined);
    assert.deepEqual(repeat.input.parsed.value, { eid: "10812346" });
    assert.equal((await h.execute(repeat)).state, "done");
    assert.deepEqual(h.fresh(source), source);
  });

  it("omits a selected-out transaction with submitted facts and no new write evidence", async () => {
    const h = sourceBoundHarness(writeFixtureOmittableDescriptor, (world) => {
      const write = buildWriteFixtureRegistry(world); const read = sourceBoundReadStores(world);
      return defineTaskStoreRegistry([...write.stores, ...read.stores], { scenarioIds: [...write.corpus.scenarioIds, ...read.corpus.scenarioIds], tasks: [...write.corpus.tasks, ...read.corpus.tasks] });
    }); disposers.push(h.dispose);
    const source = await completed(h); const before = effects(h); h.world.events.length = 0;
    const plan = h.planner.plan({ workflowId: h.descriptor.id, submissions: [{ eid: "10812345" }], dryRun: false,
      selectedStepKeys: ["reading"], stepOmissions: [{ step: "write", facts: { reason: "operator omission" } }],
      rerunSource: { runId: source.envelope.runId, expectedVersion: source.version, intent: "rerun", selectedStepKeys: ["reading"] } });
    const repeat = h.start(plan); assert.equal((await h.execute(repeat)).state, "done");
    assert.deepEqual(h.world.events, ["read:absent"]);
    assert.deepEqual(h.database.authority.writeIntents.listByRun(repeat.envelope.runId), []);
    assert.deepEqual(h.database.authority.runCheckpoints.listByItem(h.descriptor.id, repeat.envelope.itemId).filter(row => row.runId === repeat.envelope.runId && row.nodeId !== "read"), []);
    assert.deepEqual(effects(h).intents, before.intents); assert.deepEqual(h.fresh(source), source);
  });

  it("reads legacy identity-bearing plans only to return a named replan refusal", () => {
    const h = harness(); const wire = h.proposal();
    const current = h.database.authority.startPlans.get(wire.startPlanId); assert.ok(current);
    const planned = current.planned.map((entry) => PlannedRunSchema.parse({ ...entry, runId: h.ids.uuid(), traceId: "wf-100000-cccc" }));
    const legacy = StartPlanRecordSchema.parse({ ...current, startPlanId: h.planIds.uuid(), planned,
      inputFingerprint: derivePlannedInputFingerprint(planned, current.ingressSchemaHash, current.canonicalInputSchemaHash) });
    h.database.authority.startPlans.create(legacy);
    const command = h.command(wire); command.target.startPlanId = legacy.startPlanId;
    command.payload = { ...command.payload, inputFingerprint: legacy.inputFingerprint };
    const result = h.kernel.execute(command);
    assert.equal(result.state, "rejected"); if (result.state === "rejected") assert.equal(result.code, "replan-required");
    assert.deepEqual(h.lifecycleIds.minted(), []); assert.deepEqual(h.queueRoots, []);
    assert.equal(h.database.authority.startPlans.get(legacy.startPlanId)?.consumedBy, undefined);
  });

});
