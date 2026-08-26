import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { LogRowWireSchema, NotePageSchema } from "../../../src/domain/dashboard/run-detail.js";
import {
  appendLogPage,
  groupLogRows,
  logPillsOf,
  logRowsOf,
  rowMatchesLogQuery,
} from "../../../src/dashboard/surfaces/log-panel-model.js";

const RUN = "e1b8ae3e-0000-4000-8000-000000000001";
const TRACE = "pl-100000-e1b8";
const AT = "2026-08-25T12:00:00.000Z";

function observed(sequence: number, attempt = 1) {
  return LogRowWireSchema.parse({
    kind: "observed",
    logId: `e1b8ae3e-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    sequence,
    at: AT,
    attempt,
    traceId: TRACE,
    spanPath: `run/task-${String(sequence)}`,
    producer: { nodeId: "person-read", step: "Find person", taskId: "ucpath/person-read", system: "ucpath" },
    points: [{
      direction: "read",
      field: "person.employeeId",
      values: [
        { key: "employeeId", state: "redacted", classification: "direct-identifier", transform: "drop" },
        { key: "matchCount", state: "transformed", classification: "safe-diagnostic", transform: "count", value: 1 },
      ],
    }],
  });
}

function fence(sequence: number) {
  return LogRowWireSchema.parse({
    kind: "transaction-fenced",
    logId: `e1b8ae3e-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    sequence,
    at: AT,
    attempt: 2,
    traceId: TRACE,
    spanPath: "run/transaction",
    producer: { nodeId: "transaction", step: "Finalize separation", taskId: "kuali/finalize", system: "kuali" },
  });
}

function note(sequence: number) {
  return LogRowWireSchema.parse({
    kind: "note",
    logId: `e1b8ae3e-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    sequence,
    note: {
      noteId: `e1b8ae3e-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
      runId: RUN,
      sequence,
      at: AT,
      level: "warning",
      message: "The directory returned more than one candidate",
    },
  });
}

function page(rows: readonly ReturnType<typeof observed>[], cursor: { state: "present"; value: string } | { state: "absent"; reason: "end-of-page" }) {
  const notes = rows.flatMap((row) => row.kind === "note" ? [row.note] : []);
  return NotePageSchema.parse({ runId: RUN, rows, notes, nextCursor: cursor });
}

