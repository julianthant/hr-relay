import assert from "node:assert/strict";
import { afterEach, it, vi } from "vitest";
import { DashboardWorkflowSourceRefusedError } from "../../../../../src/backend/app/composition/dashboard/dashboard-wiring.js";
import { startAdmissionFixture } from "../../../../support/helpers/backend/start-admission-world.js";

const configured = vi.hoisted(() => {
  const sources: Record<string, string> = {}, original: Record<string, string> = {};
  return { sources, original };
});
vi.mock("../../../../../config/dashboard-workflow-sources.json", async importOriginal => {
  const real = await importOriginal<{ default: Record<string, string> }>();
  Object.assign(configured.original, real.default);
  Object.assign(configured.sources, real.default);
  return { default: configured.sources };
});

afterEach(() => {
  for (const id of Object.keys(configured.sources)) Reflect.deleteProperty(configured.sources, id);
  Object.assign(configured.sources, configured.original);
});

for (const value of ["mock", "visible"]) it(`dashboard start refuses a "${value}" workflow source with a named error naming the workflow and the value`, async () => {
  configured.sources.separations = value;
  await assert.rejects(startAdmissionFixture(), (error: unknown) => {
    assert.ok(error instanceof DashboardWorkflowSourceRefusedError);
    assert.equal(error.name, "DashboardWorkflowSourceRefusedError");
    assert.equal(error.workflowId, "separations");
    assert.equal(error.value, value);
    assert.match(error.message, new RegExp(`separations.*"${value}"`, "u"));
    return true;
  });
});
