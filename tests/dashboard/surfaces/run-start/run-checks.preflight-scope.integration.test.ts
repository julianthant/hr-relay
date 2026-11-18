// @vitest-environment jsdom
import assert from "node:assert/strict";
import { Hono } from "hono";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it, vi } from "vitest";
import { WORKFLOW_MODULES } from "../../../../src/backend/app/registries/workflow-registry.js";
import { workflowPreflightScope } from "../../../../src/backend/runs/start/preflight-scope.js";
import { createPreflightReportService } from "../../../../src/backend/runtime/preflight/report-service.js";
import { createTimeoutDeadlineScheduler } from "../../../../src/backend/runtime/scheduling/timeout-deadline-scheduler.js";
import type { DashboardApp } from "../../../../src/backend/transports/http/routes/api-types.js";
import { registerSettingsPreflightRoutes } from "../../../../src/backend/transports/http/routes/settings-preflight.js";
import { createDashboardClient, type DashboardClient } from "../../../../src/dashboard/client/index.js";
import { SETTINGS_READ_DEADLINE_MS } from "../../../../src/dashboard/client/read-deadline.js";
import { FailureNotice } from "../../../../src/dashboard/ds/primitives/failure-notice.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { runChecksBlocked, useRunChecks } from "../../../../src/dashboard/surfaces/run-start/run-checks-model.js";
import { RunChecksStage } from "../../../../src/dashboard/surfaces/run-start/run-checks.js";
import { PreflightReadinessWireSchema, PreflightSelectionSchema } from "../../../../src/models/preflight/preflight-contract.js";
import { requiredPreflightChecks } from "../../../../src/models/preflight/preflight.js";
import { PREFLIGHT_CHECKS } from "../../../../src/models/runtime/runtime-dependencies.js";
import { ActorIdSchema } from "../../../../src/rules/identity/ids.js";
import { createPreflightAdmission } from "../../../../src/rules/preflight/preflight-admission.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { FIXTURE_START_PICKER_BOOTSTRAP } from "../../../support/fixtures/dashboard/fixture-start.js";
import { FIXTURE_EDITABLE_SETTINGS } from "../../../support/fixtures/dashboard/fixture-settings.js";
import { createPreflightHarness } from "../../../support/fixtures/preflight-seams.js";
import { FixtureCommandBinding } from "../../../support/helpers/dashboard/command-binding.js";
import workflowSources from "../../../../config/dashboard-workflow-sources.json" with { type: "json" };

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
});

function checksHarness(workflowId: string, failConfig = true, beforeRerun?: () => Promise<void>) {
  const descriptor = WORKFLOW_MODULES.find(module => module.descriptor.id === workflowId)?.descriptor;
  assert.ok(descriptor, `registered workflow ${workflowId}`);
  const clock = manualClock(new Date("2026-11-17T12:00:00Z"));
  const scope = workflowPreflightScope(descriptor, {
    configSnapshotId: "66666666-6666-4666-8666-666666666666",
    configFingerprint: FIXTURE_EDITABLE_SETTINGS.activeConfigFingerprint,
  });
  const observations: string[] = [];
  const admission = createPreflightAdmission({
    clock, scheduler: createTimeoutDeadlineScheduler(clock), validate: () => undefined,
    runners: selected => requiredPreflightChecks(selected.requestedCapabilities).map(check => {
      const spec = PREFLIGHT_CHECKS.find(candidate => candidate.id === check);
      assert.ok(spec, `registered check ${check}`);
      return { check, kind: spec.runner, async run() {
        observations.push(check);
        return failConfig && check === "config.valid"
          ? { check, state: "unhealthy" as const, summary: "The runtime configuration is invalid.", impact: "The run cannot start." }
          : { check, state: "healthy" as const, summary: "Synthetic healthy observation." };
      } };
    }),
  });
  const service = createPreflightReportService({
    dashboard: createPreflightHarness(clock, scope.configFingerprint).authority,
    runtime: { admission, currentScope: selected => { assert.equal(selected, workflowId); return scope; } }, clock,
  });
  const app: DashboardApp = new Hono();
  app.use("*", async (c, next) => { c.set("requestActorId", ActorIdSchema.parse("local-operator")); await next(); });
  app.get("/api/v1/bootstrap", () => Response.json(FIXTURE_START_PICKER_BOOTSTRAP));
  app.get("/api/v1/settings/editable", () => Response.json(FIXTURE_EDITABLE_SETTINGS));
  registerSettingsPreflightRoutes(app, { clock, preflight: service });
  const requests: string[] = [];
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1:3938", fetchImpl: async (url, init) => {
    const path = new URL(url).pathname;
    requests.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/api/v1/preflight/rerun") await beforeRerun?.();
    return app.request(url, { ...init, headers: { ...init?.headers, host: "127.0.0.1:3938" } });
  } });
  return { client, observations, requests, scope };
}

