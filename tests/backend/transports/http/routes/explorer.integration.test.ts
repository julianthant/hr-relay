import { foreignOriginCases } from "../../../../support/helpers/backend/http-route-harness.js";

import assert from "node:assert/strict";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("BFF spine flow (start plan -> kernel -> spans -> projection)", () => {

  const FOREIGN_ORIGIN_CASES = foreignOriginCases();

  it.each(FOREIGN_ORIGIN_CASES)(
    "refuses Explorer validation with %s before its authority is consulted",
    async (_label, headers) => {
      const h = await harness();
      const request = new Request("http://localhost/api/v1/explorer/validate", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ workflowId: "fixture-graph" }),
      });
      const reads = (["json", "text", "arrayBuffer", "blob", "formData"] as const)
        .map((method) => vi.spyOn(request, method));
      const response = await h.app.request(request);
      // 403 rather than the harness's "Explorer authority is not composed"
      // unavailability: admission wins before the handler runs at all.
      assert.equal(response.status, 403);
      assert.equal((await json(response)).code, "OPERATOR_MUTATION_ORIGIN_REFUSED");
      for (const read of reads) expect(read).not.toHaveBeenCalled();
      assert.equal(request.bodyUsed, false);
    },
  );
  it("keeps Explorer validation on the JSON door: text/plain refuses, same-origin JSON reaches the seam", async () => {
    const seen: unknown[] = [];
    const h = await harness({
      explorerEdits: {
        validate: (input) => {
          seen.push(input);
          return { state: "conflict", code: "revision-stale", message: "fixture conflict" } as never;
        },
      },
    });
    const body = JSON.stringify({ workflowId: "fixture-graph" });
    const refused = await h.app.request("http://localhost/api/v1/explorer/validate", {
      method: "POST",
      headers: { ...OPERATOR_JSON_HEADERS, "content-type": "text/plain" },
      body,
    });
    assert.equal(refused.status, 415);
    assert.equal((await json(refused)).code, "OPERATOR_MUTATION_MEDIA_TYPE_REFUSED");
    assert.deepEqual(seen, []);

    const admitted = await h.app.request("http://localhost/api/v1/explorer/validate", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body,
    });
    assert.equal(admitted.status, 409);
    assert.deepEqual(seen, [{ workflowId: "fixture-graph" }]);
  });
});

import { OPERATOR_JSON_HEADERS, disposeHttpRouteHarness, harness, json } from "../../../../support/helpers/backend/http-route-harness.js";
afterEach(disposeHttpRouteHarness);
