// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { NotificationsView } from "../../../../../src/dashboard/surfaces/notifications/notifications-view.js";
import type { NotificationsState } from "../../../../../src/dashboard/surfaces/notifications/notifications-view-model.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

it("returns focus to the active filter after a confirmed asynchronous row removal", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const item = { id: "n1", title: "Run failed", subject: "Unavailable", workflow: "Unavailable",
    detail: "A run failed.", tone: "danger" as const, age: "1m ago", read: false, snoozed: true, action: "Open run" };
  let calls = 0;
  const render = async (state: NotificationsState) => act(async () => root.render(createElement(NotificationsView, {
    state, filter: "snoozed", onFilter: () => undefined, open: true, onOpenChange: () => undefined,
    onControl: () => { calls += 1; }, onOpen: () => undefined, notice: "", desktopStatus: "Desktop pings off", onEnable: () => undefined,
  })));
  try {
    await render({ state: "ready", items: [item], pinned: [] });
    const control = document.querySelector<HTMLButtonElement>('button[aria-label="Unsnooze: Run failed"]');
    assert.ok(control);
    await act(async () => { control.focus(); control.click(); });
    assert.equal(calls, 1);
    assert.equal(document.activeElement, control, "pending command leaves the served row and focus intact");
    await render({ state: "ready", items: [], pinned: [] });
    assert.equal(document.activeElement?.getAttribute("data-notification-filter"), "snoozed");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
