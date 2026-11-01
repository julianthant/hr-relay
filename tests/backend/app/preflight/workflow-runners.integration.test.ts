import { fixtureDuoSigningSource } from "../../../support/helpers/browser/duo-signing.js";
import assert from "node:assert/strict";
import { chmodSync,mkdirSync,mkdtempSync,rmSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { afterEach,describe,it,vi } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { createRuntimePreflightRunners,type RuntimePreflightRunnerInput } from "../../../../src/backend/app/preflight/runtime-runners.js";
import { createWorkflowPreflightRunners } from "../../../../src/backend/app/preflight/workflow-runners.js";
import { createTimeoutDeadlineScheduler } from "../../../../src/backend/runtime/scheduling/timeout-deadline-scheduler.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { initialProtectedStoreRecord,PROTECTED_SETTINGS_SCHEMA_HASH,ProtectedStoreRecordSchema } from "../../../../src/models/config/protected-settings.js";
import { createPreflightAuthority,executePreflightRunner } from "../../../../src/models/preflight/preflight.js";
import { FEATURE_RUNTIME_SPECS,PreflightCheckIdSchema,PROVIDER_ADAPTER_SPECS,RUNTIME_DEPENDENCIES,SYSTEM_RUNTIME_SPECS,type RuntimeCapability } from "../../../../src/models/runtime/runtime-dependencies.js";
import { PreflightAdmissionScopeSchema } from "../../../../src/rules/preflight/preflight-admission.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(capabilities: readonly RuntimeCapability[]) {
  const root = mkdtempSync(join(tmpdir(), "setup-detectors-")); roots.push(root);
  const clock = manualClock(new Date("2026-09-19T12:00:00.000Z"));
  const config = structuredClone(resolveConfigWithProvenance({}, hostConfigFacts({}), clock).config);
  config.paths.duoExtensionDir = join(root, "extension");
  config.features.duoWebAuthn = true;
  const input: RuntimePreflightRunnerInput = {
    scope: PreflightAdmissionScopeSchema.parse({ configSnapshotId: "11111111-1111-4111-8111-111111111111", configFingerprint: "a".repeat(64), descriptorFingerprint: "b".repeat(64), requestedCapabilities: capabilities }),
    config, protectedSecrets: { read: initialProtectedStoreRecord }, providerAvailability: {},
    dashboard: { repoRoot: root, stateRoot: root, artifactRoot: root, backendPort: 0, frontendPort: 0, clock,
      authorityHealth: { check: PreflightCheckIdSchema.parse("authority.health"), kind: "io", async run() { throw new Error("unselected authority detector ran"); } } },
  };
  const observe = async (name: string, useFactory = false) => {
    const runner = (useFactory ? createRuntimePreflightRunners(input) : createWorkflowPreflightRunners(input)).find(candidate => candidate.check === name);
    assert.ok(runner, name);
    return executePreflightRunner(runner, new AbortController().signal, clock, createTimeoutDeadlineScheduler(clock));
  };
  return { root, clock, config, input, observe };
}
function protectedRecord(omit?: string) {
  const values = { ucpathUserId: "SYNTHETIC_PRIVATE_PERSON", ucpathPassword: "SYNTHETIC_PRIVATE_SECRET", timekeeperName: "SYNTHETIC_PRIVATE_PERSON", sharepointOnboardingRosterUrl: "https://example.invalid/SYNTHETIC_PRIVATE_PATH" };
  return ProtectedStoreRecordSchema.parse({ ...initialProtectedStoreRecord(), revision: 2,
    entries: Object.fromEntries(Object.entries(values).filter(([name]) => name !== omit).map(([name,value],index) => [name, {value, valueId: `${String(index+1).repeat(8)}-1111-4111-8111-111111111111`, updatedAt: "2026-09-19T12:00:00.000Z"}])),
    lastApplied: { commandId: "77777777-7777-4777-8777-777777777777", commandFingerprint: "7".repeat(64), expectedRevision: 1, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: "88888888-8888-4888-8888-888888888888" },
  });
}

