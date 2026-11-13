// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, vi } from "vitest";
import { createFixtureBff } from "../../../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY_WIRE } from "../../../mocks/helpers/fixture-queue.js";
import { MOCK_WORKFLOW_COMPOSITION } from "../../../mocks/helpers/workflow-composition.js";
import { DashboardApp } from "../../../../src/dashboard/app/dashboard-app.js";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

/** The fixture BFF serves every dashboard read; the day arrives on the event stream like the real one. */
function dashboardServer() {
  const { app } = createFixtureBff();
  return (url: string, init?: RequestInit): Response | Promise<Response> => {
    if (!url.includes("/events/v1?")) return app.request(url, init);
    const day = FIXTURE_DAY_WIRE;
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      const send = (message: unknown) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(message)}\n\n`));
      send({ type: "hello", wireVersion: 1, descriptorHash: day.descriptorHash, projectionGeneration: day.projectionGeneration, cursor: day.snapshotCursor });
      send({ type: "snapshot", topic: "dashboard-day", cursor: day.snapshotCursor, payload: day });
      init?.signal?.addEventListener("abort", () => { try { controller.close(); } catch { /* already closed */ } }, { once: true });
    } });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  };
}

type Answer = () => Response | Promise<Response>;
async function start(answers: Record<string, Answer>, fallback?: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const previous = window.location.href; window.history.replaceState(null, "", "/");
  const paths: string[] = [];
  const client = createDashboardClient({ baseUrl: "http://localhost:3938", fetchImpl: async (url, init) => {
    const path = new URL(url).pathname; paths.push(path);
    const answer = answers[path]; if (answer === undefined && fallback !== undefined) return fallback(url, init); assert.ok(answer, `unexpected request ${path}`); return answer();
  } });
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  // The sign-in page is the only surface with the "Log in to Relay" heading; sample every commit.
  let signInFrames = 0;
  const frames: string[] = [];
  const watcher = new MutationObserver(() => {
    if (host.querySelector("h1")?.textContent === "Log in to Relay") signInFrames++;
    const frame = host.querySelector("[data-startup-loading]") ? "loading" : host.querySelector("h1")?.textContent === "Log in to Relay" ? "sign-in"
      : host.querySelector(".dashboard-shell:not([aria-busy])") ? "dashboard" : host.querySelector("[aria-busy]") ? "skeleton" : "other";
    if (frames.at(-1) !== frame) frames.push(frame);
  });
  watcher.observe(host, { childList: true, subtree: true, characterData: true });
  await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp, { profileSource: "served", workflowComposition: MOCK_WORKFLOW_COMPOSITION }) })));
  return { host, paths, frames, signInFrames: () => signInFrames,
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

it("hands a signed-in start to the dashboard without ever mounting the sign-in page", async () => {
  let resumes = 0;
  const server = dashboardServer();
  const app = await start({
    "/api/v1/profile/state": () => Response.json(resumes === 0 ? { state: "signed-out", resumable: true } : active),
    "/api/v1/profile/resume": () => { resumes++; return Response.json(active); },
  }, server);
  try {
    await vi.waitFor(() => assert.ok(app.host.querySelector(".dashboard-shell")));
    assert.equal(resumes, 1);
    assert.equal(loadingLabel(app.host), undefined);
    assert.equal(app.signInFrames(), 0);
    assert.equal(app.host.querySelector(".hub-onboarding"), null);
    assert.equal(app.frames[0], "loading");
    assert.equal(app.frames.at(-1), "dashboard");
    assert.ok(!app.frames.includes("sign-in"), `frames: ${app.frames.join(" > ")}`);
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
