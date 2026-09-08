/**
 * Track D **D5** — the four bounded read scans (ref frontend-backend-integration §7.4; the
 * 2026-08-20 architecture audit's P2, P3 and P4).
 *
 * Each case pins a BOUND, not a duration: a millisecond number is a property of
 * the machine that took it, and §7.4's own baseline says as much. What these
 * assert is the thing a later reader can check without owning the laptop —
 * how many authority statements one row costs, and which partitions on disk a
 * reader is allowed to open.
 *
 * The output half is pinned too. Every bound below was landed as a
 * behaviour-preserving change, so each case states the SERVED value beside the
 * count: a preview that named the wrong three members, or a logs page that lost
 * a line, would be a cheaper read of the wrong thing.
 */
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { appendEventStreamLine } from "../../../src/infra/events/jsonl-streams.js";
import { createNoteJsonlWriter } from "../../../src/infra/events/note-jsonl-writer.js";
import { RunRecordSchema, type RunRecord } from "../../../src/domain/run/record.js";
import {
  assertNoteWithinRunScope,
  runNotePartitionScope as sharedNotePartitionScope,
  runRecordNoteScopeInstants,
} from "../../../src/domain/run/note-scope.js";
import type { RunCheckpointRecord } from "../../../src/domain/workflow/checkpoint.js";
import {
  buildRunSection,
  createRunNoteScanCache,
  runNotePartitionScope,
  type RunDetailQueryDeps,
  type RunNoteScanEntry,
} from "../../../src/server/dashboard/queries/run-detail.js";
import { WORKFLOW_MODULES } from "../../../src/control/workflow-registry.js";
import { dataOriginViewsOf } from "../../../src/server/dashboard/compose.js";
import {
  AT,
  claimEventOf,
  cleanReceiptOf,
  instantOffsetOf,
  makeWorld,
  queuedEventOf,
  receiptWithWarningsOf,
  runEndedEventOf,
  runRecordOf,
  traceOf,
  uuidOf,
  type DashboardWorld,
} from "./helpers/dashboard-harness.js";
import { personLookupDescriptor } from "../../helpers/registered-workflows.js";

const worlds: DashboardWorld[] = [];
function world(): DashboardWorld {
  const created = makeWorld({ descriptors: { resolve: () => personLookupDescriptor } });
  worlds.push(created);
  return created;
}
afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});

/** A settled `done` run, fold and authority agreeing, as the projector sees one. */
function terminalDone(w: DashboardWorld, seed: number, over: Record<string, unknown> = {}): void {
  queuedEventOf(w, { seed, ...over });
  claimEventOf(w, seed);
  runEndedEventOf(w, seed, "done");
  w.authority.put(runRecordOf({
    seed,
    ...over,
    lifecycle: { state: "terminal", outcome: "done", endedAt: instantOffsetOf(0, 60_000) },
    claimGeneration: 1,
    version: 3,
  }));
}

/**
 * Counts the authority reads ONE call makes, through the same object the
 * projection holds — the fake's methods are replaced for the duration of the
 * call and restored after, so nothing leaks into the next case. A counter that
 * wrapped a copy would count nothing and report a bound that cannot fail.
 */
function countAuthorityReads<Result>(
  w: DashboardWorld,
  work: () => Result,
): { value: Result; getRun: number; canonicalRead: number; canonicalList: number; latestCheckpoint: number; getReceipt: number } {
  const original = {
    canonicalRead: w.runReader.read.bind(w.runReader),
    canonicalList: w.runReader.list.bind(w.runReader),
    getRun: w.authority.getRun.bind(w.authority),
    latestCheckpoint: w.authority.latestCheckpoint.bind(w.authority),
    getReceipt: w.authority.getReceipt.bind(w.authority),
  };
  const counts = { getRun: 0, canonicalRead: 0, canonicalList: 0, latestCheckpoint: 0, getReceipt: 0 };
  w.runReader.read = (runId) => {
    counts.canonicalRead += 1;
    return original.canonicalRead(runId);
  };
  w.runReader.list = (input) => {
    counts.canonicalList += 1;
    return original.canonicalList(input);
  };
  w.authority.getRun = (runId: string): RunRecord | undefined => {
    counts.getRun += 1;
    return original.getRun(runId);
  };
  w.authority.latestCheckpoint = (
    workflowId: string,
    itemId: string,
    nodeId: string,
  ): RunCheckpointRecord | undefined => {
    counts.latestCheckpoint += 1;
    return original.latestCheckpoint(workflowId, itemId, nodeId);
  };
  w.authority.getReceipt = (runId: string) => {
    counts.getReceipt += 1;
    return original.getReceipt(runId);
  };
  try {
    return { value: work(), ...counts };
  } finally {
    w.runReader.read = original.canonicalRead;
    w.runReader.list = original.canonicalList;
    w.authority.getRun = original.getRun;
    w.authority.latestCheckpoint = original.latestCheckpoint;
    w.authority.getReceipt = original.getReceipt;
  }
}

/* ── P2 · the member preview ─────────────────────────────────────────────── */

