import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { createDashboardClient,DashboardClientError } from "../../../src/dashboard/client/index.js";

const RUN = "00000000-0000-4000-8000-000000000301";
const FOREIGN = "00000000-0000-4000-8000-000000000302";
const ITEM = "00000000-0000-4000-8000-000000000303";

function available(selectedRunId = RUN) {
  return {
    schemaVersion: 1,
    state: "available",
    selected: {
      state: "present", disposition: "live", runId: selectedRunId,
      workflowId: "person-lookup", itemId: ITEM, attempt: 2, rowRevision: 3,
    },
    item: { workflowId: "person-lookup", itemId: ITEM },
    page: { limit: 25, offset: 0, totalEntries: 1, entries: [
      { disposition: "live", runId: selectedRunId, workflowId: "person-lookup", itemId: ITEM, attempt: 2, rowRevision: 3, partitionDay: "2026-08-03" },
    ], nextCursor: null },
  };
}

function clientReturning(body: unknown) {
  return createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async () => Response.json(body) });
}

describe("same-item attempt history client", () => {
  it("rejects an otherwise valid response selected for a different run", async () => {
    const client = clientReturning(available(FOREIGN));
    await assert.rejects(() => client.itemAttemptHistory(RUN), (error: unknown) => {
      assert.ok(error instanceof DashboardClientError);
      assert.equal(error.kind, "schema");
      assert.equal(error.code, "RUN_ATTEMPT_HISTORY_IDENTITY_MISMATCH");
      assert.match(error.message, new RegExp(RUN, "u"));
      assert.doesNotMatch(error.message, new RegExp(FOREIGN, "u"));
      return true;
    });
  });

  it("rejects a stale/reset result naming another selected run", async () => {
    const client = clientReturning({
      schemaVersion: 1, state: "stale", selectedRunId: FOREIGN, reason: "authority-changed",
    });
    await assert.rejects(() => client.itemAttemptHistory(RUN), (error: unknown) => {
      assert.ok(error instanceof DashboardClientError);
      assert.equal(error.code, "RUN_ATTEMPT_HISTORY_IDENTITY_MISMATCH");
      return true;
    });
  });

  it("binds its page query to the selected run and abort signal", async () => {
    const controller = new AbortController();
    let receivedPath: unknown;
    let receivedSignal: AbortSignal | null | undefined;
    const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (input, init) => {
      receivedPath = input;
      receivedSignal = init?.signal;
      return Response.json(available());
    } });
    const result = await client.itemAttemptHistory(RUN, { limit: 10, cursor: "page+2", signal: controller.signal });
    assert.equal(result.state, "available");
    assert.equal(receivedSignal, controller.signal);
    assert.equal(String(receivedPath), `http://fixture.test/api/v1/runs/${RUN}/attempt-history?limit=10&cursor=page%2B2`);
  });
});
