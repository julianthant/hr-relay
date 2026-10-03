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
vi.mock("../../../../../src/dashboard/surfaces/notifications/notifications-view.js", () => ({ NotificationsView: () => null }));

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