describe("registered workflow detectors", () => {
  for (const dependency of RUNTIME_DEPENDENCIES.filter(candidate => candidate.secretNames !== undefined)) {
    for (const name of dependency.secretNames ?? []) it(`detects and rechecks ${name} without exposing source data`, async () => {
      const f = fixture(dependency.capabilities);
      let source = protectedRecord();
      f.input.protectedSecrets.read = () => source;
      assert.equal((await f.observe(dependency.check, true)).state, "healthy");
      source = protectedRecord(name);
      const missing = await f.observe(dependency.check, true);
      assert.equal(missing.state, "unhealthy"); assert.match(missing.summary, new RegExp(`${name}: missing`, "u"));
      source = protectedRecord();
      assert.equal((await f.observe(dependency.check, true)).state, "healthy");
      f.input.protectedSecrets.read = () => { throw new Error("SYNTHETIC_PRIVATE_SECRET /SYNTHETIC_PRIVATE_PATH SYNTHETIC_PRIVATE_PERSON"); };
      const unknown = await f.observe(dependency.check, true);
      assert.equal(unknown.state, "unhealthy"); assert.match(unknown.summary, /unknown/u);
      assert.doesNotMatch(JSON.stringify([missing, unknown]), /SYNTHETIC_PRIVATE/u);
    });
  }
  for (const system of SYSTEM_RUNTIME_SPECS) {
    for (const instance of ["prod"] as const) {
      for (const route of system.routes) it(`verifies ${system.system} ${instance} ${route} and refuses missing evidence`, async () => {
        const f = fixture([`system.${system.system}.${instance}`]);
        const endpoints = f.config.urls[system.configKey];
        const good = Object.fromEntries(system.routes.map(key => [key, `https://${instance}.example.invalid/${key}`]));
        Reflect.set(endpoints, instance, good);
        const check = `endpoint.${system.system}.${instance}`;
        assert.equal((await f.observe(check, true)).state, "healthy");
        Reflect.deleteProperty(good, route);
        assert.equal((await f.observe(check)).state, "unhealthy");
        Reflect.set(good, route, "SYNTHETIC_PRIVATE_SECRET");
        const invalid = await f.observe(check);
        assert.equal(invalid.state, "unhealthy"); assert.doesNotMatch(JSON.stringify(invalid), /SYNTHETIC_PRIVATE/u);

      });
    }
  }
  it("uses the clock's current fiscal year and rejects stale or invalid dates", async () => {
    const f = fixture(["workflow.kuali-fill"]);
    assert.equal((await f.observe("fiscal.current", true)).state, "unhealthy");
    f.config.annualDates.FY2027 = { jobEndDate: "6/30/2027", kronosDefaultStartDate: "7/1/2026", kronosDefaultEndDate: "6/30/2027" };
    assert.equal((await f.observe("fiscal.current", true)).state, "healthy");
    f.config.annualDates.FY2027.jobEndDate = "9/18/2026";
    assert.equal((await f.observe("fiscal.current", true)).state, "unhealthy");
    f.config.annualDates.FY2027.jobEndDate = "2/30/2027";
    assert.equal((await f.observe("fiscal.current", true)).state, "unhealthy");
    f.config.annualDates.FY2027.jobEndDate = "6/30/2027";
    f.clock.advanceWall(366 * 24 * 60 * 60 * 1000);
    assert.match((await f.observe("fiscal.current", true)).summary, /FY2028.*missing/u);
  });
  it("checks actual local browser assets without a browser launch and rereads repairs", async () => {
    const f = fixture(["executor.run"]);
    const executable = join(f.root, "chromium");
    vi.spyOn(chromium, "executablePath").mockReturnValue(executable);
    const launch = vi.spyOn(chromium, "launchPersistentContext").mockImplementation(async () => { throw new Error("forbidden browser launch"); });
    assert.match((await f.observe("browser.assets", true)).summary, /Chromium.*unavailable/u);
    writeFileSync(executable, "synthetic executable", { mode: 0o700 });
    assert.match((await f.observe("browser.assets", true)).summary, /manifest.*unavailable/u);
    mkdirSync(f.config.paths.duoExtensionDir); writeFileSync(join(f.config.paths.duoExtensionDir, "workflow-manifest.json"), "{}");
    assert.match((await f.observe("browser.assets", true)).summary, /backend signing source.*unavailable/u);
    Reflect.set(f.input, "duo", fixtureDuoSigningSource());
    const credential = join(f.root, "credential.json");
    writeFileSync(credential, "SYNTHETIC_PRIVATE_SECRET", { mode: 0o600 });
    assert.equal((await f.observe("browser.assets", true)).state, "healthy");
    Reflect.set(f.input, "duo", fixtureDuoSigningSource({ assertCurrent() { throw new Error("SYNTHETIC_PRIVATE_SECRET"); } }));
    chmodSync(credential, 0o644);
    const unsafe = await f.observe("browser.assets", true);
    assert.equal(unsafe.state, "unhealthy"); assert.doesNotMatch(JSON.stringify(unsafe), /SYNTHETIC_PRIVATE|setup-detectors-/u);
    Reflect.set(f.input, "duo", fixtureDuoSigningSource());
    chmodSync(credential, 0o600);
    assert.equal((await f.observe("browser.assets", true)).state, "healthy");
    assert.equal(launch.mock.calls.length, 0);
  });
  it("does not inspect disabled Duo assets or unselected private dependencies", async () => {
    const f = fixture(["executor.run"]);
    const executable = join(f.root, "chromium"); writeFileSync(executable, "synthetic executable", {mode: 0o700});
    vi.spyOn(chromium, "executablePath").mockReturnValue(executable);
    f.config.features.duoWebAuthn = false;
    f.input.protectedSecrets.read = () => { throw new Error("unselected secret read"); };
    assert.match((await f.observe("browser.assets", true)).summary, /disabled/u);
    assert.deepEqual(createWorkflowPreflightRunners(f.input).map(({check})=>check), ["browser.assets"]);
  });
  it("honors cancellation before inspecting local assets", async () => {
    const f = fixture(["executor.run"]);
    const runner = createWorkflowPreflightRunners(f.input)[0]; assert.ok(runner);
    const controller = new AbortController(); controller.abort();
    const lookup = vi.spyOn(chromium, "executablePath");
    await assert.rejects(runner.run({ signal: controller.signal, deadlineMonotonicMs: 100, timeoutMs: 100, redaction: "path-basename" }), /aborted/u);
    assert.equal(lookup.mock.calls.length, 0);
  });
});


