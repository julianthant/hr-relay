// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it, vi } from "vitest";
import { DashboardApp } from "../../../src/dashboard/app/dashboard-app.js";
import { createDashboardClient, type DashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { createPersonPreferences } from "../../../src/dashboard/state/person-preferences-model.js";
import { createFixtureBff } from "../../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_BOOTSTRAP } from "../../mocks/helpers/fixture-bootstrap.js";
import { FIXTURE_DAY_WIRE } from "../../mocks/helpers/fixture-queue.js";
import { MOCK_WORKFLOW_COMPOSITION } from "../../mocks/helpers/workflow-composition.js";
import { operatorFailureSentence } from "../../../src/models/failures/error-catalog.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); window.history.replaceState(null, "", "/"); });

async function mount(deletion: () => Promise<Response>, profileSource: "served" | "mock" = "served") {
  const requests: { path: string; body: unknown }[] = [];
  const { app } = createFixtureBff();
  const transport = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/api/v1/profile/state") return Response.json({ state: "active", profileId: "00000000-0000-4000-8000-000000000001", epoch: 1, duoState: "ready", account: { name: "Jordan Lee", initials: "JL", timekeeper: "Jordan Lee", lastSignedInAt: "2026-11-10T08:30:00-08:00" } });
    if (path === "/api/v1/profile/delete-account") {
      const body = init?.body;
      assert.ok(typeof body === "string");
      requests.push({ path, body: JSON.parse(body) as unknown });
      return deletion();
    }
    return app.request(url, init);
  } });
  const client: DashboardClient = { ...transport, subscribeDay: options => {
    options.onDay(FIXTURE_DAY_WIRE); options.onState({ state: "live" }); return { close() {} };
  } };
  window.history.replaceState(null, "", "/?settings=account");
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp, {
    profileSource, workflowComposition: MOCK_WORKFLOW_COMPOSITION, previewPreferences: createPersonPreferences("preview"),
  }) })));
  await vi.waitFor(() => assert.ok(document.querySelector('[aria-label="UCPath sign-in"]')));
  return { requests, host };
}

function button(name: string, within: ParentNode = document): HTMLButtonElement {
  const control = [...within.querySelectorAll("button")].find(candidate => candidate.textContent?.trim() === name);
  assert.ok(control, `missing ${name}`);
  return control;
}

it("enables the served account control and deletes only after explicit confirmation", async () => {
  const response = Promise.withResolvers<Response>();
  const { requests } = await mount(() => response.promise);
  const trigger = button("Delete account");
  assert.equal(trigger.disabled, false);
  assert.doesNotMatch(document.querySelector('[aria-label="Account"]')?.textContent ?? "", /Try again when connected/u);
  assert.deepEqual(requests, []);
  await act(async () => trigger.click());
  const cancelledDialog = document.querySelector('[role="dialog"]');
  assert.ok(cancelledDialog);
  assert.ok(cancelledDialog.textContent?.includes(`Delete ${FIXTURE_BOOTSTRAP.actor.label}’s account?`));
  await act(async () => button("Cancel", cancelledDialog).click());
  assert.deepEqual(requests, []);
  assert.equal(document.querySelector('[role="dialog"]'), null);
  await act(async () => trigger.click());
  const dialog = document.querySelector('[role="dialog"]'); assert.ok(dialog);
  await act(async () => button("Delete account", dialog).click());
  assert.deepEqual(requests, [{ path: "/api/v1/profile/delete-account", body: { confirmed: true,
    expectedProfileId: "00000000-0000-4000-8000-000000000001", expectedEpoch: 1 } }]);
  assert.equal(button("Deleting…").disabled, true);
  assert.match(document.querySelector('[aria-label="Account"]')?.textContent ?? "", /erasure is not complete/u);
  await act(async () => response.resolve(Response.json({ state: "signed-out", signUpRequired: true })));
  await vi.waitFor(() => assert.equal(document.querySelector("h1")?.textContent, "Create your profile"));
  assert.equal(document.querySelector('[aria-label="Account"]'), null);
  assert.equal(requests.length, 1);
});

for (const outcome of ["refused", "error", "cancelling", "lost"] as const) it(`keeps ${outcome} deletion locked and visible across Settings navigation`, async () => {
  const { requests } = await mount(async () => {
    if (outcome === "lost") throw new Error("private transport diagnostic");
    return Response.json(outcome === "cancelling" ? { state: "cancelling", operationId: "00000000-0000-4000-8000-000000000002" }
      : { state: outcome, code: "PROFILE_ACCOUNT_DELETION_REFUSED" });
  });
  await act(async () => button("Delete account").click());
  const dialog = document.querySelector('[role="dialog"]'); assert.ok(dialog);
  await act(async () => button("Delete account", dialog).click());
  const message = operatorFailureSentence("PROFILE_ACCOUNT_DELETION_REFUSED");
  assert.equal(document.querySelector('[aria-label="Account"] [role="alert"]')?.textContent, message);
  assert.equal(button("Delete account").disabled, true);
  await act(async () => button("Delete account").click());
  for (const name of ["General", "Account"]) {
    const link = [...document.querySelectorAll<HTMLAnchorElement>(".settings-nav-group a")].find(candidate => candidate.textContent === name);
    assert.ok(link); await act(async () => link.click());
  }
  assert.equal(document.querySelector('[aria-label="Account"] [role="alert"]')?.textContent, message);
  assert.equal(button("Delete account").disabled, true);
  assert.doesNotMatch(document.body.textContent ?? "", /private transport diagnostic|Create your profile/u);
  assert.equal(requests.length, 1);
});

it("does not invent deletion authority for the mock profile source", async () => {
  const { requests } = await mount(async () => { throw new Error("mock deletion must never dispatch"); }, "mock");
  assert.equal([...document.querySelectorAll("button")].some(candidate => candidate.textContent?.trim() === "Delete account"), false);
  assert.deepEqual(requests, []);
});
