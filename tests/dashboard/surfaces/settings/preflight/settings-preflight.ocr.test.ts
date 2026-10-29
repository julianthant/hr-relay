// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import type { DashboardClient } from "../../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import { PreflightActionsProvider } from "../../../../../src/dashboard/surfaces/settings/preflight/preflight-actions.js";
import { PreflightReportContent } from "../../../../../src/dashboard/surfaces/settings/preflight/settings-preflight.js";
import { PreflightOcrContext, createServedPreflightOcrPort, type PreflightOcrPort, type PreflightOcrSnapshot } from "../../../../../src/dashboard/surfaces/settings/preflight/preflight-ocr-model.js";
import { ERROR_CATALOG } from "../../../../../src/models/failures/error-catalog.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined, host: HTMLElement | undefined;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined; });
async function mount(port: PreflightOcrPort, onRerun = () => {}) {
  const client = { preflightScopes: async () => [] } as unknown as DashboardClient;
  host = document.createElement("div"); document.body.append(host);
  await act(async () => {
    root = createRoot(host!);
    root.render(createElement(DashboardClientProvider, { client, children: createElement(PreflightActionsProvider, {
      actions: { actorId: "operator", descriptorFingerprint: "a".repeat(64), showSettings() {}, showSessions() {} },
      children: createElement(PreflightOcrContext.Provider, { value: port, children: createElement(PreflightReportContent, {
        presentation: "settings", preflight: { state: "refused", message: "Readiness unavailable" }, onRerun,
      }) }),
    }) }));
  });
}
for (const state of ["idle", "disabled", "loading", "completed", "failed", "refused", "uncertain"] as const) it(`renders preflight OCR ${state} without dispatching it`, async () => {
  let calls = 0;
  const snapshot: PreflightOcrSnapshot = state === "idle" || state === "loading" ? { state }
    : state === "completed" ? { state, model: "Synthetic model" }
    : state === "disabled" || state === "failed" ? { state, code: "CHATGPT_OCR_INVALID" }
    : { state, code: "CHATGPT_OCR_INVALID", message: ERROR_CATALOG.CHATGPT_OCR_INVALID.text };
  await mount({ getSnapshot: () => snapshot, subscribe: () => () => {}, testOcr: async () => { calls++; } });
  const button = [...host!.querySelectorAll("button")].find(node => node.textContent === "Test OCR");
  assert.ok(button); assert.equal(button.disabled, ["disabled", "loading", "uncertain"].includes(state));
  assert.equal(calls, 0);
  if (state === "completed") assert.match(host!.textContent ?? "", /OCR test completed.*Synthetic model/u);
  else if (state === "loading") assert.match(host!.textContent ?? "", /Testing OCR/u);
  else if (state !== "idle") assert.ok(host!.textContent?.includes(ERROR_CATALOG.CHATGPT_OCR_INVALID.text));
});
it("keeps OCR dispatch separate from Run preflight and scope refresh", async () => {
  let calls = 0, reruns = 0;
  await mount({ getSnapshot: () => idle, subscribe: () => () => {}, testOcr: async () => { calls++; } }, () => { reruns++; });
  const buttons = [...host!.querySelectorAll("button")];
  await act(async () => buttons.find(node => node.textContent === "Run preflight")!.click());
  const scope = host!.querySelector("select"); assert.ok(scope);
  await act(async () => scope.dispatchEvent(new Event("change", { bubbles: true })));
  assert.equal(calls, 0); assert.equal(reruns, 1);
  await act(async () => buttons.find(node => node.textContent === "Test OCR")!.click());
  assert.equal(calls, 1); assert.equal(reruns, 1);
});
const idle: PreflightOcrSnapshot = { state: "idle" };

it("locks duplicate OCR clicks until the preflight-owned operation settles", async () => {
  const result = Promise.withResolvers<{ state: "completed"; model: string }>();
  let calls = 0;
  const port = createServedPreflightOcrPort({ testChatGptOcr: () => { calls++; return result.promise; } }, {
    mode: "preview", getSnapshot: () => enabled, subscribe: () => () => {},
    signIn: async () => {}, signOut: async () => {}, cancelSignIn: async () => {},
  });
  try {
    await mount(port); assert.equal(calls, 0);
    const button = [...host!.querySelectorAll("button")].find(node => node.textContent === "Test OCR"); assert.ok(button);
    await act(async () => { button.click(); button.click(); });
    assert.equal(calls, 1); assert.equal(button.disabled, true);
    await act(async () => result.resolve({ state: "completed", model: "Synthetic model" }));
    assert.equal(button.disabled, false); assert.match(host!.textContent ?? "", /Synthetic model/u);
  } finally { port.dispose(); }
});
const enabled = { state: "connected" as const, name: "Operator", email: "operator@example.com", planUsage: "enabled" as const };
