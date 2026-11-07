// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import { notificationsSample } from "../../../../src/dashboard/surfaces/notifications/notifications-fixture.js";
import { useNotificationRailModel } from "../../../../src/dashboard/surfaces/notifications/notification-rail-model.js";
import type { NotificationDestination, NotificationsState } from "../../../../src/dashboard/surfaces/notifications/notifications-view-model.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  window.history.replaceState(null, "", "/");
});

function Harness({ notifications, onOpenNotification }: {
  notifications: NotificationsState;
  onOpenNotification: (destination: NotificationDestination, opened: () => void, refused: (message: string) => void) => void;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("existing notice");
  const model = useNotificationRailModel({ notifications, filter: "all", setOpen, setNotice, onOpenNotification });
  const reads = model.state.state === "ready" ? Object.fromEntries(model.state.items.map(item => [item.id, item.read])) : {};
  const completed = model.state.state === "ready" ? model.state.items.find(item => item.title === "Run completed") : undefined;
  return createElement("div", {
    "data-open": String(open), "data-notice": notice, "data-unread": String(model.unread),
    "data-ping": String(model.ping), "data-ping-item": model.pingItem?.id ?? "", "data-reads": JSON.stringify(reads),
  }, [
    createElement("button", { key: "read", onClick: () => model.onControl("sample-verification", "read") }, "Mark read"),
    createElement("button", { key: "unread", onClick: () => model.onControl("sample-completed", "unread") }, "Mark unread"),
    createElement("button", { key: "all", onClick: model.onReadAll }, "Read all"),
    createElement("button", { key: "panel", onClick: () => model.changeOpen(true) }, "Open panel"),
    createElement("button", { key: "item", onClick: () => { if (completed) model.onOpenItem(completed); } }, "Open completed"),
    createElement("button", { key: "ping-close", onClick: model.onClosePing }, "Close ping"),
    createElement("button", { key: "ping-open", onClick: model.onOpenPing }, "Open ping"),
  ]);
}

function mount(onOpenNotification: Parameters<typeof Harness>[0]["onOpenNotification"]): void {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(createElement(Harness, { notifications: notificationsSample("normal"), onOpenNotification })));
}
function model(): HTMLElement {
  const found = host?.firstElementChild;
  assert.ok(found instanceof HTMLElement);
  return found;
}
function button(label: string): HTMLButtonElement {
  const found = [...(host?.querySelectorAll("button") ?? [])].find(node => node.textContent === label);
  assert.ok(found instanceof HTMLButtonElement, `missing button ${label}`);
  return found;
}
function click(label: string): void { act(() => button(label).click()); }

describe("notification rail producer", () => {
  it("keeps read overlays, read-all, refusal and successful opening behavior", () => {
    let allowOpen = false;
    const destinations: NotificationDestination[] = [];
    mount((destination, opened, refused) => {
      destinations.push(destination);
      if (allowOpen) opened(); else refused("This notification is unavailable.");
    });
    assert.equal(model().dataset.unread, "3");
    click("Mark read");
    assert.equal(model().dataset.unread, "2");
    click("Read all");
    assert.equal(model().dataset.unread, "0");
    click("Mark unread");
    assert.equal(model().dataset.unread, "1");
    click("Open panel");
    click("Open completed");
    assert.deepEqual(destinations[0], { kind: "run", runId: "00000000-0003-4000-8000-000000000003", day: "2026-08-03" });
    assert.equal(model().dataset.notice, "This notification is unavailable.");
    assert.equal(model().dataset.open, "true");
    assert.equal(model().dataset.unread, "1");
    allowOpen = true;
    click("Open completed");
    assert.equal(model().dataset.notice, "");
    assert.equal(model().dataset.open, "false");
    assert.equal(model().dataset.unread, "0");
    assert.equal(model().dataset.reads?.includes('"sample-completed":true'), true);
  });

  it("initializes the preview ping and clears it on close or opening notifications", () => {
    window.history.replaceState(null, "", "/?notificationsPreview=ping");
    mount(() => undefined);
    assert.equal(model().dataset.ping, "true");
    assert.equal(model().dataset.pingItem, "sample-completed");
    click("Open ping");
    assert.equal(model().dataset.ping, "false");
    assert.equal(model().dataset.open, "true");

    act(() => root?.unmount());
    root = undefined;
    host?.remove();
    host = undefined;
    window.history.replaceState(null, "", "/?notificationsPreview=ping");
    mount(() => undefined);
    click("Close ping");
    assert.equal(model().dataset.ping, "false");
    assert.equal(model().dataset.open, "false");
  });
});
