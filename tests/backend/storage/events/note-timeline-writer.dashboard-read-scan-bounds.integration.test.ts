import { terminalDone, depsOf, observedDepsOf, observedEvent } from "../../../support/helpers/backend/note-scope-fixtures.js";

import assert from "node:assert/strict";

import { afterEach, describe, it } from "vitest";
import { buildRunSection, createRunNoteScanCache, type RunNoteScanEntry } from "../../../../src/backend/runs/queries/run-detail.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { type RunRecord } from "../../../../src/models/run/record.js";
import type { RunCheckpointRecord } from "../../../../src/models/workflow/checkpoint.js";
import { AT, cleanReceiptOf, makeWorld, queuedEventOf, receiptWithWarningsOf, traceOf, uuidOf, type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";
import { createSubjectTitleTestWorld } from "../../../support/helpers/backend/subject-title-world.js";
import { RunEvidenceReceiptSchema, type RunEvidenceReceipt } from "../../../../src/models/trust/evidence.js";

const { descriptor: subjectDescriptor } = createSubjectTitleTestWorld();
const worlds: DashboardWorld[] = [];
function world(): DashboardWorld {
  const created = makeWorld({ descriptors: { resolve: () => subjectDescriptor } });
  worlds.push(created);
  return created;
}
afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});

/** A settled `done` run, fold and authority agreeing, as the projector sees one. */


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

function boundReceipt(w: DashboardWorld, receipt: RunEvidenceReceipt): RunEvidenceReceipt {
  const run = w.authority.records.get(receipt.runId);
  assert.ok(run);
  const e = run.envelope;
  return RunEvidenceReceiptSchema.parse({ ...receipt, runId: e.runId, traceId: e.traceId, attempt: e.attempt,
    workflowId: e.workflow, descriptorFingerprint: e.contractFingerprint, configFingerprint: e.configFingerprint });
}

