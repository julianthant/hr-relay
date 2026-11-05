// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { it, vi } from "vitest";
import { DashboardApp } from "../../../src/dashboard/app/dashboard-app.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

for (const source of ["show", "poll", "initial"] as const) it(`explains the Duo closure hold without an authority error (${source})`, async () => {
  vi.useFakeTimers();
  const previous = window.location.href; window.history.replaceState(null, "", source === "poll" ? "/?onboardingSetup=duo" : "/");
  const idle = { state: "idle", ceremonyObserved: false, portalAccepted: false, operatorConfirmed: false, exactCredentialRequestObserved: false };
  const draft = { browser: { state: "open" as const, generation: 1 }, state: "onboarding", operationId: "00000000-0000-4000-8000-000000000001",
    profileId: "00000000-0000-4000-8000-000000000002", step: "duo", methods: { key: idle, touch: idle } };
  const calls: string[] = [];
  const client = createDashboardClient({ baseUrl: "http://localhost:3938", fetchImpl: async url => {
    const path = new URL(url).pathname; calls.push(path);
    assert.ok(path === "/api/v1/profile/state" || source === "show" && path === "/api/v1/profile/onboarding/duo/browser");
    return Response.json(calls.length === 1 && source !== "initial" ? draft : { state: "refused", code: "BROWSER_CLOSURE_UNPROVED" });
  } });
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  try {
    await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp, { profileSource: "served" }) })));
    await act(async () => {
      if (source === "show") {
        const show = [...host.querySelectorAll("button")].find(button => button.textContent === "Show setup browser"); assert.ok(show); show.click();
      } else if (source === "poll") await vi.advanceTimersByTimeAsync(1000);
    });
    assert.equal(host.querySelector("h1")?.textContent, "Sign-up on hold");
    assert.equal(host.querySelector('[role="alert"]')?.textContent, "Relay could not confirm the Duo setup browser closed. Sign-up is on hold. Close and reopen Relay to continue.");
    assert.doesNotMatch(host.textContent ?? "", /Current profile authority is unavailable|If the browser stays behind|Reopen it to try again/);
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('main button[type="submit"], main .actions button, main .step-link')];
    assert.ok(buttons.length > 0); assert.ok(buttons.every(button => button.disabled));
    await act(async () => { for (const button of buttons) button.click(); await vi.advanceTimersByTimeAsync(5000); });
    assert.equal(calls.length, source === "initial" ? 1 : 2);
  } finally { await act(async () => root.unmount()); vi.useRealTimers(); host.remove(); window.history.replaceState(null, "", previous); }
});

for (const route of ["/", "/?onboarding=ready", "/?onboardingSetup=duo"]) it(`keeps the served public login outside selected authority for ${route}`, async () => {
  const previous = window.location.href;
  window.history.replaceState(null, "", route);
  const calls: string[] = [];
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1:5174", fetchImpl: async url => {
    const path = new URL(url).pathname; calls.push(path);
    assert.equal(path, "/api/v1/profile/state", "public login cannot request selected APIs");
    return Response.json({ state: "signed-out" });
  } });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(StrictMode, { children: createElement(DashboardClientProvider,
      { client, children: createElement(DashboardApp, { profileSource: "served" }) }) })));
    assert.match(host.textContent ?? "", /Log in to Relay/);
    assert.doesNotMatch(host.textContent ?? "", /Demo:|UI mock|Both methods are registered/);
    assert.ok(calls.length > 0);
    assert.ok(calls.every(path => path === "/api/v1/profile/state"));
    assert.equal(host.querySelector('[data-source="served"]') !== null, true);
  } finally { await act(async () => root.unmount()); host.remove(); window.history.replaceState(null, "", previous); }
});


for (const ready of [false, true]) it(`resumes the server draft stage without ordinary authority (ready=${ready})`, async () => {
  const previous = window.location.href; window.history.replaceState(null, "", "/");
  const method = (complete: boolean) => ({ state: complete ? "complete" : "idle", ceremonyObserved: complete,
    portalAccepted: complete, operatorConfirmed: complete, exactCredentialRequestObserved: false });
  const calls: string[] = [];
  const client = createDashboardClient({ baseUrl: "http://localhost:3938", fetchImpl: async url => {
    const path = new URL(url).pathname; calls.push(path); assert.equal(path, "/api/v1/profile/state");
    return Response.json({ browser: { state: "open" as const, generation: 1 }, state: "onboarding", operationId: "00000000-0000-4000-8000-000000000001",
      profileId: "00000000-0000-4000-8000-000000000002", step: ready ? "ready" : "duo", methods: { key: method(ready), touch: method(ready) } });
  } });
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  try {
    await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp, { profileSource: "served" }) })));
    assert.equal(host.querySelector('[data-source="served"]') !== null, true);
    assert.equal(host.querySelector('form'), null);
    assert.ok(calls.length > 0); assert.ok(calls.every(path => path === "/api/v1/profile/state"));
    if (ready) assert.equal(host.querySelector<HTMLButtonElement>("main button:not(ol button)")?.disabled, false);
  } finally { await act(async () => root.unmount()); host.remove(); window.history.replaceState(null, "", previous); }
});
