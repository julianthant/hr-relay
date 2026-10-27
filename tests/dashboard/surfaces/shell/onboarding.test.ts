import { OnboardingSetup } from "../../../../src/dashboard/surfaces/shell/onboarding-setup.js";
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
    async complete() { throw new Error("not called"); }, async cancel() { throw new Error("not called"); }, async cancelDuo() { throw new Error("not called"); },
    async start() { throw new Error("not called"); }, async confirmDuo() { throw new Error("not called"); },
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


it("Ready only dispatches Finish and does not navigate on refusal or uncertain completion", async () => {
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  const method = { state: "complete" as const, ceremonyObserved: true, portalAccepted: true, operatorConfirmed: true, exactCredentialRequestObserved: false };
  const onboarding = { state: "onboarding" as const, operationId: "00000000-0000-4000-8000-000000000001",
    profileId: "00000000-0000-4000-8000-000000000002", step: "ready" as const, methods: { key: method, touch: method } };
  let completed = 0, navigated = 0, uncertain = false;
  const unused = async (): Promise<never> => { throw new Error("unexpected call"); };
  const port: ServedOnboardingPort = { source: "served", onboarding, validate: mockOnboardingPort.validate,
    submit: unused, cancel: unused, cancelDuo: unused, start: unused, confirmDuo: unused,
    async complete() { completed++; if (uncertain) throw new Error("lost response"); return { state: "refused", code: "PROFILE_TRANSITION_BLOCKED" }; },
  };
  const props = { port, step: "ready" as const, onStep() {}, onDashboard() { navigated++; } };
  const finish = () => { const button = host.querySelector<HTMLButtonElement>("main button:not(ol button)"); assert.ok(button); return button; };
  try {
    await act(async () => root.render(createElement(Onboarding, props)));
    assert.equal(completed, 0); assert.equal(navigated, 0); assert.equal(finish().disabled, false);
    await act(async () => finish().click());
    assert.equal(completed, 1); assert.equal(navigated, 0); assert.ok(host.querySelector('[role="alert"]')?.textContent);
    uncertain = true;
    await act(async () => finish().click());
    assert.equal(completed, 2); assert.equal(navigated, 0); assert.equal(finish().disabled, true);
    await act(async () => finish().click()); assert.equal(completed, 2);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("Finish navigates only after the matching active completion settles", async () => {
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  const method = { state: "complete" as const, ceremonyObserved: true, portalAccepted: true, operatorConfirmed: true, exactCredentialRequestObserved: false };
  const onboarding = { state: "onboarding" as const, operationId: "00000000-0000-4000-8000-000000000001",
    profileId: "00000000-0000-4000-8000-000000000002", step: "ready" as const, methods: { key: method, touch: method } };
  const reply = Promise.withResolvers<import("../../../../src/models/profiles/public-profile.js").PublicProfileState>();
  const unused = async (): Promise<never> => { throw new Error("unexpected call"); };
  const port: ServedOnboardingPort = { source: "served", onboarding, validate: mockOnboardingPort.validate,
    submit: unused, cancel: unused, cancelDuo: unused, start: unused, confirmDuo: unused, complete: () => reply.promise };
  let navigated = 0;
  try {
    await act(async () => root.render(createElement(Onboarding, { port, step: "ready", onStep() {}, onDashboard() { navigated++; } })));
    await act(async () => host.querySelector<HTMLButtonElement>("main button:not(ol button)")!.click());
    assert.equal(navigated, 0);
    await act(async () => { reply.resolve({ state: "active", profileId: onboarding.profileId, epoch: 1, duoState: "ready" }); });
    assert.equal(navigated, 1);
  } finally { await act(async () => root.unmount()); host.remove(); }
});


it("a late Finish result cannot navigate a replacement draft", async () => {
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  const method = { state: "complete" as const, ceremonyObserved: true, portalAccepted: true, operatorConfirmed: true, exactCredentialRequestObserved: false };
  const draft = { state: "onboarding" as const, operationId: "00000000-0000-4000-8000-000000000001",
    profileId: "00000000-0000-4000-8000-000000000002", step: "ready" as const, methods: { key: method, touch: method } };
  const reply = Promise.withResolvers<import("../../../../src/models/profiles/public-profile.js").PublicProfileState>();
  const unused = async (): Promise<never> => { throw new Error("unexpected call"); };
  const port: ServedOnboardingPort = { source: "served", onboarding: draft, validate: mockOnboardingPort.validate,
    submit: unused, cancel: unused, cancelDuo: unused, start: unused, confirmDuo: unused, complete: () => reply.promise };
  let navigated = 0;
  const props = { step: "ready" as const, onStep() {}, onDashboard() { navigated++; } };
  try {
    await act(async () => root.render(createElement(Onboarding, { ...props, port })));
    await act(async () => host.querySelector<HTMLButtonElement>("main button:not(ol button)")!.click());
    await act(async () => root.render(createElement(Onboarding, { ...props, port: { ...port, onboarding: { ...draft, operationId: "00000000-0000-4000-8000-000000000003" } } })));
    await act(async () => { reply.resolve({ state: "active", profileId: draft.profileId, epoch: 1, duoState: "ready" }); });
    assert.equal(navigated, 0);
  } finally { await act(async () => root.unmount()); host.remove(); }
});


it("returning to Details requires confirmed draft cancellation", async () => {
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  const method = { state: "idle" as const, ceremonyObserved: false, portalAccepted: false, operatorConfirmed: false, exactCredentialRequestObserved: false };
  const onboarding = { state: "onboarding" as const, operationId: "00000000-0000-4000-8000-000000000001",
    profileId: "00000000-0000-4000-8000-000000000002", step: "duo" as const, methods: { key: method, touch: method } };
  const unused = async (): Promise<never> => { throw new Error("unexpected call"); };
  let allow = false, cancelled = 0;
  const port: ServedOnboardingPort = { source: "served", onboarding, validate: mockOnboardingPort.validate,
    submit: unused, complete: unused, cancelDuo: unused, start: unused, confirmDuo: unused,
    async cancel() { cancelled++; return allow ? { state: "signed-out" } : { state: "refused", code: "PROFILE_TRANSITION_BLOCKED" }; } };
  const transitions: OnboardingStep[] = [];
  const props = { port, step: "duo" as const, onStep(step: OnboardingStep) { transitions.push(step); }, onDashboard() { throw new Error("early dashboard"); } };
  const details = () => { const buttons = host.querySelectorAll<HTMLButtonElement>("ol button"); assert.equal(buttons.length, 3); return buttons[0]; };
  try {
    await act(async () => root.render(createElement(Onboarding, props)));
    await act(async () => details().click());
    assert.equal(cancelled, 1); assert.deepEqual(transitions, []);
    allow = true;
    await act(async () => details().click());
    assert.equal(cancelled, 2); assert.deepEqual(transitions, ["signup"]);
  } finally { await act(async () => root.unmount()); host.remove(); }
});


it("the served consent dialog closes when its displayed attempt is replaced", async () => {
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  const attemptId = "00000000-0000-4000-8000-000000000003";
  const idle = { state: "idle" as const, ceremonyObserved: false, portalAccepted: false, operatorConfirmed: false, exactCredentialRequestObserved: false };
  const draft = { state: "onboarding" as const, operationId: "00000000-0000-4000-8000-000000000001",
    profileId: "00000000-0000-4000-8000-000000000002", step: "duo" as const, methods: { key: { ...idle, state: "pending" as const, attemptId }, touch: idle } };
  const unused = async (): Promise<never> => { throw new Error("unexpected call"); };
  let confirmed = 0;
  const port: ServedOnboardingPort = { source: "served", onboarding: draft, validate: mockOnboardingPort.validate,
    submit: unused, complete: unused, cancel: unused, cancelDuo: unused, start: unused,
    async confirmDuo() { confirmed++; return draft; } };
  try {
    await act(async () => root.render(createElement(OnboardingSetup, { page: "duo", port })));
    const buttons = host.querySelectorAll<HTMLButtonElement>("section button"); assert.equal(buttons.length, 2);
    await act(async () => buttons[0].click());
    assert.ok(document.querySelector('[role="dialog"]'));
    await act(async () => root.render(createElement(OnboardingSetup, { page: "duo", port: { ...port, onboarding: { ...draft,
      methods: { ...draft.methods, key: { ...draft.methods.key, attemptId: "00000000-0000-4000-8000-000000000004" } } } } })));
    assert.equal(document.querySelector('[role="dialog"]'), null); assert.equal(confirmed, 0);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
