
import assert from "node:assert/strict";
import { afterEach,it } from "vitest";
import { ContextDataSectionSchema,ObservedLogRowWireSchema } from "../../../src/models/dashboard/run-detail.js";
import {
uuidOf,
type DashboardWorld
} from "../../support/helpers/backend/dashboard-harness.js";

const worlds: DashboardWorld[] = [];

afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});

it("accepts absent deleted observations and refuses valid populated observations", () => {
  const base = { runId: uuidOf(1), state: "deleted", entries: [] };
  assert.equal(ContextDataSectionSchema.safeParse(base).success, true);
  assert.equal(ContextDataSectionSchema.safeParse({ ...base, observations: [] }).success, true);
  const observation = ObservedLogRowWireSchema.parse({ kind: "observed", logId: uuidOf(2), sequence: 1,
    at: "2026-09-22T17:00:00.000Z", attempt: 1, traceId: "pl-100000-e1b8", spanPath: "pl-100000-e1b8/read#1.1",
    producer: { nodeId: "read", step: "Read document", taskId: "kuali/read-document", system: "kuali" },
    points: [{ direction: "read", field: "documentNumber", values: [{ key: "documentNumber",
      state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "4684" }] }],
  });
  const result = ContextDataSectionSchema.safeParse({ ...base, observations: [observation] });
  assert.equal(result.success, false);
  if (result.success) throw new Error("deleted observations accepted");
  assert.ok(result.error.issues.some(issue => issue.message === "deleted context data cannot claim retained observations"));
});
