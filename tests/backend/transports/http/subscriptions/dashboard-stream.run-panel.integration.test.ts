import assert from "node:assert/strict";
import { afterAll, afterEach, describe, it, vi } from "vitest";
import { BackfillGapObservationSchema } from "../../../../../src/backend/runs/notifications/backfill-gap.js";
import { SectionUnavailableError } from "../../../../../src/backend/runs/commands/refusals.js";
import { createNoteTimelineWriter } from "../../../../../src/backend/storage/events/note-timeline-writer.js";
import {
  createDashboardStreamHub,
  type DashboardStreamConnection,
  type DashboardStreamHub,
} from "../../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { dashboardEventStreamBody } from "../../../../../src/backend/transports/http/subscriptions/sse-response.js";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import type { DashboardDayWire } from "../../../../../src/models/dashboard/projection.js";
import { NotePageSchema, RunDetailWireSchema } from "../../../../../src/models/dashboard/run-detail.js";
import type { DashboardStreamEnvelope, RunPanel, StreamRow } from "../../../../../src/models/dashboard/subscription.js";
import { RunIdSchema, type RunId } from "../../../../../src/rules/identity/ids.js";
import { createProfileFixtureSet } from "../../../../support/helpers/admission-fixture.js";
import {
  claimEventOf,
  DAY,
  makeWorld,
  queuedEventOf,
  taskEventsOf,
  traceOf,
  uuidOf,
  type DashboardWorld,
} from "../../../../support/helpers/backend/dashboard-harness.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());

const worlds: DashboardWorld[] = [];
const hubs: DashboardStreamHub[] = [];
const closers: (() => void)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0)) close();
  for (const hub of hubs.splice(0)) hub.close();
  for (const w of worlds.splice(0)) await w.dispose();
});

type AvailablePanel = Extract<RunPanel, { state: "available" }>;

/** A whole panel whose detail revision names the store state it was read at. */
function panelOf(runId: string, rowRevision: number): AvailablePanel {
  const detail = RunDetailWireSchema.parse({
    runId, rowRevision, panelKind: "run",
    header: { runId, traceId: traceOf(1), workflowId: "person-lookup", title: "10000001", status: "running", attempt: 1 },
    timeline: { steps: [], events: [] }, gate: { state: "absent", reason: "no gate" },
    outcome: { state: "absent", reason: "the run has not ended" },
    context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 }, availableSections: ["logs"],
  });
  const logs = NotePageSchema.parse({ runId, rows: [], notes: [], nextCursor: { state: "absent", reason: "end-of-page" } });
  return { state: "available", detail, logs, sections: [] };
}

interface HeldRead {
  readonly runId: RunId;
  readonly signal: AbortSignal;
  resolve(rowRevision: number): void;
  reject(error: unknown): void;
}

/** A panel reader the test holds open: every read waits until the test settles it. */
function heldReader() {
  const reads: HeldRead[] = [];
  return {
    reads,
    read(runId: RunId, signal: AbortSignal): Promise<AvailablePanel> {
      return new Promise((resolve, reject) => {
        reads.push({ runId, signal, resolve: (revision) => resolve(panelOf(runId, revision)), reject });
      });
    },
  };
}

/** The hub's timers, run only when the test says so. */
function manualTimers() {
  const timers: { delayMs: number; task: () => void; cancelled: boolean }[] = [];
  return {
    timers,
    schedule: (delayMs: number, task: () => void): (() => void) => {
      const timer = { delayMs, task, cancelled: false };
      timers.push(timer);
      return () => { timer.cancelled = true; };
    },
    /** Runs every live timer scheduled so far, once. */
    fire(): number {
      const due = timers.splice(0).filter(timer => !timer.cancelled);
      for (const timer of due) timer.task();
      return due.length;
    },
    /** Runs only the oldest live timer. */
    fireOldest(): void {
      const index = timers.findIndex(timer => !timer.cancelled);
      const [timer] = index === -1 ? [] : timers.splice(index, 1);
      if (timer === undefined) assert.fail("no live timer to fire");
      timer.task();
    },
    live(): number {
      return timers.filter(timer => !timer.cancelled).length;
    },
  };
}

