import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { OPERATOR_JSON_HEADERS, disposeHttpRouteHarness, harness } from "../../../../support/helpers/backend/http-route-harness.js";

afterEach(disposeHttpRouteHarness);

it("removes the Explorer validation endpoint", async () => {
  const h = await harness();
  const response = await h.app.request("http://localhost/api/v1/explorer/validate", {
    method: "POST", headers: OPERATOR_JSON_HEADERS, body: JSON.stringify({ workflowId: "fixture-graph" }),
  });
  assert.equal(response.status, 404);
});
