// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { Onboarding } from "../../../../src/dashboard/surfaces/shell/onboarding.js";
import { mockOnboardingPort, type ServedOnboardingPort, type OnboardingStep } from "../../../../src/dashboard/surfaces/shell/onboarding-model.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
it("keeps form drafts across wizard and router navigation without retaining passwords", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  let navigate!: (step: OnboardingStep) => void;
  function Probe() { const [step, onStep] = useState<OnboardingStep>("signup"); navigate = onStep; return createElement(Onboarding, { step, onStep, onDashboard() {} }); }
  const input = (name: string) => { const field = host.querySelector<HTMLInputElement>(`input[name="${name}"]`); assert.ok(field); return field; };
  try {
    await act(async () => root.render(createElement(Probe)));
    for (const [name, value] of [["firstName", "Alex"], ["lastName", "Rivera"], ["email", "alex.rivera@ucsd.edu"], ["password", "Relay-demo-42"]] as const) {
      await act(async () => { const field = input(name); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); });
    }
    await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    assert.match(host.textContent ?? "", /Opening your setup browser/);
    const back = [...host.querySelectorAll("button")].find(button => button.textContent?.trim() === "Your details"); assert.ok(back);
    await act(async () => back.click());
    assert.equal(input("firstName").value, "Alex");
    assert.equal(input("lastName").value, "Rivera");
    assert.equal(input("email").value, "alex.rivera@ucsd.edu");
    assert.equal(input("password").value, "");
    await act(async () => navigate("login"));
    for (const [name, value] of [["email", "other@ucsd.edu"], ["password", "Another-demo-42"]] as const) {
      await act(async () => { const field = input(name); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); });
    }
    await act(async () => navigate("signup"));
    assert.equal(input("firstName").value, "Alex");
    assert.equal(input("email").value, "alex.rivera@ucsd.edu");
    assert.equal(input("password").value, "");
    await act(async () => navigate("login"));
    assert.equal(input("email").value, "other@ucsd.edu");
    assert.equal(input("password").value, "");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("uses server authentication for Duo access and keeps a refused served login on its form", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const transitions: string[] = [];
  const port: ServedOnboardingPort = { source: "served", validate: (step, details) => mockOnboardingPort.validate(step, details),
    async submit() { return { state: "refused", code: "PROFILE_SIGN_IN_REFUSED" }; } };
  const props = { port, onStep: (step: OnboardingStep) => { transitions.push(step); }, onDashboard() { transitions.push("dashboard"); } };
  try {
    await act(async () => root.render(createElement(Onboarding, { ...props, step: "duo", authenticated: false })));
    assert.match(host.textContent ?? "", /Start with your details/);
    await act(async () => root.render(createElement(Onboarding, { ...props, step: "duo", authenticated: true })));
    assert.match(host.textContent ?? "", /Reconnect to finish setup/);
    assert.doesNotMatch(host.textContent ?? "", /Start with your details/);
    await act(async () => root.render(createElement(Onboarding, { ...props, step: "login", authenticated: false })));
    for (const [name, value] of [["email", "fixture@ucsd.edu"], ["password", "disposable-fixture-password"]]) {
      await act(async () => { const field = host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true })); });
    }
    await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    assert.equal(host.querySelector<HTMLInputElement>('input[name="password"]')!.value, "disposable-fixture-password");
    assert.ok(host.querySelector('[role="alert"]')?.textContent);
    assert.deepEqual(transitions, []);
    assert.doesNotMatch(host.textContent ?? "", /Demo:/);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