describe("D5 · the member preview slices before it joins (audit P2)", () => {
  /** A group of `members` members, each titled so the preview can be read. */
  function groupOf(w: DashboardWorld, members: number): void {
    queuedEventOf(w, { seed: 1, shape: "operation", title: "Termination batch" });
    for (let index = 0; index < members; index += 1) {
      queuedEventOf(w, {
        seed: 100 + index,
        shape: "operation-member",
        parentSeed: 1,
        title: `Member ${String(index)}`,
      });
    }
  }

  it("names the first three and counts the rest", () => {
    const w = world();
    groupOf(w, 8);
    const group = w.projection.queueSurface(uuidOf(1));
    assert.ok(group !== undefined && group.surfaceKind === "operation");
    assert.deepEqual(group.memberPreview, {
      state: "present",
      value: "Member 0, Member 1, Member 2 +5 more",
    });
  });

  it("joins authority for at most the three members it can name", () => {
    const w = world();
    groupOf(w, 8);
    const counted = countAuthorityReads(w, () => w.projection.queueSurface(uuidOf(1)));
    // Canonical admission and one membership snapshot replace per-member run
    // joins. Only the group's own title and the three named members read a
    // checkpoint; a preview must not enumerate all runs once per member.
    assert.equal(counted.latestCheckpoint, 4);
    assert.equal(counted.getRun, 0);
    assert.equal(counted.canonicalRead, 1);
    assert.equal(counted.canonicalList, 1);
  });

  it("costs the same three joins whether the group has four members or forty", () => {
    const small = world();
    groupOf(small, 4);
    const large = world();
    groupOf(large, 40);
    const smallCount = countAuthorityReads(small, () => small.projection.queueSurface(uuidOf(1)));
    const largeCount = countAuthorityReads(large, () => large.projection.queueSurface(uuidOf(1)));
    assert.equal(largeCount.latestCheckpoint, smallCount.latestCheckpoint);
    assert.equal(largeCount.getRun, smallCount.getRun);
    assert.equal(largeCount.canonicalRead, smallCount.canonicalRead);
    assert.equal(largeCount.canonicalList, smallCount.canonicalList);
  });

  it("still counts every member the fold has seen in the `+N more` tail", () => {
    const w = world();
    groupOf(w, 40);
    const group = w.projection.queueSurface(uuidOf(1));
    assert.ok(group !== undefined && group.surfaceKind === "operation");
    assert.deepEqual(group.memberPreview, {
      state: "present",
      value: "Member 0, Member 1, Member 2 +37 more",
    });
  });

  it("names the absence when the fold has seen no member of a group that claims some", () => {
    const w = world();
    queuedEventOf(w, { seed: 1, shape: "operation" });
    const group = w.projection.queueSurface(uuidOf(1));
    assert.ok(group !== undefined && group.surfaceKind === "operation");
    assert.deepEqual(group.memberPreview, {
      state: "absent",
      reason: "this group has fanned out to no members yet",
    });
  });
});

/* ── P4 · one receipt read per row ───────────────────────────────────────── */

describe("D5 · a row reads its evidence receipt once (audit P4)", () => {
  it("reads the receipt exactly once for a terminal row", () => {
    const w = world();
    terminalDone(w, 1);
    w.authority.receipts.set(uuidOf(1), cleanReceiptOf({ seed: 1 }));
    const counted = countAuthorityReads(w, () => w.projection.queueSurface(uuidOf(1)));
    assert.equal(counted.getReceipt, 1);
  });

  it("reads it once even when the run has no derived receipt at all", () => {
    const w = world();
    terminalDone(w, 1);
    const counted = countAuthorityReads(w, () => w.projection.queueSurface(uuidOf(1)));
    assert.equal(counted.getReceipt, 1);
  });

  it("reads none for a row that has not produced a terminal result", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    const counted = countAuthorityReads(w, () => w.projection.queueSurface(uuidOf(1)));
    assert.equal(counted.getReceipt, 0);
  });

  it("keeps both consumers' answers, from that one read", () => {
    const w = world();
    terminalDone(w, 1);
    w.authority.receipts.set(uuidOf(1), cleanReceiptOf({ seed: 1 }));
    const row = w.projection.queueSurface(uuidOf(1));
    assert.ok(row !== undefined);
    assert.deepEqual(row.warnings, {
      state: "absent",
      reason: "this run's evidence receipt records no warning",
    });
    assert.deepEqual(row.facts, {
      state: "absent",
      reason: "this run's evidence receipt records no output fact",
    });
  });

  it("keeps `unread` and `none` apart when no receipt was ever derived", () => {
    const w = world();
    terminalDone(w, 1);
    const row = w.projection.queueSurface(uuidOf(1));
    assert.ok(row !== undefined);
    assert.deepEqual(row.warnings, {
      state: "absent",
      reason: "no evidence receipt has been derived for this run, so its warning set is unknown",
    });
  });

  it("scales the day wire's receipt reads with the TERMINAL rows, not with every row", () => {
    const w = world();
    terminalDone(w, 1);
    terminalDone(w, 2);
    queuedEventOf(w, { seed: 3 });
    queuedEventOf(w, { seed: 4 });
    const counted = countAuthorityReads(w, () => w.projection.buildDashboardDayWire(
      AT.toISOString().slice(0, 10),
    ));
    assert.equal(counted.value.queueSurfaces.length, 4);
    assert.equal(counted.getReceipt, 2);
  });

  it("reuses each terminal row's safe receipt projection for the Activity completion split", () => {
    const w = world();
    // Keep every terminal arm in this one regression: composition 3 is admitted
    // to operator surfaces, while a receipt whose composition is absent is a
    // valid pre-composition-3 authority row whose free text must be withheld.
    terminalDone(w, 1);
    terminalDone(w, 2);
    terminalDone(w, 3);
    terminalDone(w, 4);
    w.authority.receipts.set(uuidOf(1), cleanReceiptOf({ seed: 1 }));
    w.authority.receipts.set(uuidOf(2), receiptWithWarningsOf({
      seed: 2,
      summaries: ["a safe warning"],
    }));
    const legacyReceipt = { ...cleanReceiptOf({ seed: 4 }) };
    delete legacyReceipt.composition;
    w.authority.receipts.set(uuidOf(4), legacyReceipt);

    const counted = countAuthorityReads(w, () => w.projection.buildActivityReportWire(
      AT.toISOString().slice(0, 10),
      AT.toISOString().slice(0, 10),
    ));
    assert.equal(counted.value.totalRuns, 4);
    assert.equal(counted.value.terminalRuns, 4);
    assert.deepEqual(counted.value.completion, { readBack: 1, warnings: 1, warningsUnknown: 2 });
    assert.deepEqual(counted.value.workflows[0]?.completion, {
      readBack: 1,
      warnings: 1,
      warningsUnknown: 2,
    });
    assert.equal(counted.getReceipt, 4);

    const rows = w.projection.buildDashboardDayWire(AT.toISOString().slice(0, 10)).queueSurfaces;
    const rowOf = (seed: number) => rows.find((row) => row.runId === uuidOf(seed));
    assert.deepEqual(rowOf(1)?.warnings, {
      state: "absent",
      reason: "this run's evidence receipt records no warning",
    });
    assert.deepEqual(rowOf(2)?.warnings, {
      state: "present",
      count: 1,
      first: "a safe warning",
    });
    assert.deepEqual(rowOf(3)?.warnings, {
      state: "absent",
      reason: "no evidence receipt has been derived for this run, so its warning set is unknown",
    });
    assert.deepEqual(rowOf(4)?.warnings, {
      state: "absent",
      reason: "immutable receipt composition 1 predates the required protected-value projection; "
        + "its free-text projection is withheld and the authority row is unchanged",
    });
  });
});

