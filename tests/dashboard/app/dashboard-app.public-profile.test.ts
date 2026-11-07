// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { it, vi } from "vitest";
import { DashboardApp } from "../../../src/dashboard/app/dashboard-app.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

for (const source of ["show", "poll", "initial", "initial-network"] as const) it(`keeps explicit browser recovery after a closure failure (${source})`, async () => {
  vi.useFakeTimers();
  const previous = window.location.href; window.history.replaceState(null, "", "/");
  const idle = { state: "idle", ceremonyObserved: false, portalAccepted: false, operatorConfirmed: false, exactCredentialRequestObserved: false };
  const draft = { browser: { state: "open" as const, generation: 1 }, state: "onboarding", operationId: "00000000-0000-4000-8000-000000000001",
    profileId: "00000000-0000-4000-8000-000000000002", step: "duo", methods: { key: idle, touch: idle } };
  const calls: string[] = [];
  const client = createDashboardClient({ baseUrl: "http://localhost:3938", fetchImpl: async url => {
    const path = new URL(url).pathname; calls.push(path);
    assert.ok(["/api/v1/profile/state", "/api/v1/profile/onboarding/duo/browser", "/api/v1/profile/onboarding/duo/reopen"].includes(path));
    if (source === "initial-network" && calls.length === 1) throw new TypeError("synthetic initial read unavailable");
    return Response.json(path.endsWith("/reopen") ? { ...draft, browser: { state: "open", generation: 2 } } : source.startsWith("initial") && calls.length > 1 ? { ...draft, browser: { state: "closed", generation: 1 } } : calls.length === 1 && !source.startsWith("initial") ? draft : { state: "refused", code: "BROWSER_CLOSURE_UNPROVED" });
  } });
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  const button = (text: string) => { const result = [...host.querySelectorAll("button")].find(button => button.textContent === text); assert.ok(result); return result; };
  try {
    await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp, { profileSource: "served" }) })));
    if (source.startsWith("initial")) {
      assert.equal(host.querySelector("h1")?.textContent, "Log in to Relay");
      if (source === "initial") assert.match(host.querySelector('[role="alert"]')?.textContent ?? "", /Browser closure could not be verified/);
      assert.equal(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled, true);
      await act(async () => vi.advanceTimersByTimeAsync(1000));
      assert.equal(host.querySelector("form"), null);
      assert.equal(button("Reopen").disabled, false);
    } else {
      await act(async () => { if (source === "show") button("Show window").click(); else await vi.advanceTimersByTimeAsync(1000); });
      assert.match(host.textContent ?? "", /Could not reopen setup window/);
      assert.equal(host.querySelector("form"), null, "the current draft survives the failed action or read");
      assert.equal(button("Reopen").disabled, false);
      await act(async () => button("Reopen").click());
      assert.ok(calls.includes("/api/v1/profile/onboarding/duo/reopen"));
      assert.match(host.textContent ?? "", /Setup window is open/);
    }
    assert.doesNotMatch(host.textContent ?? "", /Current profile authority is unavailable/);
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