describe("executable provider readiness", () => {
  const report = async (f: ReturnType<typeof fixture>) => createPreflightAuthority({
    ...f.input.scope, clock: f.clock, scheduler: createTimeoutDeadlineScheduler(f.clock), runners: createRuntimePreflightRunners(f.input),
  }).refresh(new AbortController().signal);
  for (const provider of PROVIDER_ADAPTER_SPECS) it(`does not mistake ${provider.provider} configuration for an executable adapter`, async () => {
    const f = fixture([`provider.${provider.provider}`]);
    assert.equal((await report(f)).results[0]?.status, "warning");
    for (const capability of provider.capabilities) Reflect.set(f.input.providerAvailability, `${provider.provider}/${capability}`, true);
    assert.equal((await report(f)).results[0]?.status, "pass");

  });
  for (const feature of FEATURE_RUNTIME_SPECS) it(`expands every executable provider for ${String(feature.feature)}`, async () => {
    for (const provider of PROVIDER_ADAPTER_SPECS.filter(candidate => candidate.capabilities.includes(feature.providerCapability))) {
      const f = fixture([feature.feature]);
      assert.equal((await report(f)).results.find(result => result.check === feature.check)?.status, "fail");
      Reflect.set(f.input.providerAvailability, `${provider.provider}/${feature.providerCapability}`, true);
      assert.equal((await report(f)).results.find(result => result.check === feature.check)?.status, "pass");
    }
  });
});

it("uses the explicit admitted executable path without bundled discovery or launch", async () => {
  const f = fixture(["executor.run"]);
  const path = join(f.root, "explicit-chromium"); writeFileSync(path, "synthetic executable", { mode: 0o700 });
  f.config.features.duoWebAuthn = false;
  const discovery = vi.spyOn(chromium, "executablePath").mockImplementation(() => { throw new Error("unexpected discovery"); });
  const launch = vi.spyOn(chromium, "launchPersistentContext").mockImplementation(async () => { throw new Error("unexpected launch"); });
  const runner = createWorkflowPreflightRunners({ ...f.input, browserExecutablePath: () => path }).find(value => value.check === "browser.assets");
  assert.ok(runner);
  const result = await executePreflightRunner(runner, new AbortController().signal, f.clock, createTimeoutDeadlineScheduler(f.clock));
  assert.equal(result.state, "healthy"); assert.equal(discovery.mock.calls.length, 0); assert.equal(launch.mock.calls.length, 0);
});


it("discovers the bundled executable by default without launching Chromium", async () => {
  const f = fixture(["executor.run"]);
  f.config.features.duoWebAuthn = false;
  const path = join(f.root, "bundled-chromium"); writeFileSync(path, "synthetic executable", { mode: 0o700 });
  const discovery = vi.spyOn(chromium, "executablePath").mockReturnValue(path);
  const launch = vi.spyOn(chromium, "launchPersistentContext").mockImplementation(async () => { throw new Error("unexpected launch"); });
  const result = await f.observe("browser.assets");
  assert.equal(result.state, "healthy"); assert.equal(discovery.mock.calls.length, 1); assert.equal(launch.mock.calls.length, 0);
});
