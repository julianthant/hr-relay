// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import { ToastProvider, TooltipProvider } from "../../../../src/dashboard/ds/ui.js";
import { inboxProjection } from "../../../../src/dashboard/state/inbox-wiring-adapter.js";
import { NotificationsPopover } from "../../../../src/dashboard/surfaces/notifications/notifications-popover.js";
import type { NotificationItem, NotificationsState } from "../../../../src/dashboard/surfaces/notifications/notifications-view-model.js";
import { NotificationWireSchema } from "../../../../src/models/dashboard/projection.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });

const item = (id: string, extra: Partial<NotificationItem> = {}): NotificationItem => ({ id, kind: "run", title: "Run failed", subject: "EID 10555001", workflow: "Person Lookup", detail: "CRM sign-in failed.",
  tone: "danger", priority: true, age: "2 min ago", read: false, action: "Open log", destination: { kind: "none" }, ...extra });
const ITEMS = [item("failed", { count: 3 }), item("read", { read: true, day: "Yesterday" }), item("gone", { read: true, gone: true, day: "Yesterday" }),
  item("storage", { kind: "storage", title: "Storage needs attention", subject: "", workflow: "", detail: "Relay could not save everything.", tone: "warning", count: 213 })];

async function draw(state: NotificationsState, show: "all" | "unread" = "all") {
  const calls: string[] = [];
  const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
  await act(async () => root?.render(createElement(TooltipProvider, null, createElement(ToastProvider, null, createElement(NotificationsPopover, { state, open: true, onOpenChange() {}, show, onShow() {},
    onReadAll: () => calls.push("read-all"), onClearAll: () => calls.push("clear-all"), onClear: id => calls.push(`clear:${id}`),
    onOpen: opened => calls.push(`open:${opened.id}`), onControl: (id, control) => calls.push(`${control}:${id}`), canAct: () => true })))));
  const groups = () => [...document.querySelectorAll("section.notice-group")].map(group => [group.getAttribute("aria-label"), [...group.querySelectorAll(".notice-title")].map(title => title.textContent).length]);
  const row = (index: number) => { const found = document.querySelectorAll<HTMLElement>("li.notice-row")[index]; assert(found); return found; };
  const rerender = (next: NotificationsState) => act(async () => root?.render(createElement(TooltipProvider, null, createElement(ToastProvider, null, createElement(NotificationsPopover, { state: next, open: true, onOpenChange() {}, show, onShow() {},
    onReadAll() {}, onClearAll() {}, onClear: id => calls.push(`clear:${id}`), onOpen() {}, onControl() {}, canAct: () => true })))));
  return { host, calls, groups, row, rerender };
}

it("lists unread failures and waits under Needs you and everything read under its day, with the unread count on the bell", async () => {
  const view = await draw({ state: "ready", items: ITEMS, pinned: [] });
  assert.deepEqual(view.groups(), [["Needs you", 2], ["Yesterday", 2]]);
  assert(view.host.querySelector('button[aria-label="Notifications, 2 unread"]'));
  assert.equal(view.host.querySelector(".notice-bell-count")?.textContent, "2");
  assert.equal(view.row(0).dataset.unread, "true");
  assert.equal(view.row(2).dataset.unread, undefined);
  assert(view.host.querySelector(".notice-bell-dot"), "an unread dot sits with the count");
});

it("draws no dot and no number on the bell with nothing unread", async () => {
  const view = await draw({ state: "ready", items: [item("read", { read: true })], pinned: [] });
  assert(view.host.querySelector('button[aria-label="Notifications, 0 unread"]'));
  assert.ok(view.host.querySelector(".notice-bell-dot, .notice-bell-count") === null);
});

it("reads 99+ on the bell above 99 and keeps the exact count in its name", async () => {
  const view = await draw({ state: "ready", items: Array.from({ length: 140 }, (_, index) => item(`n${String(index)}`)), pinned: [] });
  assert(view.host.querySelector('button[aria-label="Notifications, 140 unread"]'));
  assert.equal(view.host.querySelector(".notice-bell-count")?.textContent, "99+");
});

it("shows repeats as one row with a count badge, and a storage notice as title, count and body only", async () => {
  const view = await draw({ state: "ready", items: ITEMS, pinned: [] });
  assert.equal(view.row(0).querySelector(".notice-count")?.textContent, "3 times3");
  assert.equal(view.row(0).querySelector(".notice-context")?.textContent, "Person Lookup · EID 10555001");
  const storage = view.row(1);
  assert.equal(storage.querySelector(".notice-title")?.textContent, "Storage needs attention");
  assert.equal(storage.querySelector(".notice-count")?.textContent, "213 times213");
  assert.ok(storage.querySelector(".notice-context") === null);
  assert.equal(storage.querySelector(".notice-detail")?.textContent, "Relay could not save everything.");
});

it("opens a row, toggles its read state from the row, and marks all read", async () => {
  const view = await draw({ state: "ready", items: ITEMS, pinned: [] });
  await act(async () => view.row(0).querySelector<HTMLButtonElement>("button.notice-main")?.click());
  await act(async () => view.row(0).querySelector<HTMLButtonElement>('button[aria-label="Mark as read"]')?.click());
  await act(async () => view.row(2).querySelector<HTMLButtonElement>('button[aria-label="Mark as unread"]')?.click());
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Mark all read"]')?.click());
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Clear all"]')?.click());
  assert.deepEqual(view.calls, ["open:failed", "read:failed", "unread:read", "read-all", "clear-all"]);
});

