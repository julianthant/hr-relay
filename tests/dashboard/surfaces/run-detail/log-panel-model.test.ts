import assert_m0 from "node:assert/strict";
import { describe as describe_m0,it as it_m0 } from "vitest";
import {
appendLogPage as appendLogPage_m0,defaultTabFor as defaultTabFor_m0,groupLogRows as groupLogRows_m0,
logLedgerOf as logLedgerOf_m0,
logPillsOf as logPillsOf_m0,
logRowsOf as logRowsOf_m0,
rowMatchesLogQuery as rowMatchesLogQuery_m0,tabsFor as tabsFor_m0
} from "../../../../src/dashboard/surfaces/run-detail/log-panel-model.js";
import { LogRowWireSchema as LogRowWireSchema_m0,NotePageSchema as NotePageSchema_m0 } from "../../../../src/models/dashboard/run-detail.js";
import { IsoInstantSchema as IsoInstantSchema_m0 } from "../../../../src/rules/identity/ids.js";



{


const RUN = "e1b8ae3e-0000-4000-8000-000000000001";
const TRACE = "pl-100000-e1b8";
const AT = "2026-08-25T12:00:00.000Z";

function observed(sequence: number, attempt = 1) {
  return LogRowWireSchema_m0.parse({
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
  return LogRowWireSchema_m0.parse({
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
  return LogRowWireSchema_m0.parse({
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
  return NotePageSchema_m0.parse({ runId: RUN, rows, notes, nextCursor: cursor });
}

describe_m0("observed log presentation fold", () => {
  it_m0("fails loud with run and cursor when a live page omits strict rows", () => {
    const cursor = `lc:${"e".repeat(64)}:4`;
    const noteRow = note(1);
    if (noteRow.kind !== "note") throw new Error("the note fixture did not parse as a note row");
    const notesOnly = NotePageSchema_m0.parse({
      runId: RUN,
      notes: [noteRow.note],
      nextCursor: { state: "absent", reason: "end-of-page" },
    });

    assert_m0.throws(
      () => logRowsOf_m0(notesOnly, cursor),
      new RegExp(`live log page for run ${RUN} at cursor ${cursor} is missing rows`),
    );
  });

  it_m0("keeps every strict row kind in sequence order even when observations share a timestamp", () => {
    const rows = logRowsOf_m0(page([fence(3), note(1), observed(2)], { state: "absent", reason: "end-of-page" }), "initial");
    assert_m0.deepEqual(rows.map((row) => [row.kind, row.sequence]), [["note", 1], ["observed", 2], ["transaction-fenced", 3]]);
  });

  it_m0("groups only contiguous producer rows and retains the note as a note", () => {
    const groups = groupLogRows_m0([observed(1), observed(2, 2), note(3), fence(4)]);
    assert_m0.deepEqual(groups.map((group) => [group.label, group.rows.map((row) => row.kind)]), [
      ["Find person · ucpath/person-read", ["observed", "observed"]],
      [undefined, ["note"]],
      ["Finalize separation · kuali/finalize", ["transaction-fenced"]],
    ]);
  });

  it_m0("keeps the served 200-row page bound complete in one contiguous producer group", () => {
    const rows = Array.from({ length: 200 }, (_, index) => observed(index + 1));
    const groups = groupLogRows_m0(rows);

    assert_m0.equal(groups.length, 1);
    assert_m0.equal(groups[0]?.rows.length, 200);
    assert_m0.equal(groups[0]?.rows[0], rows[0]);
    assert_m0.equal(groups[0]?.rows[199], rows[199]);
  });

  it_m0("preserves redaction and retry facts without assigning a fence a page direction or system", () => {
    const row = observed(2, 3);
    assert_m0.deepEqual(logPillsOf_m0(row), [
      { direction: "read", label: "person.employeeId · employeeId", value: "redacted" },
      { direction: "read", label: "person.employeeId · matchCount", value: "1" },
    ]);
    const fenced = fence(4);
    assert_m0.equal(fenced.kind, "transaction-fenced");
    assert_m0.deepEqual(logPillsOf_m0(fenced), []);
  });

  it_m0("lays an observed row out as a ledger: direction once per section, field prefixes dropped, lists kept whole", () => {
    const row = LogRowWireSchema_m0.parse({
      kind: "observed",
      logId: "e1b8ae3e-0000-4000-8000-000000000021",
      sequence: 21,
      at: AT,
      attempt: 1,
      traceId: TRACE,
      spanPath: "run/read-document",
      producer: { nodeId: "read-document", step: "Separation Document", taskId: "kuali/read-separation-document", system: "kuali" },
      points: [
        {
          direction: "read",
          field: "documentNumber",
          values: [{ key: "documentNumber", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "4495" }],
        },
        {
          direction: "read",
          field: "employee",
          values: [
            { key: "employee.location.value", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "Hospitality" },
            { key: "employee.name.state", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "present" },
          ],
        },
        {
          direction: "write",
          field: "options",
          values: [{ key: "options.department", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: ["- - -", "000412 - Housing", 7] }],
        },
        {
          direction: "read",
          field: "person.employeeId",
          values: [{ key: "employeeId", state: "redacted", classification: "direct-identifier", transform: "drop" }],
        },
      ],
    });
    assert_m0.deepEqual(logLedgerOf_m0(row), [
      {
        direction: "read",
        fields: [
          {
            field: "documentNumber",
            nested: false,
            facts: [{ key: "documentNumber", label: "documentNumber · documentNumber", value: "4495", items: undefined }],
          },
          {
            field: "employee",
            nested: true,
            facts: [
              { key: "location.value", label: "employee · employee.location.value", value: "Hospitality", items: undefined },
              { key: "name.state", label: "employee · employee.name.state", value: "present", items: undefined },
            ],
          },
        ],
      },
      {
        direction: "write",
        fields: [{
          field: "options",
          nested: true,
          facts: [{
            key: "department",
            label: "options · options.department",
            value: '["- - -","000412 - Housing",7]',
            items: ["- - -", "000412 - Housing", "7"],
          }],
        }],
      },
      {
        direction: "read",
        fields: [{
          field: "person.employeeId",
          nested: true,
          facts: [{ key: "employeeId", label: "person.employeeId · employeeId", value: "redacted", items: undefined }],
        }],
      },
    ]);
    // The ledger and the pills are the same facts in the same order: the
    // hover title and the search contract may never disagree with the screen.
    assert_m0.deepEqual(
      logLedgerOf_m0(row).flatMap((section) => section.fields.flatMap((field) => field.facts.map((fact) => `${fact.label}: ${fact.value}`))),
      logPillsOf_m0(row).map((pill) => `${pill.label}: ${pill.value}`),
    );
    assert_m0.deepEqual(logLedgerOf_m0(fence(4)), []);
    assert_m0.deepEqual(logLedgerOf_m0(note(1)), []);
  });

  it_m0("searches notes and the observed pill label and value, never a fabricated fence detail", () => {
    const observedRow = observed(2);
    assert_m0.equal(rowMatchesLogQuery_m0(observedRow, "employeeId"), true);
    assert_m0.equal(rowMatchesLogQuery_m0(observedRow, "redacted"), true);
    assert_m0.equal(rowMatchesLogQuery_m0(observedRow, "kuali"), false);
    assert_m0.equal(rowMatchesLogQuery_m0(note(1), "directory"), true);
    assert_m0.equal(rowMatchesLogQuery_m0(fence(3), "read"), false);
  });

  it_m0("appends an immutable next page without altering the first snapshot", () => {
    const cursor = `lc:${"a".repeat(64)}:2`;
    const first = page([note(1), observed(2)], { state: "present", value: cursor });
    const next = page([fence(3)], { state: "absent", reason: "end-of-page" });
    const appended = appendLogPage_m0(first, cursor, next);
    assert_m0.deepEqual(logRowsOf_m0(first, "initial").map((row) => row.sequence), [1, 2]);
    assert_m0.deepEqual(logRowsOf_m0(appended, cursor).map((row) => row.sequence), [1, 2, 3]);
    assert_m0.deepEqual(appended.nextCursor, { state: "absent", reason: "end-of-page" });
  });

  it_m0("rejects returned rows that reverse sequence within one continuation page", () => {
    const cursor = `lc:${"a".repeat(64)}:10`;
    const first = page([observed(9)], { state: "present", value: cursor });
    const reversed = page([observed(10), observed(5)], { state: "absent", reason: "end-of-page" });

    assert_m0.throws(
      () => appendLogPage_m0(first, cursor, reversed),
      new RegExp(`log continuation for run ${RUN} at cursor ${cursor} must strictly increase after sequence 10; received 5`),
    );
  });

  it_m0("rejects a continuation that begins below the requested cursor offset", () => {
    const cursor = `lc:${"a".repeat(64)}:10`;
    const first = page([observed(2)], { state: "present", value: cursor });
    const beforeCursor = page([observed(5)], { state: "absent", reason: "end-of-page" });

    assert_m0.throws(
      () => appendLogPage_m0(first, cursor, beforeCursor),
      new RegExp(`log continuation for run ${RUN} at cursor ${cursor} must strictly increase after sequence 9; received 5`),
    );
  });

  it_m0("rejects a returned next cursor from a different immutable snapshot", () => {
    const requestedDigest = "a".repeat(64);
    const returnedDigest = "b".repeat(64);
    const cursor = `lc:${requestedDigest}:2`;
    const first = page([note(1), observed(2)], { state: "present", value: cursor });
    const differentSnapshot = page(
      [observed(3)],
      { state: "present", value: `lc:${returnedDigest}:3` },
    );

    assert_m0.throws(
      () => appendLogPage_m0(first, cursor, differentSnapshot),
      new RegExp(
        `log continuation for run ${RUN} at cursor ${cursor} returned snapshot digest ${returnedDigest}; expected ${requestedDigest}`,
      ),
    );
  });

  it_m0("accepts a strictly increasing continuation on the requested immutable snapshot", () => {
    const digest = "c".repeat(64);
    const cursor = `lc:${digest}:10`;
    const returnedCursor = `lc:${digest}:12`;
    const first = page([observed(9)], { state: "present", value: cursor });
    const continuation = page(
      [observed(10), fence(11)],
      { state: "present", value: returnedCursor },
    );

    const appended = appendLogPage_m0(first, cursor, continuation);

    assert_m0.deepEqual(logRowsOf_m0(appended, returnedCursor).map((row) => row.sequence), [9, 10, 11]);
    assert_m0.deepEqual(appended.nextCursor, { state: "present", value: returnedCursor });
  });

  it_m0("refuses a duplicated append instead of silently losing or reordering evidence", () => {
    const cursor = `lc:${"b".repeat(64)}:1`;
    const first = page([observed(2)], { state: "present", value: cursor });
    const duplicate = page([observed(2)], { state: "absent", reason: "end-of-page" });
    assert_m0.throws(() => appendLogPage_m0(first, cursor, duplicate), /duplicate log sequence 2/);
  });

  it_m0("refuses a continuation launched for a different cursor than the current snapshot owns", () => {
    const ownedCursor = `lc:${"c".repeat(64)}:1`;
    const staleCursor = `lc:${"d".repeat(64)}:1`;
    const first = page([observed(1)], { state: "present", value: ownedCursor });
    const next = page([observed(2)], { state: "absent", reason: "end-of-page" });

    assert_m0.throws(
      () => appendLogPage_m0(first, staleCursor, next),
      new RegExp(`cursor ${staleCursor}.*current run ${RUN} owns ${ownedCursor}`),
    );
  });
});

describe_m0("retired run inspection surfaces", () => {
  it_m0("omits receipt and opens terminal runs on Logs, including old advertised receipt", () => {
    assert_m0.deepEqual(tabsFor_m0({ availableSections: ["logs", "receipt", "context-data", "context-attempts"] }), ["logs"]);
    assert_m0.equal(defaultTabFor_m0({ availableSections: ["logs", "receipt"], outcome: { state: "terminal", result: "verified-done", completedAt: IsoInstantSchema_m0.parse("2026-09-29T12:00:00.000Z") } }), "logs");
  });
});
}
