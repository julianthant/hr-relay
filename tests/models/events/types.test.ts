import { default as assert } from "node:assert/strict";
import { describe } from "vitest";
import { it } from "vitest";
import { SpanNotRunReasonSchema as ExecutorNotRunReasonSchema } from "../../../src/backend/logs/span-emitter.js";
import { ExecutorSpanEventSchema } from "../../../src/backend/logs/span-emitter.js";
import { SpanOutcomeSchema } from "../../../src/backend/logs/span-emitter.js";
import { TimelineNotRunReasonSchema } from "../../../src/models/dashboard/run-detail.js";
import { NoteWireSchema } from "../../../src/models/events/types.js";
import { SpanBrowserSystemSchema } from "../../../src/models/events/types.js";
import { SpanDataClassificationSchema } from "../../../src/models/events/types.js";
import { SpanEventWireSchema } from "../../../src/models/events/types.js";
import { SpanFieldPathSchema } from "../../../src/models/events/types.js";
import { SpanNotRunReasonSchema } from "../../../src/models/events/types.js";
import { SpanOutcomeWireSchema } from "../../../src/models/events/types.js";
import { SpanRequeueCauseSchema } from "../../../src/models/events/types.js";
import { SpanTaskIdSchema } from "../../../src/models/events/types.js";
import { projectNoteForOperator } from "../../../src/models/events/types.js";
import { RequeueCauseSchema } from "../../../src/models/run/record.js";
import { RunOutcomeSchema } from "../../../src/models/run/record.js";
import { TerminalNotRunReasonSchema } from "../../../src/models/run/result.js";
import { ContractFieldPathSchema } from "../../../src/models/task/task-contract.js";
import { CURRENT_DIAGNOSTIC_SAFETY_VERSION } from "../../../src/models/trust/failure.js";
import { BrowserSystemIdSchema } from "../../../src/rules/identity/ids.js";
import { TaskIdSchema } from "../../../src/rules/identity/ids.js";
import { DataClassificationSchema } from "../../../src/rules/redaction/redaction.js";
import { redactValue } from "../../../src/rules/redaction/redaction.js";

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

describe("span wire leaf parity with the domain vocabulary", () => {
  it("pins the leaf's restated enums to their domain owners", () => {
    assert.deepEqual(SpanBrowserSystemSchema.options, BrowserSystemIdSchema.options);
    assert.deepEqual(SpanRequeueCauseSchema.options, RequeueCauseSchema.options);
    assert.deepEqual(SpanOutcomeWireSchema.options, SpanOutcomeSchema.options);

    assert.deepEqual(SpanDataClassificationSchema.options, DataClassificationSchema.options);
    assert.equal(SpanTaskIdSchema.parse("workflow:separations/match-identity"), "workflow:separations/match-identity");
    assert.throws(() => SpanTaskIdSchema.parse("Not/A-Task"));
    assert.throws(() => TaskIdSchema.parse("Not/A-Task"));
    assert.equal(SpanFieldPathSchema.parse("selection.status"), "selection.status");
    assert.throws(() => SpanFieldPathSchema.parse("Selection.Status"));
    assert.throws(() => ContractFieldPathSchema.parse("Selection.Status"));

    assert.deepEqual([...RunOutcomeSchema.options, "skipped"].sort(), [...SpanOutcomeWireSchema.options].sort());
  });

  it("pins ONE not-run vocabulary across the durable result, the span, and the timeline", () => {

    assert.deepEqual(SpanNotRunReasonSchema.options, TerminalNotRunReasonSchema.options);
    assert.deepEqual(ExecutorNotRunReasonSchema.options, TerminalNotRunReasonSchema.options);
    assert.deepEqual(TimelineNotRunReasonSchema.options, TerminalNotRunReasonSchema.options);
  });

  it("carries a not-run reason ONLY on a skipped task span", () => {
    const ended = {
      t: "span.ended", kind: "task", ...BASE, ...RUN_IDENTITY,
      spanPath: `${TRACE}/crm-dates#1`,
    } as const;
    assert.equal(
      SpanEventWireSchema.parse({ ...ended, outcome: "skipped", notRunReason: "condition-false" }).t,
      "span.ended",
    );

    assert.equal(SpanEventWireSchema.parse({ ...ended, outcome: "skipped" }).t, "span.ended");
    assert.throws(() => SpanEventWireSchema.parse({ ...ended, outcome: "done", notRunReason: "condition-false" }));
    assert.throws(() => SpanEventWireSchema.parse({ ...ended, outcome: "skipped", notRunReason: "gave-up" }));
    assert.throws(() => ExecutorSpanEventSchema.parse({
      t: "span.ended", kind: "run", ts: BASE.ts, workflow: BASE.workflow, ...RUN_IDENTITY,
      outcome: "skipped", notRunReason: "condition-false",
    }));
  });
});

describe("the transaction fence beat", () => {
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

  it("round-trips through both strict parity twins", () => {
    ExecutorSpanEventSchema.parse(FENCED);
    SpanEventWireSchema.parse({ ...FENCED, pid: BASE.pid });
  });

  it("refuses a missing task role and a fabricated page-data field", () => {
    assert.throws(() => ExecutorSpanEventSchema.parse({ ...FENCED, taskId: undefined }));
    assert.throws(() => SpanEventWireSchema.parse({ ...FENCED, pid: BASE.pid, points: [] }));
  });
});

