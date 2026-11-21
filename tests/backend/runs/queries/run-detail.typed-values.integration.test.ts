import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import type { z } from "zod";
import { buildRunDetail, buildRunSection, type RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail.js";
import { RunRecordSchema, type RunRecord } from "../../../../src/models/run/record.js";
import type { RerunSourceSchema } from "../../../../src/models/run/rerun.js";
import type { StepOmissionEntry } from "../../../../src/models/workflow/step-omission.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { HASH_A, NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { createRunDetailTestWorld } from "../../../support/helpers/backend/run-detail-world.js";
import { claimEventOf, instantOffsetOf, queuedEventOf, runRecordOf, taskEventsOf, uuidOf, type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";
import { separationsDescriptor } from "../../../support/helpers/registered-workflows.js";

const { world, EXACT_DESCRIPTOR, depsOf, checkpointFor, storeCheckpoint, cleanup } = createRunDetailTestWorld();

afterEach(cleanup);

const TERMINAL_DONE = { state: "terminal", outcome: "done", endedAt: instantOffsetOf(0, 5_000) } as const;
const TIMECARD = "kronos-timecard";
const LAST_DAY = "09/30/2026";
const SEPARATION = "10/01/2026";
const SOURCE_RUN = uuidOf(9);

/** Parsed with the run record, so written as the schema input. */
type CopiedFrom = NonNullable<z.input<typeof RerunSourceSchema>["copiedFrom"]>;

function sourceBoundOf(copiedFrom: CopiedFrom) {
  return {
    source: { runId: SOURCE_RUN, expectedVersion: 2, intent: "rerun", selectedStepKeys: separationsDescriptor.timeline.filter((step) => step.key !== TIMECARD).map((step) => step.key), copiedFrom },
    warnings: [],
    warningDigest: HASH_A,
    confirmationCommandId: uuidOf(77),
  } as const;
}

const COPIED_LAST_DAY = { nodeId: "dates", fieldPath: "lastDayWorked", targetFieldPath: "lastDayWorked", targetStepKey: TIMECARD };

/** The fixture run's input emplId, bound here as a protected test-data value. */
const PROTECTED_EID = "10873698";
const PROTECTED_BINDING = { kind: "test-data-local", inputPath: "emplId", name: "personLookupCanaryEid", sourceId: uuidOf(88) } as const;

function separationsRun(w: DashboardWorld, input: Readonly<{
  entry?: StepOmissionEntry;
  copiedFrom?: CopiedFrom;
  dryRun?: boolean;
  protectedEid?: true;
}> = {}): void {
  const seed = { seed: 1, workflow: "separations", descriptor: separationsDescriptor, lifecycle: TERMINAL_DONE, ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }) };
  queuedEventOf(w, seed);
  claimEventOf(w, 1);
  const record = runRecordOf(seed);
  w.authority.put(RunRecordSchema.parse({
    ...record,
    envelope: {
      ...record.envelope,
      ...(input.entry === undefined ? {} : { stepOmissions: [input.entry] }),
      ...(input.copiedFrom === undefined ? {} : { sourceBound: sourceBoundOf(input.copiedFrom) }),
    },
    ...(input.protectedEid === undefined ? {} : {
      input: { ...record.input, parsed: { ...record.input.parsed, protectedBindings: [PROTECTED_BINDING] } },
    }),
  }));
  if (input.entry === undefined) {
    taskEventsOf(w, 1, "timecard-search", "done");
    taskEventsOf(w, 1, "timecard", "done");
    taskEventsOf(w, 1, "dates", "done");
    return;
  }
  taskEventsOf(w, 1, "timecard-search", "skipped", "step-omitted");
  taskEventsOf(w, 1, "timecard", "skipped", "step-omitted");
  taskEventsOf(w, 1, "dates", "skipped", "operator-asserted");
}

function detailDeps(w: DashboardWorld, canonical = true): RunDetailQueryDeps {
  return {
    runReader: w.runReader,
    timeline: w.timeline,
    stateRoot: w.stateRoot,
    projection: w.projection,
    authority: w.authority,
    descriptors: { resolve: () => ({ ...separationsDescriptor }) },
    ...(canonical ? { canonical: { reader: w.runReader, database: w.database, descriptors: { resolve: () => separationsDescriptor } } } : {}),
  };
}