/* ── P3 · the notes reader, scoped to its run's own partitions ───────────── */

describe("D5 · a logs GET opens only its run's partitions (audit P3)", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function depsOf(w: DashboardWorld): RunDetailQueryDeps {
    return { runReader: w.runReader,
      stateRoot: w.stateRoot,
      projection: w.projection,
      authority: w.authority,
      descriptors: { resolve: () => personLookupDescriptor },
    };
  }

  /** `count` note lines for a run, written by the REAL writer at the clock's day. */
  function emitNotes(w: DashboardWorld, seed: number, count: number, from = 0): void {
    const notes = createNoteJsonlWriter({ stateRoot: w.stateRoot, clock: w.clock, pid: 4242 });
    for (let index = 0; index < count; index += 1) {
      notes.emitNote({
        workflow: "person-lookup",
        address: { runId: uuidOf(seed), attempt: 1, traceId: traceOf(seed), spanPath: traceOf(seed) },
        level: "step",
        message: `note ${String(from + index)}`,
      });
    }
  }

  /** Unreadable bytes in ONE `notes/` partition — the tripwire for a scan. */
  function poison(w: DashboardWorld, date: string): void {
    appendEventStreamLine(w.stateRoot, "notes", "person-lookup", date, "{ not json at all");
  }

  it("serves the run's notes without reading a distant partition of the same workflow", () => {
    const w = world();
    terminalDone(w, 1);
    emitNotes(w, 1, 3);
    // A whole-corpus reader would hand these bytes to `NoteWireSchema.parse`
    // and throw; serving the page is the observation that it never opened them.
    poison(w, "2026-06-01");
    poison(w, "2026-12-31");
    const section = buildRunSection(depsOf(w), uuidOf(1), "logs");
    assert.equal(section.section, "logs");
    assert.deepEqual(
      section.payload.notes.map((note) => note.message),
      ["note 0", "note 1", "note 2"],
    );
  });

  it("does not read another workflow's partition on the run's own day", () => {
    const w = world();
    terminalDone(w, 1);
    emitNotes(w, 1, 2);
    appendEventStreamLine(w.stateRoot, "notes", "separations", "2026-08-03", "{ not json at all");
    const section = buildRunSection(depsOf(w), uuidOf(1), "logs");
    assert.equal(section.section, "logs");
    assert.equal(section.payload.notes.length, 2);
  });

  it("REFUSES an unparsable line inside the scope, naming the file and line it could not read (D218)", () => {
    const w = world();
    terminalDone(w, 1);
    emitNotes(w, 1, 2);
    poison(w, "2026-08-03");
    // A bare SyntaxError/ZodError names no byte on disk, so the operator whose
    // logs tab just answered 500 has nothing to grep for.
    assert.throws(
      () => buildRunSection(depsOf(w), uuidOf(1), "logs"),
      new RegExp(
        `notes line ${join(w.stateRoot, "notes", "person-lookup-2026-08-03.jsonl").replaceAll(/[.\\/]/g, "\\$&")}:3 `
        + "is not a readable note",
      ),
    );
  });

  it("still serves a note written the day AFTER the run's last durable instant", () => {
    const w = world();
    terminalDone(w, 1);
    emitNotes(w, 1, 1);
    // The midnight the margin exists for: an append-at-now partition rolls over
    // between the terminal transition and the worker's last note.
    w.clock.setWall(new Date(AT.getTime() + DAY_MS));
    emitNotes(w, 1, 1, 1);
    const section = buildRunSection(depsOf(w), uuidOf(1), "logs");
    assert.equal(section.section, "logs");
    assert.deepEqual(section.payload.notes.map((note) => note.message), ["note 0", "note 1"]);
  });

  it("scopes to the run's own window, with a day of margin ABOVE it and none below", () => {
    const w = world();
    // Enqueued at the harness's own clock, so the window below is the run's own
    // day and the day after it. (Left to the shared fixture instant, authority's
    // `updatedAt` is older than the span stream's clock and the lower end moves
    // back to cover BOTH — the union of a run's instants, which is the honest
    // answer and never a narrower one.)
    terminalDone(w, 1, { enqueuedAt: instantOffsetOf(0) });
    const row = w.projection.runFold(uuidOf(1));
    const authority = w.authority.getRun(uuidOf(1));
    assert.ok(row !== undefined && authority !== undefined);
    assert.deepEqual(runNotePartitionScope(uuidOf(1), row, authority), {
      workflow: "person-lookup",
      fromDate: "2026-08-03",
      toDate: "2026-08-04",
    });
  });

  it("refuses to choose partitions from an instant it cannot read", () => {
    const w = world();
    terminalDone(w, 1);
    const row = w.projection.runFold(uuidOf(1));
    const authority = w.authority.getRun(uuidOf(1));
    assert.ok(row !== undefined && authority !== undefined);
    assert.throws(
      () => runNotePartitionScope(uuidOf(1), { ...row, lastEventAt: "not an instant" }, authority),
      /refuses to decide which partitions it may skip/,
    );
  });

  /* ── the producer half of the same contract ───────────────────────────── */

  /** The authority record `terminalDone` seeded — what a note PRODUCER holds. */
  function authorityOf(w: DashboardWorld): RunRecord {
    const authority = w.authority.getRun(uuidOf(1));
    assert.ok(authority !== undefined);
    return authority;
  }

  it("ADMITS a note filed the day after the run's last durable instant — the margin, from the producer's side", () => {
    const w = world();
    terminalDone(w, 1, { enqueuedAt: instantOffsetOf(0) });
    assertNoteWithinRunScope(authorityOf(w), {
      runId: uuidOf(1),
      workflow: "person-lookup",
      at: new Date(AT.getTime() + DAY_MS),
    });
  });

  it("REFUSES a note filed two days after the run's terminal instant, naming the run, its day and the bounds", () => {
    const w = world();
    terminalDone(w, 1, { enqueuedAt: instantOffsetOf(0) });
    // The drop class this contract exists for: the writer partitions at its own
    // `clock.now()`, the reader opens the run's own window, and nothing else
    // binds the two. A refusal at the append is the only place it can be seen.
    assert.throws(
      () => assertNoteWithinRunScope(authorityOf(w), {
        runId: uuidOf(1),
        workflow: "person-lookup",
        at: new Date(AT.getTime() + 2 * DAY_MS),
      }),
      /refusing to file a note for run 0001.*partition for 2026-08-05, outside the run's own notes scope 2026-08-03\.\.2026-08-04/s,
    );
  });

  it("REFUSES a note filed under a workflow whose partitions this run's logs reader never opens", () => {
    const w = world();
    terminalDone(w, 1, { enqueuedAt: instantOffsetOf(0) });
    assert.throws(
      () => assertNoteWithinRunScope(authorityOf(w), { runId: uuidOf(1), workflow: "separations", at: AT }),
      /the run belongs to person-lookup/,
    );
  });

  it("REFUSES a note scoped against another run's authority record", () => {
    const w = world();
    terminalDone(w, 1, { enqueuedAt: instantOffsetOf(0) });
    assert.throws(
      () => assertNoteWithinRunScope(authorityOf(w), { runId: uuidOf(2), workflow: "person-lookup", at: AT }),
      /composed from a different run's instants/,
    );
  });

  it("scopes a producer INSIDE the window the reader opens, never outside it", () => {
    const w = world();
    terminalDone(w, 1);
    const row = w.projection.runFold(uuidOf(1));
    assert.ok(row !== undefined);
    const authority = authorityOf(w);
    // The containment that makes the producer's assertion sufficient: the
    // reader's instants are the producer's PLUS the fold's, so its min can only
    // be smaller and its max only larger.
    const producer = sharedNotePartitionScope({
      runId: uuidOf(1),
      workflow: authority.envelope.workflow,
      instants: runRecordNoteScopeInstants(authority),
    });
    const reader = runNotePartitionScope(uuidOf(1), row, authority);
    assert.ok(reader.fromDate <= producer.fromDate, `${reader.fromDate} must not start after ${producer.fromDate}`);
    assert.ok(reader.toDate >= producer.toDate, `${reader.toDate} must not end before ${producer.toDate}`);
  });

  it("does NOT serve a note written past the scope — the reader bound the assertion exists to refuse", () => {
    const w = world();
    terminalDone(w, 1, { enqueuedAt: instantOffsetOf(0) });
    emitNotes(w, 1, 1);
    // Injected past the assertion, exactly as an unchecked producer would file
    // it: the line is on disk, in this run's own workflow, and unservable.
    w.clock.setWall(new Date(AT.getTime() + 2 * DAY_MS));
    emitNotes(w, 1, 1, 1);
    const section = buildRunSection(depsOf(w), uuidOf(1), "logs");
    assert.equal(section.section, "logs");
    assert.deepEqual(section.payload.notes.map((note) => note.message), ["note 0"]);
  });

  it("serves an empty page, not a throw, for a run whose workflow wrote no notes", () => {
    const w = world();
    terminalDone(w, 1);
    mkdirSync(join(w.stateRoot, "notes"), { recursive: true });
    writeFileSync(join(w.stateRoot, "notes", "separations-2026-08-03.jsonl"), `{"n":1}\n`);
    const section = buildRunSection(depsOf(w), uuidOf(1), "logs");
    assert.equal(section.section, "logs");
    assert.deepEqual(section.payload.notes, []);
  });

  /* ── L3 · the combined span + note log ───────────────────────────────── */

  function observedDepsOf(
    w: DashboardWorld,
    dataOrigins: readonly Readonly<{
      nodeId: string;
      step: string;
      taskId: string;
      system?: string;
    }>[],
  ): RunDetailQueryDeps {
    return { runReader: w.runReader,
      stateRoot: w.stateRoot,
      projection: w.projection,
      authority: w.authority,
      descriptors: {
        resolve: () => ({
          dataOrigins: dataOrigins.map((origin) => ({ ...origin, dir: "read" as const, feeds: [] })),
        }),
      },
    };
  }

  const SEARCH_ORIGIN = {
    nodeId: "searching",
    step: "Search person",
    taskId: "ucpath/search-person-org",
    system: "ucpath",
  } as const;

  function observedEvent(
    w: DashboardWorld,
    input: Readonly<{
      seed?: number;
      attempt?: number;
      at?: string;
      nodeId?: string;
      taskId?: string;
      workflow?: string;
      traceId?: string;
    }> = {},
  ): void {
    const seed = input.seed ?? 1;
    const at = input.at ?? w.clock.now().toISOString();
    const traceId = input.traceId ?? traceOf(seed);
    w.writer.emit({
      t: "data.observed",
      ts: at,
      workflow: input.workflow ?? "person-lookup",
      runId: uuidOf(seed),
      attempt: input.attempt ?? 1,
      traceId,
      spanPath: `${traceId}/searching#1.${String(input.attempt ?? 1)}`,
      nodeId: input.nodeId ?? "searching",
      taskId: input.taskId ?? "ucpath/search-person-org",
      observedAt: at,
      points: [{
        direction: "read",
        field: "selection.status",
        values: [{
          key: "selection.status",
          state: "allowed",
          classification: "safe-diagnostic",
          transform: "allow",
          value: "resolved",
        }],
      }],
    });
  }

  function fencedEvent(w: DashboardWorld, at: string): void {
    w.writer.emit({
      t: "transaction.fenced",
      ts: at,
      workflow: "person-lookup",
      runId: uuidOf(1),
      attempt: 1,
      traceId: traceOf(1),
      spanPath: `${traceOf(1)}/searching#1.1`,
      node: "searching",
      taskId: "ucpath/search-person-org",
    });
  }

  it("combines redacted observations and the durable fence with notes in one ordered, addressable page", () => {
    const w = world();
    terminalDone(w, 1);
    const first = instantOffsetOf(0, 10);
    const fence = instantOffsetOf(0, 20);
    const last = instantOffsetOf(0, 30);
    observedEvent(w, { at: first });
    fencedEvent(w, fence);
    observedEvent(w, { at: last });
    const section = buildRunSection(observedDepsOf(w, [SEARCH_ORIGIN]), uuidOf(1), "logs");
    assert.equal(section.section, "logs");
    assert.ok(section.payload.rows !== undefined);
    assert.deepEqual(section.payload.rows.map((row) => row.kind), ["observed", "transaction-fenced", "observed"]);
    const observed = section.payload.rows[0];
    assert.ok(observed !== undefined && observed.kind === "observed");
    assert.equal(observed.at, first);
    assert.equal(observed.attempt, 1);
    assert.equal(observed.spanPath, `${traceOf(1)}/searching#1.1`);
    assert.deepEqual(observed.producer, SEARCH_ORIGIN);
    assert.equal(observed.points[0]?.direction, "read");
    assert.equal(observed.points[0]?.values[0]?.transform, "allow");
    const fenced = section.payload.rows[1];
    assert.ok(fenced !== undefined && fenced.kind === "transaction-fenced");
    assert.equal(fenced.at, fence);
    assert.deepEqual(fenced.producer, SEARCH_ORIGIN);
    assert.equal("points" in fenced, false, "a durable fence is not fabricated page data");
  });

  it("serves a real transaction module as probe, prepare, fence, commit, verify without fabricating fence data", () => {
    const module = WORKFLOW_MODULES.find((candidate) =>
      String(candidate.descriptor.id) === "separations-kuali-finalization");
    assert.ok(module !== undefined);
    const w = makeWorld({ descriptors: { resolve: () => module.descriptor } });
    worlds.push(w);
    queuedEventOf(w, { seed: 1, workflow: "separations-kuali-finalization" });
    const emitObserved = (taskId: string, direction: "read" | "write", at: string): void => {
      w.writer.emit({
        t: "data.observed",
        ts: at,
        workflow: "separations-kuali-finalization",
        runId: uuidOf(1),
        attempt: 1,
        traceId: traceOf(1),
        spanPath: `${traceOf(1)}/finalize-kuali/${taskId.split("/").at(-1)}#1.1`,
        nodeId: "finalize-kuali",
        taskId,
        observedAt: at,
        points: [{
          direction,
          field: "timekeeper.name",
          values: [{
            key: "timekeeper.name",
            state: "allowed",
            classification: "safe-diagnostic",
            transform: "allow",
            value: taskId,
          }],
        }],
      });
    };
    emitObserved("kuali/match-separation-finalization", "read", instantOffsetOf(0, 10));
    emitObserved("kuali/stage-separation-finalization", "write", instantOffsetOf(0, 20));
    w.writer.emit({
      t: "transaction.fenced",
      ts: instantOffsetOf(0, 30),
      workflow: "separations-kuali-finalization",
      runId: uuidOf(1),
      attempt: 1,
      traceId: traceOf(1),
      spanPath: `${traceOf(1)}/finalize-kuali/commit`,
      node: "finalize-kuali",
      taskId: "kuali/save-separation-finalization",
    });
    emitObserved("kuali/save-separation-finalization", "write", instantOffsetOf(0, 40));
    emitObserved("kuali/verify-separation-finalization", "read", instantOffsetOf(0, 50));
    const deps: RunDetailQueryDeps = { runReader: w.runReader,
      stateRoot: w.stateRoot,
      projection: w.projection,
      authority: w.authority,
      descriptors: { resolve: () => ({ dataOrigins: dataOriginViewsOf(module) }) },
    };

    const section = buildRunSection(deps, uuidOf(1), "logs");

    assert.equal(section.section, "logs");
    assert.ok(section.payload.rows !== undefined);
    assert.deepEqual(section.payload.rows.map((row) => ({
      kind: row.kind,
      taskId: row.kind === "note" ? "note" : row.producer.taskId,
      direction: row.kind === "observed" ? row.points[0]?.direction : undefined,
      hasPoints: "points" in row,
    })), [
      { kind: "observed", taskId: "kuali/match-separation-finalization", direction: "read", hasPoints: true },
      { kind: "observed", taskId: "kuali/stage-separation-finalization", direction: "write", hasPoints: true },
      { kind: "transaction-fenced", taskId: "kuali/save-separation-finalization", direction: undefined, hasPoints: false },
      { kind: "observed", taskId: "kuali/save-separation-finalization", direction: "write", hasPoints: true },
      { kind: "observed", taskId: "kuali/verify-separation-finalization", direction: "read", hasPoints: true },
    ]);
    assert.ok(section.payload.rows.every((row) => row.kind === "note" || row.producer.system === "kuali"));
  });

  it("preserves a descriptor's absent browser system and still refuses an ambiguous producer", () => {
    const w = world();
    terminalDone(w, 1);
    observedEvent(w);
    const section = buildRunSection(
      observedDepsOf(w, [{ ...SEARCH_ORIGIN, system: undefined }]),
      uuidOf(1),
      "logs",
    );
    assert.equal(section.section, "logs");
    const row = section.payload.rows?.find((entry) => entry.kind === "observed");
    assert.ok(row !== undefined && row.kind === "observed");
    assert.deepEqual(row.producer, {
      nodeId: SEARCH_ORIGIN.nodeId,
      step: SEARCH_ORIGIN.step,
      taskId: SEARCH_ORIGIN.taskId,
    });
    assert.throws(
      () => buildRunSection(observedDepsOf(w, [SEARCH_ORIGIN, { ...SEARCH_ORIGIN, system: "crm" }]), uuidOf(1), "logs"),
      /has 2 matching data origins/,
    );
  });

  it("examines only this run's indexed span rows, excludes another run, and preserves legal retry attempts", () => {
    const w = world();
    terminalDone(w, 1);
    observedEvent(w, { seed: 2, at: instantOffsetOf(0, 5) });
    observedEvent(w, { seed: 1, attempt: 1, at: instantOffsetOf(0, 10) });
    w.writer.emit({
      t: "run.requeued",
      ts: instantOffsetOf(0, 15),
      workflow: "person-lookup",
      runId: uuidOf(1),
      attempt: 1,
      nextAttempt: 2,
      traceId: traceOf(1),
      spanPath: traceOf(1),
      cause: "recovery",
    });
    const authority = w.authority.getRun(uuidOf(1));
    assert.ok(authority !== undefined);
    w.authority.put(RunRecordSchema.parse({
      ...authority,
      envelope: { ...authority.envelope, attempt: 2 },
      version: authority.version + 1,
    }));
    observedEvent(w, { seed: 1, attempt: 2, at: instantOffsetOf(0, 20) });
    assert.equal(w.projection.runLogSnapshot(uuidOf(1)).entries.length, 2);
    assert.equal(w.projection.runLogSnapshot(uuidOf(2)).entries.length, 1);
    const section = buildRunSection(observedDepsOf(w, [SEARCH_ORIGIN]), uuidOf(1), "logs");
    assert.equal(section.section, "logs");
    assert.ok(section.payload.rows !== undefined);
    const observations = section.payload.rows.filter((row) => row.kind === "observed");
    assert.deepEqual(observations.map((row) => row.attempt), [1, 2]);
    assert.deepEqual(observations.map((row) => row.at), [instantOffsetOf(0, 10), instantOffsetOf(0, 20)]);
  });

  it("serves an observation appended more than two days after the run instead of dropping its append partition", () => {
    const w = world();
    terminalDone(w, 1, { enqueuedAt: instantOffsetOf(0) });
    w.clock.setWall(new Date(AT.getTime() + 3 * DAY_MS));
    observedEvent(w, { at: instantOffsetOf(0, 10) });

    const section = buildRunSection(observedDepsOf(w, [SEARCH_ORIGIN]), uuidOf(1), "logs");

    assert.equal(section.section, "logs");
    assert.ok(section.payload.rows !== undefined);
    assert.deepEqual(section.payload.rows.map((row) => row.kind), ["observed"]);
  });

  it("refuses a same-run observation whose trace is not the run authority trace", () => {
    const w = world();
    terminalDone(w, 1);
    observedEvent(w, { traceId: traceOf(2) });

    assert.throws(
      () => buildRunSection(observedDepsOf(w, [SEARCH_ORIGIN]), uuidOf(1), "logs"),
      /run 0001.*span trace pl-100002-0002.*authority trace is pl-100001-0001/s,
    );
  });

  it("refuses observed rows under a foreign workflow or outside the run's legal attempts", () => {
    const foreignWorkflow = world();
    terminalDone(foreignWorkflow, 1);
    observedEvent(foreignWorkflow, { workflow: "separations" });
    assert.throws(
      () => buildRunSection(observedDepsOf(foreignWorkflow, [SEARCH_ORIGIN]), uuidOf(1), "logs"),
      /run 0001.*workflow separations.*authority names person-lookup/s,
    );

    const foreignAttempt = world();
    terminalDone(foreignAttempt, 1);
    observedEvent(foreignAttempt, { attempt: 2 });
    assert.throws(
      () => buildRunSection(observedDepsOf(foreignAttempt, [SEARCH_ORIGIN]), uuidOf(1), "logs"),
      /run 0001.*attempt 2.*legal attempts 1\.\.1/s,
    );
  });

  it("refuses foreign note workflow and trace identities by source line", () => {
    const foreignWorkflow = world();
    terminalDone(foreignWorkflow, 1);
    appendEventStreamLine(
      foreignWorkflow.stateRoot,
      "notes",
      "person-lookup",
      "2026-08-03",
      JSON.stringify({
        ts: instantOffsetOf(0, 10),
        workflow: "separations",
        pid: 4242,
        runId: uuidOf(1),
        attempt: 1,
        traceId: traceOf(1),
        spanPath: traceOf(1),
        level: "step",
        message: "foreign workflow",
      }),
    );
    assert.throws(
      () => buildRunSection(observedDepsOf(foreignWorkflow, [SEARCH_ORIGIN]), uuidOf(1), "logs"),
      /notes line .*:1 is filed in workflow person-lookup but names workflow separations/s,
    );

    const foreignTrace = world();
    terminalDone(foreignTrace, 1);
    const notes = createNoteJsonlWriter({ stateRoot: foreignTrace.stateRoot, clock: foreignTrace.clock, pid: 4242 });
    notes.emitNote({
      workflow: "person-lookup",
      address: { runId: uuidOf(1), attempt: 1, traceId: traceOf(2), spanPath: traceOf(2) },
      level: "step",
      message: "foreign trace",
    });
    assert.throws(
      () => buildRunSection(observedDepsOf(foreignTrace, [SEARCH_ORIGIN]), uuidOf(1), "logs"),
      /run 0001.*note trace pl-100002-0002.*authority trace is pl-100001-0001/s,
    );
  });

  it("orders equal-clock rows by their durable stream location and pages the combined list without a second scan", () => {
    const w = world();
    terminalDone(w, 1);
    const tie = instantOffsetOf(0, 10);
    for (let index = 0; index < 201; index += 1) observedEvent(w, { at: tie });
    const inner = createRunNoteScanCache();
    let scans = 0;
    const cache = {
      start: (runId: string, scan: () => readonly RunNoteScanEntry[]) =>
        inner.start(runId, () => {
          scans += 1;
          return scan();
        }),
      resume: (runId: string, snapshotId: string) => inner.resume(runId, snapshotId),
    };
    const first = buildRunSection(observedDepsOf(w, [SEARCH_ORIGIN]), uuidOf(1), "logs", undefined, cache);
    assert.equal(first.section, "logs");
    assert.ok(first.payload.rows !== undefined);
    assert.equal(first.payload.rows.length, 200);
    assert.equal(first.payload.nextCursor.state, "present");
    if (first.payload.nextCursor.state !== "present") throw new Error("first combined page must continue");
    const second = buildRunSection(observedDepsOf(w, [SEARCH_ORIGIN]), uuidOf(1), "logs", first.payload.nextCursor.value, cache);
    assert.equal(second.section, "logs");
    assert.ok(second.payload.rows !== undefined);
    assert.equal(second.payload.rows.length, 1);
    assert.equal(second.payload.nextCursor.state, "absent");
    assert.equal(scans, 1);
    assert.deepEqual(
      [...first.payload.rows, ...second.payload.rows].map((row) => row.sequence),
      Array.from({ length: 201 }, (_, index) => index),
    );
  });

  it("keeps a page walk on one immutable ordering when a later append has an older record clock", () => {
    const w = world();
    terminalDone(w, 1);
    const tie = instantOffsetOf(0, 20);
    for (let index = 0; index < 201; index += 1) observedEvent(w, { at: tie });
    const deps = observedDepsOf(w, [SEARCH_ORIGIN]);
    const first = buildRunSection(deps, uuidOf(1), "logs");
    assert.equal(first.section, "logs");
    assert.ok(first.payload.rows !== undefined);
    assert.equal(first.payload.nextCursor.state, "present");
    if (first.payload.nextCursor.state !== "present") throw new Error("first combined page must continue");

    observedEvent(w, { at: instantOffsetOf(0, 10) });
    const second = buildRunSection(deps, uuidOf(1), "logs", first.payload.nextCursor.value);

    assert.equal(second.section, "logs");
    assert.ok(second.payload.rows !== undefined);
    const walked = [...first.payload.rows, ...second.payload.rows];
    assert.equal(walked.length, 201);
    assert.equal(new Set(walked.map((row) => row.logId)).size, 201);
    assert.ok(walked.every((row) => row.kind !== "observed" || row.at === tie));
  });

  it("refuses malformed in-scope spans by file and line, while a missing span partition remains an honest no-observation page", () => {
    const w = world();
    terminalDone(w, 1);
    rmSync(join(w.stateRoot, "spans"), { recursive: true, force: true });
    const noSpans = buildRunSection(observedDepsOf(w, [SEARCH_ORIGIN]), uuidOf(1), "logs");
    assert.equal(noSpans.section, "logs");
    assert.deepEqual(noSpans.payload.rows, []);
    appendEventStreamLine(w.stateRoot, "spans", "person-lookup", "2026-08-03", "{ not json at all");
    w.projection.ingestFromDisk();
    assert.throws(
      () => buildRunSection(observedDepsOf(w, [SEARCH_ORIGIN]), uuidOf(1), "logs"),
      new RegExp(`corrupt span line ${join(w.stateRoot, "spans", "person-lookup-2026-08-03.jsonl").replaceAll(/[.\\/]/g, "\\$&")}:1`),
    );
  });

  it("does not open another workflow's span partition even when it is malformed", () => {
    const w = world();
    terminalDone(w, 1);
    appendEventStreamLine(w.stateRoot, "spans", "separations", "2026-08-03", "{ not json at all");
    const section = buildRunSection(observedDepsOf(w, [SEARCH_ORIGIN]), uuidOf(1), "logs");
    assert.equal(section.section, "logs");
    assert.deepEqual(section.payload.rows, []);
  });
});

