import assert from "node:assert/strict";
import { Hono } from "hono";
import { it, vi } from "vitest";
import { composeExplorer } from "../../../../../src/backend/app/composition/dashboard/explorer.js";
import { READABLE_WORKFLOW_MODULES, descriptorSetHash } from "../../../../../src/backend/app/registries/workflow-registry.js";
import * as reviewSpec from "../../../../../src/backend/runs/queries/explorer-review-spec.js";
import type { DashboardApp } from "../../../../../src/backend/transports/http/routes/api-types.js";
import { registerExplorerRoutes } from "../../../../../src/backend/transports/http/routes/explorer.js";
import { WorkflowExplorerWireSchema } from "../../../../../src/models/dashboard/explorer.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { compileWorkflow, composeWorkflowModule } from "../../../../../src/workflow-kit/workflow-definition.js";
import { personLookupWorkflow } from "../../../../../src/workflows/person-lookup/workflow.js";

const hash = descriptorSetHash(READABLE_WORKFLOW_MODULES.map(module => module.descriptor.contractFingerprint));
const clockAtStart = () => manualClock(new Date("2026-08-09T12:00:00.000Z"));

it("refuses a read page without a row example during Explorer registration", () => {
  const definition = { ...personLookupWorkflow, steps: personLookupWorkflow.steps.map(([group, entries]) => [
    group.review === undefined ? group : { ...group, review: { ...group.review,
      pages: group.review.pages.map(page => ({ ...page, mode: "Read only" as const, fields: page.fields.map(field =>
        "inputField" in field && field.id === "search-name" ? { ...field, example: undefined } : field) })),
    } }, entries,
  ] as const) };
  const original = READABLE_WORKFLOW_MODULES.find(module => module.descriptor.id === "person-lookup");
  assert.ok(original);
  const invalid = composeWorkflowModule(compileWorkflow(definition), original.stores);
  const modules = READABLE_WORKFLOW_MODULES.map(module => module === original ? invalid : module);
  assert.throws(() => composeExplorer({ clock: clockAtStart(), descriptorSetHash: hash }, modules),
    /workflow person-lookup Explorer registration failed: .*review field search-name on read page \S+ has no example value/u);
});

it("serves one build document across Explorer registrations and sends no body for its ETag", async () => {
  const clock = clockAtStart();
  const build = vi.spyOn(reviewSpec, "buildExplorerReviewSpec");
  try {
    const app: DashboardApp = new Hono();
    registerExplorerRoutes(app, composeExplorer({ clock, descriptorSetHash: hash }));
    assert.equal(build.mock.calls.length, READABLE_WORKFLOW_MODULES.length);
    const first = await app.request("/api/v1/explorer");
    assert.equal(first.status, 200);
    const body = await first.text();
    const wire = WorkflowExplorerWireSchema.parse(JSON.parse(body));
    const tag = first.headers.get("ETag");
    assert.ok(tag?.startsWith(`"${wire.buildId}-`));
    assert.equal(wire.descriptorHash, hash);
    assert.equal(wire.generatedAt, clock.now().toISOString());
    clock.advanceWall(1000);

    const nextApp: DashboardApp = new Hono();
    registerExplorerRoutes(nextApp, composeExplorer({ clock, descriptorSetHash: hash }));
    const cached = await nextApp.request("/api/v1/explorer", { headers: { "If-None-Match": `"different", W/${tag}` } });
    assert.equal(cached.status, 304);
    assert.equal(cached.headers.get("ETag"), tag);
    assert.equal(cached.headers.get("Cache-Control"), "private, no-cache");
    assert.equal(await cached.text(), "");
    const second = await nextApp.request("/api/v1/explorer", { headers: { "If-None-Match": '"different"' } });
    assert.equal(second.status, 200);
    assert.equal(second.headers.get("ETag"), tag);
    assert.equal(await second.text(), body);
    assert.equal(build.mock.calls.length, READABLE_WORKFLOW_MODULES.length);
  } finally { build.mockRestore(); }
});