type Gap = ReturnType<typeof BackfillGapObservationSchema.parse>;

async function harness(options: Readonly<{ maxPending?: number; reader?: ReturnType<typeof heldReader> }> = {}) {
  const w = await makeWorld({ profileFixture: profileFixtures.create });
  worlds.push(w);
  const gaps: Gap[] = [];
  const reader = options.reader ?? heldReader();
  const timers = manualTimers();
  const clock = { ms: 0 };
  const hub = createDashboardStreamHub({
    projection: w.projection,
    runPanels: reader,
    schedule: timers.schedule,
    clock: { monotonicMs: () => clock.ms },
    ...(options.maxPending === undefined ? {} : { maxPending: options.maxPending }),
    backfillGaps: {
      detected: (input: unknown) => {
        const gap = BackfillGapObservationSchema.parse(input);
        gaps.push(gap);
        return Promise.resolve({ published: false as const, gap });
      },
    },
  });
  hubs.push(hub);
  return { w, hub, gaps, reader, timers, clock };
}

const Q = RunIdSchema.parse(uuidOf(1));
const R = RunIdSchema.parse(uuidOf(2));

/** Two claimed runs on the day: Q and R. */
function seedTwoRuns(w: DashboardWorld): void {
  queuedEventOf(w, { seed: 1 });
  queuedEventOf(w, { seed: 2 });
  claimEventOf(w, 1);
  claimEventOf(w, 2);
}

function cursorNumberOf(cursor: string): number {
  return Number(cursor.slice(3));
}

function changeOf(envelope: DashboardStreamEnvelope | undefined): Extract<DashboardStreamEnvelope, { type: "change" }> {
  if (envelope?.type !== "change") assert.fail(`expected a change, got ${String(envelope?.type)}`);
  return envelope;
}

function snapshotOf(envelope: DashboardStreamEnvelope | undefined): Extract<DashboardStreamEnvelope, { type: "snapshot" }> {
  if (envelope?.type !== "snapshot") assert.fail(`expected a snapshot, got ${String(envelope?.type)}`);
  return envelope;
}

function panelRevisions(rows: readonly StreamRow[]): (number | string)[] {
  return rows.map(row => row.value.state === "available" ? row.value.detail.rowRevision : row.value.error.code);
}

/** Resolves when `next()` hands something out; `undefined` means the envelope has not been handed out yet. */
async function settledWithin(promise: Promise<DashboardStreamEnvelope | undefined>): Promise<DashboardStreamEnvelope | "waiting" | undefined> {
  return Promise.race([promise, new Promise<"waiting">(resolve => setTimeout(() => resolve("waiting"), 20))]);
}

async function take(connection: DashboardStreamConnection, count: number): Promise<DashboardStreamEnvelope[]> {
  const out: DashboardStreamEnvelope[] = [];
  while (out.length < count) {
    const envelope = await connection.next();
    if (envelope === undefined) assert.fail(`the connection closed after ${String(out.length)} of ${String(count)} envelopes`);
    out.push(envelope);
  }
  return out;
}

function rowOf(day: DashboardDayWire | undefined, runId: string) {
  return day?.queueSurfaces.find(row => row.runId === runId);
}