describe("member preview slices before joining", () => {
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

describe("a row reads its evidence receipt once", () => {
  it("reads the receipt exactly once for a terminal row", () => {
    const w = world();
    terminalDone(w, 1);
    w.authority.receipts.set(uuidOf(1), boundReceipt(w, cleanReceiptOf({ seed: 1 })));
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
    w.authority.receipts.set(uuidOf(1), boundReceipt(w, cleanReceiptOf({ seed: 1 })));
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

    terminalDone(w, 1);
    terminalDone(w, 2);
    terminalDone(w, 3);
    terminalDone(w, 4);
    w.authority.receipts.set(uuidOf(1), boundReceipt(w, cleanReceiptOf({ seed: 1 })));
    w.authority.receipts.set(uuidOf(2), boundReceipt(w, receiptWithWarningsOf({
      seed: 2,
      summaries: ["a safe warning"],
    })));
    const legacyReceipt = boundReceipt(w, cleanReceiptOf({ seed: 4 }));
    w.authority.receipts.set(uuidOf(4), legacyReceipt);

    const counted = countAuthorityReads(w, () => w.projection.buildActivityReportWire(
      AT.toISOString().slice(0, 10),
      AT.toISOString().slice(0, 10),
    ));
    assert.equal(counted.value.totalRuns, 4);
    assert.equal(counted.value.terminalRuns, 4);
    assert.deepEqual(counted.value.completion, { readBack: 2, warnings: 1, warningsUnknown: 1 });
    assert.deepEqual(counted.value.workflows[0]?.completion, {
      readBack: 2,
      warnings: 1,
      warningsUnknown: 1,
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
      reason: "this run's evidence receipt records no warning",
    });
  });
});

describe("a logs GET opens only its run partitions", () => {
  const _DAY_MS = 24 * 60 * 60 * 1000;



  const SEARCH_ORIGIN = {
    nodeId: "searching",
    step: "Search person",
    taskId: "ucpath/search-person-org",
    system: "ucpath",
  } as const;



  it("serves a completed browser action as a concise Logs line", () => {
    const w = world();
    terminalDone(w, 1);
    const authority = w.authority.getRun(uuidOf(1));
    assert.ok(authority !== undefined);
    const notes = createNoteTimelineWriter({ repository: w.database.authority.timelineEvents, clock: w.clock, pid: 4242 });
    notes.emitRunAction({
      workflow: "person-lookup",
      address: { runId: uuidOf(1), attempt: 1, traceId: traceOf(1), spanPath: traceOf(1) },
      action: { kind: "clicked", targetId: "ucpath.person-org.search-button", at: w.clock.now().toISOString() },
    }, authority);
    const section = buildRunSection(observedDepsOf(w, [SEARCH_ORIGIN]), uuidOf(1), "logs");
    assert.equal(section.section, "logs");
    assert.deepEqual(section.payload.rows?.map((row) => row.kind), ["note"]);
    assert.equal(section.payload.notes[0]?.message, "Clicked ucpath person org search button");
  });

  it("serves classified note values in Logs", () => {
    const w = world();
    terminalDone(w, 1);
    const notes = createNoteTimelineWriter({ repository: w.database.authority.timelineEvents, clock: w.clock, pid: 4242 });
    notes.emitNote({
      workflow: "person-lookup",
      address: { runId: uuidOf(1), attempt: 1, traceId: traceOf(1), spanPath: traceOf(1) },
      level: "step",
      message: "Entered person details",
      fields: [{ key: "ssn", classification: "direct-identifier", transform: "last4", value: "920-74-1459" }],
    });
    const section = buildRunSection(observedDepsOf(w, [SEARCH_ORIGIN]), uuidOf(1), "logs");
    assert.equal(section.section, "logs");
    assert.deepEqual(section.payload.notes[0]?.fields, [{ key: "ssn", kind: "text", value: "[SSN masked]" }]);
  });

  it("refuses a same-run observation whose trace is not the run authority trace", () => {
    const w = world();
    terminalDone(w, 1);
    assert.throws(() => observedEvent(w, { traceId: traceOf(2) }), /timeline-event-owner-mismatch/u);
  });

  it("refuses observed rows under a foreign workflow or outside the run's legal attempts", () => {
    const foreignWorkflow = world();
    terminalDone(foreignWorkflow, 1);
    assert.throws(() => observedEvent(foreignWorkflow, { workflow: "separations" }), /timeline-event-owner-mismatch/u);
    const foreignAttempt = world();
    terminalDone(foreignAttempt, 1);
    assert.throws(() => observedEvent(foreignAttempt, { attempt: 2 }), /timeline-event-owner-mismatch/u);
  });

  it("refuses foreign note workflow and trace identities by source line", () => {
    const foreignWorkflow = world();
    terminalDone(foreignWorkflow, 1);
    const foreignNotes = createNoteTimelineWriter({ repository: foreignWorkflow.timeline, clock: foreignWorkflow.clock, pid: 4242 });
    assert.throws(() => foreignNotes.emitNote({ workflow: "separations", address: { runId: uuidOf(1), attempt: 1, traceId: traceOf(1), spanPath: traceOf(1) }, level: "step", message: "foreign workflow" }), /timeline-event-owner-mismatch/u);

    const foreignTrace = world();
    terminalDone(foreignTrace, 1);
    const notes = createNoteTimelineWriter({ repository: foreignTrace.timeline, clock: foreignTrace.clock, pid: 4242 });
    assert.throws(() => notes.emitNote({ workflow: "person-lookup", address: { runId: uuidOf(1), attempt: 1, traceId: traceOf(2), spanPath: traceOf(2) }, level: "step", message: "foreign trace" }), /timeline-note-owner-mismatch/u);

  });
});

describe("native logs snapshot scans a run once", () => {


  it("scans once across a whole page walk, and every page is the same list", () => {
    const w = world();
    terminalDone(w, 1);
    const notes = createNoteTimelineWriter({ repository: w.database.authority.timelineEvents, clock: w.clock, pid: 4242 });
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

  it("re-reads the corpus on EVERY call when no cache is handed in", () => {
    const w = world();
    terminalDone(w, 1);
    const notes = createNoteTimelineWriter({ repository: w.database.authority.timelineEvents, clock: w.clock, pid: 4242 });
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

    emit("note 1");
    const second = buildRunSection(depsOf(w), uuidOf(1), "logs");
    assert.equal(second.section, "logs");
    assert.deepEqual(second.payload.notes.map((note) => note.message), ["note 0", "note 1"]);
  });
});
