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
  const port: ServedOnboardingPort = { source: "served", showBrowser: async () => ({ state: "refused", code: "PROFILE_AUTHORITY_UNAVAILABLE" }), openPortal: async () => ({ state: "refused", code: "PROFILE_AUTHORITY_UNAVAILABLE" }), validate: (step, details) => mockOnboardingPort.validate(step, details),
    async complete() { throw new Error("not called"); }, async cancel() { throw new Error("not called"); }, async cancelDuo() { throw new Error("not called"); },
    async start() { throw new Error("not called"); }, async confirmDuo() { throw new Error("not called"); },
    async submit() { return { state: "refused", code: "PROFILE_SIGN_IN_REFUSED" }; } };
  const props = { port, onStep: (step: OnboardingStep) => { transitions.push(step); }, onDashboard() { transitions.push("dashboard"); } };
  try {
    await act(async () => root.render(createElement(Onboarding, { ...props, step: "duo", authenticated: false })));
    assert.match(host.textContent ?? "", /Start with your details/);
    await act(async () => root.render(createElement(Onboarding, { ...props, step: "duo", authenticated: true })));
    assert.equal(host.querySelector("h1")?.textContent, "Security key");
    assert.match(host.textContent ?? "", /could not show the setup browser/);
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
  const port: ServedOnboardingPort = { source: "served", showBrowser: async () => ({ state: "refused", code: "PROFILE_AUTHORITY_UNAVAILABLE" }), openPortal: async () => ({ state: "refused", code: "PROFILE_AUTHORITY_UNAVAILABLE" }), onboarding, validate: mockOnboardingPort.validate,
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
  const port: ServedOnboardingPort = { source: "served", showBrowser: async () => ({ state: "refused", code: "PROFILE_AUTHORITY_UNAVAILABLE" }), openPortal: async () => ({ state: "refused", code: "PROFILE_AUTHORITY_UNAVAILABLE" }), onboarding, validate: mockOnboardingPort.validate,
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
  const port: ServedOnboardingPort = { source: "served", showBrowser: async () => ({ state: "refused", code: "PROFILE_AUTHORITY_UNAVAILABLE" }), openPortal: async () => ({ state: "refused", code: "PROFILE_AUTHORITY_UNAVAILABLE" }), onboarding: draft, validate: mockOnboardingPort.validate,
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
  const port: ServedOnboardingPort = { source: "served", showBrowser: async () => ({ state: "refused", code: "PROFILE_AUTHORITY_UNAVAILABLE" }), openPortal: async () => ({ state: "refused", code: "PROFILE_AUTHORITY_UNAVAILABLE" }), onboarding, validate: mockOnboardingPort.validate,
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
  const port: ServedOnboardingPort = { source: "served", showBrowser: async () => ({ state: "refused", code: "PROFILE_AUTHORITY_UNAVAILABLE" }), openPortal: async () => ({ state: "refused", code: "PROFILE_AUTHORITY_UNAVAILABLE" }), onboarding: draft, validate: mockOnboardingPort.validate,
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


it("unknown enrollment copy never directs adding the uncertain method again", async () => {
  const host = document.createElement("div"), root = createRoot(host);
  const method = { state: "idle" as const, ceremonyObserved: false, portalAccepted: false, operatorConfirmed: false, exactCredentialRequestObserved: false };
  const onboarding = { state: "onboarding" as const, operationId: "00000000-0000-4000-8000-000000000001", profileId: "00000000-0000-4000-8000-000000000002", step: "duo" as const,
    methods: { key: { ...method, state: "unknown" as const, attemptId: "00000000-0000-4000-8000-000000000003" }, touch: method } };
  const unavailable = async () => ({ state: "refused" as const, code: "PROFILE_AUTHORITY_UNAVAILABLE" as const });
  const port: ServedOnboardingPort = { source: "served", onboarding, unavailable: true, validate: mockOnboardingPort.validate,
    showBrowser: unavailable, openPortal: unavailable, complete: unavailable, cancel: unavailable, cancelDuo: unavailable, start: unavailable, confirmDuo: unavailable, submit: unavailable };
  try {
    await act(async () => root.render(createElement(Onboarding, { step: "duo", onStep() {}, onDashboard() {}, port })));
    assert.equal(host.querySelector("h1")?.textContent, "Security key");
    assert.match(host.textContent ?? "", /Security keyFailed/);
    assert.doesNotMatch(host.textContent ?? "", /outcome unknown|Needs review|may already have been added/);
    assert.match(host.textContent ?? "", /without repeating this attempt/);
    assert.doesNotMatch(host.textContent ?? "", /Security key is next|Start with a security key|then add a security key|Security key and Touch ID not added/);
    const steps: string[] = [];
    const stalePort = { ...port, reauthenticationRequired: true, cancel: async () => { throw new Error("must not cancel stale draft"); } };
    await act(async () => root.render(createElement(Onboarding, { step: "duo", onStep(step) { steps.push(step); }, onDashboard() {}, port: stalePort })));
    assert.match(host.textContent ?? "", /original profile details/);
    const recover = [...host.querySelectorAll("button")].find(button => button.textContent === "Return to your details"); assert.ok(recover);
    await act(async () => recover.click());
    assert.deepEqual(steps, ["signup"]);
    for (const state of ["pending", "unavailable"] as const) {
      const currentPort = { ...port, unavailable: false, onboarding: { ...onboarding, methods: { ...onboarding.methods, key: { ...onboarding.methods.key, state } } } };
      await act(async () => root.render(createElement(Onboarding, { step: "duo", onStep() {}, onDashboard() {}, port: currentPort })));
      assert.equal(host.querySelector("h1")?.textContent, "Security key");
      assert.match(host.textContent ?? "", state === "pending" ? /Security keyPending/ : /Security keyFailed/);
      assert.doesNotMatch(host.textContent ?? "", /Start with a security key|Next, add a security key/);
    }
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("both served setup pages keep method outcomes visible without offering another failed capture", async () => {
  const host = document.createElement("div"), root = createRoot(host);
  const method = { state: "idle" as const, ceremonyObserved: false, portalAccepted: false, operatorConfirmed: false, exactCredentialRequestObserved: false };
  const calls: string[] = [];
  const unavailable = async () => ({ state: "refused" as const, code: "PROFILE_AUTHORITY_UNAVAILABLE" as const });
  try {
    for (const page of ["fast", "duo"] as const) for (const [state, label] of [["idle", "Not started"], ["pending", "Pending"], ["complete", "Completed"], ["unknown", "Failed"], ["unavailable", "Failed"]] as const) {
      const port: ServedOnboardingPort = { source: "served", validate: mockOnboardingPort.validate,
        onboarding: { state: "onboarding", operationId: "00000000-0000-4000-8000-000000000001", profileId: "00000000-0000-4000-8000-000000000002", step: "duo",
          methods: { key: { ...method, state, attemptId: "00000000-0000-4000-8000-000000000003" }, touch: method } },
        showBrowser: unavailable, openPortal: unavailable, complete: unavailable, cancel: unavailable, cancelDuo: unavailable,
        start: async () => { calls.push("start"); return unavailable(); }, confirmDuo: unavailable, submit: unavailable };
      await act(async () => root.render(createElement(OnboardingSetup, { page, port })));
      const row = host.querySelector(page === "fast" ? ".method-list li" : ".device-row"); assert.ok(row);
      assert.equal(row.querySelector(page === "fast" ? ".duo-method-pill" : "p")?.textContent, label);
      assert.doesNotMatch(host.textContent ?? "", /Not added|Needs review|outcome unknown/);
      assert.match(host.querySelector(".sr-only")?.textContent ?? "", new RegExp(`Security key: ${label}`));
      if (state === "unknown" || state === "unavailable") {
        const capture = page === "fast" ? [...host.querySelectorAll("button")].find(button => button.textContent === "Start capture") : row.querySelector("button");
        assert.ok(capture); assert.equal(capture.disabled, true);
        await act(async () => capture.click());
        assert.equal(calls.length, 0);
        if (page === "fast") assert.match(host.textContent ?? "", /without repeating this attempt/);
      }
    }
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("selects Fast Duo cards through the device selector and blocks selection while a method is pending or busy", async () => {
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  const idle = { state: "idle" as const, ceremonyObserved: false, portalAccepted: false, operatorConfirmed: false, exactCredentialRequestObserved: false };
  const draft = { state: "onboarding" as const, operationId: "00000000-0000-4000-8000-000000000001", profileId: "00000000-0000-4000-8000-000000000002", step: "duo" as const, methods: { key: idle, touch: idle } };
  const unused = async (): Promise<never> => { throw new Error("unexpected command"); };
  let settle!: (value: typeof draft) => void;
  const port: ServedOnboardingPort = { source: "served", onboarding: draft, validate: mockOnboardingPort.validate, submit: unused, complete: unused, cancel: unused, cancelDuo: unused, start: unused, confirmDuo: unused, showBrowser: unused, openPortal: () => new Promise(resolve => { settle = resolve; }) };
  const cards = () => [...host.querySelectorAll<HTMLButtonElement>(".method-card")];
  try {
    await act(async () => root.render(createElement(OnboardingSetup, { page: "fast", port })));
    assert.equal(cards().length, 2);
    assert.equal(host.querySelector(".method-heading")?.textContent, "Relay sign-in methods0 of 2 completed");
    await act(async () => cards()[1].click());
    assert.equal(cards()[1].getAttribute("aria-pressed"), "true");
    const select = host.querySelector<HTMLSelectElement>("#device-type"); assert.ok(select);
    assert.equal(select.value, "touch");
    await act(async () => { select.value = "key"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    assert.equal(cards()[0].getAttribute("aria-pressed"), "true");
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Open duo.ucsd.edu")!.click());
    assert.ok(cards().every(card => card.disabled)); assert.equal(select.disabled, true);
    await act(async () => settle(draft));
    assert.ok(cards().every(card => !card.disabled));
    await act(async () => root.render(createElement(OnboardingSetup, { page: "fast", port: { ...port, onboarding: { ...draft, methods: { key: idle, touch: { ...idle, state: "pending", attemptId: "00000000-0000-4000-8000-000000000003" } } } } })));
    assert.ok(cards().every(card => card.disabled)); assert.equal(select.disabled, true);
    await act(async () => cards()[1].click());
    assert.equal(select.value, "key");
    assert.equal(cards()[1].querySelector(".duo-method-pill")?.textContent, "Pending");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
