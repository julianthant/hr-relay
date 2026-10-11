import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { RunDetailSectionResponseSchema,RunDetailWireSchema } from "../../../src/models/dashboard/run-detail.js";
import { startOperationAuthorityServer } from "../../support/fixtures/dashboard/fixture-operation-authority.js";

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
