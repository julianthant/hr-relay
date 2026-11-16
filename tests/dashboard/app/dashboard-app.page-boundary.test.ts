// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, vi } from "vitest";
import { DashboardPageBoundary } from "../../../src/dashboard/app/dashboard-app.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

it("retains shell controls after a page crash and recovers on navigation", async () => {
  const errors: unknown[] = [];
  vi.stubGlobal("reportError", (error: unknown) => errors.push(error));
  const host = document.createElement("div"), root = createRoot(host, { onCaughtError() {} });
  document.body.append(host);
  let recovered = 0;
  function BrokenPage(): never { throw new Error("Synthetic page crash"); }
  const render = async (broken: boolean, resetKey: string) => {
    await act(async () => root.render(createElement("div", null,
      createElement("nav", null, "Workflow navigation"),
      createElement(DashboardPageBoundary, { resetKey, onRecover: () => { recovered++; },
        children: broken ? createElement(BrokenPage) : createElement("main", null, "Recovered page") }),
      createElement("footer", null, "Sessions"))));
  };
  try {
    await render(true, "broken");
    assert.equal(host.querySelector("nav")?.textContent, "Workflow navigation");
    assert.equal(host.querySelector("footer")?.textContent, "Sessions");
    assert.match(host.textContent ?? "", /Page unavailable/);
    assert.equal(errors.length, 1);
    assert.equal((errors[0] as Error).message, "Synthetic page crash");
    const button = host.querySelector("button"); assert.ok(button);
    await act(async () => button.click());
    assert.equal(recovered, 1);
    await render(false, "dashboard");
    assert.equal(host.querySelector("main")?.textContent, "Recovered page");
    assert.doesNotMatch(host.textContent ?? "", /Page unavailable/);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
