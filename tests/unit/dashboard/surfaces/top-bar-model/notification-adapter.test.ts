// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, vi } from "vitest";
import { ToastProvider } from "../../../../../src/dashboard/ds/ui.js";
import { NotificationWireSchema } from "../../../../../src/models/dashboard/projection.js";

const notificationClient = vi.hoisted(() => ({ current: {} }));
vi.mock("../../../../../src/dashboard/state/notification-client.js", () => ({ useNotificationClient: () => notificationClient.current }));
vi.mock("../../../../../src/dashboard/state/use-notification-delivery.js", () => ({
  NOTIFICATION_DELIVERY_LABELS: { off: "off" }, useNotificationDelivery: () => ({ state: "off", enable: () => {} }),
}));
vi.mock("../../../../../src/dashboard/surfaces/notifications/notifications-view.js", () => ({ NotificationsView: ({ onControl, notice }: {
  onControl: (id: string, action: "read" | "snooze") => void; notice: string;
}) => createElement("div", null, createElement("button", { onClick: () => onControl("11111111-1111-4111-8111-111111111111", "read") }, "Mark read"),
  createElement("span", { "data-testid": "notice" }, notice)) }));

import { ConnectedNotifications } from "../../../../../src/dashboard/surfaces/notifications/connected-notifications.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const row = (publication: string, actorId = "local-operator") => NotificationWireSchema.parse({
  kind: "notification", channel: "ping", count: 1, publicationId: publication.repeat(64),
  trigger: "failed", readState: "unread", context: { state: "available", workflow: "Workflow", subject: "Subject" },
  sourceEvent: { state: "available", kind: "run-failed" },
  notificationId: "11111111-1111-4111-8111-111111111111", actorId,
  severity: "error", title: "Run failed", state: "unread", occurredAt: "2026-10-02T17:00:00.000Z", revision: 1,
  link: { kind: "failure", runId: "22222222-2222-4222-8222-222222222222", failureId: "33333333-3333-4333-8333-333333333333" },
});

it("scopes chips across actor/day/client changes and dismisses them when the consumer unmounts", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const onOpenNotification = vi.fn();
  const refresh = vi.fn();
  const render = async (rows: readonly ReturnType<typeof row>[], actorId: string, mounted = true, day = "2026-10-02") => {
    await act(async () => root.render(createElement(ToastProvider, null, mounted ? createElement(ConnectedNotifications, {
      rows, actorId, day, nowIso: "2026-10-02T17:01:00.000Z", connected: true, dayState: "loaded", refresh, onOpenNotification,
    }) : null)));
  };
  try {
    await render([row("a")], "local-operator");
    await render([row("b", "other-operator")], "local-operator");
    assert.equal(document.querySelector('[data-ds-toast-state]'), null);
    await render([row("c")], "local-operator");
    assert.equal(document.querySelector('[data-ds-toast-state="chip"]')?.textContent?.includes("Run failed"), true);
    await render([row("c")], "other-operator");
    assert.equal(document.querySelector('[data-ds-toast-state]'), null);
    await render([row("c")], "local-operator");
    assert.equal(document.querySelector('[data-ds-toast-state]'), null);
    await render([row("d")], "local-operator");
    assert.ok(document.querySelector('[data-ds-toast-state="chip"]'));
    await render([row("d")], "local-operator", true, "2026-10-03");
    assert.equal(document.querySelector('[data-ds-toast-state]'), null);
    await render([row("e")], "local-operator", true, "2026-10-03");
    assert.ok(document.querySelector('[data-ds-toast-state="chip"]'));
    notificationClient.current = {};
    await render([row("e")], "local-operator", true, "2026-10-03");
    assert.equal(document.querySelector('[data-ds-toast-state]'), null);
    await render([row("f")], "local-operator", true, "2026-10-03");
    assert.ok(document.querySelector('[data-ds-toast-state="chip"]'));
    await render([], "local-operator", false);
    assert.equal(document.querySelector('[data-ds-toast-state]'), null);
    assert.equal(onOpenNotification.mock.calls.length, 0);
  } finally {
    notificationClient.current = {};
    await act(async () => root.unmount()); host.remove();
  }
});

it("acknowledges a matching notification control result once without turning a stream revision into another chip", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const refresh = vi.fn();
  const onOpenNotification = vi.fn();
  notificationClient.current = { executeCommand: async (command: { commandId: string; target: { notificationId: string } }) => ({
    state: "applied", commandId: command.commandId, affectedTargets: [{ family: "notification", notificationId: command.target.notificationId }],
  }) };
  const render = async (rows: readonly ReturnType<typeof row>[]) => act(async () => root.render(createElement(ToastProvider, null,
    createElement(ConnectedNotifications, { rows, actorId: "local-operator", day: "2026-10-02", nowIso: "2026-10-02T17:01:00.000Z",
      connected: true, dayState: "loaded", refresh, onOpenNotification }))));
  try {
    await render([row("a")]);
    assert.equal(document.querySelector('[data-ds-toast-state]'), null);
    await act(async () => { (host.querySelector("button") as HTMLButtonElement).click(); });
    assert.equal(host.querySelector('[data-ds-toast-state="chip"]')?.textContent?.includes("Marked read"), true);
    assert.equal(refresh.mock.calls.length, 1);
    await render([row("a")]);
    assert.equal(host.querySelectorAll('[data-ds-toast-state="chip"]').length, 1);
  } finally { notificationClient.current = {}; await act(async () => root.unmount()); host.remove(); }
});

it("keeps server refusal and post-dispatch unknown truthful, and ignores a stale actor result", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const refresh = vi.fn(); const onOpenNotification = vi.fn();
  let settle: ((value: unknown) => void) | undefined;
  let mode: "refused" | "unknown" | "pending" = "refused";
  notificationClient.current = { executeCommand: (command: { commandId: string }) => {
    if (mode === "refused") return Promise.resolve({ state: "conflict", commandId: command.commandId, currentVersion: 2, message: "row changed" });
    if (mode === "unknown") return Promise.reject(new Error("transport lost"));
    return new Promise(resolve => { settle = resolve; });
  } };
  const render = async (actorId: string) => act(async () => root.render(createElement(ToastProvider, null,
    createElement(ConnectedNotifications, { rows: [row("a")], actorId, day: "2026-10-02", nowIso: "2026-10-02T17:01:00.000Z",
      connected: true, dayState: "loaded", refresh, onOpenNotification }))));
  const click = async () => act(async () => { (host.querySelector("button") as HTMLButtonElement).click(); });
  try {
    await render("local-operator"); await click();
    assert.equal(host.querySelector('[data-ds-toast-state="chip"]')?.textContent?.includes("Notification changed"), true);
    assert.equal(host.querySelector('[data-testid="notice"]')?.textContent?.includes("row changed"), true);
    await render("other-operator");
    assert.equal(host.querySelector('[data-ds-toast-state]'), null);
    await render("local-operator");
    mode = "unknown"; await click();
    assert.equal(host.querySelector('[data-ds-toast-state="chip"]')?.textContent?.includes("result unknown"), true);
    assert.equal(host.querySelector('[data-testid="notice"]')?.textContent?.includes("transport lost"), true);
    await render("other-operator"); await render("local-operator");
    mode = "pending"; await click(); await render("other-operator");
    await act(async () => settle?.({ state: "applied", commandId: "stale", affectedTargets: [] }));
    assert.equal(host.querySelector('[data-ds-toast-state]'), null);
  } finally { notificationClient.current = {}; await act(async () => root.unmount()); host.remove(); }
});