function stepOf(w: DashboardWorld, key: string) {
  const step = buildRunDetail(detailDeps(w), uuidOf(1)).timeline.steps?.find((entry) => entry.key === key);
  assert.ok(step !== undefined, `step ${key} is served`);
  return step;
}

const TYPED: StepOmissionEntry = {
  step: TIMECARD,
  facts: { lastDayWorked: LAST_DAY, separationDate: SEPARATION },
  labels: { lastDayWorked: "Last day on the job", separationDate: "Separation date" },
};

describe("run detail of a run started with typed values", () => {
  it("serves the typed step's values under the labels they were typed with", async () => {
    const w = await world();
    separationsRun(w, { entry: TYPED });

    assert.deepEqual(stepOf(w, TIMECARD).typedValues, {
      title: "Operator-entered values",
      reading: "Not run, typed by hand",
      fields: [
        { key: "lastDayWorked", label: "Last day on the job", value: LAST_DAY, mark: "Typed by hand" },
        { key: "separationDate", label: "Separation date", value: SEPARATION, mark: "Typed by hand" },
      ],
    });
  });

  it("reads the workflow's current labels for an entry stored without labels", async () => {
    const w = await world();
    separationsRun(w, { entry: { step: TIMECARD, facts: { lastDayWorked: LAST_DAY, separationDate: SEPARATION } } });

    assert.deepEqual(stepOf(w, TIMECARD).typedValues?.fields.map((field) => field.label), ["Last day worked", "Separation date"]);
  });

  it("attributes a value copied unedited from the source run to the earlier run, and an edited one to the operator", async () => {
    const w = await world();
    separationsRun(w, { entry: TYPED, copiedFrom: [COPIED_LAST_DAY] });

    assert.deepEqual(stepOf(w, TIMECARD).typedValues?.fields.map((field) => [field.key, field.mark]), [
      ["lastDayWorked", "From the earlier run"],
      ["separationDate", "Typed by hand"],
    ]);
  });

  it("names the typed values a later step reads, derived from the graph", async () => {
    const w = await world();
    separationsRun(w, { entry: TYPED });

    const readers = new Set(separationsDescriptor.timeline.filter((step) => step.key !== TIMECARD && step.nodes.some((member) =>
      descriptorRuntimeNodes(separationsDescriptor).find((node) => node.id === member.id)?.dependsOn.some((id) => String(id) === "dates") === true))
      .map((step) => step.key));
    assert.ok(readers.has("ucpath-transaction"), "the termination reads the dates");
    const steps = buildRunDetail(detailDeps(w), uuidOf(1)).timeline.steps ?? [];
    for (const step of steps) {
      if (step.key === undefined || !readers.has(step.key)) {
        assert.equal(step.usesTyped, undefined, `step ${String(step.key)} reads no typed value`);
        continue;
      }
      assert.equal(step.typedValues, undefined);
      assert.deepEqual(step.usesTyped, { line: "Uses values typed by hand: Last day on the job, Separation date", labels: ["Last day on the job", "Separation date"] });
    }
  });

  it("lists the typed step of a dry run as not run, typed by hand", async () => {
    const w = await world();
    separationsRun(w, { entry: TYPED, dryRun: true });

    const detail = buildRunDetail(detailDeps(w), uuidOf(1));
    const step = detail.timeline.steps?.find((entry) => entry.key === TIMECARD);
    assert.equal(step?.typedValues?.reading, "Not run, typed by hand");
    assert.deepEqual(step?.typedValues?.fields.map((field) => field.mark), ["Typed by hand", "Typed by hand"]);
    assert.deepEqual(step?.members.map((member) => [member.nodeId, member.state, member.notRunReason]), [
      ["timecard-search", "skipped", "step-omitted"],
      ["timecard", "skipped", "step-omitted"],
      ["dates", "skipped", "operator-asserted"],
    ]);
    assert.ok(detail.outcome.state === "terminal");
    assert.equal(detail.outcome.result, "partial");
  });

  it("refuses to serve a typed value that is not a plain fact", async () => {
    const w = await world();
    separationsRun(w, { entry: { ...TYPED, facts: { ...TYPED.facts, lastDayWorked: { kind: "protected-store", ref: "slot-1" } } } });

    assert.throws(() => buildRunDetail(detailDeps(w), uuidOf(1)), /typed value "lastDayWorked" of step "kronos-timecard" is not a typed scalar or text list; it is not served/u);
  });

  it("withholds a typed value that is or contains one of the run's protected inputs", async () => {
    const w = await world();
    separationsRun(w, { protectedEid: true, entry: {
      step: TIMECARD,
      facts: { lastDayWorked: LAST_DAY, separationDate: PROTECTED_EID, notes: ["card", `see ${PROTECTED_EID}`] },
      labels: { lastDayWorked: "Last day worked", separationDate: "Separation date", notes: "Notes" },
    } });

    const detail = buildRunDetail(detailDeps(w), uuidOf(1));
    assert.deepEqual(detail.timeline.steps?.find((entry) => entry.key === TIMECARD)?.typedValues?.fields, [
      { key: "lastDayWorked", label: "Last day worked", value: LAST_DAY, mark: "Typed by hand" },
      { key: "separationDate", label: "Separation date", withheld: true, mark: "Typed by hand" },
      { key: "notes", label: "Notes", withheld: true, mark: "Typed by hand" },
    ]);
    const typed = JSON.stringify(detail.timeline.steps?.map((step) => [step.typedValues, step.usesTyped]));
    assert.equal(typed.includes(PROTECTED_EID), false);
  });

  it("serves a run with nothing typed exactly as it does without the typed projection", async () => {
    const w = await world();
    separationsRun(w);

    const detail = buildRunDetail(detailDeps(w), uuidOf(1));
    assert.equal(JSON.stringify(detail), JSON.stringify(buildRunDetail(detailDeps(w, false), uuidOf(1))));
    assert.equal(/typedValues|usesTyped/u.test(JSON.stringify(detail)), false);
  });
});

