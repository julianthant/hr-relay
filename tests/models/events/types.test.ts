
import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { describe as describe_m0,describe as describe_m1,it as it_m0,it as it_m1 } from "vitest";
import {
SpanNotRunReasonSchema as ExecutorNotRunReasonSchema_m0,
ExecutorSpanEventSchema as ExecutorSpanEventSchema_m0,
SpanOutcomeSchema as SpanOutcomeSchema_m0
} from "../../../src/backend/logs/span-emitter.js";
import { TimelineNotRunReasonSchema as TimelineNotRunReasonSchema_m0 } from "../../../src/models/dashboard/run-detail.js";
import {
NoteWireSchema as NoteWireSchema_m0,
NoteWireSchema as NoteWireSchema_m1,
SpanBrowserSystemSchema as SpanBrowserSystemSchema_m0,
SpanDataClassificationSchema as SpanDataClassificationSchema_m0,
SpanEventWireSchema as SpanEventWireSchema_m0,
SpanFieldPathSchema as SpanFieldPathSchema_m0,
SpanNotRunReasonSchema as SpanNotRunReasonSchema_m0,
SpanOutcomeWireSchema as SpanOutcomeWireSchema_m0,
SpanRequeueCauseSchema as SpanRequeueCauseSchema_m0,
SpanTaskIdSchema as SpanTaskIdSchema_m0,
projectNoteForOperator as projectNoteForOperator_m1
} from "../../../src/models/events/types.js";
import { RequeueCauseSchema as RequeueCauseSchema_m0,RunOutcomeSchema as RunOutcomeSchema_m0 } from "../../../src/models/run/record.js";
import { TerminalNotRunReasonSchema as TerminalNotRunReasonSchema_m0 } from "../../../src/models/run/result.js";
import { ContractFieldPathSchema as ContractFieldPathSchema_m0 } from "../../../src/models/task/task-contract.js";
import {
CURRENT_DIAGNOSTIC_SAFETY_VERSION as CURRENT_DIAGNOSTIC_SAFETY_VERSION_m1
} from "../../../src/models/trust/failure.js";
import { BrowserSystemIdSchema as BrowserSystemIdSchema_m0,TaskIdSchema as TaskIdSchema_m0 } from "../../../src/rules/identity/ids.js";
import {
DataClassificationSchema as DataClassificationSchema_m0,
redactValue as redactValue_m0
} from "../../../src/rules/redaction/redaction.js";


