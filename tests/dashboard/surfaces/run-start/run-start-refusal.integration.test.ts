// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterAll, afterEach, it, vi } from "vitest";
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";
import { createPreflightAdmission } from "../../../../src/rules/preflight/preflight-admission.js";
import { requiredPreflightChecks } from "../../../../src/models/preflight/preflight.js";
import { PREFLIGHT_CHECKS } from "../../../../src/models/runtime/runtime-dependencies.js";
import { createTimeoutDeadlineScheduler } from "../../../../src/backend/runtime/scheduling/timeout-deadline-scheduler.js";
import { StartCommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { ERROR_CATALOG } from "../../../../src/models/failures/error-catalog.js";
import { act } from "react";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { createMountedRerunWorld } from "../../../support/helpers/dashboard/mounted-rerun-world.js";

const profiles = createProfileFixtureSet();
afterAll(() => profiles.close());
const { setup, mount, cleanup, press, checkbox, button, fill, text } = createMountedRerunWorld(profiles.create);
afterEach(async () => { vi.restoreAllMocks(); await cleanup(); });

for (const rerun of [false, true]) {
  async function review(h: Awaited<ReturnType<typeof setup>>, client: DashboardClient = h.client) {
    const replaceBinding = await mount(h, rerun ? await h.completeSource() : undefined, client);
    if (rerun) { await press("Continue"); await press("Confirm"); await press("Continue"); }
    else { const box = document.querySelector("textarea"); assert.ok(box); await fill(box, "10812345"); await press("Continue"); }
    await act(async () => checkbox("Dry run").click()); await press("Continue");
    return replaceBinding;
  }
  it(`${rerun ? "Rerun" : "Run"} re-previews an expired plan and requires another Start`, async () => {
    const h = await setup(); await review(h);
    h.clock.advanceWall(600_000); h.clock.advanceMonotonic(600_000);
    await press("Start dry run");
    assert.ok(text().includes("This plan expired, so it was checked again. Review it and press Start again."));
    assert.equal(document.querySelector('[role="dialog"]') !== null, true);
    assert.equal(text().includes("Run not started"), false);
    assert.equal(h.submissions.length, 2);
    assert.deepEqual(h.submissions[1], h.submissions[0]);
    assert.equal(h.finalCommands.length, 1);
    assert.equal(window.sessionStorage.length, 0);
    await press("Start dry run");
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(h.finalCommands.length, 2);
    assert.equal(h.queueRoots.length, rerun ? 2 : 1);
    const original = StartCommandRequestSchema.parse(h.finalCommands[0]), refreshed = StartCommandRequestSchema.parse(h.finalCommands[1]);
    assert.notEqual(original.target.startPlanId, refreshed.target.startPlanId);
    assert.notEqual(original.commandId, refreshed.commandId);
  });
  it(`${rerun ? "Rerun" : "Run"} closes a real readiness refusal and emits one 6000 ms catalog toast`, async () => {
    let blocked = false;
    const h = await setup(clock => createPreflightAdmission({ clock, scheduler: createTimeoutDeadlineScheduler(clock), validate() {},
      runners: scope => requiredPreflightChecks(scope.requestedCapabilities).map(check => {
        const spec = PREFLIGHT_CHECKS.find(entry => entry.id === check); assert.ok(spec);
        return { check, kind: spec.runner, async run() { return blocked
          ? { check, state: "unhealthy" as const, summary: "PRIVATE_KERNEL_MARKER", impact: "Controlled failure" }
          : { check, state: "healthy" as const, summary: "Controlled healthy detector" }; } };
      }) }));
    await review(h); blocked = true;
    const timer = vi.spyOn(globalThis, "setTimeout");
    await press("Start dry run");
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(text().split("Run not started").length - 1, 1);
    assert.ok(text().includes(ERROR_CATALOG.RUN_START_READINESS_BLOCKED.text));
    for (const privateText of ["PRIVATE_KERNEL_MARKER", "RUN_START_READINESS_BLOCKED", "The start was refused", "Command result", "nothing is enqueued"]) assert.equal(text().includes(privateText), false);
    assert.ok(timer.mock.calls.some(call => call[1] === 6000));
    assert.equal(window.sessionStorage.length, 0);
    assert.equal(h.queueRoots.length, rerun ? 1 : 0);
    assert.equal(h.finalCommands.length, 1);
    assert.equal(document.activeElement?.textContent, rerun ? "Rerun source" : "Run workflow");
  });
  it(`${rerun ? "Rerun" : "Run"} closes and toasts safely if expiry re-preview fails`, async () => {
    const h = await setup(); let previews = 0;
    await review(h, { ...h.client, submitStartPlan: async request => {
      if (++previews > 1) throw new Error("PRIVATE_REPREVIEW_MARKER");
      return h.client.submitStartPlan(request);
    } });
    h.clock.advanceWall(600_000); h.clock.advanceMonotonic(600_000);
    await press("Start dry run");
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(text().split("Run not started").length - 1, 1);
    assert.ok(text().includes(ERROR_CATALOG.RUN_START_READINESS_UNAVAILABLE.text));
    assert.equal(text().includes("PRIVATE_REPREVIEW_MARKER"), false);
    assert.equal(h.finalCommands.length, 1); assert.equal(previews, 2);
    assert.equal(window.sessionStorage.length, 0);
  });
  it(`${rerun ? "Rerun" : "Run"} coalesces Start while expiry re-preview is pending`, async () => {
    const h = await setup(); const gate = Promise.withResolvers<void>(); let previews = 0;
    await review(h, { ...h.client, submitStartPlan: async request => {
      if (++previews > 1) await gate.promise;
      return h.client.submitStartPlan(request);
    } });
    h.clock.advanceWall(600_000); h.clock.advanceMonotonic(600_000);
    await act(async () => { button("Start dry run").click(); button("Start dry run").click(); });
    assert.equal(previews, 2); assert.equal(h.finalCommands.length, 1);
    await act(async () => gate.resolve());
    assert.equal(text().includes("Run not started"), false);
    assert.equal(h.finalCommands.length, 1);
    await press("Start dry run"); assert.equal(h.finalCommands.length, 2);
  });
  for (const replacement of ["draft", "scope", "close"] as const) it(`${rerun ? "Rerun" : "Run"} ignores an expiry response after ${replacement} replacement`, async () => {
    const h = await setup(); const gate = Promise.withResolvers<void>(); let previews = 0;
    const client = { ...h.client, submitStartPlan: async (request: unknown) => {
      if (++previews > 1) await gate.promise;
      return h.client.submitStartPlan(request);
    } };
    const replaceBinding = await review(h, client);
    h.clock.advanceWall(600_000); h.clock.advanceMonotonic(600_000);
    await act(async () => button("Start dry run").click());
    if (replacement === "draft") {
      await press("Back"); await press("Back");
      const box = document.querySelector("textarea, input[type=text]");
      assert.ok(box instanceof HTMLInputElement || box instanceof HTMLTextAreaElement);
      await fill(box, "10812346");
    } else if (replacement === "scope") await replaceBinding(client, { requestKey: 1 });
    else await press("Cancel");
    await act(async () => gate.resolve());
    assert.equal(text().includes("This plan expired, so it was checked again."), false);
    assert.equal(text().includes("Run not started"), false);
    assert.equal(h.finalCommands.length, 1);
  });

}
