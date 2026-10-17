import type { LogRowWire } from "../../../../src/models/dashboard/run-detail.js";
import { createConfirmedActionPublisher } from "../../../../src/backend/logs/confirmed-action-publisher.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { taskSpanPath } from "../../../../src/backend/logs/span-emitter.js";
import type { RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail-types.js";
import { buildRunLogsSection } from "../../../../src/backend/runs/queries/run-logs.js";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { ucpathDriver } from "../../../../src/backend/systems/ucpath/driver-declaration.js";
import { ucpathSession } from "../../../../src/backend/systems/ucpath/session-provider.js";
import { ucpathStore } from "../../../../src/backend/systems/ucpath/task-registry.js";
import { NoteWireSchema } from "../../../../src/models/events/types.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { SearchPersonOrg, SearchPersonOrgOutputSchema } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { NodeIdSchema, TraceIdSchema } from "../../../../src/rules/identity/ids.js";
import { TaskError } from "../../../../src/workflow-kit/errors.js";
import { defineBrowserStore, defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import { UUID_4, UUID_5 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { RUN_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { healthyCrmDriver, healthyUcpathDriver, personLookupQueuedRun, recordingLogger, sessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";

const {executorHarness, enqueueAndClaim, SIGNAL, ACTION_BINDING_WORKFLOW_ID, actionBindingCompiled, readPersistedNotes, actionBindingQueuedRun, actionBindingSessions, cleanup } = createRunExecutorTestWorld();

afterEach(cleanup);

describe("complete operation display action binding", () => {

  it("binds real early confirmation publications to their later buffered action rows by exact identity", async () => {
    const harness = executorHarness({ descriptor: actionBindingCompiled.descriptor, sessions: actionBindingSessions({ lifecycle: true }) });
    const { database, clock } = harness.authority;
    const claimed = enqueueAndClaim(database, actionBindingQueuedRun(clock.now().toISOString(), { protectedValue: false }),
      clock.now().toISOString(), ACTION_BINDING_WORKFLOW_ID);
    const logs = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
    const publisher = createConfirmedActionPublisher({ workerId: claimed.claim.workerId, streamId: "logs-native-fixture", clock, capacity: 100,
      append: event => {
        const run = database.authority.runs.get(event.action.runId); assert.ok(run);
        logs.emitConfirmedAction(event, run);
      } });
    const result = await executeClaimedRun({ ...harness.deps, taskNotes: logs, confirmedActionPublisher: publisher }, { ...claimed, signal: SIGNAL });
    assert.equal(result.state, "done");
    const authority = database.authority.runs.get(claimed.run.envelope.runId); assert.ok(authority);
    const deps = { timeline: database.authority.timelineEvents,
      projection: { runLogSnapshot: () => ({ entries: [] }) }, descriptors: { resolve: () => undefined },
    } as unknown as RunDetailQueryDeps;
    const section = buildRunLogsSection(deps, authority.envelope.runId, undefined, authority);
    assert.equal(section.section, "logs");
    if (section.section !== "logs") throw new Error("expected logs");
    assert.ok((section.payload.confirmedActions?.length ?? 0) > 0);
    assert.equal(section.payload.confirmedActionBindings?.length, section.payload.confirmedActions?.length);
    let early = 0;
    for (const binding of section.payload.confirmedActionBindings ?? []) {
      const target: LogRowWire | undefined = section.payload.rows?.find(row => row.logId === binding.logId); assert.ok(target?.native);
      const stored = database.authority.timelineEvents.get(binding.native.eventId); assert.ok(stored);
      assert.equal(binding.native.order, stored.cursor);
      assert.equal(binding.native.runId, authority.envelope.runId);
      assert.equal(binding.native.traceId, authority.envelope.traceId);
      assert.equal(binding.native.attempt, authority.envelope.attempt);
      assert.equal(binding.native.nodeId, "search");
      if (binding.native.order < target.native.order) early++;
    }
    assert.ok(early > 0, "confirmation publication precedes the buffered target in native delivery order");
    const row = section.payload.rows?.find(row => row.kind === "note" && row.native !== undefined);
    assert.ok(row?.native);
    assert.equal(database.authority.timelineEvents.get(row.native.eventId)?.cursor, row.native.order);
    const missingTargets = { ...deps, timeline: { ...deps.timeline,
      page: (input: Parameters<typeof deps.timeline.page>[0]) => deps.timeline.page(input).filter(record =>
        record.payload.kind !== "note" || record.payload.note.action?.operation === undefined),
    } };
    assert.throws(() => buildRunLogsSection(missingTargets, authority.envelope.runId, undefined, authority), /ACTION_TARGET_IDENTITY_MISMATCH/);
    const actionNote = database.authority.timelineEvents.page({ runId: authority.envelope.runId }).find(record =>
      record.payload.kind === "note" && record.payload.note.action?.operation !== undefined);
    assert.ok(actionNote);
    const { cursor: _cursor, ...duplicate } = actionNote;
    database.authority.timelineEvents.append({ ...duplicate, eventId: UUID_4 });
    assert.throws(() => buildRunLogsSection(deps, authority.envelope.runId, undefined, authority), /ACTION_TARGET_IDENTITY_MISMATCH/);
  });

  it("refuses missing complete snapshots at record admission and corrupt snapshots before a driver opens", async () => {
    const missingHarness = executorHarness({ descriptor: actionBindingCompiled.descriptor });
    const missingQueued = actionBindingQueuedRun(missingHarness.authority.clock.now().toISOString());
    const { operationDisplaySnapshot: _snapshot, ...missingEnvelope } = missingQueued.envelope;
    assert.throws(
      () => RunRecordSchema.parse({ ...missingQueued, envelope: missingEnvelope }),
      /complete run fixture-operation-action-binding is missing its frozen operation display snapshot/u,
    );
    assert.equal(missingHarness.sessions.opens(), 0);

    assert.throws(
      () => buildRunLogsSection({
        stateRoot: missingHarness.authority.stateRoot,
        timeline: missingHarness.authority.database.authority.timelineEvents,
        projection: { runLogSnapshot: () => ({ entries: [] }) },
        descriptors: { resolve: () => undefined },
      } as unknown as RunDetailQueryDeps, UUID_5, undefined, {
        ...missingQueued,
        envelope: missingEnvelope,
      }),
      /complete run fixture-operation-action-binding is missing its frozen operation display snapshot/u,
    );

    const corruptHarness = executorHarness({ descriptor: actionBindingCompiled.descriptor });
    const corruptClaim = enqueueAndClaim(
      corruptHarness.authority.database,
      actionBindingQueuedRun(corruptHarness.authority.clock.now().toISOString()),
      corruptHarness.authority.clock.now().toISOString(),
      ACTION_BINDING_WORKFLOW_ID,
    );
    const snapshot = corruptClaim.run.envelope.operationDisplaySnapshot;
    assert.ok(snapshot);
    const corrupt = {
      ...corruptClaim.run,
      envelope: {
        ...corruptClaim.run.envelope,
        operationDisplaySnapshot: { ...snapshot, contentDigest: "0".repeat(64) },
      },
    } as RunRecord;
    await assert.rejects(
      () => executeClaimedRun(corruptHarness.deps, { ...corruptClaim, run: corrupt, signal: SIGNAL }),
      /corrupt frozen operation display snapshot digest/u,
    );
    assert.equal(corruptHarness.sessions.opens(), 0);
  });
});

describe("person-lookup full walk", () => {

  it("writes every ordinary task log and its fields through the run query cursor", async () => {
    let searchCalls = 0;
    const sessions = sessionFactoryHarness({
      ucpath: () => {
        const driver = healthyUcpathDriver();
        return Object.freeze({
          ...driver,
          searchPersonOrg: (...args: Parameters<typeof driver.searchPersonOrg>) => {
            searchCalls += 1;
            if (searchCalls === 1) {
              return Promise.reject(new TaskError(
                SearchPersonOrg.id,
                "search-unavailable",
                "transient search failure",
                { transient: true },
              ));
            }
            return driver.searchPersonOrg(...args);
          },
        });
      },
      crm: () => healthyCrmDriver(),
    });
    const harness = executorHarness({ sessions, autoFireAtOrBelowMs: 2_500 });
    const { database, clock, stateRoot: _stateRoot } = harness.authority;
    const logs = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
    const stdout = recordingLogger();
    const searchWithLogs = defineTask(ucpathDriver, SearchPersonOrg, {
      sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
      retry: { attempts: 2, backoffMs: 2_000, retryOn: "transient" },
      async run({ input, ctx }) {
        if (searchCalls === 0) {
          ctx.log.info(`UNCLASSIFIED_MESSAGE_CANARY protected EID ${"10873698"}; ${"x".repeat(3_000)}`, {
            unclassifiedEid: "10873698",
            unclassifiedSecret: "UNCLASSIFIED_NOTE_CANARY",
          });
          ctx.log.info("roster match completed", { unclassifiedSecret: "UNCLASSIFIED_NOTE_CANARY" });
        }
        const output = SearchPersonOrgOutputSchema.parse(await ctx.driver.searchPersonOrg(input));
        for (let index = 0; index < 260; index += 1) {
          ctx.log.info("roster match completed", { unclassifiedSecret: "UNCLASSIFIED_NOTE_CANARY" });
        }
        ctx.recordData([
          { direction: "read", field: "results", value: output.results },
          { direction: "read", field: "selection", value: output.selection },
        ]);
        return output;
      },
    });
    const ucpath = defineBrowserStore("ucpath", ucpathDriver, ucpathSession, {
      ...ucpathStore.tasks,
      searchPersonOrg: searchWithLogs,
    });
    const stores = defineTaskStoreRegistry(
      taskStoreRegistry.stores.map((store) => store.namespace === "ucpath" ? ucpath : store),
      taskStoreRegistry.corpus,
    );
    const claimed = enqueueAndClaim(database, personLookupQueuedRun({
      protectedBindings: [{
        kind: "test-data-local", sourceId: UUID_4,
        inputPath: "emplId",
        name: "personLookupCanaryEid",
      }],
    }), clock.now().toISOString());
    const outcome = await executeClaimedRun({ ...harness.deps, stores, log: stdout.log, taskNotes: logs }, { ...claimed, signal: SIGNAL });
    assert.deepEqual(outcome, { state: "done", runId: RUN_ID });
    assert.equal(searchCalls, 2, "a transient task failure retries once");
    assert.equal(stdout.entries().length, 265, "all task log lines still reach stdout");
    assert.match(stdout.entries()[0] ?? "", /UNCLASSIFIED_MESSAGE_CANARY/u);
    assert.equal(stdout.entries()[0]?.includes("10873698"), true);

    const noteLines = readPersistedNotes(database);
    assert.equal(noteLines.length, 265, "all task messages persist");
    assert.equal(noteLines.some((note) => JSON.stringify(note).includes("UNCLASSIFIED_MESSAGE_CANARY")), true);
    assert.equal(noteLines.some((note) => JSON.stringify(note).includes("10873698")), true);
    assert.equal(noteLines.some((note) => JSON.stringify(note).includes("UNCLASSIFIED_NOTE_CANARY")), true);
    const firstLine = noteLines[0];
    assert.ok(firstLine);
    const firstNote = NoteWireSchema.parse(firstLine);
    assert.match(firstNote.message, /UNCLASSIFIED_MESSAGE_CANARY protected EID 10873698/u);
    assert.ok("runId" in firstNote);
    assert.equal(firstNote.runId, RUN_ID);
    assert.equal(firstNote.attempt, 1);
    assert.equal(firstNote.traceId, claimed.run.envelope.traceId);
    assert.equal(firstNote.spanPath, taskSpanPath(
      TraceIdSchema.parse(claimed.run.envelope.traceId),
      NodeIdSchema.parse("searching"),
      1,
      claimed.claim.claimGeneration,
    ));
    const retriedNote = NoteWireSchema.parse(noteLines[2]);
    assert.ok("runId" in retriedNote);
    assert.equal(retriedNote.runId, RUN_ID);
    assert.equal(retriedNote.attempt, 1);
    assert.equal(retriedNote.traceId, claimed.run.envelope.traceId);
    assert.equal(retriedNote.spanPath, taskSpanPath(
      TraceIdSchema.parse(claimed.run.envelope.traceId),
      NodeIdSchema.parse("searching"),
      2,
      claimed.claim.claimGeneration,
    ));
    assert.deepEqual(firstNote.fields, [
      { key: "unclassifiedEid", kind: "text", value: "10873698" },
      { key: "unclassifiedSecret", kind: "text", value: "UNCLASSIFIED_NOTE_CANARY" },
    ]);
    const lastNote = NoteWireSchema.parse(noteLines.at(-1));
    assert.equal(lastNote.message, "Employment status");

    const terminal = database.authority.runs.get(RUN_ID);
    assert.ok(terminal);
    const queryDeps = {
      timeline: database.authority.timelineEvents,
      stateRoot: _stateRoot,
      projection: { runLogSnapshot: () => ({ entries: [] }) },
      descriptors: { resolve: () => undefined },
    } as unknown as RunDetailQueryDeps;
    const firstPage = buildRunLogsSection(queryDeps, RUN_ID, undefined, terminal);
    if (firstPage.section !== "logs") throw new Error("expected bounded log page");
    assert.equal(firstPage.payload.rows?.length, 200);
    assert.equal(firstPage.payload.nextCursor.state, "present");
    if (firstPage.payload.nextCursor.state !== "present") throw new Error("expected log continuation");

    logs.emitNote({
      workflow: "person-lookup",
      address: { runId: RUN_ID, attempt: 1, traceId: terminal.envelope.traceId, spanPath: terminal.envelope.traceId },
      level: "step",
      message: "arrived after page one",
    });
    const oldContinuation = buildRunLogsSection(queryDeps, RUN_ID, undefined, terminal, firstPage.payload.nextCursor.value);
    if (oldContinuation.section !== "logs") throw new Error("expected old snapshot continuation");
    assert.equal(oldContinuation.payload.rows?.length, 65);
    assert.equal(oldContinuation.payload.rows?.some((row) => row.kind === "note" && row.note.message === "arrived after page one"), false);

    const freshFirst = buildRunLogsSection(queryDeps, RUN_ID, undefined, terminal);
    if (freshFirst.section !== "logs" || freshFirst.payload.nextCursor.state !== "present") {
      throw new Error("expected a new snapshot after an appended note");
    }
    assert.notEqual(freshFirst.payload.nextCursor.value, firstPage.payload.nextCursor.value);
    const freshContinuation = buildRunLogsSection(queryDeps, RUN_ID, undefined, terminal, freshFirst.payload.nextCursor.value);
    if (freshContinuation.section !== "logs") throw new Error("expected refreshed continuation");
    assert.equal(freshContinuation.payload.rows?.length, 66);
    assert.equal(freshContinuation.payload.rows?.at(-1)?.sequence, 265);
  });
});

it("retains a task screenshot association and native node without exposing raw actions", () => {
  const harness = executorHarness();
  const { database, clock } = harness.authority;
  const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
  const notes = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
  const sessionId = UUID_5;
  const address = { runId: claimed.run.envelope.runId, attempt: claimed.run.envelope.attempt, traceId: claimed.run.envelope.traceId,
    spanPath: taskSpanPath(claimed.run.envelope.traceId, NodeIdSchema.parse("searching"), 1, claimed.claim.claimGeneration) };
  notes.emitRunAction({ workflow: claimed.run.envelope.workflow, address, action: { kind: "screenshot", targetId: "ucpath.task-capture",
    value: `${UUID_4}:${UUID_5}`, physicalSessionId: sessionId, at: clock.now().toISOString() } }, claimed.run);
  const deps = { timeline: database.authority.timelineEvents, projection: { runLogSnapshot: () => ({ entries: [] }) }, descriptors: { resolve: () => undefined } } as unknown as RunDetailQueryDeps;
  const section = buildRunLogsSection(deps, claimed.run.envelope.runId, undefined, claimed.run);
  assert.ok(section.section === "logs");
  const row = section.payload.rows?.find(row => row.kind === "note");
  assert.ok(row?.kind === "note");
  assert.deepEqual(row.note.screenshot, { bundleId: UUID_4, artifactId: UUID_5, sessionId });
  assert.equal(row.native?.nodeId, "searching");
  assert.equal("action" in row.note, false);
});
