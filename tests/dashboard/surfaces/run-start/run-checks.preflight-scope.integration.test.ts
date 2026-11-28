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
import { PREFLIGHT_RERUN_DEADLINE_MS, SETTINGS_READ_DEADLINE_MS } from "../../../../src/dashboard/client/read-deadline.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { runChecksBlocked, useRunChecks } from "../../../../src/dashboard/surfaces/run-start/run-checks-model.js";
import { RunChecksStage } from "../../../../src/dashboard/surfaces/run-start/run-checks.js";
import { PreflightReadinessWireSchema, PreflightSelectionSchema } from "../../../../src/models/preflight/preflight-contract.js";
import { requiredPreflightChecks } from "../../../../src/models/preflight/preflight.js";
import { PREFLIGHT_CHECKS } from "../../../../src/models/runtime/runtime-dependencies.js";
import { ActorIdSchema, IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { createPreflightAdmission } from "../../../../src/rules/preflight/preflight-admission.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { ERROR_CATALOG } from "../../../../src/models/failures/error-catalog.js";
import { FIXTURE_CHATGPT_OCR_AVAILABLE } from "../../../support/fixtures/dashboard/fixture-chatgpt-account.js";
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

function checksHarness(workflowId: string, failingCheck: "config.valid" | "secrets.ucpath-sso" | false = "config.valid", beforeRerun?: () => Promise<void>, beforeRead?: () => Promise<void>, firstAttempt: Readonly<Record<string, "lost" | "silent">> = {}) {
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
        return check === failingCheck
          ? { check, state: "unhealthy" as const, summary: check === "config.valid"
              ? "The runtime configuration is invalid." : "UCPath sign-in is unavailable.", impact: "The run cannot start." }
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
  registerSettingsPreflightRoutes(app, { preflight: service });
  const requests: string[] = [];
  const reports: unknown[] = [];
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1:3938", surface: () => "run-start", fetchImpl: async (url, init) => {
    const path = new URL(url).pathname;
    requests.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/api/v1/profile/state") return Response.json({ state: "active", profileId: "00000000-0000-4000-8000-000000000001", epoch: 1, duoState: "ready" });
    if (path === "/api/v1/debug/errors") { assert.ok(typeof init?.body === "string"); reports.push(JSON.parse(init.body)); return Response.json({ state: "recorded" }); }
    if (firstAttempt[path] !== undefined && requests.filter(request => request === `GET ${path}`).length === 1) {
      if (firstAttempt[path] === "lost") throw new TypeError("Failed to fetch");
      await new Promise<never>(() => undefined);
    }
    if (path === "/api/v1/preflight/rerun") await beforeRerun?.();
    if (path === "/api/v1/preflight") await beforeRead?.();
    return app.request(url, { ...init, headers: { ...init?.headers, host: "127.0.0.1:3938" } });
  } });
  return { client, clock, observations, reports, requests, scope };
}

/** The unavailable-checks notice with its Check again action is on screen. */
const checksUnavailable = () => [...document.querySelectorAll("button")].some(button => button.textContent === "Check again");

function Checks({ client, workflowId, requiresOcr }: { client: DashboardClient; workflowId: string; requiresOcr: boolean }) {
  const checks = useRunChecks(client, workflowId, true, true, true, requiresOcr);
  return createElement("div", null,
    createElement(RunChecksStage, { checks: checks.state, onFix: () => undefined, onRecheck: checks.recheck }),
    createElement("button", { disabled: runChecksBlocked(checks.state), "data-checks-start": true }, "Start dry run"));
}

async function mount(client: DashboardClient, workflowId: string, requiresOcr = false) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root?.render(createElement(DashboardClientProvider, { client,
    children: createElement(FixtureCommandBinding, { actorId: "local-operator",
      children: createElement(Checks, { client, workflowId, requiresOcr }) }),
  })); });
  await settle();
}

async function settle() {
  for (let turn = 0; turn < 40; turn += 1) await act(async () => { await Promise.resolve(); });
}

