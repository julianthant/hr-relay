import { buildRunLogsSection } from "../../../../src/backend/runs/queries/run-logs.js";
import { makeWorld } from "../../../support/helpers/backend/dashboard-harness.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { createDeterministicProviderHarness } from "../../../../src/backend/processing/providers/deterministic-provider.js";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { FingerprintSchema, IsoInstantSchema, TraceIdSchema } from "../../../../src/rules/identity/ids.js";
import { deriveGateResultCheckpointFingerprint } from "../../../../src/backend/runs/commands/command-kernel.js";
import { captureRunContinuation } from "../../../../src/backend/storage/sqlite/run-continuation.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { defineServiceStore, defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import { HASH_A, NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { RUN_ID, sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { RunRecordService, requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectRunRuntime } from "../../../../src/backend/runs/settings/run-settings.js";
import { deriveItemId } from "../../../../src/rules/identity/logical-item.js";
import { createCapabilityWiringTestWorld } from "../../../support/helpers/backend/capability-wiring-world.js";
import { createDryRunPreviewResultTestWorld } from "../../../support/helpers/backend/dry-run-preview-result-world.js";
import { RunDryRunPreviewResultSchema } from "../../../../src/models/run/result.js";
import { absentProbeEvidence, WRITE_FIXTURE_NOW, WRITE_FIXTURE_RUN_ID, writeFixtureTraversalDescriptor } from "../../../support/fixtures/write-sequencer-fixtures.js";

const { harness, cleanup } = createDryRunPreviewResultTestWorld();
const wiring = createCapabilityWiringTestWorld();
afterEach(cleanup);
afterEach(wiring.cleanup);

it("previews both ordered writes and accounts for a skipped gate and unavailable dependent read without committing", async () => {
  const h = await harness(writeFixtureTraversalDescriptor);
  h.world.commitThrows = new Error("preview must never invoke a commit task");
  h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
  await h.run();
  const result = h.database.authority.runResults.get(WRITE_FIXTURE_RUN_ID);
  assert.ok(result);
  const preview = RunDryRunPreviewResultSchema.parse(result.result.value);
  assert.deepEqual(preview.steps.map(step => [step.nodeId, step.state]), [
    ["submit-write", "transaction-preview"], ["second-write", "transaction-preview"],
    ["not-required", "not-run"], ["after-write", "unavailable"],
  ]);
  assert.deepEqual(preview.steps.find(step => step.nodeId === "not-required"), {
    nodeId: "not-required", state: "not-run", reason: "condition-false",
  });
  assert.equal(h.database.authority.gateResults.get(`${WRITE_FIXTURE_RUN_ID}:not-required`), undefined);
  assert.equal(preview.coverage.state, "full");
  assert.equal(h.world.events.filter(event => event === "prepare").length, 2);
  assert.equal(h.world.events.filter(event => event.startsWith("commit-click:")).length, 0);
  assert.deepEqual(h.database.authority.writeIntents.listByRun(WRITE_FIXTURE_RUN_ID), []);
  assert.deepEqual(h.database.authority.writeIntents.countDryRunEvidenceByRun(WRITE_FIXTURE_RUN_ID), { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });
  const run = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID); assert.ok(run);
  assert.deepEqual(h.database.authority.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId), []);
  assert.equal(h.emitter.events().filter(event => event.t === "transaction.previewed").length, 2);
  const world = await makeWorld();
  try {
    const section = buildRunLogsSection({ stateRoot: world.stateRoot, authority: world.authority,
      timeline: h.database.authority.timelineEvents, projection: world.projection,
      canonical: { database: h.database, reader: testRunService(h.database, h.clock), descriptors: { resolve: () => writeFixtureTraversalDescriptor } },
      descriptors: { resolve: () => writeFixtureTraversalDescriptor },
    }, WRITE_FIXTURE_RUN_ID, undefined, run);
    assert.ok(section.section === "logs");
    assert.ok(section.payload.dryRunPreview?.state === "available");
    assert.deepEqual(section.payload.dryRunPreview.stages.map(stage => stage.state), ["exercised", "exercised", "skipped", "unavailable"]);
    assert.deepEqual(section.payload.dryRunPreview.stages.map(stage => stage.submitNotClicked === true), [true, true, false, false]);
  } finally { await world.dispose(); }
});

