// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { Onboarding } from "../../../../src/dashboard/surfaces/shell/onboarding.js";
import { mockOnboardingPort, type OnboardingStep, type ServedOnboardingPort } from "../../../../src/dashboard/surfaces/shell/onboarding-model.js";
import type { ProfileOwnerClaimRequest } from "../../../../src/models/profiles/public-profile.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

it("uses an explicit claim action and stable request identity without dispatching ordinary signup", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const claims: ProfileOwnerClaimRequest[] = []; let signupCalls = 0;
  const port: ServedOnboardingPort = { source: "served", validate: mockOnboardingPort.validate,
    async showBrowser() { throw new Error("not called"); }, async openPortal() { throw new Error("not called"); },
    async submit() { signupCalls++; return { state: "refused", code: "PROFILE_SIGN_IN_REFUSED" }; },
    async complete() { throw new Error("not called"); }, async cancel() { throw new Error("not called"); },
    async cancelDuo() { throw new Error("not called"); }, async start() { throw new Error("not called"); }, async confirmDuo() { throw new Error("not called"); } };
  function Probe() {
    const [step, onStep] = useState<OnboardingStep>("login");
    return createElement(Onboarding, { step, onStep, onDashboard() {}, port,
      async claimExistingData(request) { claims.push(request); return { state: "refused", code: "PROFILE_OWNER_CLAIM_STARTING" }; } });
  }
  try {
    await act(async () => root.render(createElement(Probe)));
    const claim = [...host.querySelectorAll("a")].find(link => link.textContent === "Claim existing data"); assert.ok(claim);
    await act(async () => claim.click());
    assert.match(host.textContent ?? "", /Claim your existing data/u);
    for (const [name, value] of [["firstName", "Historical"], ["lastName", "Fixture"], ["email", "historical-fixture@ucsd.edu"], ["password", "disposable-historical-fixture"]]) {
      await act(async () => {
        const input = host.querySelector<HTMLInputElement>(`input[name="${name}"]`); assert.ok(input);
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.bind(input); assert.ok(setter);
        setter(value); input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    const form = host.querySelector("form"); assert.ok(form);
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    assert.equal(claims.length, 1); assert.equal(claims[0]?.claimExistingData, true); assert.equal(signupCalls, 0);
    assert.match(host.textContent ?? "", /backing up and preserving/u);
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    assert.equal(claims.length, 2); assert.equal(claims[1]?.claimId, claims[0]?.claimId); assert.equal(signupCalls, 0);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("reopens the retained draft with original Details even after the claim form was selected", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  let detailsCalls = 0, claimCalls = 0;
  const method = { state: "idle" as const, ceremonyObserved: false, portalAccepted: false, operatorConfirmed: false, exactCredentialRequestObserved: false };
  const draft = { state: "onboarding" as const, operationId: "00000000-0000-4000-8000-000000000001", profileId: "00000000-0000-4000-8000-000000000002", step: "duo" as const,
    methods: { key: { ...method, state: "unknown" as const, attemptId: "00000000-0000-4000-8000-000000000003" }, touch: method } };
  const port: ServedOnboardingPort = { source: "served", validate: mockOnboardingPort.validate,
    async showBrowser() { throw new Error("not called"); }, async openPortal() { throw new Error("not called"); },
    async submit(step) { assert.equal(step, "signup"); detailsCalls++; return draft; },
    async complete() { throw new Error("not called"); }, async cancel() { throw new Error("must retain the draft"); },
    async cancelDuo() { throw new Error("not called"); }, async start() { throw new Error("must not retry enrollment"); }, async confirmDuo() { throw new Error("not called"); } };
  function Probe({ recover = false }: { recover?: boolean }) {
    const [step, onStep] = useState<OnboardingStep>("login");
    return createElement(Onboarding, { step, onStep, onDashboard() {}, port: recover ? { ...port, onboarding: draft, unavailable: true, reauthenticationRequired: true } : port,
      async claimExistingData() { claimCalls++; throw new Error("must not claim the retained draft"); } });
  }
  try {
    await act(async () => root.render(createElement(Probe)));
    const claim = [...host.querySelectorAll("a")].find(link => link.textContent === "Claim existing data"); assert.ok(claim);
    await act(async () => claim.click());
    await act(async () => root.render(createElement(Probe, { recover: true })));
    assert.match(host.textContent ?? "", /Return to your profile/u);
    assert.equal(host.querySelector('button[type="submit"]')?.textContent, "Reopen profile");
    for (const [name, value] of [["firstName", "Original"], ["lastName", "Operator"], ["email", "original@ucsd.edu"], ["password", "original-synthetic-password"]]) {
      await act(async () => {
        const input = host.querySelector<HTMLInputElement>(`input[name="${name}"]`); assert.ok(input);
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.bind(input); assert.ok(setter);
        setter(value); input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    const form = host.querySelector("form"); assert.ok(form);
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    assert.equal(detailsCalls, 1); assert.equal(claimCalls, 0);
    assert.equal(draft.methods.key.state, "unknown");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
