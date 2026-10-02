/**
 * The span/notes wire leaf (ref dashboard-surfaces §1.1).
 *
 * `src/domain/events/types.ts` restates its id patterns locally so it can stay a
 * zod-only leaf; the parity cases here pin that restatement against the domain
 * vocabulary byte-for-byte, so the two can never quietly fork. The rest is
 * boundary strictness: unknown keys, identity keys on patches, and executor
 * event compatibility.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  ExecutorSpanEventSchema,
  SpanNotRunReasonSchema as ExecutorNotRunReasonSchema,
  SpanOutcomeSchema,
} from "../../../../src/backend/logs/span-emitter.js";
import { ObservedDataPointSchema } from "../../../../src/backend/logs/span-emitter.js";
import { ContractFieldPathSchema } from "../../../../src/domain/contracts/base.js";
import { TimelineNotRunReasonSchema } from "../../../../src/domain/dashboard/run-detail.js";
import {
  DataClassificationSchema,
  EvidenceTransformSchema,
  evidenceTransformAllowed,
  redactValue,
} from "../../../../src/domain/redaction.js";
import { TerminalNotRunReasonSchema } from "../../../../src/domain/run/result.js";
import { BrowserSystemIdSchema, TaskIdSchema } from "../../../../src/domain/ids.js";
import { RequeueCauseSchema, RunOutcomeSchema } from "../../../../src/domain/run/record.js";
import {
  NoteWireSchema,
  SpanBrowserSystemSchema,
  SpanDataClassificationSchema,
  SpanFieldPathSchema,
  SpanTaskIdSchema,
  SpanEventWireSchema,
  SpanNotRunReasonSchema,
  SpanOutcomeWireSchema,
  SpanRequeueCauseSchema,
} from "../../../../src/domain/events/types.js";

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


/**
 * Every legal `(classification, transform)` pair, produced through the ONE
 * shared transform implementation. D215's lesson is that a parity claim is only
 * as wide as its cases, so the `data.observed` arm is walked over the PRODUCT
 * of the redaction table rather than over a sampled shape: an arm the kernel
 * can emit and the wire leaf cannot parse is exactly the fork that killed a
 * live worker once already.
 */
const REDACTED_VALUES = DataClassificationSchema.options.flatMap((classification) =>
  EvidenceTransformSchema.options
    .filter((transform) => evidenceTransformAllowed(classification, transform))
    .map((transform) => ({
      key: "observed",
      ...redactValue(classification, transform, "10456712"),
    })));

