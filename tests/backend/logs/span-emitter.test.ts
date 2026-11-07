
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { ObservedDataPointSchema } from "../../../src/backend/logs/span-emitter.js";
import {
redactValue
} from "../../../src/rules/redaction/redaction.js";

const RUN_ID = "3b8f0a1e-2c4d-4e6f-8a9b-0c1d2e3f4a5b";
const TRACE = "pl-104233-3b8f";
const BASE = { ts: "2026-08-03T10:42:33.000-07:00", workflow: "person-lookup", pid: 4242 } as const;
const RUN_IDENTITY = { runId: RUN_ID, attempt: 1, traceId: TRACE, spanPath: TRACE } as const;

describe("the observed-log arm", () => {
  const _OBSERVED = {
    t: "data.observed", ts: BASE.ts, workflow: BASE.workflow, ...RUN_IDENTITY,
    spanPath: `${TRACE}/searching#1.1`,
    nodeId: "searching", taskId: "ucpath/search-person-org", observedAt: BASE.ts,
    points: [{ direction: "read", field: "results", values: [
      { key: "results", ...redactValue("sensitive-hr", "count", []) },
    ] }],
  } as const;

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
