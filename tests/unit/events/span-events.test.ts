/**
 * The span/notes wire leaf (doc 03 §1.1).
 *
 * `src/events/types.ts` restates its id patterns locally so it can stay a
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
} from "../../../src/core/span-emitter.js";
import { TimelineNotRunReasonSchema } from "../../../src/domain/dashboard/run-detail.js";
import { TerminalNotRunReasonSchema } from "../../../src/domain/run/result.js";
import { BrowserSystemIdSchema } from "../../../src/domain/ids.js";
import { RequeueCauseSchema, RunOutcomeSchema } from "../../../src/domain/run/record.js";
import {
  NoteWireSchema,
  SPAN_IDENTITY_ATTRIBUTE_KEYS,
  SpanBrowserSystemSchema,
  SpanEventWireSchema,
  SpanNotRunReasonSchema,
  SpanOutcomeWireSchema,
  SpanRequeueCauseSchema,
} from "../../../src/events/types.js";

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
    ];
    for (const event of executorEvents) {
      ExecutorSpanEventSchema.parse(event);
      SpanEventWireSchema.parse({ ...event, pid: BASE.pid });
    }
  });
});

describe("span wire strictness", () => {
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

  it("refuses a span.patched update that names an identity attribute", () => {
    for (const key of ["runId", "traceId", "shape", "dryRun", "contractFingerprint"]) {
      assert.equal(SPAN_IDENTITY_ATTRIBUTE_KEYS.has(key), true);
      assert.throws(() => SpanEventWireSchema.parse({
        t: "span.patched", ...BASE, ...RUN_IDENTITY, updates: [{ key, value: "clobbered" }],
      }), new RegExp("write-once|Invalid"));
    }
    SpanEventWireSchema.parse({
      t: "span.patched", ...BASE, ...RUN_IDENTITY, updates: [{ key: "resolvedName", value: "Ada Lovelace" }],
    });
  });

  it("refuses an empty patch and a malformed gate resolution", () => {
    assert.throws(() => SpanEventWireSchema.parse({ t: "span.patched", ...BASE, ...RUN_IDENTITY, updates: [] }));
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
