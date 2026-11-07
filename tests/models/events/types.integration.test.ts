
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { SpanEventWireSchema } from "../../../src/models/events/types.js";

const RUN_ID = "3b8f0a1e-2c4d-4e6f-8a9b-0c1d2e3f4a5b";
const TRACE = "pl-104233-3b8f";
const AT = new Date("2026-08-03T10:42:33.000-07:00");
const CLASSIFICATIONS = [
  "secret", "credential-file", "direct-identifier", "sensitive-hr", "safe-diagnostic",
] as const;
const TRANSFORMS = ["drop", "digest", "last4", "basename", "count", "allow"] as const;
type Classification = typeof CLASSIFICATIONS[number];
type Transform = typeof TRANSFORMS[number];

const EXPECTED_ALLOWED_TRANSFORMS = {
  secret: new Set<Transform>(["drop", "digest", "allow"]),
  "credential-file": new Set<Transform>(["drop", "digest", "allow"]),
  "direct-identifier": new Set<Transform>(["drop", "digest", "last4", "allow"]),
  "sensitive-hr": new Set<Transform>(["drop", "digest", "count", "allow"]),
  "safe-diagnostic": new Set<Transform>(["allow", "count", "basename"]),
} satisfies Record<Classification, ReadonlySet<Transform>>;

function redactedPairValue(classification: Classification, transform: Transform): Record<string, unknown> {
  const base = { key: "selection.value", classification, transform };
  switch (transform) {
    case "drop": return { ...base, state: "redacted" };
    case "digest": return { ...base, state: "transformed", value: "a".repeat(64) };
    case "last4": return { ...base, state: "transformed", value: "cret" };
    case "basename": return {
      ...base,
      state: "transformed",
      value: classification === "safe-diagnostic" ? "report.txt" : "RAW_SECRET_CANARY.txt",
    };
    case "count": return { ...base, state: "transformed", value: 7 };
    case "allow": return {
      ...base,
      state: "allowed",
      value: classification === "safe-diagnostic" ? "healthy" : "RAW_SECRET_CANARY",
    };
  }
}

function observedPairEvent(value: Record<string, unknown>): Record<string, unknown> {
  return {
    t: "data.observed", ts: AT.toISOString(), workflow: "person-lookup",
    runId: RUN_ID, attempt: 1, traceId: TRACE, spanPath: `${TRACE}/searching#1.1`, parentSpanPath: TRACE,
    nodeId: "searching", taskId: "ucpath/search-person-org", observedAt: AT.toISOString(),
    points: [{ direction: "read", field: "selection.value", values: [value] }],
  };
}

describe("native span writer", () => {

  it("the observed-event wire twin accepts exactly the canonical redaction pairs", () => {
    for (const classification of CLASSIFICATIONS) for (const transform of TRANSFORMS) {
      const pair = `${classification}/${transform}`;
      const event = observedPairEvent(redactedPairValue(classification, transform));
      const expectedAllowed = EXPECTED_ALLOWED_TRANSFORMS[classification].has(transform);

      assert.equal(SpanEventWireSchema.safeParse({ ...event, pid: 1 }).success, expectedAllowed, pair);
    }
  });
});
