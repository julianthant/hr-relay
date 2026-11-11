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
import { defineServiceStore, defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import { HASH_A, NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { RUN_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
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
  const descriptor = publicationDescriptor("publication-preview-fixture", "pp");
  const ORDINARY_RUN_ID = "00000000-0000-4000-8000-0000000000a1";
  const PREVIEW_LOG = "Dry run: this save was prepared and checked. Nothing was saved.";

  async function run(options: Readonly<{ dryRun: boolean; name?: string; ordinaryFirst?: boolean }>) {
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
    if (options.ordinaryFirst === true) {
      const ordinary = await execute({ runId: ORDINARY_RUN_ID, traceId: TraceIdSchema.parse("pp-170000-2223"), dryRun: false }, ORDINARY_RUN_ID);
      assert.equal(ordinary.state, "done");
    }
    const callsBefore = adapter.calls().length;
    const outcome = await execute({ dryRun: options.dryRun, ...(options.ordinaryFirst === true ? { attempt: 2 } : {}) }, "00000000-0000-4000-8000-0000000000c1");
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
      const resolver = { resolve: () => descriptor };
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

  it("previews the declared save even when an ordinary run of the same item saved it first", async () => {
    const { outcome, database, calls, failure } = await run({ dryRun: true, ordinaryFirst: true });
    assert.equal(outcome.state, "done", failure?.summary ?? "");
    const stored = database.authority.runResults.get(RUN_ID);
    assert.ok(stored);
    const preview = z.looseObject({ kind: z.string(), steps: z.array(z.looseObject({ nodeId: z.string(), state: z.string() })) }).parse(stored.result.value);
    assert.equal(preview.kind, "publication-dry-run-preview");
    assert.deepEqual(preview.steps.map(step => [step.nodeId, step.state]), [["extract", "publication-preview"], ["after", "unavailable"]]);
    assert.equal(calls, 0);
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
});