it("produces Emergency Contact's exact-scope report and shows its real failed check with what to do", async () => {
  const h = checksHarness("emergency-contact");
  const selection = PreflightSelectionSchema.parse({ workflowId: "emergency-contact" });
  const missing = await h.client.readPreflight(selection);
  assert.equal(missing.state, "unavailable");
  if (missing.state !== "unavailable") throw new Error("unexecuted scope must be unavailable");
  assert.match(missing.reason, /Preflight evidence is unavailable for this exact scope/u);
  assert.equal(missing.code, "PREFLIGHT_EVIDENCE_MISSING");
  await mount(h.client, "emergency-contact");
  assert.ok(document.body.textContent?.includes("Relay's settings could not be read. Restart Relay, then check again."), document.body.textContent ?? "");
  assert.equal(document.querySelector('[data-run-check-fix="config.valid"]') === null, true, "Settings cannot fix an invalid runtime configuration");
  const report = PreflightReadinessWireSchema.parse(await h.client.readPreflight(selection));
  assert.equal(report.state, "present");
  if (report.state !== "present") throw new Error("completed exact-scope report required");
  assert.equal(report.report.descriptorFingerprint, h.scope.descriptorFingerprint);
  assert.deepEqual(report.report.requestedCapabilities, h.scope.requestedCapabilities);
  assert.deepEqual(h.observations, requiredPreflightChecks(h.scope.requestedCapabilities));
  assert.equal(h.requests.filter(request => request === "POST /api/v1/preflight/rerun").length, 1);
  assert.equal(document.querySelector<HTMLButtonElement>("[data-checks-start]")?.disabled, true);
});

it("blocks Emergency Contact Start when its delegated UCPath sign-in is unavailable", async () => {
  const h = checksHarness("emergency-contact", "secrets.ucpath-sso");
  await mount(h.client, "emergency-contact");

  const readiness = await h.client.readPreflight(PreflightSelectionSchema.parse({ workflowId: "emergency-contact" }));
  assert.ok(readiness.state === "present");
  assert.ok(readiness.report.requestedCapabilities.includes("system.ucpath.prod"), "Emergency Contact must check delegated UCPath");
  assert.equal(readiness.report.results.find(result => result.check === "secrets.ucpath-sso")?.status, "fail");
  assert.equal(document.querySelector<HTMLButtonElement>("[data-checks-start]")?.disabled, true);
});