/** The unavailable-checks notice with its Check again action is on screen. */
const checksUnavailable = () => [...document.querySelectorAll("button")].some(button => button.textContent === "Check again");

function Checks({ client, workflowId }: { client: DashboardClient; workflowId: string }) {
  const checks = useRunChecks(client, workflowId, true);
  return createElement("div", null,
    checks.state.state === "unavailable" && createElement(FailureNotice, { sentence: checks.state.message, stillWorks: "Your choices are kept.",
      action: { label: "Check again", onClick: checks.recheck } }),
    createElement(RunChecksStage, { checks: checks.state, onFix: () => undefined }),
    createElement("button", { disabled: runChecksBlocked(checks.state), "data-checks-start": true }, "Start dry run"));
}

async function mount(client: DashboardClient, workflowId: string) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root?.render(createElement(DashboardClientProvider, { client,
    children: createElement(FixtureCommandBinding, { actorId: "local-operator",
      children: createElement(Checks, { client, workflowId }) }),
  })); });
  await settle();
}

async function settle() {
  for (let turn = 0; turn < 40; turn += 1) await act(async () => { await Promise.resolve(); });
}

it("produces Emergency Contact's exact-scope report and shows its real failed check with a fix", async () => {
  const h = checksHarness("emergency-contact");
  const selection = PreflightSelectionSchema.parse({ workflowId: "emergency-contact" });
  const missing = await h.client.readPreflight(selection);
  assert.equal(missing.state, "unavailable");
  if (missing.state !== "unavailable") throw new Error("unexecuted scope must be unavailable");
  assert.match(missing.reason, /Preflight evidence is unavailable for this exact scope/u);
  await mount(h.client, "emergency-contact");
  assert.ok(document.body.textContent?.includes("The runtime configuration is invalid."), document.body.textContent ?? "");
  assert.ok(document.querySelector('[data-run-check-fix="config.valid"]'));
  const report = PreflightReadinessWireSchema.parse(await h.client.readPreflight(selection));
  assert.equal(report.state, "present");
  if (report.state !== "present") throw new Error("completed exact-scope report required");
  assert.equal(report.report.descriptorFingerprint, h.scope.descriptorFingerprint);
  assert.deepEqual(report.report.requestedCapabilities, h.scope.requestedCapabilities);
  assert.deepEqual(h.observations, requiredPreflightChecks(h.scope.requestedCapabilities));
  assert.equal(h.requests.filter(request => request === "POST /api/v1/preflight/rerun").length, 1);
  assert.equal(document.querySelector<HTMLButtonElement>("[data-checks-start]")?.disabled, true);
});

it.each(Object.entries(workflowSources).filter(([, source]) => source === "served").map(([id]) => id))(
  "prepares the exact scope for served workflow %s and enables Start when its checks pass", async workflowId => {
    const h = checksHarness(workflowId, false);
    await mount(h.client, workflowId);
    const wire = await h.client.readPreflight(PreflightSelectionSchema.parse({ workflowId }));
    assert.equal(wire.state, "present");
    if (wire.state !== "present") throw new Error("Exact-scope report required");
    assert.equal(wire.report.configFingerprint, h.scope.configFingerprint);
    assert.equal(wire.report.descriptorFingerprint, h.scope.descriptorFingerprint);
    assert.deepEqual(wire.report.requestedCapabilities, h.scope.requestedCapabilities);
    assert.deepEqual(wire.report.results.map(result => result.check), requiredPreflightChecks(h.scope.requestedCapabilities));
    assert.ok(wire.report.results.every(result => result.status === "pass"));
    assert.equal(document.querySelector<HTMLButtonElement>("[data-checks-start]")?.disabled, false);
    assert.equal(h.requests.filter(request => request === "POST /api/v1/preflight/rerun").length, 1);
  },
);

