import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { OPERATOR_JSON_HEADERS, disposeHttpRouteHarness, harness } from "../../../../support/helpers/backend/http-route-harness.js";
import { WorkflowExplorerWireSchema } from "../../../../../src/models/dashboard/explorer.js";
import { READABLE_WORKFLOW_MODULES } from "../../../../../src/backend/app/registries/workflow-registry.js";

afterEach(disposeHttpRouteHarness);

it("serves strict review specs for the public and delegated workflow catalog", async () => {
  const h = await harness();
  const response = await h.app.request("http://localhost/api/v1/explorer");
  assert.equal(response.status, 200);
  const wire = WorkflowExplorerWireSchema.parse(await response.json());
  assert.deepEqual(wire.workflows.map(workflow => workflow.id), READABLE_WORKFLOW_MODULES.map(module => module.descriptor.id));
  for (const workflow of wire.workflows) {
    assert.deepEqual(workflow.reviewSpec.steps.map(step => step.id), workflow.timeline.map(group => group.key));
    assert.equal(workflow.reviewSpec.sessionStep.title, "Open browser sessions");
    assert.equal(workflow.reviewSpec.unlistedFailure, "Anything not listed stops the run with a failure card");
  }
});

it("removes the Explorer validation endpoint", async () => {
  const h = await harness();
  const response = await h.app.request("http://localhost/api/v1/explorer/validate", {
    method: "POST", headers: OPERATOR_JSON_HEADERS, body: JSON.stringify({ workflowId: "fixture-graph" }),
  });
  assert.equal(response.status, 404);
});
