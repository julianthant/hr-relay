import assert_m0 from "node:assert/strict";
import { describe as describe_m0,it as it_m0 } from "vitest";
import { sanitizeDebugText as sanitizeDebugText_m0 } from "../../../src/rules/redaction/redaction.js";

import { default as assert_m1,default as assert_m2 } from "node:assert/strict";
import { describe as describe_m1,describe as describe_m2,it as it_m1,it as it_m2 } from "vitest";
import {
ExecutorSpanEventSchema as ExecutorSpanEventSchema_m1,
ObservedDataPointSchema as ObservedDataPointSchema_m1
} from "../../../src/backend/logs/span-emitter.js";
import {
SpanEventWireSchema as SpanEventWireSchema_m1
} from "../../../src/models/events/types.js";
import { NotificationTriggerEventSchema as NotificationTriggerEventSchema_m2 } from "../../../src/rules/notifications/notification-triggers.js";
import {
DataClassificationSchema as DataClassificationSchema_m1,
DataClassificationSchema as DataClassificationSchema_m2,
EvidenceTransformSchema as EvidenceTransformSchema_m1,
RedactedValueSchema as RedactedValueSchema_m2,directIdentifierDisplay as directIdentifierDisplay_m2,
evidenceTransformAllowed as evidenceTransformAllowed_m1,
redactDiagnosticFields as redactDiagnosticFields_m2,
redactValue as redactValue_m1,
redactValue as redactValue_m2,
retainLocalEvidenceValue as retainLocalEvidenceValue_m2
} from "../../../src/rules/redaction/redaction.js";


{

describe_m0("bounded native debug events", () => {
  it_m0("preserves paths and HR text while removing private key/authorization material", () => {
    const safe = sanitizeDebugText_m0("at /local/run.ts:3 employee Ada -----BEGIN PRIVATE KEY-----\nCANARY\n-----END PRIVATE KEY----- Basic CANARY");
    assert_m0.ok(safe.includes("/local/run.ts:3 employee Ada")); assert_m0.ok(!safe.includes("CANARY"));
  });
});
}

{


const RUN_ID = "3b8f0a1e-2c4d-4e6f-8a9b-0c1d2e3f4a5b";
const TRACE = "pl-104233-3b8f";
const BASE = { ts: "2026-08-03T10:42:33.000-07:00", workflow: "person-lookup", pid: 4242 } as const;
const RUN_IDENTITY = { runId: RUN_ID, attempt: 1, traceId: TRACE, spanPath: TRACE } as const;



const REDACTED_VALUES = DataClassificationSchema_m1.options.flatMap((classification) =>
  EvidenceTransformSchema_m1.options
    .filter((transform) => evidenceTransformAllowed_m1(classification, transform))
    .map((transform) => ({
      key: "observed",
      ...redactValue_m1(classification, transform, "10456712"),
    })));

describe_m1("span wire leaf parity with the domain vocabulary", () => {

  it_m1("accepts every executor span event once the writer stamps pid", () => {
    const executorEvents = [
      { t: "run.claimed", ts: BASE.ts, workflow: BASE.workflow, ...RUN_IDENTITY, workerId: "person-lookup-worker-1" },
      { t: "run.requeued", ts: BASE.ts, workflow: BASE.workflow, ...RUN_IDENTITY, cause: "recovery", nextAttempt: 2 },
      { t: "span.started", kind: "task", ts: BASE.ts, workflow: BASE.workflow, ...RUN_IDENTITY, spanPath: `${TRACE}/searching#1`, parentSpanPath: TRACE, name: "searching", system: "ucpath" },
      { t: "span.ended", kind: "task", ts: BASE.ts, workflow: BASE.workflow, ...RUN_IDENTITY, spanPath: `${TRACE}/searching#1`, outcome: "done" },
      { t: "span.ended", kind: "run", ts: BASE.ts, workflow: BASE.workflow, ...RUN_IDENTITY, outcome: "done" },
      { t: "gate.opened", ts: BASE.ts, workflow: BASE.workflow, ...RUN_IDENTITY, gate: "approval" },
      { t: "span.started", kind: "worker", ts: BASE.ts, workflow: BASE.workflow, workerId: "person-lookup-worker-1", spanPath: "worker/person-lookup/person-lookup-worker-1", name: "person-lookup" },
      { t: "span.ended", kind: "browser", ts: BASE.ts, workflow: BASE.workflow, workerId: "person-lookup-worker-1", spanPath: "worker/person-lookup/person-lookup-worker-1/browser:ucpath#" + RUN_ID, outcome: "failed", errorSummary: "browser session closed as poisoned" },

      ...(["match", "mismatch", "unscoped", "not-observed"] as const).map((subject) => ({
        t: "transaction.previewed", ts: BASE.ts, workflow: BASE.workflow, ...RUN_IDENTITY,
        node: "clear-pending", subject, externalCommit: "none",
      })),
      {
        t: "transaction.fenced", ts: BASE.ts, workflow: BASE.workflow, ...RUN_IDENTITY,
        spanPath: `${TRACE}/clear-pending/commit`, parentSpanPath: TRACE,
        node: "clear-pending", taskId: "ucpath/delete-pending-terminations",
      },

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
              { key: "selection.status", ...redactValue_m1("safe-diagnostic", "allow", "resolved") },
              { key: "selection.eid", ...redactValue_m1("direct-identifier", "last4", "10456712") },
            ],
          },
        ],
      })),
    ];
    for (const event of executorEvents) {
      ExecutorSpanEventSchema_m1.parse(event);
      SpanEventWireSchema_m1.parse({ ...event, pid: BASE.pid });
    }
  });
});

