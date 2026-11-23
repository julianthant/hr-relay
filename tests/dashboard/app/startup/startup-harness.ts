import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { createFixtureBff } from "../../../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY_WIRE } from "../../../mocks/helpers/fixture-queue.js";
import { MOCK_WORKFLOW_COMPOSITION } from "../../../mocks/helpers/workflow-composition.js";
import { DashboardApp } from "../../../../src/dashboard/app/dashboard-app.js";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
// jsdom has no scrolling; the search list scrolls its active row into view.
if (typeof Element.prototype.scrollIntoView !== "function") Element.prototype.scrollIntoView = () => {};

/** The fixture BFF serves every dashboard read; the day arrives on the event stream like the real one. */
export function dashboardServer() {
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

export type Answer = () => Response | Promise<Response>;
export async function start(answers: Record<string, Answer>, fallback?: (url: string, init?: RequestInit) => Response | Promise<Response>, at = "/", workflowComposition = MOCK_WORKFLOW_COMPOSITION) {
  const previous = window.location.href; window.history.replaceState(null, "", at);
  const paths: string[] = [];
  const client = createDashboardClient({ baseUrl: "http://localhost:3938", fetchImpl: async (url, init) => {
    const path = new URL(url).pathname; paths.push(path);
    const answer = answers[path]; if (answer === undefined && fallback !== undefined) return fallback(url, init); assert.ok(answer, `unexpected request ${path}`); return answer();
  } });
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  // The sign-in page is the only surface with the "Log in to Relay" heading; sample every commit.
  let signInFrames = 0;
  const frames: string[] = [];
  let firstDashboard = "";
  const watcher = new MutationObserver(() => {
    if (host.querySelector("h1")?.textContent === "Log in to Relay") signInFrames++;
    const frame = host.querySelector("[data-startup-loading]") ? "loading" : host.querySelector("h1")?.textContent === "Log in to Relay" ? "sign-in"
      : [...host.querySelectorAll('[data-slot="skeleton"], [data-loading-layout], [aria-busy="true"]:not(button)')].some(part => part.closest("[hidden]") === null) ? "skeleton" : host.querySelector(".dashboard-shell") ? "dashboard" : "other";
    if (frames.at(-1) !== frame) frames.push(frame);
    if (frame === "dashboard" && firstDashboard === "") firstDashboard = host.textContent ?? "";
  });
  watcher.observe(host, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden"] });
  await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(DashboardApp, { workflowComposition }) })));
  return { host, paths, frames, signInFrames: () => signInFrames, firstDashboard: () => firstDashboard,
    stop: async () => { watcher.disconnect(); await act(async () => root.unmount()); host.remove(); window.history.replaceState(null, "", previous); } };
}
export const never = (): Promise<Response> => new Promise(() => {});
export const active = { state: "active", profileId: "00000000-0000-4000-8000-000000000002", epoch: 1, duoState: "ready",
  account: { name: "A B", initials: "AB", timekeeper: "A B", timekeeperInitials: "AB", lastSignedInAt: "2026-11-12T00:00:00.000Z" } };

export const READ_DELAY_MS = 2_500;
export const delayed = (server: (url: string, init?: RequestInit) => Response | Promise<Response>) =>
  async (url: string, init?: RequestInit) => { await new Promise(resolve => setTimeout(resolve, READ_DELAY_MS)); return server(url, init); };
