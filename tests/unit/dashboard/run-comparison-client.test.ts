import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { RunReceiptComparisonTargetSchema } from "../../../src/domain/dashboard/run-comparison.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const PRIOR_RUN_ID = "22222222-2222-4222-8222-222222222222";
const WIRE = {
  wireVersion: 1,
  runId: RUN_ID,
  retryOf: PRIOR_RUN_ID,
  workflowId: "separations",
  currentReceiptId: "33333333-3333-4333-8333-333333333333",
  priorReceiptId: "44444444-4444-4444-8444-444444444444",
  facts: [{
    state: "changed",
    factId: "separations.action.document-number",
    label: "Document number",
    before: "4502",
    after: "4537",
  }],
} as const;
const TARGET = RunReceiptComparisonTargetSchema.parse({
  runId: WIRE.runId,
  retryOf: WIRE.retryOf,
  workflowId: WIRE.workflowId,
  currentReceiptId: WIRE.currentReceiptId,
});

describe("run receipt comparison client", () => {
  it("accepts a server-derived prior receipt only when the selected four-field target matches", async () => {
    const requests: string[] = [];
    const client = createDashboardClient({
      baseUrl: "http://bff.test",
      fetchImpl: (input) => {
        requests.push(input);
        return Promise.resolve(Response.json(WIRE));
      },
    });

    const comparison = await client.runReceiptComparison(TARGET);

    assert.deepEqual(comparison, WIRE);
    assert.equal("priorReceiptId" in TARGET, false);
    assert.deepEqual(requests, [`http://bff.test/api/v1/runs/${RUN_ID}/comparison`]);
  });

  it("rejects a schema-valid response with a foreign selected retry, workflow, or current receipt", async () => {
    const cases = [
      {
        label: "retry",
        response: { ...WIRE, retryOf: "66666666-6666-4666-8666-666666666666" },
      },
      { label: "workflow", response: { ...WIRE, workflowId: "person-lookup" } },
      {
        label: "current receipt",
        response: { ...WIRE, currentReceiptId: "55555555-5555-4555-8555-555555555555" },
      },
    ] as const;

    for (const testCase of cases) {
      const client = createDashboardClient({
        baseUrl: "http://bff.test",
        fetchImpl: () => Promise.resolve(Response.json(testCase.response)),
      });

      await assert.rejects(
        client.runReceiptComparison(TARGET),
        (error: unknown) => error instanceof Error
          && "code" in error
          && error.code === "RUN_COMPARISON_IDENTITY_MISMATCH",
        testCase.label,
      );
    }
  });

  it("refuses a schema-valid comparison for a foreign run id", async () => {
    const client = createDashboardClient({
      baseUrl: "http://bff.test",
      fetchImpl: () => Promise.resolve(Response.json({
        ...WIRE,
        runId: "55555555-5555-4555-8555-555555555555",
      })),
    });

    await assert.rejects(
      client.runReceiptComparison(TARGET),
      (error: unknown) => error instanceof Error
        && "code" in error
        && error.code === "RUN_COMPARISON_IDENTITY_MISMATCH",
    );
  });

  it("refuses a malformed or expanded selected tuple before transport", async () => {
    let requestCount = 0;
    const client = createDashboardClient({
      baseUrl: "http://bff.test",
      fetchImpl: () => {
        requestCount += 1;
        return Promise.resolve(Response.json(WIRE));
      },
    });

    await assert.rejects(client.runReceiptComparison({ ...TARGET, currentReceiptId: "latest" } as never));
    await assert.rejects(client.runReceiptComparison({ ...TARGET, priorReceiptId: WIRE.priorReceiptId } as never));
    assert.equal(requestCount, 0);
  });
});
