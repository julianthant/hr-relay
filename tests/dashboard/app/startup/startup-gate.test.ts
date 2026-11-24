// @vitest-environment jsdom
import { profileActivationResponse } from "../../../support/helpers/dashboard/shared-profile-cookie-tabs.js";
import assert from "node:assert/strict";
import { act } from "react";
import { it, vi } from "vitest";
import { active, dashboardServer, never, start } from "./startup-harness.js";

const loadingLabel = (host: HTMLElement) => host.querySelector("[data-startup-loading]")?.getAttribute("aria-label");

it("shows the loading screen, not the sign-in page, while the session is unknown", async () => {
  const app = await start({ "/api/v1/profile/state": never });
  try {
    assert.equal(loadingLabel(app.host), "Starting Relay");
    assert.equal(app.host.querySelector("form") === null, true);
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
    assert.equal(app.host.querySelector("form") === null, true);
    assert.ok(resumed, "the resume starts from the loading screen");
    await act(async () => resumed?.(profileActivationResponse(active)));
    assert.equal(loadingLabel(app.host), undefined);
    assert.equal(app.signInFrames(), 0);
  } finally { await app.stop(); }
});

it("hands a signed-in start to the dashboard without ever mounting the sign-in page", async () => {
  let resumes = 0;
  const server = dashboardServer();
  const app = await start({
    "/api/v1/profile/state": () => Response.json(resumes === 0 ? { state: "signed-out", resumable: true } : active),
    "/api/v1/profile/resume": () => { resumes++; return profileActivationResponse(active); },
  }, server);
  try {
    await vi.waitFor(() => assert.ok(app.host.querySelector(".dashboard-shell")));
    assert.equal(resumes, 1);
    assert.equal(loadingLabel(app.host), undefined);
    assert.equal(app.signInFrames(), 0);
    assert.equal(app.host.querySelector(".hub-onboarding") === null, true);
    assert.equal(app.frames[0], "loading");
    assert.equal(app.frames.at(-1), "dashboard");
    assert.ok(!app.frames.includes("sign-in") && !app.frames.includes("skeleton"), `frames: ${app.frames.join(" > ")}`);
    console.log(`[frames] ${app.frames.join(" > ")}`);
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

it("resumes once when the resume request fails and shows the existing failure on sign-in", async () => {
  const app = await start({
    "/api/v1/profile/state": () => Response.json({ state: "signed-out", resumable: true }),
    "/api/v1/profile/resume": () => { throw new TypeError("synthetic resume failure"); },
  });
  try {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    assert.equal(app.paths.filter(path => path === "/api/v1/profile/resume").length, 1);
    assert.equal(app.host.querySelector("h1")?.textContent, "Log in to Relay");
    assert.match(app.host.querySelector('[role="alert"]')?.textContent ?? "", /./);
  } finally { await app.stop(); }
});

it("shows the dashboard with the queue's failure notice when the day read fails", async () => {
  const server = dashboardServer();
  const app = await start({}, (url, init) => new URL(url).pathname === "/api/v1/profile/state" ? Response.json(active)
    : url.includes("/events/v1?") ? new Response("unavailable", { status: 503 }) : server(url, init));
  try {
    await vi.waitFor(() => assert.equal(app.frames.at(-1), "dashboard"), { timeout: 20_000, interval: 50 });
    assert.deepEqual(app.frames, ["loading", "dashboard"]);
    assert.match(app.host.querySelector('.dashboard-shell [role="alert"]')?.textContent ?? "", /./);
  } finally { await app.stop(); }
}, 30_000);