describe("the observed-log arm", () => {
  const OBSERVED = {
    t: "data.observed", ts: BASE.ts, workflow: BASE.workflow, ...RUN_IDENTITY,
    spanPath: `${TRACE}/searching#1.1`,
    nodeId: "searching", taskId: "ucpath/search-person-org", observedAt: BASE.ts,
    points: [{ direction: "read", field: "results", values: [
      { key: "results", ...redactValue("sensitive-hr", "count", []) },
    ] }],
  } as const;

  it("round-trips through the kernel union and the wire leaf", () => {
    ExecutorSpanEventSchema.parse(OBSERVED);
    SpanEventWireSchema.parse({ ...OBSERVED, pid: BASE.pid });
  });

  it("refuses an event with no points — an emission describes an observation that happened", () => {
    assert.throws(() => ExecutorSpanEventSchema.parse({ ...OBSERVED, points: [] }));
    assert.throws(() => SpanEventWireSchema.parse({ ...OBSERVED, points: [], pid: BASE.pid }));
  });

  it("refuses a raw value where a redacted one belongs", () => {
    assert.throws(() => SpanEventWireSchema.parse({
      ...OBSERVED, pid: BASE.pid,
      points: [{ direction: "read", field: "results", values: [{ key: "results", value: "Ada Lovelace" }] }],
    }));
  });
});

describe("span wire strictness", () => {
  it("admits only a complete authority-reconstruction marker on a queued root", () => {
    SpanEventWireSchema.parse({
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
    assert.throws(() => SpanEventWireSchema.parse({
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
    assert.throws(() => SpanEventWireSchema.parse({
      ...QUEUED,
      repair: {
        kind: "authority-reconstruction",
        repairedAt: BASE.ts,
        sourceAuthorityGeneration: 0,
        sourceAuthorityFingerprint: HASH,
        priorStreamBytes: 0,
      },
    }));
    assert.throws(() => SpanEventWireSchema.parse({
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

  it("parses the full run.queued identity and refuses unknown keys", () => {
    SpanEventWireSchema.parse(QUEUED);
    assert.throws(() => SpanEventWireSchema.parse({ ...QUEUED, sneaky: true }));
    assert.throws(() => SpanEventWireSchema.parse({ ...QUEUED, resolvedInstance: { intranet: "prod" } }));
  });

  it("refuses a worker span wearing a run id and a run span wearing none", () => {
    assert.throws(() => SpanEventWireSchema.parse({
      t: "span.started", kind: "worker", ...BASE, workerId: "w-1", runId: RUN_ID, spanPath: "worker/x/w-1", name: "x",
    }));
    const { runId: _runId, ...withoutRunId } = QUEUED;
    assert.throws(() => SpanEventWireSchema.parse(withoutRunId));
  });

  it("refuses every span.patched shape — the retired detail channel is not in the union", () => {
    for (const key of ["resolvedName", "selection-status", "runId", "traceId", "contractFingerprint"]) {
      assert.throws(() => SpanEventWireSchema.parse({
        t: "span.patched", ...BASE, ...RUN_IDENTITY, updates: [{ key, value: "x" }],
      }));
    }
    assert.throws(() => SpanEventWireSchema.parse({ t: "span.patched", ...BASE, ...RUN_IDENTITY, updates: [] }));
  });

  it("refuses a malformed gate resolution", () => {
    assert.throws(() => SpanEventWireSchema.parse({
      t: "gate.resolved", ...BASE, ...RUN_IDENTITY, gate: "approval", resolutionKey: "resolved", resultHash: "short",
    }));
    SpanEventWireSchema.parse({
      t: "gate.resolved", ...BASE, ...RUN_IDENTITY, gate: "approval", resolutionKey: "resolved", resultHash: HASH,
    });
  });

  it("parses run- and worker-addressed notes and refuses unknown keys and levels", () => {
    NoteWireSchema.parse({ ...BASE, ...RUN_IDENTITY, level: "step", message: "opened person search" });
    NoteWireSchema.parse({
      ...BASE, workerId: "person-lookup-worker-1", spanPath: "worker/person-lookup/person-lookup-worker-1",
      level: "warn", message: "browser health degraded",
      fields: [{ key: "restarts", kind: "count", value: 2 }],
    });
    assert.throws(() => NoteWireSchema.parse({ ...BASE, ...RUN_IDENTITY, level: "info", message: "x" }));
    assert.throws(() => NoteWireSchema.parse({ ...BASE, ...RUN_IDENTITY, level: "step", message: "x", extra: 1 }));
    assert.throws(() => NoteWireSchema.parse({
      ...BASE, ...RUN_IDENTITY, level: "step", message: "x",
      fields: [{ key: "raw", kind: "map", value: { open: true } }],
    }));
  });
});
}

{

const RAW = "ucpath:termination|10812345|2026-08-29";

describe("diagnostic evidence projection", () => {

  it("serves unstamped and stamped note text", () => {
    const unstamped = NoteWireSchema.parse({
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
    const current = NoteWireSchema.parse({
      ...unstamped,
      diagnosticSafetyVersion: CURRENT_DIAGNOSTIC_SAFETY_VERSION,
      message: "registered source could not be read",
    });
    assert.deepEqual(projectNoteForOperator(unstamped), unstamped);
    assert.deepEqual(projectNoteForOperator(current), current);
  });
});
}
