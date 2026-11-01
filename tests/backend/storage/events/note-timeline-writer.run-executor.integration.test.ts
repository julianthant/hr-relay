import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import type { RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail-types.js";
import { buildRunLogsSection } from "../../../../src/backend/runs/queries/run-logs.js";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { recordBrowserAction, withBrowserActionNotes } from "../../../../src/backend/systems/browser-shared/action-notes.js";
import { fillSsoCredentials } from "../../../../src/backend/systems/browser-shared/ucsd-sso.js";
import type { Page } from "playwright";
import { WorkerIdSchema } from "../../../../src/rules/identity/ids.js";
import { ConfigSchema } from "../../../../src/models/config/schema.js";
import { duoCeremonyGatesOver } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { ObservedOperationStructureWireSchema } from "../../../../src/models/dashboard/operation-structure.js";
import { NoteWireSchema } from "../../../../src/models/events/types.js";
import { canonicalChildExecution } from "../../../support/helpers/backend/canonical-child-execution.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor, workflowTerminalResultExecution, workflowPlanning } from "../../../../src/workflow-kit/workflow.js";
import { DelegationEdgeIdSchema } from "../../../../src/rules/identity/ids.js";
import { randomUUID } from "node:crypto";
import { SearchPersonOrg } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { TaskError } from "../../../../src/workflow-kit/errors.js";
import { CONFIG_SNAPSHOT, UUID_4, UUID_5 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { healthyCrmDriver, healthyUcpathDriver, personLookupQueuedRun, sessionFactoryHarness, type SessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";

const {executorHarness, enqueueAndClaim, SIGNAL, ACTION_BINDING_WORKFLOW_ID, actionBindingCompiled, readPersistedNotes, actionBindingQueuedRun, actionBindingSessions, cleanup } = createRunExecutorTestWorld();

afterEach(cleanup);

describe("cold login action note secrecy", () => {
  for (const failed of [false, true]) {
    it(`drops unbound raw credentials when cold login ${failed ? "fails" : "succeeds"}`, async () => {
      const h = await executorHarness();
      const { database, clock } = h.authority;
      const { run } = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
      const writer = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock });
      const secret = "synthetic-cold-password-proof";
      const operation = withBrowserActionNotes(clock, async () => {
        recordBrowserAction("typed", "ucsd.sso.password", secret);
        if (failed) throw new Error("synthetic downstream login failure");
      }, actions => { for (const action of actions) writer.emitRunAction({ workflow: run.envelope.workflow,
        address: { runId: run.envelope.runId, attempt: run.envelope.attempt, traceId: run.envelope.traceId,
          spanPath: run.envelope.traceId }, action }, run); });
      if (failed) await assert.rejects(operation, /synthetic downstream/u); else await operation;
      const notes = readPersistedNotes(database);
      assert.equal(notes.length, 1);
      assert.equal(JSON.stringify(notes).includes(secret), false);
      assert.equal(notes[0].action?.value, undefined);
      assert.equal(notes[0].message, "Typed into ucsd sso password");
    });

    it(`never records SSO credential values when the actual fill ${failed ? "precedes failure" : "succeeds"}`, async () => {
      const h = await executorHarness();
      const { database, clock } = h.authority;
      const { run, claim } = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
      const writer = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock });
      const credentials = { userId: "synthetic-cold-username-proof", password: "synthetic-cold-password-proof" };
      const filled: string[] = [];
      function field() {
        const value = { first: () => value, or: () => value, count: async () => 1,
          fill: async (value: string) => { filled.push(value); } };
        return value;
      }
      const page = { locator: field, getByLabel: field, url: () => "https://sso.example.invalid/login" } as unknown as Page;
      const gate = duoCeremonyGatesOver(database, clock, h.scheduler).openGate({
        workerId: WorkerIdSchema.parse(claim.workerId),
        system: "ucpath", envelopeDeadlineMonotonicMs: clock.monotonicMs() + 60_000,
        cancelCeremony: () => undefined, signal: SIGNAL });
      let capturedBytes = "";
      try {
        const operation = gate.withCeremony(token => withBrowserActionNotes(clock, async () => {
          await fillSsoCredentials("ucpath", { page, config: ConfigSchema.parse(CONFIG_SNAPSHOT.config), credentials,
            instance: "prod", label: "synthetic-cold-login", signal: SIGNAL, duoCeremony: gate,
            assertCurrent: () => undefined, recordEvidence: () => undefined }, token);
          if (failed) throw new Error("synthetic downstream login failure");
        }, actions => {
          capturedBytes = JSON.stringify(actions);
          for (const action of actions) writer.emitRunAction({ workflow: run.envelope.workflow,
            address: { runId: run.envelope.runId, attempt: run.envelope.attempt, traceId: run.envelope.traceId,
              spanPath: run.envelope.traceId }, action }, run);
        }));
        if (failed) await assert.rejects(operation, /synthetic downstream/u); else await operation;
      } finally { gate.dispose(); }
      const notes = readPersistedNotes(database);
      assert.equal(notes.length, 2);
      for (const value of Object.values(credentials)) {
        assert.equal(filled.includes(value), true);
        assert.equal(capturedBytes.includes(value), false);
        assert.equal(JSON.stringify(notes).includes(value), false);
      }
    });
  }
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
            throw new TaskError(SearchPersonOrg.id, "PERSON_LOOKUP_UCPATH_SEARCH_FAILED", "synthetic retry", { transient: true });
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
    const harness = await executorHarness({ sessions, descriptor: actionBindingCompiled.descriptor });
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
      "Fill: Person Org EID input",
      "Click: Person Org Search button",
      "Click: Person Org Search button",
    ]);
    assert.equal(new Set(page.payload.rows?.map(row => row.native?.eventId)).size, 3);
    assert.equal(new Set(page.payload.notes.map(note => note.noteId)).size, 3);
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
    assert.deepEqual(page.payload.operationStructure.observations.map(observation => observation.logId),
      page.payload.notes.map(note => note.noteId));
    assert.equal(new Set(page.payload.operationStructure.observations.map(({ occurrence }) =>
      JSON.stringify([occurrence.invocationId, occurrence.logicalActionId, occurrence.occurrence]))).size, 3);
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
    const harness = await executorHarness({
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
    const harness = await executorHarness({ sessions: actionBindingSessions(), descriptor: actionBindingCompiled.descriptor });
    const { database, clock, stateRoot: _stateRoot } = harness.authority;
    const writer = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
    const child = actionBindingCompiled.descriptor;
    const parent = defineWorkflowDescriptor({ id: "fixture-note-child-parent", code: "fnp", version: child.version,
      contractFingerprint: child.contractFingerprint, label: "Child action parent", icon: child.icon, category: child.category,
      canonicalInput: child.canonicalInput, inputSubject: "eid", surface: { shape: "single" }, enqueue: "reject-active",
      actions: child.actions, surfaces: {}, details: [], identity: { matchKey: workflowPlanning(child).matchKey },
      presentation: { title: workflowPlanning(child).title }, scenarios: ["fixture-note-child-parent/happy"], timeline: [{ key: "child-search", label: "Child search", nodes: ["child-search"] }], flow: flow(child.input)
        .childRun("child-search", { id: child.id, input: child.input, result: workflowTerminalResultExecution(child).schema }, {
          dependsOn: [], edgeId: DelegationEdgeIdSchema.parse("child-search"), cardinality: "one",
          bind: ({ input }) => input, deriveChildItemId: (_input, identity) => identity.canonicalItemId,
          await: "terminal", join: "one", policy: { onChildFailed: "fail-parent", cascadeCancel: "cascade",
            afterChildRetry: "resume-parent", visibility: "inline" },
        }).build({ schema: workflowTerminalResultExecution(child).schema, dependsOn: ["child-search"], derive: () => ({}) }),
    });
    let issued = false;
    const canonical = canonicalChildExecution({ ...harness.deps, taskNotes: writer, ids: { uuid: () => {
      if (!issued) { issued = true; return "22222222-2222-4222-8222-222222222222"; }
      return randomUUID();
    } } }, database, harness.authority.path, id => [parent, child].find(value => value.id === id));
    const root = canonical.start(parent, { emplId: "10873698" }, { dryRun: false });
    const delegated = await canonical.step(root, SIGNAL);
    assert.equal(delegated.outcome.state, "yielded-delegation");
    const completed = await canonical.step(root, SIGNAL);
    assert.equal(completed.run.envelope.parent?.runId, root.envelope.runId);
    assert.deepEqual(completed.outcome, { state: "done", runId: completed.run.envelope.runId });
    const firstAction = readPersistedNotes(database)
      .map((note) => NoteWireSchema.parse(note))
      .find((note) => note.action !== undefined);
    assert.deepEqual(firstAction?.action?.operation?.childInvocation, {
      parentRunId: "22222222-2222-4222-8222-222222222222",
      edgeId: "child-search",
    });
  });

  it("binds a declared operation-level page open to its completed driver gesture", async () => {
    const harness = await executorHarness({
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
    const harness = await executorHarness({
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
