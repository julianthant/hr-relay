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
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { appendEventStreamLine } from "../../../src/infra/events/jsonl-streams.js";
import { createNoteJsonlWriter } from "../../../src/infra/events/note-jsonl-writer.js";
import type { RunRecord } from "../../../src/domain/run/record.js";
import type { RunCheckpointRecord } from "../../../src/domain/workflow/checkpoint.js";
import {
  buildRunSection,
  createRunNoteScanCache,
  runNotePartitionScope,
  type RunDetailQueryDeps,
  type RunNoteScanEntry,
} from "../../../src/server/dashboard/queries/run-detail.js";
import { personLookupDescriptor } from "../../../src/workflows/person-lookup/descriptor.js";
import {
  AT,
  claimEventOf,
  cleanReceiptOf,
  instantOffsetOf,
  makeWorld,
  queuedEventOf,
  runEndedEventOf,
  runRecordOf,
  traceOf,
  uuidOf,
  type DashboardWorld,
} from "./helpers/dashboard-harness.js";

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
): { value: Result; getRun: number; latestCheckpoint: number; getReceipt: number } {
  const original = {
    getRun: w.authority.getRun.bind(w.authority),
    latestCheckpoint: w.authority.latestCheckpoint.bind(w.authority),
    getReceipt: w.authority.getReceipt.bind(w.authority),
  };
  const counts = { getRun: 0, latestCheckpoint: 0, getReceipt: 0 };
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
    // A group row joins its OWN authority record and resolves its OWN subject
    // title once; the preview adds one `getRun` + one `latestCheckpoint` per
    // NAMED member and no more. Before D5 it was one of each per MEMBER — 8
    // here, 108 on the §7.4 fixture, to print three names.
    assert.equal(counted.latestCheckpoint, 4);
    assert.equal(counted.getRun, 4);
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
});

/* ── P3 · the notes reader, scoped to its run's own partitions ───────────── */

describe("D5 · a logs GET opens only its run's partitions (audit P3)", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function depsOf(w: DashboardWorld): RunDetailQueryDeps {
    return {
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

  it("REFUSES an unparsable line inside the scope rather than reading around it (D218)", () => {
    const w = world();
    terminalDone(w, 1);
    emitNotes(w, 1, 2);
    poison(w, "2026-08-03");
    assert.throws(() => buildRunSection(depsOf(w), uuidOf(1), "logs"));
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

  it("scopes to the run's own window plus one day on each end", () => {
    const w = world();
    // Enqueued at the harness's own clock, so the window below is the run's
    // day ±1 and nothing else. (Left to the shared fixture instant, authority's
    // `updatedAt` is older than the span stream's clock and the scope widens to
    // cover BOTH — the union of a run's instants, which is the honest answer
    // and never a narrower one.)
    terminalDone(w, 1, { enqueuedAt: instantOffsetOf(0) });
    const row = w.projection.runFold(uuidOf(1));
    const authority = w.authority.getRun(uuidOf(1));
    assert.ok(row !== undefined && authority !== undefined);
    assert.deepEqual(runNotePartitionScope(uuidOf(1), row, authority), {
      workflow: "person-lookup",
      fromDate: "2026-08-02",
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

  it("serves an empty page, not a throw, for a run whose workflow wrote no notes", () => {
    const w = world();
    terminalDone(w, 1);
    mkdirSync(join(w.stateRoot, "notes"), { recursive: true });
    writeFileSync(join(w.stateRoot, "notes", "separations-2026-08-03.jsonl"), `{"n":1}\n`);
    const section = buildRunSection(depsOf(w), uuidOf(1), "logs");
    assert.equal(section.section, "logs");
    assert.deepEqual(section.payload.notes, []);
  });
});

/* ── P3 · the archive freeze scans once ──────────────────────────────────── */

describe("D5 · the version-bump freeze scans a run's notes once (audit P3)", () => {
  function depsOf(w: DashboardWorld): RunDetailQueryDeps {
    return {
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
      read: (runId: string, scan: () => readonly RunNoteScanEntry[]): readonly RunNoteScanEntry[] =>
        inner.read(runId, () => {
          scans += 1;
          return scan();
        }),
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

  it("scans once per call when no cache is handed in", () => {
    const w = world();
    terminalDone(w, 1);
    const inner = createRunNoteScanCache();
    let scans = 0;
    const counting = (): readonly RunNoteScanEntry[] => {
      scans += 1;
      return [];
    };
    inner.read(uuidOf(1), counting);
    inner.read(uuidOf(1), counting);
    inner.read(uuidOf(2), counting);
    assert.equal(scans, 2);
  });
});