{


const RUN_ID = "3b8f0a1e-2c4d-4e6f-8a9b-0c1d2e3f4a5b";
const ITEM_ID = "9c8b7a6d-5e4f-43a2-9b8c-7d6e5f4a3b2c";
const SNAPSHOT_ID = "1a2b3c4d-5e6f-47a8-89ab-cdef01234567";
const TRACE = "pl-104233-3b8f";
const HASH = "a".repeat(64);
const BASE = { ts: "2026-08-03T10:42:33.000-07:00", workflow: "person-lookup", pid: 4242 } as const;
const RUN_IDENTITY = { runId: RUN_ID, attempt: 1, traceId: TRACE, spanPath: TRACE } as const;

const QUEUED = {
  t: "run.queued",
  kind: "run",
  ...BASE,
  ...RUN_IDENTITY,
  itemId: ITEM_ID,
  shape: "single",
  priority: "interactive",
  dryRun: false,
  actorId: "local-operator",
  title: "Ada Lovelace",
  descriptorVersion: 1,
  contractFingerprint: HASH,
  resolvedInstance: { ucpath: "prod" },
  configFingerprint: HASH,
  configSnapshotId: SNAPSHOT_ID,
} as const;

describe_m0("span wire leaf parity with the domain vocabulary", () => {
  it_m0("pins the leaf's restated enums to their domain owners", () => {
    assert_m0.deepEqual(SpanBrowserSystemSchema_m0.options, BrowserSystemIdSchema_m0.options);
    assert_m0.deepEqual(SpanRequeueCauseSchema_m0.options, RequeueCauseSchema_m0.options);
    assert_m0.deepEqual(SpanOutcomeWireSchema_m0.options, SpanOutcomeSchema_m0.options);

    assert_m0.deepEqual(SpanDataClassificationSchema_m0.options, DataClassificationSchema_m0.options);
    assert_m0.equal(SpanTaskIdSchema_m0.parse("workflow:separations/match-identity"), "workflow:separations/match-identity");
    assert_m0.throws(() => SpanTaskIdSchema_m0.parse("Not/A-Task"));
    assert_m0.throws(() => TaskIdSchema_m0.parse("Not/A-Task"));
    assert_m0.equal(SpanFieldPathSchema_m0.parse("selection.status"), "selection.status");
    assert_m0.throws(() => SpanFieldPathSchema_m0.parse("Selection.Status"));
    assert_m0.throws(() => ContractFieldPathSchema_m0.parse("Selection.Status"));
    // The run-outcome union is the wire union minus the task-only `skipped`.
    assert_m0.deepEqual([...RunOutcomeSchema_m0.options, "skipped"].sort(), [...SpanOutcomeWireSchema_m0.options].sort());
  });

  it_m0("pins ONE not-run vocabulary across the durable result, the span, and the timeline", () => {

    assert_m0.deepEqual(SpanNotRunReasonSchema_m0.options, TerminalNotRunReasonSchema_m0.options);
    assert_m0.deepEqual(ExecutorNotRunReasonSchema_m0.options, TerminalNotRunReasonSchema_m0.options);
    assert_m0.deepEqual(TimelineNotRunReasonSchema_m0.options, TerminalNotRunReasonSchema_m0.options);
  });

  it_m0("carries a not-run reason ONLY on a skipped task span", () => {
    const ended = {
      t: "span.ended", kind: "task", ...BASE, ...RUN_IDENTITY,
      spanPath: `${TRACE}/crm-dates#1`,
    } as const;
    assert_m0.equal(
      SpanEventWireSchema_m0.parse({ ...ended, outcome: "skipped", notRunReason: "condition-false" }).t,
      "span.ended",
    );

    assert_m0.equal(SpanEventWireSchema_m0.parse({ ...ended, outcome: "skipped" }).t, "span.ended");
    assert_m0.throws(() => SpanEventWireSchema_m0.parse({ ...ended, outcome: "done", notRunReason: "condition-false" }));
    assert_m0.throws(() => SpanEventWireSchema_m0.parse({ ...ended, outcome: "skipped", notRunReason: "gave-up" }));
    assert_m0.throws(() => ExecutorSpanEventSchema_m0.parse({
      t: "span.ended", kind: "run", ts: BASE.ts, workflow: BASE.workflow, ...RUN_IDENTITY,
      outcome: "skipped", notRunReason: "condition-false",
    }));
  });
});

describe_m0("the transaction fence beat", () => {
  const FENCED = {
    t: "transaction.fenced",
    ts: BASE.ts,
    workflow: BASE.workflow,
    ...RUN_IDENTITY,
    spanPath: `${TRACE}/clear-pending/commit`,
    parentSpanPath: TRACE,
    node: "clear-pending",
    taskId: "ucpath/delete-pending-terminations",
  } as const;

  it_m0("round-trips through both strict parity twins", () => {
    ExecutorSpanEventSchema_m0.parse(FENCED);
    SpanEventWireSchema_m0.parse({ ...FENCED, pid: BASE.pid });
  });

  it_m0("refuses a missing task role and a fabricated page-data field", () => {
    assert_m0.throws(() => ExecutorSpanEventSchema_m0.parse({ ...FENCED, taskId: undefined }));
    assert_m0.throws(() => SpanEventWireSchema_m0.parse({ ...FENCED, pid: BASE.pid, points: [] }));
  });
});

describe_m0("the observed-log arm", () => {
  const OBSERVED = {
    t: "data.observed", ts: BASE.ts, workflow: BASE.workflow, ...RUN_IDENTITY,
    spanPath: `${TRACE}/searching#1.1`,
    nodeId: "searching", taskId: "ucpath/search-person-org", observedAt: BASE.ts,
    points: [{ direction: "read", field: "results", values: [
      { key: "results", ...redactValue_m0("sensitive-hr", "count", []) },
    ] }],
  } as const;

  it_m0("round-trips through the kernel union and the wire leaf", () => {
    ExecutorSpanEventSchema_m0.parse(OBSERVED);
    SpanEventWireSchema_m0.parse({ ...OBSERVED, pid: BASE.pid });
  });

  it_m0("refuses an event with no points — an emission describes an observation that happened", () => {
    assert_m0.throws(() => ExecutorSpanEventSchema_m0.parse({ ...OBSERVED, points: [] }));
    assert_m0.throws(() => SpanEventWireSchema_m0.parse({ ...OBSERVED, points: [], pid: BASE.pid }));
  });

  it_m0("refuses a raw value where a redacted one belongs", () => {
    assert_m0.throws(() => SpanEventWireSchema_m0.parse({
      ...OBSERVED, pid: BASE.pid,
      points: [{ direction: "read", field: "results", values: [{ key: "results", value: "Ada Lovelace" }] }],
    }));
  });
});

describe_m0("span wire strictness", () => {
  it_m0("admits only a complete authority-reconstruction marker on a queued root", () => {
    SpanEventWireSchema_m0.parse({
      ...QUEUED,
      repair: {
        kind: "authority-reconstruction",
        repairedAt: BASE.ts,
        sourceAuthorityGeneration: 0,
        sourceAuthorityFingerprint: HASH,
        priorStreamBytes: 0,
        priorStreamSha256: HASH,
      },
    });
    assert_m0.throws(() => SpanEventWireSchema_m0.parse({
      ...QUEUED,
      repair: {
        kind: "authority-reconstruction",
        repairedAt: BASE.ts,
        sourceAuthorityGeneration: -1,
        sourceAuthorityFingerprint: HASH,
        priorStreamBytes: 0,
        priorStreamSha256: HASH,
      },
    }));
    assert_m0.throws(() => SpanEventWireSchema_m0.parse({
      ...QUEUED,
      repair: {
        kind: "authority-reconstruction",
        repairedAt: BASE.ts,
        sourceAuthorityGeneration: 0,
        sourceAuthorityFingerprint: HASH,
        priorStreamBytes: 0,
      },
    }));
    assert_m0.throws(() => SpanEventWireSchema_m0.parse({
      ...QUEUED,
      repair: {
        kind: "authority-reconstruction",
        repairedAt: BASE.ts,
        sourceAuthorityGeneration: 0,
        sourceAuthorityFingerprint: HASH,
        priorStreamBytes: 0,
        priorStreamSha256: HASH,
        extra: true,
      },
    }));
  });

  it_m0("parses the full run.queued identity and refuses unknown keys", () => {
    SpanEventWireSchema_m0.parse(QUEUED);
    assert_m0.throws(() => SpanEventWireSchema_m0.parse({ ...QUEUED, sneaky: true }));
    assert_m0.throws(() => SpanEventWireSchema_m0.parse({ ...QUEUED, resolvedInstance: { intranet: "prod" } }));
  });

  it_m0("refuses a worker span wearing a run id and a run span wearing none", () => {
    assert_m0.throws(() => SpanEventWireSchema_m0.parse({
      t: "span.started", kind: "worker", ...BASE, workerId: "w-1", runId: RUN_ID, spanPath: "worker/x/w-1", name: "x",
    }));
    const { runId: _runId, ...withoutRunId } = QUEUED;
    assert_m0.throws(() => SpanEventWireSchema_m0.parse(withoutRunId));
  });


  it_m0("refuses every span.patched shape — the retired detail channel is not in the union", () => {
    for (const key of ["resolvedName", "selection-status", "runId", "traceId", "contractFingerprint"]) {
      assert_m0.throws(() => SpanEventWireSchema_m0.parse({
        t: "span.patched", ...BASE, ...RUN_IDENTITY, updates: [{ key, value: "x" }],
      }));
    }
    assert_m0.throws(() => SpanEventWireSchema_m0.parse({ t: "span.patched", ...BASE, ...RUN_IDENTITY, updates: [] }));
  });

  it_m0("refuses a malformed gate resolution", () => {
    assert_m0.throws(() => SpanEventWireSchema_m0.parse({
      t: "gate.resolved", ...BASE, ...RUN_IDENTITY, gate: "approval", resolutionKey: "resolved", resultHash: "short",
    }));
    SpanEventWireSchema_m0.parse({
      t: "gate.resolved", ...BASE, ...RUN_IDENTITY, gate: "approval", resolutionKey: "resolved", resultHash: HASH,
    });
  });

  it_m0("parses run- and worker-addressed notes and refuses unknown keys and levels", () => {
    NoteWireSchema_m0.parse({ ...BASE, ...RUN_IDENTITY, level: "step", message: "opened person search" });
    NoteWireSchema_m0.parse({
      ...BASE, workerId: "person-lookup-worker-1", spanPath: "worker/person-lookup/person-lookup-worker-1",
      level: "warn", message: "browser health degraded",
      fields: [{ key: "restarts", kind: "count", value: 2 }],
    });
    assert_m0.throws(() => NoteWireSchema_m0.parse({ ...BASE, ...RUN_IDENTITY, level: "info", message: "x" }));
    assert_m0.throws(() => NoteWireSchema_m0.parse({ ...BASE, ...RUN_IDENTITY, level: "step", message: "x", extra: 1 }));
    assert_m0.throws(() => NoteWireSchema_m0.parse({
      ...BASE, ...RUN_IDENTITY, level: "step", message: "x",
      fields: [{ key: "raw", kind: "map", value: { open: true } }],
    }));
  });
});
}

{


const RAW = "ucpath:termination|10812345|2026-08-29";

describe_m1("diagnostic evidence projection", () => {

  it_m1("serves unstamped and stamped note text", () => {
    const unstamped = NoteWireSchema_m1.parse({
      ts: "2026-08-29T08:00:00.000Z",
      workflow: "person-lookup",
      pid: 123,
      level: "error",
      message: RAW,
      runId: "10000000-0000-4000-8000-000000000002",
      attempt: 1,
      traceId: "pl-010101-1000",
      spanPath: "pl-010101-1000/searching#1.1",
    });
    const current = NoteWireSchema_m1.parse({
      ...unstamped,
      diagnosticSafetyVersion: CURRENT_DIAGNOSTIC_SAFETY_VERSION_m1,
      message: "registered source could not be read",
    });
    assert_m1.deepEqual(projectNoteForOperator_m1(unstamped), unstamped);
    assert_m1.deepEqual(projectNoteForOperator_m1(current), current);
  });
});
}