it("shows history without a toggle or bell count even when it matches a native notice", async () => {
  const now = "2026-08-03T17:00:00.000Z";
  const localId = "00000000-0000-4000-8000-000000000101";
  const base = { kind: "notification", trigger: "failed", notificationId: localId, actorId: "local-operator",
    channel: "ping", count: 1, publicationId: "a".repeat(64), severity: "error", title: "Run failed",
    context: { state: "available", workflow: "Person Lookup", subject: "Fixture" }, revision: 1,
    link: { kind: "run", runId: "00000000-0000-4000-8000-000000000102" } };
  const local = NotificationWireSchema.parse({ ...base, state: "unread", readState: "unread", occurredAt: "2026-08-03T16:00:00.000Z" });
  const archivedId = "00000000-0000-4000-8000-000000000103";
  const archived = NotificationWireSchema.parse({ ...base, notificationId: archivedId, state: "read", readState: "read",
    occurredAt: now, readOnlyHistory: true });
  const view = await draw(inboxProjection([archived, local], now).state);
  assert(view.host.querySelector('button[aria-label="Notifications, 1 unread"]'));
  assert.deepEqual(view.groups(), [["Needs you", 1], ["Today", 1]]);
  assert.ok(view.row(1).querySelector(".notice-action") === null);
  await act(async () => view.row(1).querySelector<HTMLButtonElement>("button.notice-main")?.click());
  await act(async () => view.row(0).querySelector<HTMLButtonElement>('button[aria-label="Mark as read"]')?.click());
  assert.deepEqual(view.calls, [`open:${archivedId}`, `read:${localId}`]);
});

it("says a deleted run was deleted on its own row, which opens nothing and has no Dismiss", async () => {
  const view = await draw({ state: "ready", items: ITEMS, pinned: [] });
  const gone = view.row(3);
  assert.equal(gone.dataset.gone, "true");
  assert.equal(gone.querySelector(".notice-detail")?.textContent, "This run was deleted.");
  assert.ok(gone.querySelector("button.notice-main") === null);
  assert.ok(document.querySelector('button[aria-label="Dismiss"]') === null);
});

it("filters to unread and disables Mark all read when nothing is unread", async () => {
  const view = await draw({ state: "ready", items: ITEMS.map(entry => ({ ...entry, read: true })), pinned: [] }, "unread");
  assert.deepEqual(view.groups(), []);
  assert(document.body.textContent?.includes("No unread notifications"));
  assert.equal(document.querySelector<HTMLButtonElement>('button[aria-label="Mark all read"]')?.disabled, true);
  assert.equal(document.querySelector<HTMLButtonElement>('button[aria-label="Clear all"]')?.disabled, true);
});

it("names the header actions by icon only and offers Clear only on rows that can be cleared", async () => {
  const items = [item("failed"), item("waiting", { title: "Run waiting", tone: "warning", standing: true }), item("history", { read: true, readOnlyHistory: true, day: "Yesterday" })];
  const view = await draw({ state: "ready", items, pinned: [] });
  for (const label of ["Mark all read", "Clear all"]) {
    const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    assert.equal(button?.textContent, "", `${label} shows no text`);
  }
  assert(view.row(0).querySelector('button[aria-label="Clear notification"]'));
  assert.ok(view.row(1).querySelector('button[aria-label="Clear notification"]') === null, "a standing notice has no Clear");
  assert(view.row(1).querySelector('button[aria-label="Mark as read"]'), "a standing notice keeps its read toggle");
  assert.ok(view.row(2).querySelector(".notice-action") === null, "history has no actions");
  await act(async () => view.row(0).querySelector<HTMLButtonElement>('button[aria-label="Clear notification"]')?.click());
  assert.deepEqual(view.calls, ["clear:failed"]);
});

it("dims Clear all when only standing notices are listed", async () => {
  await draw({ state: "ready", items: [item("waiting", { tone: "warning", standing: true })], pinned: [] });
  assert.equal(document.querySelector<HTMLButtonElement>('button[aria-label="Clear all"]')?.disabled, true);
  assert.equal(document.querySelector<HTMLButtonElement>('button[aria-label="Mark all read"]')?.disabled, false);
});

it("moves focus to the next row after a clear, then to the header once the list is empty", async () => {
  const items = [item("a"), item("b"), item("c")];
  const view = await draw({ state: "ready", items, pinned: [] });
  await act(async () => view.row(0).querySelector<HTMLButtonElement>('button[aria-label="Clear notification"]')?.click());
  await view.rerender({ state: "ready", items: items.slice(1), pinned: [] });
  assert.equal(document.activeElement, view.row(0).querySelector(".notice-main"), "focus lands on the row that took its place");
  assert.equal(view.row(0).dataset.id, "b");
  await act(async () => view.row(1).querySelector<HTMLButtonElement>('button[aria-label="Clear notification"]')?.click());
  await view.rerender({ state: "ready", items: [items[1]], pinned: [] });
  assert.equal(document.activeElement, view.row(0).querySelector(".notice-main"), "the last row falls back to the one before it");
  await act(async () => view.row(0).querySelector<HTMLButtonElement>('button[aria-label="Clear notification"]')?.click());
  await view.rerender({ state: "ready", items: [], pinned: [] });
  assert.equal(document.activeElement, document.querySelector("header.notice-popover-head"));
  assert(document.body.textContent?.includes("No notifications"), "the empty state is the panel's own");
});
