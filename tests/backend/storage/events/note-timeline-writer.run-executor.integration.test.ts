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
import { NoteWireSchema } from "../../../../src/models/events/types.js";
import { SearchPersonOrg } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { TaskError } from "../../../../src/workflow-kit/errors.js";
import { CONFIG_SNAPSHOT, UUID_5 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
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

describe("driver gesture notes", () => {
  it("appends completed driver gestures in order and drops protected input before native durability", async () => {
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
    assert.equal(actions[0]?.action?.value, undefined, "protected raw browser value is removed before persistence");
    assert.equal(noteLines.some((note) => JSON.stringify(note).includes("10873698")), false);

    const terminal = database.authority.runs.get(UUID_5);
    assert.ok(terminal);
    const page = buildRunLogsSection({
      timeline: database.authority.timelineEvents,
      stateRoot: _stateRoot,
      projection: { runLogSnapshot: () => ({ entries: [] }) },
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
    assert.deepEqual(actions.map((note) => note.message), [
      "Typed into ucpath person org eid input", "Clicked ucpath person org search button",
      "Typed into ucpath person org eid input", "Clicked ucpath person org search button",
    ]);
  });



  it("writes no gesture note when a task fails before a completed driver gesture", async () => {
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