it("answers the 257th workflow preflight rerun", async () => {
  const h = checksHarness("emergency-contact", false);
  for (let attempt = 1; attempt <= 257; attempt += 1) {
    const commandId = `00000000-0000-4000-8000-${String(attempt).padStart(12, "0")}`;
    const result = await h.client.rerunPreflight({
      commandId, requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator",
      source: "settings-surface", type: "rerun-preflight", target: {
        expectedConfigFingerprint: h.scope.configFingerprint, expectedDescriptorFingerprint: h.scope.descriptorFingerprint,
        selection: { workflowId: "emergency-contact" },
      },
    });
    assert.equal(result.commandId, commandId);
    h.clock.advanceMonotonic(60_000);
  }
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

it.each([false, true])("Check again executes new exact-scope detectors with OCR required = %s", async requiresOcr => {
  const h = checksHarness("emergency-contact", false);
  let scopesUnavailable = true;
  const checkChatGptAccount: DashboardClient["checkChatGptAccount"] = async (_signal, options) => {
    assert.equal(options?.fresh, true);
    return scopesUnavailable ? FIXTURE_CHATGPT_OCR_AVAILABLE : { account: { state: "expired" },
      connection: { state: "refused", checkedAt: IsoInstantSchema.parse(h.clock.now().toISOString()), failureCode: "CHATGPT_ACCOUNT_EXPIRED" },
      usage: { state: "unavailable", reason: "expired" } };
  };
  const check = vi.fn(checkChatGptAccount);
  const client: DashboardClient = { ...h.client, checkChatGptAccount: check, preflightScopes: async () => {
    if (scopesUnavailable) throw new Error("Synthetic unavailable workflow catalog");
    return h.client.preflightScopes();
  } };
  await mount(client, "emergency-contact", requiresOcr);
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
  assert.equal(check.mock.calls.length, requiresOcr ? 2 : 0);
  assert.equal(document.body.textContent?.includes(ERROR_CATALOG.PROVIDER_UNAVAILABLE.text), requiresOcr);
  assert.equal(document.querySelector<HTMLButtonElement>("[data-checks-start]")?.disabled, requiresOcr);
});

it.each([false, true])("enables OCR Start only when the connected account's fresh check finds the fixed model (%s)", async ocrModelAvailable => {
  const h = checksHarness("emergency-contact", false);
  const status = { ...FIXTURE_CHATGPT_OCR_AVAILABLE, ocrModelAvailable };
  const checkChatGptAccount = vi.fn<DashboardClient["checkChatGptAccount"]>(async (_signal, options) => {
    assert.equal(options?.fresh, true);
    return status;
  });
  await mount({ ...h.client, checkChatGptAccount }, "emergency-contact", true);

  assert.equal(checkChatGptAccount.mock.calls.length, 1);
  const wire = await h.client.readPreflight(PreflightSelectionSchema.parse({ workflowId: "emergency-contact" }));
  assert.ok(wire.state === "present" && wire.report.results.every(result => result.status === "pass"));
  assert.equal(document.body.textContent?.includes(ERROR_CATALOG.PROVIDER_UNAVAILABLE.text), !ocrModelAvailable);
  assert.equal(document.querySelector<HTMLButtonElement>("[data-checks-start]")?.disabled, !ocrModelAvailable);
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

it("shows the checks when the live rerun answers after the read deadline", async () => {
  const rerun = Promise.withResolvers<void>();
  const h = checksHarness("emergency-contact", false, () => rerun.promise);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await mount(h.client, "emergency-contact");
  await act(async () => { await vi.advanceTimersByTimeAsync(SETTINGS_READ_DEADLINE_MS + 5_000); });
  assert.equal(checksUnavailable(), false, document.body.textContent ?? "");
  await act(async () => { rerun.resolve(); });
  await settle();
  assert.equal(checksUnavailable(), false, document.body.textContent ?? "");
  assert.equal(document.querySelector<HTMLButtonElement>("[data-checks-start]")?.disabled, false);
});

it("asks a checks read that got no answer in time again and shows the checks", async () => {
  let reads = 0;
  const h = checksHarness("emergency-contact", false, undefined, () => (reads += 1) === 1 ? new Promise<void>(() => undefined) : Promise.resolve());
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await mount(h.client, "emergency-contact");
  await act(async () => { await vi.advanceTimersByTimeAsync(SETTINGS_READ_DEADLINE_MS + 250); });
  await settle();
  assert.equal(checksUnavailable(), false, document.body.textContent ?? "");
  assert.equal(document.querySelector<HTMLButtonElement>("[data-checks-start]")?.disabled, false);
  assert.equal(h.requests.filter(request => request === "POST /api/v1/preflight/rerun").length, 1);
});

it("asks the settings read before a rerun again at the request when its first attempt gets no answer in time", async () => {
  const h = checksHarness("emergency-contact", false, undefined, undefined, { "/api/v1/settings/editable": "silent" });
  await h.client.readProfileSession();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await mount(h.client, "emergency-contact");
  await act(async () => { await vi.advanceTimersByTimeAsync(SETTINGS_READ_DEADLINE_MS + 250); });
  await settle();
  assert.equal(h.requests.filter(request => request === "GET /api/v1/settings/editable").length, 2);
  assert.equal(checksUnavailable(), false, document.body.textContent ?? "");
  assert.equal(document.querySelector<HTMLButtonElement>("[data-checks-start]")?.disabled, false);
  assert.equal(h.requests.filter(request => request === "POST /api/v1/preflight/rerun").length, 1);
  assert.deepEqual(h.reports, []);
});

it("asks the workflow-scope read before a rerun again at the request when its first attempt gets no answer in time", async () => {
  const h = checksHarness("emergency-contact", false, undefined, undefined, { "/api/v1/bootstrap": "silent" });
  await h.client.readProfileSession();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await mount(h.client, "emergency-contact");
  await act(async () => { await vi.advanceTimersByTimeAsync(SETTINGS_READ_DEADLINE_MS + 250); });
  await settle();
  assert.equal(h.requests.filter(request => request === "GET /api/v1/bootstrap").length, 2);
  assert.equal(checksUnavailable(), false, document.body.textContent ?? "");
  assert.equal(document.querySelector<HTMLButtonElement>("[data-checks-start]")?.disabled, false);
  assert.equal(h.requests.filter(request => request === "POST /api/v1/preflight/rerun").length, 1);
  assert.deepEqual(h.reports, []);
});

it("asks the settings and workflow-scope reads again at the request after a lost connection and reports nothing", async () => {
  const h = checksHarness("emergency-contact", false, undefined, undefined, { "/api/v1/settings/editable": "lost", "/api/v1/bootstrap": "lost" });
  await h.client.readProfileSession();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await mount(h.client, "emergency-contact");
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  await settle();
  assert.equal(checksUnavailable(), false, document.body.textContent ?? "");
  assert.equal(document.querySelector<HTMLButtonElement>("[data-checks-start]")?.disabled, false);
  assert.equal(h.requests.filter(request => request === "GET /api/v1/settings/editable").length, 2);
  assert.equal(h.requests.filter(request => request === "GET /api/v1/bootstrap").length, 2);
  assert.equal(h.requests.filter(request => request === "POST /api/v1/preflight/rerun").length, 1);
  assert.deepEqual(h.reports, []);
});

it("bounds a stalled rerun response, ignores its late completion and permits an explicit fresh check", async () => {
  const response = Promise.withResolvers<void>();
  const h = checksHarness("emergency-contact", false, () => response.promise);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    await mount(h.client, "emergency-contact");
    assert.equal(h.requests.filter(request => request === "POST /api/v1/preflight/rerun").length, 1);
    await act(async () => { await vi.advanceTimersByTimeAsync(PREFLIGHT_RERUN_DEADLINE_MS - 1); });
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