/* ── P3 · the archive freeze scans once ──────────────────────────────────── */

describe("D5 · the version-bump freeze scans a run's notes once (audit P3)", () => {
  function depsOf(w: DashboardWorld): RunDetailQueryDeps {
    return { runReader: w.runReader,
      stateRoot: w.stateRoot,
      projection: w.projection,
      authority: w.authority,
      descriptors: { resolve: () => personLookupDescriptor },
    };
  }

  /**
   * The seam `freezeLogs` hands to `buildRunSection` — pinned here rather than
   * through the archive, because the archive creates its cache internally and
   * this is the object whose contract is "one scan per freeze".
   */
  it("scans once across a whole page walk, and every page is the same list", () => {
    const w = world();
    terminalDone(w, 1);
    const notes = createNoteJsonlWriter({ stateRoot: w.stateRoot, clock: w.clock, pid: 4242 });
    for (let index = 0; index < 450; index += 1) {
      notes.emitNote({
        workflow: "person-lookup",
        address: { runId: uuidOf(1), attempt: 1, traceId: traceOf(1), spanPath: traceOf(1) },
        level: "step",
        message: `note ${String(index)}`,
      });
    }
    const inner = createRunNoteScanCache();
    let scans = 0;
    const cache = {
      start: (runId: string, scan: () => readonly RunNoteScanEntry[]) =>
        inner.start(runId, () => {
          scans += 1;
          return scan();
        }),
      resume: (runId: string, snapshotId: string) => inner.resume(runId, snapshotId),
    };
    const messages: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const section = buildRunSection(depsOf(w), uuidOf(1), "logs", cursor, cache);
      assert.equal(section.section, "logs");
      messages.push(...section.payload.notes.map((note) => note.message));
      if (section.payload.nextCursor.state === "absent") break;
      cursor = section.payload.nextCursor.value;
    }
    assert.equal(scans, 1);
    assert.equal(messages.length, 450);
    assert.equal(messages[0], "note 0");
    assert.equal(messages.at(-1), "note 449");
  });

  it("serves one run from one scan and a second run from its own", () => {
    // The cache OBJECT's keying, which is the half `buildRunSection` cannot
    // show: a per-run map, not a per-call one.
    const inner = createRunNoteScanCache();
    let scans = 0;
    const counting = (): readonly RunNoteScanEntry[] => {
      scans += 1;
      return [];
    };
    const first = inner.start(uuidOf(1), counting);
    inner.resume(uuidOf(1), first.id);
    inner.start(uuidOf(2), counting);
    assert.equal(scans, 2);
  });

  it("re-reads the corpus on EVERY call when no cache is handed in", () => {
    const w = world();
    terminalDone(w, 1);
    const notes = createNoteJsonlWriter({ stateRoot: w.stateRoot, clock: w.clock, pid: 4242 });
    const emit = (message: string): void => {
      notes.emitNote({
        workflow: "person-lookup",
        address: { runId: uuidOf(1), attempt: 1, traceId: traceOf(1), spanPath: traceOf(1) },
        level: "step",
        message,
      });
    };
    emit("note 0");
    const first = buildRunSection(depsOf(w), uuidOf(1), "logs");
    assert.equal(first.section, "logs");
    assert.deepEqual(first.payload.notes.map((note) => note.message), ["note 0"]);
    // No continuation cursor was handed in, so this is a fresh snapshot and a
    // line appended between the two calls must be visible.
    emit("note 1");
    const second = buildRunSection(depsOf(w), uuidOf(1), "logs");
    assert.equal(second.section, "logs");
    assert.deepEqual(second.payload.notes.map((note) => note.message), ["note 0", "note 1"]);
  });
});