describe("observed log presentation fold", () => {
  it("fails loud with run and cursor when a live page omits strict rows", () => {
    const cursor = `lc:${"e".repeat(64)}:4`;
    const noteRow = note(1);
    if (noteRow.kind !== "note") throw new Error("the note fixture did not parse as a note row");
    const notesOnly = NotePageSchema.parse({
      runId: RUN,
      notes: [noteRow.note],
      nextCursor: { state: "absent", reason: "end-of-page" },
    });

    assert.throws(
      () => logRowsOf(notesOnly, cursor),
      new RegExp(`live log page for run ${RUN} at cursor ${cursor} is missing rows`),
    );
  });

  it("keeps every strict row kind in sequence order even when observations share a timestamp", () => {
    const rows = logRowsOf(page([fence(3), note(1), observed(2)], { state: "absent", reason: "end-of-page" }), "initial");
    assert.deepEqual(rows.map((row) => [row.kind, row.sequence]), [["note", 1], ["observed", 2], ["transaction-fenced", 3]]);
  });

  it("groups only contiguous producer rows and retains the note as a note", () => {
    const groups = groupLogRows([observed(1), observed(2, 2), note(3), fence(4)]);
    assert.deepEqual(groups.map((group) => [group.label, group.rows.map((row) => row.kind)]), [
      ["Find person · ucpath/person-read", ["observed", "observed"]],
      [undefined, ["note"]],
      ["Finalize separation · kuali/finalize", ["transaction-fenced"]],
    ]);
  });

  it("keeps the served 200-row page bound complete in one contiguous producer group", () => {
    const rows = Array.from({ length: 200 }, (_, index) => observed(index + 1));
    const groups = groupLogRows(rows);

    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.rows.length, 200);
    assert.equal(groups[0]?.rows[0], rows[0]);
    assert.equal(groups[0]?.rows[199], rows[199]);
  });

  it("preserves redaction and retry facts without assigning a fence a page direction or system", () => {
    const row = observed(2, 3);
    assert.deepEqual(logPillsOf(row), [
      { direction: "read", label: "person.employeeId · employeeId", value: "redacted" },
      { direction: "read", label: "person.employeeId · matchCount", value: "1" },
    ]);
    const fenced = fence(4);
    assert.equal(fenced.kind, "transaction-fenced");
    assert.deepEqual(logPillsOf(fenced), []);
  });

  it("searches notes and the observed pill label and value, never a fabricated fence detail", () => {
    const observedRow = observed(2);
    assert.equal(rowMatchesLogQuery(observedRow, "employeeId"), true);
    assert.equal(rowMatchesLogQuery(observedRow, "redacted"), true);
    assert.equal(rowMatchesLogQuery(observedRow, "kuali"), false);
    assert.equal(rowMatchesLogQuery(note(1), "directory"), true);
    assert.equal(rowMatchesLogQuery(fence(3), "read"), false);
  });

  it("appends an immutable next page without altering the first snapshot", () => {
    const cursor = `lc:${"a".repeat(64)}:2`;
    const first = page([note(1), observed(2)], { state: "present", value: cursor });
    const next = page([fence(3)], { state: "absent", reason: "end-of-page" });
    const appended = appendLogPage(first, cursor, next);
    assert.deepEqual(logRowsOf(first, "initial").map((row) => row.sequence), [1, 2]);
    assert.deepEqual(logRowsOf(appended, cursor).map((row) => row.sequence), [1, 2, 3]);
    assert.deepEqual(appended.nextCursor, { state: "absent", reason: "end-of-page" });
  });

  it("rejects returned rows that reverse sequence within one continuation page", () => {
    const cursor = `lc:${"a".repeat(64)}:10`;
    const first = page([observed(9)], { state: "present", value: cursor });
    const reversed = page([observed(10), observed(5)], { state: "absent", reason: "end-of-page" });

    assert.throws(
      () => appendLogPage(first, cursor, reversed),
      new RegExp(`log continuation for run ${RUN} at cursor ${cursor} must strictly increase after sequence 10; received 5`),
    );
  });

  it("rejects a continuation that begins below the requested cursor offset", () => {
    const cursor = `lc:${"a".repeat(64)}:10`;
    const first = page([observed(2)], { state: "present", value: cursor });
    const beforeCursor = page([observed(5)], { state: "absent", reason: "end-of-page" });

    assert.throws(
      () => appendLogPage(first, cursor, beforeCursor),
      new RegExp(`log continuation for run ${RUN} at cursor ${cursor} must strictly increase after sequence 9; received 5`),
    );
  });

  it("rejects a returned next cursor from a different immutable snapshot", () => {
    const requestedDigest = "a".repeat(64);
    const returnedDigest = "b".repeat(64);
    const cursor = `lc:${requestedDigest}:2`;
    const first = page([note(1), observed(2)], { state: "present", value: cursor });
    const differentSnapshot = page(
      [observed(3)],
      { state: "present", value: `lc:${returnedDigest}:3` },
    );

    assert.throws(
      () => appendLogPage(first, cursor, differentSnapshot),
      new RegExp(
        `log continuation for run ${RUN} at cursor ${cursor} returned snapshot digest ${returnedDigest}; expected ${requestedDigest}`,
      ),
    );
  });

  it("accepts a strictly increasing continuation on the requested immutable snapshot", () => {
    const digest = "c".repeat(64);
    const cursor = `lc:${digest}:10`;
    const returnedCursor = `lc:${digest}:12`;
    const first = page([observed(9)], { state: "present", value: cursor });
    const continuation = page(
      [observed(10), fence(11)],
      { state: "present", value: returnedCursor },
    );

    const appended = appendLogPage(first, cursor, continuation);

    assert.deepEqual(logRowsOf(appended, returnedCursor).map((row) => row.sequence), [9, 10, 11]);
    assert.deepEqual(appended.nextCursor, { state: "present", value: returnedCursor });
  });

  it("refuses a duplicated append instead of silently losing or reordering evidence", () => {
    const cursor = `lc:${"b".repeat(64)}:1`;
    const first = page([observed(2)], { state: "present", value: cursor });
    const duplicate = page([observed(2)], { state: "absent", reason: "end-of-page" });
    assert.throws(() => appendLogPage(first, cursor, duplicate), /duplicate log sequence 2/);
  });

  it("refuses a continuation launched for a different cursor than the current snapshot owns", () => {
    const ownedCursor = `lc:${"c".repeat(64)}:1`;
    const staleCursor = `lc:${"d".repeat(64)}:1`;
    const first = page([observed(1)], { state: "present", value: ownedCursor });
    const next = page([observed(2)], { state: "absent", reason: "end-of-page" });

    assert.throws(
      () => appendLogPage(first, staleCursor, next),
      new RegExp(`cursor ${staleCursor}.*current run ${RUN} owns ${ownedCursor}`),
    );
  });
});
