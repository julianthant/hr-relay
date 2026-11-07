// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, it, vi } from "vitest";
import { SettingsSectionSkeleton } from "../../../../src/dashboard/surfaces/settings/settings-loading.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
afterEach(() => vi.useRealTimers());
it("keeps the heading immediate and waits 150ms before a missing section skeleton", () => {
  vi.useFakeTimers();
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    act(() => root.render(createElement(SettingsSectionSkeleton, { section: "performance" })));
    assert.match(host.textContent ?? "", /Performance/);
    assert.equal(host.querySelector('[aria-busy="true"]'), null);
    act(() => { vi.advanceTimersByTime(149); });
    assert.equal(host.querySelector('[aria-busy="true"]'), null);
    act(() => { vi.advanceTimersByTime(1); });
    assert.ok(host.querySelector('[aria-busy="true"]'));
  } finally { act(() => root.unmount()); }
});

it("retains loaded facts beside the read failure without drawing a skeleton", () => {
  const host = document.createElement("div"); const root = createRoot(host);
  const facts = { systemHosts: [], workflowCapabilities: [] };
  try {
    act(() => root.render(createElement(FactsPane, { facts: { state: "failed", message: "Read unavailable", facts }, children: loaded => createElement("span", null, loaded === facts ? "exact held facts" : "wrong facts") })));
    assert.match(host.textContent ?? "", /exact held facts/);
    assert.match(host.textContent ?? "", /Read unavailable/);
    assert.equal(host.querySelector('[data-slot="skeleton"]'), null);
  } finally { act(() => root.unmount()); }
});

import { FactsPane } from "../../../../src/dashboard/surfaces/settings/editor/settings-facts.js";