describe("data view of a run started with typed values", () => {
  const STEP = "crm-dates";
  const DESCRIPTOR: AnyWorkflowDescriptor = {
    ...EXACT_DESCRIPTOR,
    stepOmissions: [{
      step: STEP,
      form: { fields: [
        { key: "invitedOn", label: "Invited on", kind: "iso-date", replaces: { nodeId: "crm-dates", path: "invitedOn.value" } },
        { key: "startsOn", label: "Starts on", kind: "iso-date", replaces: { nodeId: "crm-dates", path: "startsOn.value" } },
      ] },
      produces: { "crm-dates": () => ({}) },
    }],
  };

  function assertedRun(w: DashboardWorld, copiedFrom?: CopiedFrom): RunRecord {
    const base = runRecordOf({ seed: 1, claimGeneration: 1, version: 2 });
    const run = RunRecordSchema.parse({
      ...base,
      envelope: {
        ...base.envelope,
        stepOmissions: [{ step: STEP, facts: { invitedOn: "2026-06-01", startsOn: "2026-07-15" } }],
        ...(copiedFrom === undefined ? {} : { sourceBound: sourceBoundOf(copiedFrom) }),
      },
    });
    w.database.authority.runs.enqueue(run);
    const leaf = (path: string) => ({ path, source: "operator", observedAt: NOW, originalObservedAt: NOW });
    storeCheckpoint(w, RunCheckpointRecordSchema.parse({
      ...checkpointFor(run, { provenance: [leaf("emplId"), leaf("invitedOn.value"), leaf("startsOn.value"), leaf("completedOn.reason")] }),
      assertion: { step: STEP, assertedAt: NOW },
    }));
    return run;
  }

  function marks(w: DashboardWorld, run: RunRecord) {
    const response = buildRunSection(depsOf(w, { exactDescriptor: DESCRIPTOR }), run.envelope.runId, "context-data");
    if (response.section !== "context-data") throw new Error("wrong section");
    return response.payload.entries.map((entry) => [entry.label, entry.assertedStep, entry.typedMark]);
  }

  it("marks every value produced from typed values", async () => {
    const w = await world();
    const run = assertedRun(w);

    assert.deepEqual(marks(w, run), [
      ["Invited on", STEP, "Typed by hand"],
      ["Starts on", STEP, "Typed by hand"],
      ["Completed on", STEP, "Typed by hand"],
    ]);
  });

  it("marks a produced value whose field was copied unedited as from the earlier run", async () => {
    const w = await world();
    const run = assertedRun(w, [{ nodeId: "crm-dates", fieldPath: "invitedOn.value", targetFieldPath: "invitedOn", targetStepKey: STEP }]);

    assert.deepEqual(marks(w, run), [
      ["Invited on", STEP, "From the earlier run"],
      ["Starts on", STEP, "Typed by hand"],
      ["Completed on", STEP, "Typed by hand"],
    ]);
  });
});