it("Check again executes new exact-scope detectors even when a report became available meanwhile", async () => {
  const h = checksHarness("emergency-contact", false);
  let scopesUnavailable = true;
  const client: DashboardClient = { ...h.client, preflightScopes: async () => {
    if (scopesUnavailable) throw new Error("Synthetic unavailable workflow catalog");
    return h.client.preflightScopes();
  } };
  await mount(client, "emergency-contact");
  const recheck = [...document.querySelectorAll("button")].find(button => button.textContent === "Check again");
  assert.ok(recheck, document.body.textContent ?? "");
  assert.equal(document.querySelector<HTMLButtonElement>("[data-checks-start]")?.disabled, true);
  scopesUnavailable = false;
  const first = await h.client.rerunPreflight({
    commandId: crypto.randomUUID(), requestedAt: "2026-11-17T12:00:00Z", requestedBy: "local-operator",
    source: "settings-surface", type: "rerun-preflight", target: {
      expectedConfigFingerprint: h.scope.configFingerprint, expectedDescriptorFingerprint: h.scope.descriptorFingerprint,
      selection: { workflowId: "emergency-contact" },
    },
  });
  assert.equal(first.state, "completed");
  await act(async () => { recheck.click(); });
  await settle();
  assert.equal(h.requests.filter(request => request === "POST /api/v1/preflight/rerun").length, 2);
  const checks = requiredPreflightChecks(h.scope.requestedCapabilities);
  assert.deepEqual(h.observations, [...checks, ...checks]);
  assert.equal(checksUnavailable(), false);
  assert.equal(document.querySelector<HTMLButtonElement>("[data-checks-start]")?.disabled, false);
});

it("does not execute a late check after the dialog has closed during settings acquisition", async () => {
  const h = checksHarness("emergency-contact", false);
  const settings = Promise.withResolvers<typeof FIXTURE_EDITABLE_SETTINGS>();
  await mount({ ...h.client, editableSettings: () => settings.promise }, "emergency-contact");
  assert.equal(document.querySelector<HTMLButtonElement>("[data-checks-start]")?.disabled, true);
  await act(async () => { root?.unmount(); });
  root = undefined;
  settings.resolve(FIXTURE_EDITABLE_SETTINGS);
  await settle();
  assert.deepEqual(h.observations, []);
  assert.equal(h.requests.filter(request => request === "POST /api/v1/preflight/rerun").length, 0);
});

it("bounds a stalled rerun response, ignores its late completion and permits an explicit fresh check", async () => {
  const response = Promise.withResolvers<void>();
  const h = checksHarness("emergency-contact", false, () => response.promise);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    await mount(h.client, "emergency-contact");
    assert.equal(h.requests.filter(request => request === "POST /api/v1/preflight/rerun").length, 1);
    await act(async () => { await vi.advanceTimersByTimeAsync(SETTINGS_READ_DEADLINE_MS - 1); });
    assert.equal(document.querySelector<HTMLButtonElement>("[data-checks-start]")?.disabled, true);
    assert.ok(document.body.textContent?.includes("Checking"));
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    const recheck = [...document.querySelectorAll("button")].find(button => button.textContent === "Check again");
    assert.ok(recheck, document.body.textContent ?? "");
    assert.ok(checksUnavailable());
    assert.equal(document.querySelector<HTMLButtonElement>("[data-checks-start]")?.disabled, true);
    const reads = h.requests.filter(request => request === "GET /api/v1/preflight").length;
    await act(async () => { response.resolve(); });
    await settle();
    assert.ok(checksUnavailable());
    assert.equal(document.querySelector<HTMLButtonElement>("[data-checks-start]")?.disabled, true);
    assert.equal(h.requests.filter(request => request === "GET /api/v1/preflight").length, reads);
    await act(async () => { recheck.click(); });
    await settle();
    assert.equal(h.requests.filter(request => request === "POST /api/v1/preflight/rerun").length, 2);
    assert.equal(document.querySelector<HTMLButtonElement>("[data-checks-start]")?.disabled, false);
  } finally {
    await act(async () => { response.resolve(); });
    await settle();
  }
});
