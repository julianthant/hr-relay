import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { JSDOM } from "jsdom";
import { it } from "vitest";
import { populateGlobal } from "vitest/environments";
import { composeDashboardApplication } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { Onboarding } from "../../../../src/dashboard/surfaces/shell/onboarding.js";
import { createServedOnboardingPort } from "../../../../src/dashboard/surfaces/shell/onboarding-model.js";
import type { OnboardingStep } from "../../../../src/dashboard/surfaces/shell/onboarding-model.js";
import { authenticateDocument } from "../../../../src/backend/storage/configuration/credential-store.js";
import type { PublicProfileState } from "../../../../src/models/profiles/public-profile.js";
import { healthyRuntimePreflightRunners } from "../../../support/fixtures/preflight-seams.js";
import { readAuthenticatedCredentialFixture, syntheticOnboardingDuo } from "../../../support/helpers/admission-fixture.js";
import { publicProfileShellFixture } from "../../../support/helpers/backend/public-profile-shell.js";


it("signs up through the real form with both pairs, stores the UCPath pair and signs in with the Relay pair only", async () => {
  const fixture = await publicProfileShellFixture();
  let runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  // The backend runs in the node environment; the form gets a DOM only for this test, set up before React loads.
  const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
  const { keys, originals } = populateGlobal(globalThis, dom.window, { bindFunctions: true });
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    runtime = await composeDashboardApplication({ admission: fixture.machine, lifetimeLock: fixture.lifetime, isolation: rebuildRuntimeIsolation, repoRoot: fixture.root,
      backendPortOverride: 0, frontendPortOverride: 0, onboardingDuo: syntheticOnboardingDuo(), env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
    const client = createDashboardClient({ baseUrl: `http://127.0.0.1:${runtime.port}` });
    const states: PublicProfileState[] = [];
    const steps: OnboardingStep[] = [];
    const port = createServedOnboardingPort(client, state => { states.push(state); });
    await act(async () => root.render(createElement(Onboarding, { step: "signup", onStep: step => steps.push(step), onDashboard: () => undefined, port })));
    const type = async (name: string, value: string) => {
      const input = host.querySelector<HTMLInputElement>(`input[name="${name}"]`); assert.ok(input, name);
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
    };
    assert.match(host.querySelector("fieldset legend")?.textContent ?? "", /UCPath/u);
    const relay = { email: "fixture@ucsd.edu", password: "relay-fixture-password" }, ucpath = { username: "ucpath-sso@ucsd.edu", password: "ucpath-fixture-password" };
    await type("firstName", "Fixture"); await type("lastName", "Operator"); await type("email", relay.email); await type("password", relay.password);
    await act(async () => { host.querySelector<HTMLFormElement>("form")?.requestSubmit(); });
    assert.deepEqual(steps, [], "UCPath fields are required");
    assert.ok(host.querySelector('input[name="ucpathUsername"][aria-invalid="true"]') ?? host.textContent?.includes("Enter your UCPath username."));
    await type("ucpathUsername", ucpath.username); await type("ucpathPassword", ucpath.password);
    await act(async () => { host.querySelector<HTMLFormElement>("form")?.requestSubmit(); });
    await waitUntil(() => steps.length > 0);
    const draft = states.at(-1); assert.ok(draft?.state === "onboarding");
    const started = await client.startProfileOnboardingDuo({ operationId: draft.operationId, method: "key" }); assert.ok(started.state === "onboarding");
    const confirmed = await client.confirmProfileOnboardingDuo({ operationId: draft.operationId, method: "key", attemptId: started.methods.key.attemptId ?? "", operatorConfirmed: true });
    assert.ok(confirmed.state === "onboarding" && confirmed.step === "ready");
    const active = await client.completeProfileOnboarding({ operationId: draft.operationId }); assert.ok(active.state === "active", JSON.stringify(active));
    const stored = authenticateDocument(readAuthenticatedCredentialFixture(fixture.machine.stateRoot, active.profileId)) as { record: { entries: Record<string, { value: string } | undefined> } };
    assert.equal(stored.record.entries.ucpathUserId?.value, ucpath.username);
    assert.equal(stored.record.entries.ucpathPassword?.value, ucpath.password);
    const fresh = createDashboardClient({ baseUrl: `http://127.0.0.1:${runtime.port}` });
    assert.equal((await fresh.signInProfile({ email: ucpath.username, password: ucpath.password })).state, "refused");
    assert.equal((await fresh.signInProfile({ email: relay.email, password: ucpath.password })).state, "refused");
    assert.equal((await fresh.signInProfile(relay)).state, "active");
  } finally {
    await act(async () => root.unmount()); host.remove();
    for (const key of keys) { const original = originals.get(key); if (original === undefined) Reflect.deleteProperty(globalThis, key); else Reflect.set(globalThis, key, original); }
    await runtime?.stop(); fixture.machine.release(); rmSync(fixture.root, { recursive: true, force: true });
  }
});

async function waitUntil(done: () => boolean) {
  for (let attempt = 0; attempt < 100 && !done(); attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  assert.ok(done());
}
