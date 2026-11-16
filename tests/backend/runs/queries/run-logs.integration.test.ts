import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
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
import { SearchPersonOrg, SearchPersonOrgOutputSchema } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { NodeIdSchema, TraceIdSchema } from "../../../../src/rules/identity/ids.js";
import { TaskError } from "../../../../src/workflow-kit/errors.js";
import { defineBrowserStore, defineTaskStoreRegistry } from "../../../../src/workflow-kit/task-registry.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import { UUID_4, UUID_5 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { RUN_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { healthyCrmDriver, healthyUcpathDriver, personLookupQueuedRun, recordingLogger, sessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";

const {executorHarness, enqueueAndClaim, SIGNAL, readPersistedNotes, cleanup } = createRunExecutorTestWorld();

afterEach(cleanup);

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
    const harness = await executorHarness({ sessions, autoFireAtOrBelowMs: 2_500 });
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

it("retains a task screenshot association and native node without exposing raw actions", async () => {
  const harness = await executorHarness();
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
  assert.equal(row.note.message, "Screenshot");
  assert.deepEqual(row.note.screenshot, { bundleId: UUID_4, artifactId: UUID_5, sessionId });
  assert.equal(row.note.operatorAction?.sessionId, sessionId);
  assert.equal(row.native?.nodeId, "searching");
  assert.equal("action" in row.note, false);
});

it("serves registered operator labels for the normal legacy Person Lookup actions without raw targets or values", async () => {
  const harness = await executorHarness();
  const { database, clock } = harness.authority;
  const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
  const notes = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
  const address = { runId: claimed.run.envelope.runId, attempt: claimed.run.envelope.attempt, traceId: claimed.run.envelope.traceId,
    spanPath: taskSpanPath(claimed.run.envelope.traceId, NodeIdSchema.parse("searching"), 1, claimed.claim.claimGeneration) };
  for (const action of [{ kind: "typed" as const, targetId: "ucpath.person-org.eid-input", value: "10000001" },
    { kind: "clicked" as const, targetId: "ucpath.person-org.search-button" },
    { kind: "read" as const, targetId: "ucpath.person-org.name-display", value: "Quillan, Petra A." }]) {
    notes.emitRunAction({ workflow: claimed.run.envelope.workflow, address, action: { ...action, at: clock.now().toISOString() } }, claimed.run);
  }
  const deps = { timeline: database.authority.timelineEvents, projection: { runLogSnapshot: () => ({ entries: [] }) }, descriptors: { resolve: () => undefined } } as unknown as RunDetailQueryDeps;
  const section = buildRunLogsSection(deps, claimed.run.envelope.runId, undefined, claimed.run);
  assert.ok(section.section === "logs");
  const rows = section.payload.rows?.filter(row => row.kind === "note") ?? [];
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => Reflect.get(row.note, "operatorAction")), [
    { kind: "fill", label: "Person Org EID input", registryLabel: true, system: "ucpath" },
    { kind: "click", label: "Person Org Search button", registryLabel: true, system: "ucpath" },
    { kind: "read", label: "Person Org displayed name", registryLabel: true, system: "ucpath" },
  ]);
  assert.deepEqual(rows.map(row => row.note.message), [
    "Fill: Person Org EID input", "Click: Person Org Search button", "Read: Person Org displayed name",
  ]);
  assert.equal(new Set(rows.map(row => row.native?.eventId)).size, 3);
  assert.ok(rows.every(row => row.native?.nodeId === "searching"));
  assert.doesNotMatch(JSON.stringify(rows.map(row => Reflect.get(row.note, "operatorAction"))), /targetId|value|10000001|Quillan/u);
});