describe("span wire leaf parity with the domain vocabulary", () => {
  it("pins the leaf's restated enums to their domain owners", () => {
    assert.deepEqual(SpanBrowserSystemSchema.options, BrowserSystemIdSchema.options);
    assert.deepEqual(SpanRequeueCauseSchema.options, RequeueCauseSchema.options);
    assert.deepEqual(SpanOutcomeWireSchema.options, SpanOutcomeSchema.options);
    // D270 — the observed-point leaf restates three more domain vocabularies.
    assert.deepEqual(SpanDataClassificationSchema.options, DataClassificationSchema.options);
    assert.equal(SpanTaskIdSchema.parse("workflow:separations/match-identity"), "workflow:separations/match-identity");
    assert.throws(() => SpanTaskIdSchema.parse("Not/A-Task"));
    assert.throws(() => TaskIdSchema.parse("Not/A-Task"));
    assert.equal(SpanFieldPathSchema.parse("selection.status"), "selection.status");
    assert.throws(() => SpanFieldPathSchema.parse("Selection.Status"));
    assert.throws(() => ContractFieldPathSchema.parse("Selection.Status"));
    // The run-outcome union is the wire union minus the task-only `skipped`.
    assert.deepEqual([...RunOutcomeSchema.options, "skipped"].sort(), [...SpanOutcomeWireSchema.options].sort());
  });

  it("pins ONE not-run vocabulary across the durable result, the span, and the timeline (D123)", () => {
    // A skip is one fact. If the durable result said `condition-false` and a
    // surface could say something else, the two would disagree about the same
    // node — which is exactly the class of defect this arm exists to stop.
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
    // Absence is legal and means "no reason was recorded"; it is never
    // back-filled downstream.
    assert.equal(SpanEventWireSchema.parse({ ...ended, outcome: "skipped" }).t, "span.ended");
    assert.throws(() => SpanEventWireSchema.parse({ ...ended, outcome: "done", notRunReason: "condition-false" }));
    assert.throws(() => SpanEventWireSchema.parse({ ...ended, outcome: "skipped", notRunReason: "gave-up" }));
    assert.throws(() => ExecutorSpanEventSchema.parse({
      t: "span.ended", kind: "run", ts: BASE.ts, workflow: BASE.workflow, ...RUN_IDENTITY,
      outcome: "skipped", notRunReason: "condition-false",
    }));
  });

  it("accepts every executor span event once the writer stamps pid", () => {
    const executorEvents = [
      { t: "run.claimed", ts: BASE.ts, workflow: BASE.workflow, ...RUN_IDENTITY, workerId: "person-lookup-worker-1" },
      { t: "run.requeued", ts: BASE.ts, workflow: BASE.workflow, ...RUN_IDENTITY, cause: "recovery", nextAttempt: 2 },
      { t: "span.started", kind: "task", ts: BASE.ts, workflow: BASE.workflow, ...RUN_IDENTITY, spanPath: `${TRACE}/searching#1`, parentSpanPath: TRACE, name: "searching", system: "ucpath" },
      { t: "span.ended", kind: "task", ts: BASE.ts, workflow: BASE.workflow, ...RUN_IDENTITY, spanPath: `${TRACE}/searching#1`, outcome: "done" },
      { t: "span.ended", kind: "run", ts: BASE.ts, workflow: BASE.workflow, ...RUN_IDENTITY, outcome: "done" },
      { t: "gate.opened", ts: BASE.ts, workflow: BASE.workflow, ...RUN_IDENTITY, gate: "approval" },
      { t: "span.started", kind: "worker", ts: BASE.ts, workflow: BASE.workflow, workerId: "person-lookup-worker-1", spanPath: "worker/person-lookup/person-lookup-worker-1", name: "person-lookup" },
      { t: "span.ended", kind: "browser", ts: BASE.ts, workflow: BASE.workflow, workerId: "person-lookup-worker-1", spanPath: "worker/person-lookup/person-lookup-worker-1/browser:ucpath#" + RUN_ID, outcome: "failed", errorSummary: "browser session closed as poisoned" },
      // `transaction.previewed` had NO case here, and that is how D215's fourth
      // subject verdict reached the kernel's union without reaching this wire
      // leaf: the first preview that ever settled live threw inside the JSONL
      // writer. Every verdict the kernel can emit is walked, so the pair the
      // file header promises cannot fork on this arm again.
      ...(["match", "mismatch", "unscoped", "not-observed"] as const).map((subject) => ({
        t: "transaction.previewed", ts: BASE.ts, workflow: BASE.workflow, ...RUN_IDENTITY,
        node: "clear-pending", subject, externalCommit: "none",
      })),
      {
        t: "transaction.fenced", ts: BASE.ts, workflow: BASE.workflow, ...RUN_IDENTITY,
        spanPath: `${TRACE}/clear-pending/commit`, parentSpanPath: TRACE,
        node: "clear-pending", taskId: "ucpath/delete-pending-terminations",
      },
      /*
       * D270 — the observed-log arm, walked over every DIRECTION and every
       * legal `(classification, transform)` pair, plus a point whose value is a
       * populated object (many leaves under one recorded field).
       */
      ...(["read", "write"] as const).map((direction) => ({
        t: "data.observed", ts: BASE.ts, workflow: BASE.workflow, ...RUN_IDENTITY,
        spanPath: `${TRACE}/searching#1.1`, parentSpanPath: TRACE,
        nodeId: "searching", taskId: "ucpath/search-person-org",
        observedAt: BASE.ts,
        points: [
          { direction, field: "results", values: REDACTED_VALUES },
          {
            direction,
            field: "selection",
            values: [
              { key: "selection.status", ...redactValue("safe-diagnostic", "allow", "resolved") },
              { key: "selection.eid", ...redactValue("direct-identifier", "last4", "10456712") },
            ],
          },
        ],
      })),
    ];
    for (const event of executorEvents) {
      ExecutorSpanEventSchema.parse(event);
      SpanEventWireSchema.parse({ ...event, pid: BASE.pid });
    }
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

describe("the observed-log arm (D270)", () => {
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

  it("refuses a point with no values, and a point carrying a system (D106/D252)", () => {
    assert.throws(() => ObservedDataPointSchema.parse({ direction: "read", field: "results", values: [] }));
    assert.throws(() => ObservedDataPointSchema.parse({
      direction: "read", field: "results", system: "ucpath",
      values: [{ key: "results", ...redactValue("sensitive-hr", "count", []) }],
    }));
    assert.throws(() => SpanEventWireSchema.parse({
      ...OBSERVED, pid: BASE.pid,
      points: [{ ...OBSERVED.points[0], system: "ucpath" }],
    }));
  });

  it("refuses a raw value where a redacted one belongs", () => {
    assert.throws(() => SpanEventWireSchema.parse({
      ...OBSERVED, pid: BASE.pid,
      points: [{ direction: "read", field: "results", values: [{ key: "results", value: "Ada Lovelace" }] }],
    }));
  });

  it("refuses malformed last4 and digest outputs in the kernel schema twin", () => {
    for (const value of [
      { key: "selection.eid", state: "transformed", classification: "direct-identifier", transform: "last4", value: "10456712" },
      { key: "selection.eid", state: "transformed", classification: "direct-identifier", transform: "digest", value: "10456712" },
    ]) {
      assert.throws(() => ObservedDataPointSchema.parse({
        direction: "read",
        field: "selection.eid",
        values: [value],
      }));
    }
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

  /**
   * D254 — `span.patched` is RETIRED, so the wire owes a NEGATIVE control: the
   * arm nothing ever emitted must now be refused by name rather than silently
   * re-admitted by a future edit. Both shapes the old arm accepted (a declared
   * detail key, an identity key it always refused) are refused identically,
   * because there is no longer an arm to distinguish them.
   */
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
