import { default as assert } from "node:assert/strict";
import { describe } from "vitest";
import { it } from "vitest";
import { timelineEventDuration } from "../../../src/models/dashboard/run-detail.js";
import { ContextDataSectionSchema } from "../../../src/models/dashboard/run-detail.js";
import { ObservedLogRowWireSchema } from "../../../src/models/dashboard/run-detail.js";
import { uuidOf } from "../../support/helpers/backend/dashboard-harness.js";
import { RunDetailWireSchema } from "../../../src/models/dashboard/run-detail.js";
import { instantOffsetOf } from "../../support/helpers/backend/dashboard-harness.js";
import { CaptureListSchema } from "../../../src/models/dashboard/run-detail.js";
import { RunDetailSectionResponseSchema } from "../../../src/models/dashboard/run-detail.js";
import { startOperationAuthorityServer } from "../../support/fixtures/dashboard/fixture-operation-authority.js";

{
describe("a timeline event's own measured duration", () => {

  it("reads a FROZEN record with no duration leaf forward, by name", () => {

    const measured = timelineEventDuration({});
    assert.equal(measured.state, "absent");
    assert.match(measured.state === "absent" ? measured.reason : "", /frozen before per-step durations/);
  });
});
}

{
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
}

{
const OMITTED_STEP = "kronos-timecard";

const BASE_DETAIL = {
  runId: uuidOf(1),
  rowRevision: 1,
  panelKind: "run",
  header: {
    runId: uuidOf(1),
    traceId: "pl-000619-4ebf",
    workflowId: "person-lookup",
    actorId: "local-operator",
    title: "EID 10873698",
    status: "done",
    attempt: 1,
  },
  timeline: { events: [] },
  gate: { state: "absent", reason: "this run has no gate" },
  outcome: { state: "terminal", result: "verified-done", completedAt: instantOffsetOf(0, 5_000) },
  context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 },
  availableSections: ["logs"],
} as const;

describe("run detail wire refusals under step omission", () => {
  it("refuses verified-done beside an omitted step", () => {
    assert.throws(
      () => RunDetailWireSchema.parse({ ...BASE_DETAIL, omittedSteps: [OMITTED_STEP] }),
      /a run with an omitted step cannot be verified-done/u,
    );
  });

  it("accepts an omitted step beside a partial outcome", () => {
    const parsed = RunDetailWireSchema.parse({
      ...BASE_DETAIL,
      outcome: { ...BASE_DETAIL.outcome, result: "partial" },
      omittedSteps: [OMITTED_STEP],
    });
    assert.deepEqual(parsed.omittedSteps, [OMITTED_STEP]);
  });

  it("refuses a not-run reason on a member that ran", () => {
    assert.throws(
      () => RunDetailWireSchema.parse({
        ...BASE_DETAIL,
        timeline: {
          events: [],
          steps: [{
            label: "Kronos timecard",
            state: "done",
            members: [{ label: "Timecard", state: "done", notRunReason: "operator-asserted" }],
          }],
        },
      }),
      /a done member cannot carry a not-run reason/u,
    );
  });
});
}

{

describe("run capture authority", () => {

  it("refuses an empty verified capture index rather than projecting a plausible empty receipt", () => {
    assert.equal(CaptureListSchema.safeParse({ runId: uuidOf(301), artifacts: [] }).success, false);
  });
});
}

{
describe("fictional separation run through production authority", () => {
  it("parks before staging when an explicit operator decision is required", async () => {
    const server = await startOperationAuthorityServer("separation-ambiguous");
    try {
      const run = server.database.authority.runs.get(server.runId);
      assert.equal(run?.lifecycle.state, "parked-gate");
      const detail = RunDetailWireSchema.parse(await (await fetch(`${server.baseUrl}/api/v1/runs/${server.runId}`)).json());
      assert.ok(detail.gate.state === "open");
      assert.equal(detail.gate.label, "Resolve conflicting separation dates");
      const response = await fetch(`${server.baseUrl}/api/v1/runs/${server.runId}/logs`);
      const section = RunDetailSectionResponseSchema.parse(await response.json());
      if (section.section !== "logs" || section.payload.operationStructure?.state !== "observed") throw new Error("separation-gate-logs-missing");
      assert.ok(!section.payload.operationStructure.observations.some((item) => item.occurrence.logicalActionId.startsWith("fill-")));
    } finally { await server.close(); }
  });
  it("retains a named reload failure without inventing a confirmed field value", async () => {
    const server = await startOperationAuthorityServer("separation-failed");
    try {
      const lifecycle = server.database.authority.runs.get(server.runId)?.lifecycle;
      assert.ok(lifecycle?.state === "terminal" && lifecycle.outcome === "failed");
      assert.ok(server.database.authority.failures.listByRun(server.runId).some((item) => item.code === "DOCUMENT_READ_TIMEOUT"));
      const response = await fetch(`${server.baseUrl}/api/v1/runs/${server.runId}/logs`);
      const section = RunDetailSectionResponseSchema.parse(await response.json());
      if (section.section !== "logs" || section.payload.operationStructure?.state !== "observed") throw new Error("separation-failure-logs-missing");
      const failed = section.payload.operationStructure.observations.find((item) => item.occurrence.invocationId === "verify-operation" && item.occurrence.state === "failed");
      assert.ok(failed);
      assert.equal(failed.occurrence.value, undefined);
      assert.ok(!section.payload.operationStructure.observations.some((item) => item.occurrence.invocationId === "verify-operation" && item.occurrence.state === "confirmed"));
      const responseFailure = await fetch(`${server.baseUrl}/api/v1/runs/${server.runId}/failure`);
      assert.equal(responseFailure.status, 200);
      const failure = RunDetailSectionResponseSchema.parse(await responseFailure.json());
      assert.equal(failure.section, "failure");
      assert.match(JSON.stringify(failure.payload), /DOCUMENT_READ_TIMEOUT/u);
    } finally { await server.close(); }
  });
});
}
