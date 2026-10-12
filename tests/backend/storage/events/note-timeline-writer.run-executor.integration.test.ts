import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import type { RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail-types.js";
import { buildRunLogsSection } from "../../../../src/backend/runs/queries/run-logs.js";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { recordBrowserAction } from "../../../../src/backend/systems/browser-shared/action-notes.js";
import { ObservedOperationStructureWireSchema } from "../../../../src/models/dashboard/operation-structure.js";
import { NoteWireSchema } from "../../../../src/models/events/types.js";
import { RunParentSchema } from "../../../../src/models/run/envelope.js";
import { SearchPersonOrg } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { TaskError } from "../../../../src/workflow-kit/errors.js";
import { UUID_4, UUID_5 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { healthyCrmDriver, healthyUcpathDriver, personLookupQueuedRun, sessionFactoryHarness, type SessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";

const { disposers, executorHarness, enqueueAndClaim, SIGNAL, ACTION_BINDING_WORKFLOW_ID, actionBindingCompiled, readPersistedNotes, actionBindingQueuedRun, actionBindingSessions } = createRunExecutorTestWorld();

afterEach(async () => {
  for (const dispose of disposers.splice(0)) dispose();
});

function actionBindingRetrySessions(): SessionFactoryHarness {
  return sessionFactoryHarness({
    ucpath: (openIndex) => {
      const driver = healthyUcpathDriver();
      return Object.freeze({
        ...driver,
        async searchPersonOrg(...args: Parameters<typeof driver.searchPersonOrg>) {
          const [input] = args;
          if (input.kind !== "by-eid") throw new Error("action binding retry fixture requires an EID search");
          recordBrowserAction("typed", "ucpath.person-org.eid-input", input.emplId);
          recordBrowserAction("clicked", "ucpath.person-org.search-button");
          if (openIndex === 1) {
            throw new TaskError(SearchPersonOrg.id, "search-unavailable", "synthetic retry", { transient: true });
          }
          return await driver.searchPersonOrg(...args);
        },
      });
    },
    crm: () => healthyCrmDriver(),
  });
}

describe("complete operation display action binding", () => {
  it("binds completed synthetic driver gestures in append order and redacts protected input before native durability", async () => {
    const sessions = actionBindingSessions({ clicks: 2 });
    const harness = executorHarness({ sessions, descriptor: actionBindingCompiled.descriptor });
    const { database, clock, stateRoot: _stateRoot } = harness.authority;
    const writer = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
    const claimed = enqueueAndClaim(
      database,
      actionBindingQueuedRun(clock.now().toISOString()),
      clock.now().toISOString(),
      ACTION_BINDING_WORKFLOW_ID,
    );

    const outcome = await executeClaimedRun({ ...harness.deps, taskNotes: writer }, { ...claimed, signal: SIGNAL });
    assert.deepEqual(outcome, { state: "done", runId: UUID_5 });

    const noteLines = readPersistedNotes(database);
    const notes = noteLines.map((note) => NoteWireSchema.parse(note));
    const actions = notes.filter((note) => note.action !== undefined);
    assert.deepEqual(noteLines.map((note) => note.message), ["Typed into ucpath person org eid input", "Clicked ucpath person org search button", "Clicked ucpath person org search button"]);
    assert.equal(actions.length, 3);
    assert.deepEqual(actions.map((note) => note.action?.operation?.logicalActionId), ["fill-eid", "run-search", "run-search"]);
    assert.deepEqual(actions.map((note) => note.action?.operation?.occurrence), [1, 1, 2]);
    assert.equal(actions[0]?.action?.value, undefined, "protected raw browser value is removed before persistence");
    assert.deepEqual(actions[0]?.action?.operation?.value, {
      slot: "empl-id",
      fieldPath: "emplId",
      producer: { kind: "run-input", path: "emplId" },
      consumed: {
        state: "redacted",
        binding: {
          kind: "test-data-local", sourceId: UUID_4,
          inputPath: "emplId",
          name: "personLookupCanaryEid",
        },
      },
    });
    assert.equal(actions[0]?.action?.operation?.runId, UUID_5);
    assert.equal(actions[0]?.action?.operation?.definitionFingerprint, actionBindingCompiled.descriptor.contractFingerprint);
    assert.equal(actions[0]?.action?.operation?.nodeId, "search");
    assert.equal(actions[0]?.action?.operation?.taskId, SearchPersonOrg.id);
    assert.equal(actions[0]?.action?.operation?.attempt, 1);
    assert.equal(actions[0]?.action?.operation?.claimGeneration, 1);
    assert.equal(actions[0]?.action?.operation?.taskAttempt, 1);
    assert.equal(actions[0]?.action?.operation?.invocationId, "search-operation");
    assert.deepEqual(actions[0]?.action?.operation?.occurrencePath, ["search"]);
    assert.equal(actions[0]?.action?.operation?.logicalSessionId, "ucpath-worker");
    assert.equal(actions[0]?.action?.operation?.physicalSessionId, "00000000-0000-4000-8000-000000000001");
    assert.equal(noteLines.some((note) => JSON.stringify(note).includes("10873698")), false);

    const terminal = database.authority.runs.get(UUID_5);
    assert.ok(terminal);
    const page = buildRunLogsSection({
      timeline: database.authority.timelineEvents,
      stateRoot: _stateRoot,
      projection: { runLogSnapshot: () => ({ entries: [] }) },
      // Logs resolve the retained envelope snapshot for unregistered workflows.
      descriptors: { resolve: () => undefined },
    } as unknown as RunDetailQueryDeps, UUID_5, undefined, terminal);
    if (page.section !== "logs") throw new Error("expected action log page");
    assert.deepEqual(page.payload.rows?.map((row) => row.sequence), [0, 1, 2]);
    assert.deepEqual(page.payload.notes?.map((note) => note.message), [
      "Typed into ucpath person org eid input",
      "Clicked ucpath person org search button",
      "Clicked ucpath person org search button",
    ]);
    if (page.payload.operationStructure?.state !== "observed") {
      throw new Error("complete action run did not retain an observed operation structure");
    }
    assert.equal(
      page.payload.operationStructure.definition.contentDigest,
      terminal.envelope.operationDisplaySnapshot?.contentDigest,
    );
    assert.deepEqual(
      page.payload.operationStructure.observations.map(({ occurrence }) => [
        occurrence.invocationId,
        occurrence.logicalActionId,
        occurrence.occurrence,
      ]),
      [
        ["search-operation", "fill-eid", 1],
        ["search-operation", "run-search", 1],
        ["search-operation", "run-search", 2],
      ],
    );
    assert.equal(
      page.payload.operationStructure.observations[0]?.occurrence.value?.state,
      "redacted",
    );
    const firstObservation = page.payload.operationStructure.observations[0];
    assert.ok(firstObservation);
    assert.equal(ObservedOperationStructureWireSchema.safeParse({
      ...page.payload.operationStructure,
      observations: [{
        ...firstObservation,
        occurrence: { ...firstObservation.occurrence, logicalActionId: "missing-action" },
      }],
    }).success, false, "a new-format unknown action must not be assigned a nearby frozen action");
    assert.equal(ObservedOperationStructureWireSchema.safeParse({
      ...page.payload.operationStructure,
      observations: [{
        ...firstObservation,
        occurrence: { ...firstObservation.occurrence, definitionFingerprint: "0".repeat(64) },
      }],
    }).success, false, "a mismatched snapshot fingerprint must refuse");
  });

  it("keeps retry attempts distinct while retaining completed-gesture append order", async () => {
    const harness = executorHarness({
      sessions: actionBindingRetrySessions(),
      descriptor: actionBindingCompiled.descriptor,
      autoFireAtOrBelowMs: 2_500,
    });
    const { database, clock, stateRoot: _stateRoot } = harness.authority;
    const writer = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
    const claimed = enqueueAndClaim(
      database,
      actionBindingQueuedRun(clock.now().toISOString()),
      clock.now().toISOString(),
      ACTION_BINDING_WORKFLOW_ID,
    );

    const outcome = await executeClaimedRun({ ...harness.deps, taskNotes: writer }, { ...claimed, signal: SIGNAL });
    assert.deepEqual(outcome, { state: "done", runId: UUID_5 });
    const lines = readPersistedNotes(database);
    const actions = lines.map((note) => NoteWireSchema.parse(note)).filter((note) => note.action !== undefined);
    assert.equal(lines.length, 4);
    assert.deepEqual(actions.map((note) => note.action?.operation?.logicalActionId), [
      "fill-eid", "run-search", "fill-eid", "run-search",
    ]);
    assert.deepEqual(actions.map((note) => note.action?.operation?.taskAttempt), [1, 1, 2, 2]);
    assert.deepEqual(actions.map((note) => note.action?.operation?.physicalSessionId), [
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000002",
    ]);
  });

  it("binds child invocation identity from the immutable child envelope", async () => {
    const harness = executorHarness({ sessions: actionBindingSessions(), descriptor: actionBindingCompiled.descriptor });
    const { database, clock, stateRoot: _stateRoot } = harness.authority;
    const writer = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
    database.authority.runs.enqueue(personLookupQueuedRun());
    const claimed = enqueueAndClaim(
      database,
      actionBindingQueuedRun(clock.now().toISOString(), {
        parent: RunParentSchema.parse({
          runId: "22222222-2222-4222-8222-222222222222",
          tracePrefix: "pl-170000-2222",
          edgeId: "child-search",
        }),
      }),
      clock.now().toISOString(),
      ACTION_BINDING_WORKFLOW_ID,
    );

    assert.deepEqual(
      await executeClaimedRun({ ...harness.deps, taskNotes: writer }, { ...claimed, signal: SIGNAL }),
      { state: "done", runId: UUID_5 },
    );
    const firstAction = readPersistedNotes(database)
      .map((note) => NoteWireSchema.parse(note))
      .find((note) => note.action !== undefined);
    assert.deepEqual(firstAction?.action?.operation?.childInvocation, {
      parentRunId: "22222222-2222-4222-8222-222222222222",
      edgeId: "child-search",
    });
  });

  it("binds a declared operation-level page open to its completed driver gesture", async () => {
    const harness = executorHarness({
      sessions: actionBindingSessions({ openedTarget: "ucpath.person-org.search" }),
      descriptor: actionBindingCompiled.descriptor,
    });
    const { database, clock, stateRoot: _stateRoot } = harness.authority;
    const writer = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
    const claimed = enqueueAndClaim(
      database,
      actionBindingQueuedRun(clock.now().toISOString()),
      clock.now().toISOString(),
      ACTION_BINDING_WORKFLOW_ID,
    );

    assert.deepEqual(
      await executeClaimedRun({ ...harness.deps, taskNotes: writer }, { ...claimed, signal: SIGNAL }),
      { state: "done", runId: UUID_5 },
    );
    const firstAction = readPersistedNotes(database)
      .map((note) => NoteWireSchema.parse(note))
      .find((note) => note.action !== undefined);
    assert.equal(firstAction?.action?.operation?.logicalActionId, "open-search");
  });

  it("does not manufacture an action occurrence when a task fails before a completed driver gesture", async () => {
    const harness = executorHarness({
      sessions: actionBindingSessions({ failBeforeGesture: true }),
      descriptor: actionBindingCompiled.descriptor,
    });
    const { database, clock, stateRoot: _stateRoot } = harness.authority;
    const writer = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
    const claimed = enqueueAndClaim(
      database,
      actionBindingQueuedRun(clock.now().toISOString()),
      clock.now().toISOString(),
      ACTION_BINDING_WORKFLOW_ID,
    );

    const outcome = await executeClaimedRun({ ...harness.deps, taskNotes: writer }, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    assert.deepEqual(readPersistedNotes(database), []);
  });
});
