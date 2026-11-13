// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { DashboardApp } from "../../../../src/dashboard/app/dashboard-app.js";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

type Answer = () => Response | Promise<Response>;
async function start(answers: Record<string, Answer>) {
  const previous = window.location.href; window.history.replaceState(null, "", "/");
  const paths: string[] = [];
  const client = createDashboardClient({ baseUrl: "http://localhost:3938", fetchImpl: async url => {
    const path = new URL(url).pathname; paths.push(path);
    const answer = answers[path]; assert.ok(answer, `unexpected request ${path}`); return answer();
  } });
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  // The sign-in page is the only surface with the "Log in to Relay" heading; sample every commit.
  let signInFrames = 0;
  const watcher = new MutationObserver(() => { if (host.querySelector("h1")?.textContent === "Log in to Relay") signInFrames++; });
  watcher.observe(host, { childList: true, subtree: true, characterData: true });
  await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp, { profileSource: "served" }) })));
  return { host, paths, signInFrames: () => signInFrames,
    stop: async () => { watcher.disconnect(); await act(async () => root.unmount()); host.remove(); window.history.replaceState(null, "", previous); } };
}
const never = (): Promise<Response> => new Promise(() => {});
const active = { state: "active", profileId: "00000000-0000-4000-8000-000000000002", epoch: 1, duoState: "ready",
  account: { name: "A B", initials: "AB", timekeeper: "A B", lastSignedInAt: "2026-11-12T00:00:00.000Z" } };
const loadingLabel = (host: HTMLElement) => host.querySelector("[data-startup-loading]")?.getAttribute("aria-label");

it("shows the loading screen, not the sign-in page, while the session is unknown", async () => {
  const app = await start({ "/api/v1/profile/state": never });
  try {
    assert.equal(loadingLabel(app.host), "Starting Relay");
    assert.equal(app.host.querySelector("form"), null);
    assert.equal(app.signInFrames(), 0);
  } finally { await app.stop(); }
});

it("resumes a signed-in start behind the loading screen without ever mounting the sign-in page", async () => {
  let resumed: ((response: Response) => void) | undefined;
  const app = await start({
    "/api/v1/profile/state": () => Response.json({ state: "signed-out", resumable: true }),
    "/api/v1/profile/resume": () => new Promise<Response>(resolve => { resumed = resolve; }),
  });
  try {
    assert.equal(loadingLabel(app.host), "Starting Relay");
    assert.equal(app.host.querySelector("form"), null);
    assert.ok(resumed, "the resume starts from the loading screen");
    await act(async () => resumed?.(Response.json(active)));
    assert.equal(loadingLabel(app.host), undefined);
    assert.equal(app.signInFrames(), 0);
  } finally { await app.stop(); }
});

it("shows the sign-in page when nobody is signed in", async () => {
  const app = await start({ "/api/v1/profile/state": () => Response.json({ state: "signed-out", signUpRequired: false }) });
  try {
    assert.equal(app.host.querySelector("h1")?.textContent, "Log in to Relay");
    assert.equal(loadingLabel(app.host), undefined);
  } finally { await app.stop(); }
});

it("shows the sign-in page with the failure when the resume is refused", async () => {
  const app = await start({
    "/api/v1/profile/state": () => Response.json({ state: "signed-out", resumable: true }),
    "/api/v1/profile/resume": () => Response.json({ state: "signed-out" }),
  });
  try {
    assert.equal(app.host.querySelector("h1")?.textContent, "Log in to Relay");
    assert.equal(loadingLabel(app.host), undefined);
  } finally { await app.stop(); }
});

it("shows the existing failure state, not an endless loader, when the session read fails", async () => {
  const app = await start({ "/api/v1/profile/state": () => { throw new TypeError("synthetic read failure"); } });
  try {
    assert.equal(loadingLabel(app.host), undefined);
    assert.match(app.host.querySelector('[role="alert"]')?.textContent ?? "", /./);
  } finally { await app.stop(); }
});
