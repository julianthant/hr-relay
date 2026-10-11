import assert from "node:assert/strict";
import { afterEach,it,vi } from "vitest";
import type { DashboardErrorReport } from "../../../src/models/events/debug-report.js";

const { report, render } = vi.hoisted(() => ({ report: vi.fn<(input: DashboardErrorReport) => Promise<void>>(), render: vi.fn() }));
vi.mock("../../../src/dashboard/client/index.js", () => ({ createDashboardClient: () => ({ reportError: report }) }));
vi.mock("react-dom/client", () => ({ createRoot: () => ({ render }) }));
vi.mock("../../../src/dashboard/app/dashboard-app.js", () => ({ DashboardApp: () => null }));
vi.mock("../../../src/dashboard/state/client-context.js", () => ({ DashboardClientProvider: () => null }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); report.mockReset(); render.mockReset(); });

it("surfaces rejected error delivery once without recursively reporting it, and disposes the listeners", async () => {
  const browser = new EventTarget();
  const surfaced: Error[] = [];
  const errors: Event[] = [];
  const dispatchError = (error: Error) => {
    const event = Object.assign(new Event("error", { cancelable: true }), { error, message: error.message });
    errors.push(event);
    browser.dispatchEvent(event);
  };
  Object.assign(browser, { location: { origin: "http://localhost:5174", pathname: "/" },
    reportError: (error: Error) => { surfaced.push(error); dispatchError(error); } });
  vi.stubGlobal("window", browser);
  vi.stubGlobal("document", { getElementById: () => ({}) });
  report.mockRejectedValue(new Error("private delivery failure"));
  await import("../../../src/dashboard/app/main.js");
  assert.equal(render.mock.calls.length, 1);

  dispatchError(new Error("ordinary error"));
  await vi.waitFor(() => assert.equal(surfaced.length, 1));
  assert.equal(report.mock.calls.length, 1);
  assert.equal(surfaced[0].message, "Dashboard error report was not recorded");
  assert.equal(report.mock.calls[0][0].message, "ordinary error");
  assert.equal(JSON.stringify(surfaced.map(error => error.message)).includes("private"), false);

  browser.dispatchEvent(Object.assign(new Event("unhandledrejection", { cancelable: true }), { reason: new Error("ordinary rejection") }));
  await vi.waitFor(() => assert.equal(surfaced.length, 2));
  assert.equal(report.mock.calls.length, 2);
  assert.equal(report.mock.calls[1][0].message, "ordinary rejection");
  assert.ok(errors.every(event => !event.defaultPrevented));

  browser.dispatchEvent(new Event("pagehide"));
  dispatchError(new Error("after pagehide"));
  browser.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: new Error("after pagehide") }));
  assert.equal(report.mock.calls.length, 2);
});