describe_m1("the observed-log arm", () => {
  const OBSERVED = {
    t: "data.observed", ts: BASE.ts, workflow: BASE.workflow, ...RUN_IDENTITY,
    spanPath: `${TRACE}/searching#1.1`,
    nodeId: "searching", taskId: "ucpath/search-person-org", observedAt: BASE.ts,
    points: [{ direction: "read", field: "results", values: [
      { key: "results", ...redactValue_m1("sensitive-hr", "count", []) },
    ] }],
  } as const;

  it_m1("refuses a point with no values, and a point carrying a system", () => {
    assert_m1.throws(() => ObservedDataPointSchema_m1.parse({ direction: "read", field: "results", values: [] }));
    assert_m1.throws(() => ObservedDataPointSchema_m1.parse({
      direction: "read", field: "results", system: "ucpath",
      values: [{ key: "results", ...redactValue_m1("sensitive-hr", "count", []) }],
    }));
    assert_m1.throws(() => SpanEventWireSchema_m1.parse({
      ...OBSERVED, pid: BASE.pid,
      points: [{ ...OBSERVED.points[0], system: "ucpath" }],
    }));
  });
});
}

{


describe_m2("local evidence and external disclosure boundaries", () => {
  it_m2.each(DataClassificationSchema_m2.options)("retains complete supplied %s values locally", classification => {
    const value = { text: "SYNTHETIC_COMPLETE_VALUE", nested: ["SYNTHETIC_ID", 17] };
    const transform = classification === "safe-diagnostic" ? "count" : "drop";
    const expected = { state: "allowed", classification, transform: "allow", value };
    assert_m2.deepEqual(RedactedValueSchema_m2.parse(retainLocalEvidenceValue_m2(classification, transform, value)), expected);
    assert_m2.deepEqual(redactDiagnosticFields_m2([{ key: "captured", classification, transform, value }]), {
      fields: [{ key: "captured", ...expected }], warnings: [],
    });
  });

  it_m2("keeps provider transforms closed and refuses complete local fields at provider admission", () => {
    for (const classification of ["secret", "credential-file", "direct-identifier", "sensitive-hr"] as const) {
      assert_m2.deepEqual(redactValue_m2(classification, "drop", "SYNTHETIC_PRIVATE_VALUE"), {
        state: "redacted", classification, transform: "drop",
      });
      assert_m2.throws(() => redactValue_m2(classification, "allow", "SYNTHETIC_PRIVATE_VALUE"), /forbidden/u);
    }

  });

  it_m2("does not add a captured-value channel to OS notifications", () => {
    const event = { kind: "storage-degraded", concern: "disk-space", state: "degraded", diagnosticFingerprint: "a".repeat(64) };
    assert_m2.equal(NotificationTriggerEventSchema_m2.safeParse(event).success, true);
    assert_m2.equal(NotificationTriggerEventSchema_m2.safeParse({ ...event, message: "SYNTHETIC_PRIVATE_VALUE" }).success, false);
    assert_m2.equal(directIdentifierDisplay_m2("SYNTHETIC_ID"), "SYNTHETIC_ID");
  });
});
}


it_m0("masks raw and formatted SSNs in error and nested-cause text", () => {
  for (const value of ["902481357", "902-48-1357", "902 48 1357"]) {
    const safe = sanitizeDebugText_m0(`failure: ${value}; cause: ${value}`);
    assert_m0.equal(safe.includes(value), false);
    assert_m0.equal(safe.includes("1357"), false);
  }
});
