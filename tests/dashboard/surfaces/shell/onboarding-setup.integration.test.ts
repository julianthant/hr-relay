// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { ProfileOnboardingStateSchema } from "../../../../src/models/profiles/public-profile.js";
import type { ServedOnboardingPort } from "../../../../src/dashboard/surfaces/shell/onboarding-model.js";
import { OnboardingSetup } from "../../../../src/dashboard/surfaces/shell/onboarding-setup.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const idle = { state: "idle", ceremonyObserved: false, portalAccepted: false, operatorConfirmed: false, exactCredentialRequestObserved: false };
const draft = (browser: object) => ProfileOnboardingStateSchema.parse({ state: "onboarding", operationId: "00000000-0000-4000-8000-000000000001",
  profileId: "00000000-0000-4000-8000-000000000003", step: "duo", methods: { key: idle, touch: idle }, browser });

async function mount(onboarding: ReturnType<typeof draft>, over: Partial<ServedOnboardingPort> = {}) {
  const never = () => Promise.reject(new Error("unused"));
  const port: ServedOnboardingPort = { reenrol: true, onboarding, validate: () => ({}), complete: never, cancel: never, cancelDuo: never, showBrowser: never, reopenBrowser: never, openPortal: never, start: never, confirmDuo: never, resume: never, submit: never, ...over };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(createElement(OnboardingSetup, { page: "fast", port })));
  const button = (name: string) => [...host.querySelectorAll("button")].find(item => item.textContent === name);
  return { host, button, async close() { await act(async () => root.unmount()); host.remove(); } };
}

it.each([
  ["DUO_SETUP_OPEN_FAILED", /The setup browser did not start\. Select Reopen to try again/u],
  ["DUO_SETUP_STOP_FAILED", /The previous setup browser did not stop\. Select Reopen to try again/u],
  ["DUO_SETUP_FILES_BUSY", /The setup browser’s files are in use\. Select Reopen to check again/u],
] as const)("shows %s with its sentence and a Reopen action that dispatches the reopen command", async (code, sentence) => {
  const calls: string[] = [];
  const f = await mount(draft({ state: "failed", generation: 2, code }), { reopenBrowser: async () => { calls.push("reopen"); return draft({ state: "open", generation: 3 }); } });
  try {
    assert.match(f.host.querySelector("[role=alert]")?.textContent ?? "", sentence);
    assert.equal(f.button("Add this device")?.disabled, true);
    await act(async () => { f.button("Reopen")?.click(); });
    assert.deepEqual(calls, ["reopen"]);
  } finally { await f.close(); }
});

it("tells the operator the setup browser was closed and offers Reopen; a healthy window offers none", async () => {
  const closed = await mount(draft({ state: "closed", generation: 1 }));
  try {
    assert.match(closed.host.querySelector("[role=alert]")?.textContent ?? "", /setup browser was closed/u);
    assert.ok(closed.button("Reopen"));
  } finally { await closed.close(); }
  const open = await mount(draft({ state: "open", generation: 1 }));
  try { assert.equal(open.button("Reopen"), undefined); } finally { await open.close(); }
});

it("shows one plain failure and disables Add this device when the status read fails, with re-enrolment wording", async () => {
  const f = await mount(draft({ state: "open", generation: 1 }), { unavailable: true });
  try {
    const alerts = [...f.host.querySelectorAll("[role=alert]")].map(item => item.textContent);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0] ?? "", /could not read the setup status/u);
    assert.equal(f.button("Add this device")?.disabled, true);
    assert.doesNotMatch(f.host.textContent ?? "", /Current profile authority is unavailable|sign-up|Onboarding 1|Fast Duo|capture|software key|enrol/iu);
    assert.equal(f.host.querySelector("h1")?.textContent, "Set up Duo again");
  } finally { await f.close(); }
});