describe("dashboard stream run panel rows", () => {
  it("holds a fresh connection's snapshot for its panel and carries the panel in it", async () => {
    const { w, hub, reader } = await harness();
    seedTwoRuns(w);
    const connection = await hub.connect({ day: DAY, run: R });
    assert.deepEqual(connection.initial.map(({ type }) => type), ["hello"], "the snapshot waits for its rows");
    assert.equal(connection.pending, 2);
    assert.deepEqual(reader.reads.map(read => read.runId), [R]);

    reader.reads[0]?.resolve(7);
    const [snapshot, health] = await take(connection, 2);
    assert.deepEqual(panelRevisions(snapshotOf(snapshot).rows), [7]);
    assert.equal(rowOf(snapshotOf(snapshot).payload, R)?.runId, R);
    assert.deepEqual(health, { type: "health", state: "live" });
  });

  it("serves a connection without a run topic at once, with no rows and no read", async () => {
    const { w, hub, reader } = await harness();
    seedTwoRuns(w);
    const connection = await hub.connect({ day: DAY });
    assert.deepEqual(connection.initial.map(({ type }) => type), ["hello", "snapshot", "health"]);
    assert.deepEqual(snapshotOf(connection.initial[1]).rows, []);
    taskEventsOf(w, 2, "searching");
    const [change] = await take(connection, 1);
    assert.deepEqual(changeOf(change).rows, []);
    assert.equal(reader.reads.length, 0);
  });

  it("resumes with the retained day change first, then the handoff rows, then the live change (section 5 example)", async () => {
    const { w, hub, gaps, reader } = await harness();
    seedTwoRuns(w);
    const first = await hub.connect({ day: DAY });
    const held = snapshotOf(first.initial[1]).cursor;
    first.close();
    taskEventsOf(w, 1, "searching"); // pc:held+1, a retained row patch for Q

    const resumed = await hub.connect({ day: DAY, run: R, lastEventId: held, lastProjectionGeneration: w.projection.generation() });
    assert.deepEqual(resumed.initial.map(({ type }) => type), ["hello", "change"]);
    const replayed = changeOf(resumed.initial[1]);
    assert.equal(replayed.day?.target.runId, Q);
    assert.equal(replayed.after, held);
    assert.deepEqual(replayed.rows, [], "row values are never replayed");

    // A live change to R is published while R's handoff panel is being read.
    taskEventsOf(w, 2, "searching");
    assert.equal(reader.reads.length, 1, "R's live read waits behind its handoff read");
    reader.reads[0]?.resolve(3);
    await vi.waitFor(() => assert.equal(reader.reads.length, 2));
    reader.reads[1]?.resolve(4);

    const [handoff, health, live] = await take(resumed, 3);
    assert.equal(changeOf(handoff).after, replayed.cursor);
    assert.equal(changeOf(handoff).day, undefined);
    assert.deepEqual(panelRevisions(changeOf(handoff).rows), [3]);
    assert.deepEqual(health, { type: "health", state: "live" });
    assert.equal(changeOf(live).after, changeOf(handoff).cursor);
    assert.equal(cursorNumberOf(changeOf(live).cursor), cursorNumberOf(changeOf(handoff).cursor) + 1);
    assert.equal(changeOf(live).day?.target.runId, R);
    assert.deepEqual(panelRevisions(changeOf(live).rows), [4]);
    assert.deepEqual(gaps, []);
  });

  it("answers the same example with a retained whole-day snapshot as one snapshot carrying the panel", async () => {
    const { w, hub, gaps, reader } = await harness();
    seedTwoRuns(w);
    const first = await hub.connect({ day: DAY });
    const held = snapshotOf(first.initial[1]).cursor;
    first.close();
    queuedEventOf(w, { seed: 3 }); // a count change: a retained whole-day snapshot marker

    const resumed = await hub.connect({ day: DAY, run: R, lastEventId: held, lastProjectionGeneration: w.projection.generation() });
    assert.deepEqual(resumed.initial.map(({ type }) => type), ["hello"]);
    assert.deepEqual(gaps.map(({ reason }) => reason), ["snapshot-boundary"]);
    taskEventsOf(w, 2, "searching");
    reader.reads[0]?.resolve(3);
    await vi.waitFor(() => assert.equal(reader.reads.length, 2));
    reader.reads[1]?.resolve(4);

    const [snapshot, health, live] = await take(resumed, 3);
    assert.deepEqual(panelRevisions(snapshotOf(snapshot).rows), [3]);
    assert.notEqual(rowOf(snapshotOf(snapshot).payload, uuidOf(3)), undefined, "the snapshot holds the day with the retained change");
    assert.deepEqual(health, { type: "health", state: "live" });
    assert.equal(changeOf(live).after, snapshotOf(snapshot).cursor);
    assert.deepEqual(panelRevisions(changeOf(live).rows), [4]);
  });

  it("reads one key at a time in envelope order, so two updates during a held handoff never go backwards", async () => {
    const { w, hub, reader } = await harness();
    seedTwoRuns(w);
    const connection = await hub.connect({ day: DAY, run: R });
    taskEventsOf(w, 2, "a"); // H+1: R moves to revision 3
    taskEventsOf(w, 2, "b"); // H+2: R moves to revision 4
    assert.equal(reader.reads.length, 1, "H+1's read has not started while H's is open");

    // Every read now sees the store at revision 4; none ran early enough to see 3 after 4.
    reader.reads[0]?.resolve(4);
    await vi.waitFor(() => assert.equal(reader.reads.length, 2));
    assert.equal(reader.reads[1]?.signal.aborted, false);
    reader.reads[1]?.resolve(4);
    await vi.waitFor(() => assert.equal(reader.reads.length, 3));
    reader.reads[2]?.resolve(4);

    const envelopes = await take(connection, 4);
    const panels = envelopes.flatMap(envelope => envelope.type === "change" || envelope.type === "snapshot" ? panelRevisions(envelope.rows) : []);
    assert.deepEqual(panels, [4, 4, 4]);
    assert.deepEqual(envelopes.map(({ type }) => type), ["snapshot", "health", "change", "change"]);
  });

  it("freezes the snapshot's day at its cursor while the panel read is held, then converges on one client connection", async () => {
    const { w, hub, reader } = await harness();
    seedTwoRuns(w);
    const days: DashboardDayWire[] = [];
    const requests: string[] = [];
    const client = createDashboardClient({
      baseUrl: "http://fixture.test",
      fetchImpl: async (url, init) => {
        requests.push(String(url));
        const connection = await hub.connect({ day: DAY, run: R });
        init?.signal?.addEventListener("abort", () => connection.close());
        return new Response(dashboardEventStreamBody(connection), { headers: { "content-type": "text/event-stream" } });
      },
    });
    const subscription = client.subscribeDay({ day: DAY, onDay: day => days.push(day), onState: () => undefined, reconnectDelayMs: 0 });
    closers.push(() => subscription.close());
    await vi.waitFor(() => assert.equal(reader.reads.length, 1));
    const before = rowOf(w.projection.buildDashboardDayWire(DAY), R);

    taskEventsOf(w, 2, "searching"); // H+1 replaces R's row
    const replaced = rowOf(w.projection.buildDashboardDayWire(DAY), R);
    w.authority.records.delete(R);
    w.projection.refreshRun(R); // H+2: the whole day, R gone
    assert.equal(days.length, 0, "nothing reaches the client while the handoff read is held");

    for (let index = 0; index < 3; index += 1) {
      await vi.waitFor(() => assert.equal(reader.reads.length, index + 1));
      reader.reads[index]?.resolve(5);
    }
    await vi.waitFor(() => assert.equal(days.length, 3));
    assert.deepEqual(rowOf(days[0], R), JSON.parse(JSON.stringify(before)), "the snapshot holds the day as it was at its cursor");
    assert.deepEqual(rowOf(days[1], R), JSON.parse(JSON.stringify(replaced)));
    assert.equal(rowOf(days[2], R), undefined);
    assert.equal(requests.length, 1, "the client converged on its first connection");
  });

  it("holds only the connection that owns a blocked read", async () => {
    const { w, hub, reader } = await harness({ maxPending: 4 });
    seedTwoRuns(w);
    const blocked = await hub.connect({ day: DAY, run: R });
    const waiting = blocked.next();
    const dayOnly = await hub.connect({ day: DAY });

    taskEventsOf(w, 1, "a");
    const [change] = await take(dayOnly, 1);
    assert.equal(changeOf(change).day?.target.runId, Q, "a connection without the run receives the day change at once");
    const late = await hub.connect({ day: DAY });
    assert.deepEqual(late.initial.map(({ type }) => type), ["hello", "snapshot", "health"], "a new connection is greeted at once");
    assert.equal(await settledWithin(waiting), "waiting");

    for (const node of ["b", "c", "d"]) taskEventsOf(w, 1, node);
    const reset = await waiting;
    assert.equal(reset?.type, "reset-required", "the overflowing connection is reset at once, waiting for no read");
    assert.equal(reader.reads[0]?.signal.aborted, true, "the read nobody is owed any longer is aborted");

    const other = await hub.connect({ day: DAY, run: Q });
    assert.equal(reader.reads[1]?.runId, Q);
    other.close();
    assert.equal(reader.reads[1]?.signal.aborted, true, "closing the only owner aborts its read");
  });

  it("sends a read past its deadline as a retryable refusal, then the queued changes, then the retried value", async () => {
    const { w, hub, reader, timers } = await harness();
    seedTwoRuns(w);
    const connection = await hub.connect({ day: DAY, run: R });
    const dayOnly = await hub.connect({ day: DAY });
    taskEventsOf(w, 1, "a");
    assert.equal(timers.fire(), 1, "the handoff read's deadline");
    assert.equal(reader.reads[0]?.signal.aborted, true);

    const [snapshot, health, queued] = await take(connection, 3);
    const refused = snapshotOf(snapshot).rows[0]?.value;
    assert.equal(refused?.state, "refused");
    if (refused?.state !== "refused") assert.fail("expected the timed-out panel");
    assert.deepEqual({ code: refused.error.code, retryable: refused.error.retryable }, { code: "DASHBOARD_READ_FAILED", retryable: true });
    assert.equal(health?.type, "health");
    assert.equal(changeOf(queued).day?.target.runId, Q);
    reader.reads[0]?.resolve(9); // the late result is discarded

    assert.equal(timers.live(), 1, "a retry is scheduled while the key is owed");
    timers.fire();
    assert.equal(reader.reads.length, 2);
    reader.reads[1]?.resolve(6);
    const [retried] = await take(connection, 1);
    assert.equal(changeOf(retried).day, undefined, "the retry is a rows-only change");
    assert.equal(changeOf(retried).after, changeOf(queued).cursor);
    assert.deepEqual(panelRevisions(changeOf(retried).rows), [6]);
    assert.equal(dayOnly.pending, 1, "the retry is sent only to connections owed the key");
    assert.equal(timers.live(), 0, "an available value stops the retries and cancels its read's deadline");
  });

  it("sends a refused read as a value without retry, and a thrown read as a refusal it retries", async () => {
    const { w, hub, reader, timers } = await harness();
    seedTwoRuns(w);
    const connection = await hub.connect({ day: DAY, run: R });
    reader.reads[0]?.reject(new SectionUnavailableError("section logs is not available for run"));
    const [snapshot] = await take(connection, 2);
    const refused = snapshotOf(snapshot).rows[0]?.value;
    if (refused?.state !== "refused") assert.fail("expected a refused panel");
    assert.deepEqual({ code: refused.error.code, retryable: refused.error.retryable }, { code: "SECTION_UNAVAILABLE", retryable: false });
    assert.equal(timers.live(), 0, "a refusal the read returned is not retried");

    taskEventsOf(w, 2, "a");
    reader.reads[1]?.reject(new Error("store unavailable"));
    const [change] = await take(connection, 1);
    assert.deepEqual(panelRevisions(changeOf(change).rows), ["INTERNAL_FAILURE"]);
    assert.notEqual(changeOf(change).day, undefined, "the day part is sent as usual");
    assert.equal(timers.live(), 1, "a thrown read is read again");
  });

  it("empties every outbox and aborts every read on a generation change", async () => {
    const { w, hub, reader } = await harness();
    seedTwoRuns(w);
    const connection = await hub.connect({ day: DAY, run: R });
    const waiting = connection.next();
    taskEventsOf(w, 2, "a");
    w.projection.rebuildFromTimeline();
    const reset = await waiting;
    assert.equal(reset?.type, "reset-required");
    assert.equal(reset?.type === "reset-required" ? reset.reason : undefined, "generation-changed");
    assert.equal(reader.reads[0]?.signal.aborted, true);
    assert.equal(connection.pending, 0, "nothing frozen under the old generation is sent afterwards");
  });

  it("brings a note-only commit to the connection that has the run open, and to no other", async () => {
    const { w, hub, reader } = await harness();
    seedTwoRuns(w);
    const open = await hub.connect({ day: DAY, run: R });
    reader.reads[0]?.resolve(1);
    await take(open, 2);
    const dayOnly = await hub.connect({ day: DAY });
    const cursor = w.projection.cursor();

    const owner = w.authority.getRun(R);
    if (owner === undefined) assert.fail("the seeded run is missing");
    createNoteTimelineWriter({ repository: w.timeline, clock: w.clock, pid: 4242 }).emitNote({
      workflow: owner.envelope.workflow,
      address: { runId: R, attempt: owner.envelope.attempt, traceId: owner.envelope.traceId, spanPath: owner.envelope.traceId },
      level: "step", message: "opened UCPath person search",
    });
    w.projection.ingestFromTimeline();
    assert.equal(reader.reads.length, 2);
    reader.reads[1]?.resolve(1);
    const [change] = await take(open, 1);
    assert.equal(changeOf(change).day, undefined);
    assert.equal(cursorNumberOf(changeOf(change).cursor), cursorNumberOf(cursor) + 1);
    assert.deepEqual(panelRevisions(changeOf(change).rows), [1]);
    assert.equal(dayOnly.pending, 0, "a connection without the run is sent nothing and sees no gap");
  });

  it("keeps a closed connection's queued read behind the earlier read still active for its key", async () => {
    const { w, hub, reader } = await harness();
    seedTwoRuns(w);
    const kept = await hub.connect({ day: DAY, run: R });
    const closed = await hub.connect({ day: DAY, run: R });
    closed.close();
    taskEventsOf(w, 2, "a");
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(reader.reads.length, 1, "the live read waits for the surviving handoff read");

    reader.reads[0]?.resolve(3);
    await vi.waitFor(() => assert.equal(reader.reads.length, 2));
    reader.reads[1]?.resolve(4);
    const envelopes = await take(kept, 3);
    assert.deepEqual(envelopes.map(({ type }) => type), ["snapshot", "health", "change"]);
    assert.deepEqual(envelopes.flatMap(envelope => envelope.type === "change" || envelope.type === "snapshot" ? panelRevisions(envelope.rows) : []), [3, 4]);
  });

  for (const ending of ["aborts", "resolves"] as const) {
    it(`keeps a retry owed when another connection's private read is active at the retry tick and ${ending}`, async () => {
      const { w, hub, reader, timers } = await harness();
      seedTwoRuns(w);
      const owed = await hub.connect({ day: DAY, run: R });
      timers.fireOldest(); // the handoff read's deadline
      const [snapshot] = await take(owed, 2);
      assert.equal(snapshotOf(snapshot).rows[0]?.value.state, "refused");
      reader.reads[0]?.resolve(9);

      const other = await hub.connect({ day: DAY, run: R });
      assert.equal(reader.reads.length, 2, "the new connection's private handoff read");
      timers.fireOldest(); // the retry, while that read is active
      if (ending === "aborts") other.close();
      else reader.reads[1]?.resolve(5);

      await vi.waitFor(() => assert.equal(reader.reads.length, 3), { timeout: 500 });
      reader.reads[2]?.resolve(6);
      const [retried] = await take(owed, 1);
      assert.equal(changeOf(retried).day, undefined);
      assert.deepEqual(panelRevisions(changeOf(retried).rows), [6]);
    });
  }

  it("settles a panel that fails validation as a refusal it retries, and reads its key again", async () => {
    const { w, hub, timers } = await harness({ reader: {
      reads: [],
      read: (runId: RunId) => Promise.resolve(panelOf(runId === R ? Q : R, 1)),
    } as unknown as ReturnType<typeof heldReader> });
    seedTwoRuns(w);
    const connection = await hub.connect({ day: DAY, run: R });
    const [snapshot] = await take(connection, 2);
    const refused = snapshotOf(snapshot).rows[0]?.value;
    if (refused?.state !== "refused") assert.fail("expected the invalid panel to be refused");
    assert.deepEqual({ code: refused.error.code, retryable: refused.error.retryable }, { code: "INTERNAL_FAILURE", retryable: false });
    assert.equal(timers.live(), 1, "the retry is scheduled and the read's deadline cancelled");

    taskEventsOf(w, 2, "a");
    const [change] = await take(connection, 1);
    assert.deepEqual(panelRevisions(changeOf(change).rows), ["INTERNAL_FAILURE"], "the key is not stranded");
  });

  it("sends a read that settles past its deadline as a timed-out refusal before the deadline timer fires", async () => {
    const { w, hub, reader, timers, clock } = await harness();
    seedTwoRuns(w);
    const connection = await hub.connect({ day: DAY, run: R });
    clock.ms += 5_001;
    reader.reads[0]?.resolve(7);
    const [snapshot] = await take(connection, 2);
    const refused = snapshotOf(snapshot).rows[0]?.value;
    if (refused?.state !== "refused") assert.fail("expected the late panel to be refused");
    assert.deepEqual({ code: refused.error.code, retryable: refused.error.retryable }, { code: "DASHBOARD_READ_FAILED", retryable: true });
    assert.equal(reader.reads[0]?.signal.aborted, true);
    assert.equal(timers.live(), 1, "the retry; the deadline timer is cancelled");
  });

  it("reserves a due retry behind the reads already queued, ahead of later private handoffs", async () => {
    const { w, hub, reader, timers } = await harness();
    seedTwoRuns(w);
    const owed = await hub.connect({ day: DAY, run: R });
    timers.fireOldest(); // the handoff read's deadline
    await take(owed, 2);
    reader.reads[0]?.resolve(9);

    const first = await hub.connect({ day: DAY, run: R });
    timers.fireOldest(); // the retry, while the first private handoff is active
    const second = await hub.connect({ day: DAY, run: R });
    reader.reads[1]?.resolve(5);
    await vi.waitFor(() => assert.equal(reader.reads.length, 3));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(reader.reads.length, 3, "the later handoff's read waits behind the retry");
    reader.reads[2]?.resolve(6);
    const retried = await settledWithin(owed.next());
    if (retried === "waiting") assert.fail("the retry waited behind a later private handoff");
    assert.deepEqual(panelRevisions(changeOf(retried).rows), [6]);
    first.close();
    second.close();
  });

  it("settles a rejection whose message is empty as a refusal it retries", async () => {
    const { w, hub, reader, timers } = await harness();
    seedTwoRuns(w);
    const connection = await hub.connect({ day: DAY, run: R });
    reader.reads[0]?.reject(new Error(""));
    const [snapshot] = await take(connection, 2);
    const refused = snapshotOf(snapshot).rows[0]?.value;
    if (refused?.state !== "refused") assert.fail("expected the failed read to be refused");
    assert.equal(refused.error.code, "DASHBOARD_READ_FAILED");
    assert.equal(timers.live(), 1, "the failed read is read again");
  });

  it("starts no read for a snapshot whose day build throws, so none outlives the reset or moves retry state", async () => {
    const { w, hub, reader, timers } = await harness();
    seedTwoRuns(w);
    const connection = await hub.connect({ day: DAY, run: R });
    reader.reads[0]?.resolve(1);
    await take(connection, 2);
    const before = reader.reads.length;

    const build = w.projection.buildDashboardDayWire.bind(w.projection);
    const spy = vi.spyOn(w.projection, "buildDashboardDayWire").mockImplementation(() => { throw new Error("synthetic day build failure"); });
    w.authority.records.delete(R);
    assert.throws(() => w.projection.refreshRun(R), /synthetic day build failure/u);
    spy.mockImplementation(build);
    w.projection.rebuildFromTimeline();

    const started = reader.reads.slice(before);
    assert.deepEqual(started.map(read => read.signal.aborted), started.map(() => true), "no read started for the failed snapshot outlives the reset");
    for (const read of started) read.reject(new Error("store unavailable"));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(timers.live(), 0, "a stale completion schedules no retry");
  });
});
