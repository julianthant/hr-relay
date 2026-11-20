// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { ProfileOnboardingStateSchema } from "../../../../src/models/profiles/public-profile.js";
import type { ServedOnboardingPort } from "../../../../src/dashboard/surfaces/shell/onboarding-model.js";
import { OnboardingSetup } from "../../../../src/dashboard/surfaces/shell/onboarding-setup.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const done = { state: "complete", ceremonyObserved: true, portalAccepted: true, operatorConfirmed: true, exactCredentialRequestObserved: true };
const idle = { state: "idle", ceremonyObserved: false, portalAccepted: false, operatorConfirmed: false, exactCredentialRequestObserved: false };
const draft = (methods: { key: object; touch: object }, step: "duo" | "ready") => ProfileOnboardingStateSchema.parse({ state: "onboarding", operationId: "00000000-0000-4000-8000-000000000001",
  profileId: "00000000-0000-4000-8000-000000000003", step, methods, browser: { state: "open", generation: 0 } });

async function mount(onboarding: ReturnType<typeof draft>, over: Partial<ServedOnboardingPort>) {
  const calls: string[] = [];
  const never = () => Promise.reject(new Error("unused"));
  const port: ServedOnboardingPort = { reenrol: true, onboarding, validate: () => ({}), complete: never, cancel: never, cancelDuo: never, showBrowser: never, reopenBrowser: never, openPortal: never, start: never, confirmDuo: never, resume: never, submit: never, ...over };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(createElement(OnboardingSetup, { page: "fast", port })));
  const button = (name: string) => [...host.querySelectorAll("button")].find(item => item.textContent === name);
  return { calls, host, button, async close() { await act(async () => root.unmount()); host.remove(); } };
}

it("keeps Use new devices off until both methods are proven and cancels from the same footer", async () => {
  const calls: string[] = [];
  const f = await mount(draft({ key: done, touch: idle }, "duo"), { cancel: async () => { calls.push("cancel"); return { state: "active", profileId: "00000000-0000-4000-8000-000000000003", epoch: 1, duoState: "ready" }; } });
  try {
    assert.equal(f.button("Use new devices")?.disabled, true);
    await act(async () => { f.button("Cancel setup")?.click(); });
    assert.deepEqual(calls, ["cancel"]);
  } finally { await f.close(); }
});

it("switches through the served port when both methods are proven and shows a refusal with the backend's text", async () => {
  const calls: string[] = [];
  const f = await mount(draft({ key: done, touch: done }, "ready"), { complete: async () => { calls.push("complete"); throw Object.assign(new Error("refused"), { code: "PROFILE_DUO_REENROL_BUSY" }); } });
  try {
    assert.equal(f.button("Use new devices")?.disabled, false);
    await act(async () => { f.button("Use new devices")?.click(); });
    assert.deepEqual(calls, ["complete"]);
    assert.match(f.host.querySelector("[role=alert]")?.textContent ?? "", /Relay can switch to the new Duo setup only while no run/u);
    assert.ok(f.button("Cancel setup"));
  } finally { await f.close(); }
});

it("sends one close command when both footer actions are pressed before React re-renders", async () => {
  const calls: string[] = [];
  const pending = (name: string) => () => { calls.push(name); return new Promise<never>(() => undefined); };
  const f = await mount(draft({ key: done, touch: done }, "ready"), { complete: pending("complete"), cancel: pending("cancel") });
  try {
    const use = f.button("Use new devices"), cancel = f.button("Cancel setup"); assert.ok(use); assert.ok(cancel);
    await act(async () => { use.click(); use.click(); cancel.click(); });
    assert.deepEqual(calls, ["complete"]);
    assert.equal(f.button("Switching…")?.getAttribute("aria-busy"), "true");
  } finally { await f.close(); }
});
