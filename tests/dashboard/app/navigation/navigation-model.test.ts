// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, vi } from "vitest";
import { DashboardApp } from "../../../../src/dashboard/app/dashboard-app.js";
import { createDashboardClient, type DashboardClient } from "../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { createPersonPreferences } from "../../../../src/dashboard/state/person-preferences-model.js";
import type { DuoReenrolState, PublicProfileState } from "../../../../src/models/profiles/public-profile.js";
import { createFixtureBff } from "../../../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY_WIRE } from "../../../support/helpers/dashboard/mock-world/fixture-queue.js";
import { MOCK_WORKFLOW_COMPOSITION } from "../../../support/helpers/dashboard/mock-world/workflow-composition.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

it("accepts browser Back from Settings while Duo setup is open", async () => {
  const profileId = "00000000-0000-4000-8000-000000000001";
  const session: PublicProfileState = { state: "active", profileId, epoch: 1, duoState: "ready",
    account: { name: "Jordan Lee", initials: "JL", timekeeper: "Jordan Lee", timekeeperInitials: "JL", lastSignedInAt: "2026-11-10T08:30:00-08:00" } };
  const setup: DuoReenrolState = { state: "duo-reenrol", profileId, operationId: "00000000-0000-4000-8000-000000000002",
    step: "duo", browser: { state: "open", generation: 1 }, methods: { key: { state: "idle",
      ceremonyObserved: false, portalAccepted: false, operatorConfirmed: false, exactCredentialRequestObserved: false } } };
  const { app } = createFixtureBff();
  const client: DashboardClient = {
    ...createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: (url, init) => app.request(url, init) }),
    readProfileSession: async () => session,
    readProfileDuoKeys: async () => ({ revision: 1, keys: [] }),
    beginProfileDuoReenrol: async () => setup,
    readProfileDuoReenrol: async () => setup,
    cancelProfileDuoReenrol: async () => session,
    subscribeDay: options => {
      options.onDay(FIXTURE_DAY_WIRE);
      options.onState({ state: "live" });
      return { select() {}, close() {} };
    },
  };
  const previousUrl = window.location.href;
  const previousState: unknown = window.history.state;
  window.history.replaceState({ hrDashboardRouteCursor: 0 }, "", "/");
  window.history.pushState({ hrDashboardRouteCursor: 1 }, "", "/?settings=account");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const button = (label: string) => [...host.querySelectorAll("button")].find(control => control.textContent === label);
  const settings = () => host.querySelector('nav[aria-label="Settings sections"]');
  const errors: unknown[] = [];
  const captureError = (event: ErrorEvent) => { errors.push(event.error); event.preventDefault(); };
  window.addEventListener("error", captureError);
  try {
    await act(async () => root.render(createElement(DashboardClientProvider, { client,
      children: createElement(DashboardApp, { workflowComposition: MOCK_WORKFLOW_COMPOSITION,
        previewPreferences: createPersonPreferences("preview") }),
    })));
    const openSetup = await vi.waitFor(() => {
      assert.ok(settings());
      const control = button("Set up");
      assert.ok(control);
      return control;
    });
    await act(async () => openSetup.click());
    assert.equal(host.querySelector("h1")?.textContent, "Set up Duo again");
    assert.equal(settings(), null);

    await act(async () => {
      const popped = new Promise<void>(resolve => window.addEventListener("popstate", () => resolve(), { once: true }));
      window.history.back();
      await popped;
    });

    const cancelSetup = button("Cancel setup");
    assert.ok(cancelSetup);
    await act(async () => cancelSetup.click());
    await vi.waitFor(() => assert.ok(errors.length > 0 || host.querySelector("#dashboard-main-region")));
    if (errors.length > 0) throw errors[0];
    assert.equal(settings(), null);
    assert.equal(window.location.search, "");
  } finally {
    window.removeEventListener("error", captureError);
    await act(async () => root.unmount());
    host.remove();
    window.history.replaceState(previousState, "", previousUrl);
  }
});