describe("publication preview boundary", () => {
  const { SIGNAL, SCENARIO, providersOnlyContract, publicationDescriptor, queuedRunFor, wiringHarness, claim } = wiring;
  const publication = publicationDescriptor("publication-preview-fixture", "pp");
  const PREVIEW_LOG = "Dry run: this save was prepared and checked. Nothing was saved.";

  async function run(options: Readonly<{ dryRun: boolean; name?: string }>) {
    const descriptor = publication;
    const adapter = createDeterministicProviderHarness("geocode.census", [0, 1].map(() => ({
      kind: "return" as const,
      outcome: {
        response: { state: "produced" as const, value: { schemaHash: FingerprintSchema.parse(HASH_A), value: { saved: true } } },
        evidence: { summary: "publication preview fixture", capturedAt: IsoInstantSchema.parse(NOW) },
      },
    })));
    const task = defineTask(providersOnlyContract, { sessions: [], async run({ ctx }) {
      await ctx.providers["geocode.census"].call({ schemaHash: FingerprintSchema.parse(HASH_A), value: {} });
      ctx.recordData([{ direction: "read", field: "value", value: "saved" }]);
      return { value: "saved" };
    } });
    const store = defineServiceStore("ocr", { fixture: task });
    const registry = defineTaskStoreRegistry([store], { scenarioIds: [SCENARIO], tasks: [{ id: task.contract.id, effect: task.contract.effect }] });
    const harness = await wiringHarness(descriptor, registry);
    const { database, clock } = harness.authority;
    const logs: { level: string; message: string }[] = [];
    const notes = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock });
    let ids = 0;
    const queued = queuedRunFor(descriptor);
    const execute = async (envelope: Partial<typeof queued.envelope>, commandId: string) => {
      database.authority.runs.enqueue({ ...queued, envelope: { ...queued.envelope, ...envelope },
        input: { ...queued.input, parsed: { ...queued.input.parsed, value: { name: options.name ?? "Battistessa, Johnnie" } } } });
      return executeClaimedRun({ ...harness.deps,
        taskNotes: { ...notes, emitRunLog(input, current) { logs.push(input); return notes.emitRunLog(input, current); } },
        providers: Object.freeze({ adapters: { "geocode.census": adapter.adapter }, configSnapshots: database.authority.configSnapshots,
          idFactory: { next: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}` } }) },
      { ...claim(harness.authority, descriptor, commandId), signal: SIGNAL });
    };
    const callsBefore = adapter.calls().length;
    const outcome = await execute({ dryRun: options.dryRun }, "00000000-0000-4000-8000-0000000000c1");
    const finished = database.authority.runs.get(RUN_ID);
    const failure = finished?.lifecycle.state === "terminal" && finished.lifecycle.failureId !== undefined
      ? database.authority.failures.get(finished.lifecycle.failureId) : undefined;
    return { outcome, database, clock, calls: adapter.calls().length - callsBefore, logs, failure };
  }

  it("previews the declared save, leaves dependents unavailable, and never calls the provider in a dry run", async () => {
    const { outcome, database, clock, calls, logs, failure } = await run({ dryRun: true });
    assert.equal(outcome.state, "done", failure?.summary ?? "");
    const stored = database.authority.runResults.get(RUN_ID);
    assert.ok(stored);
    const preview = z.looseObject({ kind: z.string(), steps: z.array(z.looseObject({ nodeId: z.string(), state: z.string() })) }).parse(stored.result.value);
    assert.equal(preview.kind, "publication-dry-run-preview");
    assert.deepEqual(preview.steps.map(step => [step.nodeId, step.state]), [["extract", "publication-preview"], ["after", "unavailable"]]);
    assert.equal(calls, 0);
    assert.ok(logs.some(log => log.level === "step" && log.message === PREVIEW_LOG));
    const world = await makeWorld();
    try {
      const finished = database.authority.runs.get(RUN_ID); assert.ok(finished);
      const resolver = { resolve: () => publication };
      const section = buildRunLogsSection({ stateRoot: world.stateRoot, authority: world.authority,
        timeline: database.authority.timelineEvents, projection: world.projection,
        canonical: { database, reader: testRunService(database, clock), descriptors: resolver }, descriptors: resolver,
      }, RUN_ID, undefined, finished);
      assert.ok(section.section === "logs");
      assert.ok(section.payload.dryRunPreview?.state === "available");
      const [saved, after] = section.payload.dryRunPreview.stages;
      assert.deepEqual([saved?.state, saved?.detail, saved?.submitNotClicked], ["exercised", "Prepared and checked without saving.", undefined]);
      assert.equal(after?.state, "unavailable");
    } finally { await world.dispose(); }
  });

  it("fails the declared node on an invalid bound input in a dry run without calling the provider", async () => {
    const { outcome, calls, failure } = await run({ dryRun: true, name: "invalid-bound" });
    assert.equal(outcome.state, "failed");
    assert.equal(failure?.nodeId, "extract", failure?.summary ?? "");
    assert.equal(calls, 0);
  });

  it("calls the provider on the declared node in an ordinary run", async () => {
    const { outcome, calls, logs, failure } = await run({ dryRun: false });
    assert.equal(outcome.state, "done", `${failure?.code ?? ""} ${failure?.summary ?? ""} ${JSON.stringify(failure?.causeChain ?? [])}`);
    assert.equal(calls, 2);
    assert.equal(logs.some(log => log.message === PREVIEW_LOG), false);
  });

  describe("replay rule: a dry run re-derives a publication and everything behind it", () => {
    const { publicationGateDescriptor, PublicationApprovalSchema } = wiring;
    const PREVIEW = z.looseObject({ kind: z.string(), steps: z.array(z.looseObject({ nodeId: z.string(), state: z.string() })) });
    type Descriptor = ReturnType<typeof publicationDescriptor> | ReturnType<typeof publicationGateDescriptor>;
    const runIdOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

    async function replayWorld(descriptor: Descriptor) {
      const called: string[] = [];
      const failNext = new Set<string>();
      let afterCall: ((name: string) => void) | undefined;
      const adapter = createDeterministicProviderHarness("geocode.census", Array.from({ length: 40 }, () => ({
        kind: "return" as const,
        outcome: {
          response: { state: "produced" as const, value: { schemaHash: FingerprintSchema.parse(HASH_A), value: { saved: true } } },
          evidence: { summary: "publication replay fixture", capturedAt: IsoInstantSchema.parse(NOW) },
        },
      })));
      const task = defineTask(providersOnlyContract, { sessions: [], async run({ input, ctx }) {
        if (failNext.delete(input.name)) throw new Error(`fixture failure at ${input.name}`);
        await ctx.providers["geocode.census"].call({ schemaHash: FingerprintSchema.parse(HASH_A), value: {} });
        called.push(input.name);
        afterCall?.(input.name);
        ctx.recordData([{ direction: "read", field: "value", value: "saved" }]);
        return { value: "saved" };
      } });
      const store = defineServiceStore("ocr", { fixture: task });
      const registry = defineTaskStoreRegistry([store], { scenarioIds: [SCENARIO], tasks: [{ id: task.contract.id, effect: task.contract.effect }] });
      const harness = await wiringHarness(descriptor, registry);
      const { database, clock } = harness.authority;
      let next = 0;
      const uuid = () => `00000000-0000-4000-9000-${String(++next).padStart(12, "0")}`;
      const deps = { ...harness.deps, taskNotes: createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock }),
        providers: Object.freeze({ adapters: { "geocode.census": adapter.adapter }, configSnapshots: database.authority.configSnapshots, idFactory: { next: uuid } }) };
      const base = queuedRunFor(descriptor);
      const queued = { ...base, envelope: { ...base.envelope, itemId: deriveItemId(descriptor.id, "name:Battistessa, Johnnie") } };
      const now = () => clock.now().toISOString();
      const enqueue = (n: number, envelope: Record<string, unknown>, name = "Battistessa, Johnnie") => database.authority.runs.enqueue({ ...queued,
        envelope: { ...queued.envelope, runId: runIdOf(n), attempt: n, traceId: TraceIdSchema.parse(`${descriptor.code}-170000-${String(2300 + n)}`), ...envelope },
        input: { ...queued.input, parsed: { ...queued.input.parsed, value: { name } } } });
      const claimNext = () => claim(harness.authority, descriptor, uuid());
      const execute = (claimed: ReturnType<typeof claimNext>) => executeClaimedRun(deps, { ...claimed, signal: SIGNAL });
      const runNext = () => execute(claimNext());
      const reclaimed = () => {
        const first = claimNext();
        const requeued = database.authority.runs.requeue({ runId: first.run.envelope.runId, expectedVersion: first.run.version, claim: first.claim, cause: "recovery", now: now() });
        assert.equal(requeued.state, "applied");
        const second = claimNext();
        assert.equal(second.claim.claimGeneration, first.claim.claimGeneration + 1);
        return second;
      };
      const approveAndResume = (runId: string) => {
        const parked = database.authority.runs.get(runId);
        assert.ok(parked?.lifecycle.state === "parked-gate", JSON.stringify(parked?.lifecycle));
        const result = { schemaHash: deriveSchemaHash(PublicationApprovalSchema, "output"), value: { approved: true } };
        database.authority.gateResults.insert({ nodeId: "approval", runId, gateId: "approval", commandId: uuid(), expectedVersion: parked.version,
          resolvedBy: "local-operator", resolvedAt: now(), checkpointFingerprint: deriveGateResultCheckpointFingerprint(result), result });
        assert.equal(database.authority.runs.resume({ runId, expectedVersion: parked.version, startAt: parked.lifecycle.resumeAt, now: now() }).state, "applied");
        clock.advanceWall(90_000);
      };
      const failureOf = (runId: string) => {
        const finished = database.authority.runs.get(runId);
        return finished?.lifecycle.state === "terminal" && finished.lifecycle.failureId !== undefined ? database.authority.failures.get(finished.lifecycle.failureId) : undefined;
      };
      /** An ordinary run of the item that completes, approving its gate when it parks. */
      const ordinary = async (n: number) => {
        enqueue(n, { dryRun: false });
        let outcome = await runNext();
        if (outcome.state === "parked-gate") { approveAndResume(runIdOf(n)); outcome = await runNext(); }
        assert.equal(outcome.state, "done", failureOf(runIdOf(n))?.summary ?? "");
      };
      return { database, clock, called, failNext, setAfterCall: (hook: (name: string) => void) => { afterCall = hook; }, enqueue, claimNext, execute, runNext,
        reclaimed, approveAndResume, failureOf, ordinary, uuid, now, descriptor, itemId: queued.envelope.itemId };
    }
    type World = Awaited<ReturnType<typeof replayWorld>>;

    function assertPreviewed(w: World, outcome: { state: string }, dryRunIds: readonly string[], calledBefore: number, fresh: readonly string[]) {
      const last = dryRunIds.at(-1); assert.ok(last);
      assert.equal(outcome.state, "done", w.failureOf(last)?.summary ?? "");
      const stored = w.database.authority.runResults.get(last); assert.ok(stored);
      const preview = PREVIEW.parse(stored.result.value);
      assert.equal(preview.kind, "publication-dry-run-preview");
      assert.equal(preview.steps.find(step => step.nodeId === "extract")?.state, "publication-preview");
      assert.equal(preview.steps.find(step => step.nodeId === "after")?.state, "unavailable");
      for (const runId of dryRunIds) {
        assert.equal(w.database.authority.timelineEvents.page({ runId }).some(event => event.payload.kind === "checkpoint-replayed"
          && (event.payload.checkpoint.nodeId === "extract" || event.payload.checkpoint.nodeId === "after")), false);
      }
      assert.deepEqual(w.database.authority.runCheckpoints.listByItem(w.descriptor.id, w.itemId)
        .filter(row => dryRunIds.includes(row.runId) && (row.nodeId === "extract" || row.nodeId === "after")), []);
      assert.deepEqual(w.called.slice(calledBefore), fresh);
    }

    const simple = (replay: "checkpoint" | "always-rerun") => publicationDescriptor("publication-preview-fixture", "pp", replay);
    const gated = (replay: "checkpoint" | "always-rerun") => publicationGateDescriptor("publication-gate-fixture", "pg", replay);

    it.each(["checkpoint", "always-rerun"] as const)("a/b fresh dry run after an ordinary run of the same item (%s)", async replay => {
      const w = await replayWorld(simple(replay));
      await w.ordinary(1);
      const before = w.called.length;
      w.enqueue(2, { dryRun: true });
      assertPreviewed(w, await w.runNext(), [runIdOf(2)], before, []);
    });

    it("c fresh dry run with restart-from-start after an ordinary run", async () => {
      const w = await replayWorld(simple("checkpoint"));
      await w.ordinary(1);
      const before = w.called.length;
      w.enqueue(2, { dryRun: true, retryOf: runIdOf(1), recovery: "restart-from-start" });
      assertPreviewed(w, await w.runNext(), [runIdOf(2)], before, []);
    });

    it("d plain retry of a failed dry run after an ordinary run", async () => {
      const w = await replayWorld(simple("checkpoint"));
      await w.ordinary(1);
      const before = w.called.length;
      w.enqueue(2, { dryRun: true }, "invalid-bound");
      assert.equal((await w.runNext()).state, "failed");
      w.enqueue(3, { dryRun: true, retryOf: runIdOf(2) });
      assertPreviewed(w, await w.runNext(), [runIdOf(2), runIdOf(3)], before, []);
    });

    it("e re-claimed fresh dry run after an ordinary run", async () => {
      const w = await replayWorld(simple("checkpoint"));
      await w.ordinary(1);
      const before = w.called.length;
      w.enqueue(2, { dryRun: true });
      assertPreviewed(w, await w.execute(w.reclaimed()), [runIdOf(2)], before, []);
    });

    describe.each(["checkpoint", "always-rerun"] as const)("gate resume behind a previewed save (%s)", replay => {
      it("f dry run parks, is approved and resumes", async () => {
        const w = await replayWorld(gated(replay));
        w.enqueue(1, { dryRun: true });
        assert.equal((await w.runNext()).state, "parked-gate");
        w.approveAndResume(runIdOf(1));
        assertPreviewed(w, await w.runNext(), [runIdOf(1)], 0, ["read", "tail"]);
      });

      it("g dry run resumes after an ordinary run of the same item completed", async () => {
        const w = await replayWorld(gated(replay));
        await w.ordinary(1);
        const before = w.called.length;
        w.enqueue(2, { dryRun: true });
        assert.equal((await w.runNext()).state, "parked-gate", w.failureOf(runIdOf(2))?.summary ?? "");
        w.approveAndResume(runIdOf(2));
        assertPreviewed(w, await w.runNext(), [runIdOf(2)], before, ["tail"]);
      });

      it("h resumed dry run is re-claimed", async () => {
        const w = await replayWorld(gated(replay));
        w.enqueue(1, { dryRun: true });
        assert.equal((await w.runNext()).state, "parked-gate");
        w.approveAndResume(runIdOf(1));
        assertPreviewed(w, await w.execute(w.reclaimed()), [runIdOf(1)], 0, ["read", "tail"]);
      });
    });

    it("i operator pause and resume of a dry run continues from itself", async () => {
      const w = await replayWorld(gated("checkpoint"));
      const service = testRunService(w.database, w.clock);
      w.enqueue(1, { dryRun: true });
      w.setAfterCall(name => {
        if (name !== "read") return;
        const current = w.database.authority.runs.get(runIdOf(1)); assert.ok(current);
        assert.equal(service.pause({ commandId: w.uuid(), runId: runIdOf(1), expectedVersion: current.version }).state, "applied");
      });
      assert.equal((await w.runNext()).state, "abandoned");
      w.setAfterCall(() => undefined);
      const paused = w.database.authority.runs.get(runIdOf(1)); assert.ok(paused?.pause?.state === "paused");
      assert.equal(service.resumePaused({ commandId: w.uuid(), runId: runIdOf(1), expectedVersion: paused.version }).state, "applied");
      assert.ok(w.database.authority.runs.get(runIdOf(1))?.envelope.continuation !== undefined);
      assert.equal((await w.runNext()).state, "parked-gate", w.failureOf(runIdOf(1))?.summary ?? "");
      w.approveAndResume(runIdOf(1));
      assertPreviewed(w, await w.runNext(), [runIdOf(1)], 0, ["read", "tail"]);
    });

    it("j recover-run continues a failed dry run", async () => {
      const w = await replayWorld(gated("checkpoint"));
      w.failNext.add("tail");
      w.enqueue(1, { dryRun: true });
      assert.equal((await w.runNext()).state, "parked-gate");
      w.approveAndResume(runIdOf(1));
      assert.equal((await w.runNext()).state, "failed");
      const failed = w.database.authority.runs.get(runIdOf(1)); assert.ok(failed);
      const lifecycle = new RunRecordService({ database: w.database, clock: w.clock, ids: sequentialIdFactory("f"), publishQueued: () => undefined });
      const recovered = requireLifecycleApplied(lifecycle.create({ commandId: w.uuid(), code: w.descriptor.code, matchKey: "name:Battistessa, Johnnie",
        workflow: w.descriptor.id, descriptorVersion: failed.envelope.descriptorVersion, contractFingerprint: failed.envelope.contractFingerprint,
        configFingerprint: failed.envelope.configFingerprint, configSnapshotId: failed.envelope.configSnapshotId, resolvedInstance: failed.envelope.resolvedInstance,
        priority: failed.envelope.priority, shape: failed.envelope.shape, dryRun: true, input: failed.input, retryOf: failed.envelope.runId,
        continuation: captureRunContinuation(w.database.authority, failed), runtimeConfig: selectRunRuntime(w.database.authority) }));
      assertPreviewed(w, await w.runNext(), [runIdOf(1), recovered.envelope.runId], 0, ["read", "tail"]);
    });

    it("an ordinary run parks, is approved and resumes to its workflow result, saving once", async () => {
      const w = await replayWorld(gated("checkpoint"));
      await w.ordinary(1);
      assert.deepEqual(w.called, ["read", "extract", "after", "tail"]);
      assert.deepEqual(w.database.authority.runResults.get(runIdOf(1))?.result.value, { done: true });
    });

    it("an ordinary run after a completed dry run of the same item saves", async () => {
      const w = await replayWorld(gated("checkpoint"));
      w.enqueue(1, { dryRun: true });
      assert.equal((await w.runNext()).state, "parked-gate");
      w.approveAndResume(runIdOf(1));
      assert.equal((await w.runNext()).state, "done");
      const before = w.called.length;
      w.enqueue(2, { dryRun: false });
      const outcome = await w.runNext();
      assert.equal(outcome.state, "parked-gate", JSON.stringify({ outcome, failure: w.failureOf(runIdOf(2))?.summary }));
      assert.deepEqual(w.called.slice(before).filter(name => name === "extract" || name === "after"), ["extract", "after"]);
    });
  });
});
