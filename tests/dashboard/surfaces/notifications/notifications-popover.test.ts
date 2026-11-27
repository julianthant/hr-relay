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
const ITEMS = [item("failed", { count: 3 }), item("read", { read: true }), item("gone", { read: true, gone: true }),
  item("storage", { kind: "storage", title: "Storage needs attention", subject: "", workflow: "", detail: "Relay could not save everything.", tone: "warning", count: 213 })];

async function draw(state: NotificationsState, show: "all" | "unread" = "all", current: (id: string) => boolean = () => true) {
  const calls: string[] = [];
  const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
  await act(async () => root?.render(createElement(TooltipProvider, null, createElement(ToastProvider, null, createElement(NotificationsPopover, { state, open: true, onOpenChange() {}, show, onShow() {},
    onReadAll: () => calls.push("read-all"), onClearAll: () => calls.push("clear-all"), onClear: id => calls.push(`clear:${id}`),
    onOpen: opened => calls.push(`open:${opened.id}`), onControl: (id, control) => calls.push(`${control}:${id}`), canAct: current, canClear: current })))));
  const groups = () => [...document.querySelectorAll("section.notice-group")].map(group => [group.getAttribute("aria-label"), [...group.querySelectorAll(".notice-title")].map(title => title.textContent).length]);
  const row = (index: number) => { const found = document.querySelectorAll<HTMLElement>("li.notice-row")[index]; assert(found); return found; };
  const rerender = (next: NotificationsState, acts: (id: string) => boolean = current) => act(async () => root?.render(createElement(TooltipProvider, null, createElement(ToastProvider, null, createElement(NotificationsPopover, { state: next, open: true, onOpenChange() {}, show, onShow() {},
    onReadAll() {}, onClearAll() {}, onClear: id => calls.push(`clear:${id}`), onOpen() {}, onControl() {}, canAct: acts, canClear: acts })))));
  return { host, calls, groups, row, rerender };
}

it("lists unread failures and waits under Needs you and everything read under Earlier, with the unread count on the bell", async () => {
  const view = await draw({ state: "ready", items: ITEMS, pinned: [] });
  assert.deepEqual(view.groups(), [["Needs you", 2], ["Earlier", 2]]);
  assert(view.host.querySelector('button[aria-label="Notifications, 2 unread"]'));
  assert.equal(view.host.querySelector(".notice-bell-count")?.textContent, "2");
  assert.equal(view.row(0).dataset.unread, "true");
  assert.equal(view.row(2).dataset.unread, undefined);
  assert(view.host.querySelector(".notice-bell-dot"), "an unread dot sits with the count");
});

it("keeps a standing notice under Needs you and archive rows out of Earlier, and clears an Earlier row by keyboard through the served command", async () => {
  const items = [item("storage", { kind: "storage", title: "Storage needs attention", tone: "warning", read: true, standing: true }), item("old", { read: true }), item("archive", { read: true, readOnlyHistory: true })];
  const view = await draw({ state: "ready", items, pinned: [] });
  assert.deepEqual(view.groups(), [["Needs you", 1], ["Earlier", 1], ["History", 1]]);
  assert.ok(view.row(0).querySelector('button[aria-label="Clear notification"]') === null);
  const clear = view.row(1).querySelector<HTMLButtonElement>('button[aria-label="Clear notification"]');
  assert(clear, "an Earlier row has Clear");
  await act(async () => clear.focus());
  assert.ok(document.activeElement === clear, "Clear takes keyboard focus");
  // A browser turns Enter on a focused button into a click.
  await act(async () => { clear.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); clear.click(); });
  assert.deepEqual(view.calls, ["clear:old"]);
  await view.rerender({ state: "ready", items: [items[0], items[2]], pinned: [] });
  assert.deepEqual(view.groups(), [["Needs you", 1], ["History", 1]]);
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

it("shows repeats as one row with a count badge, and a storage notice with its title leading and no workflow", async () => {
  const view = await draw({ state: "ready", items: ITEMS, pinned: [] });
  assert.equal(view.row(0).querySelector(".notice-count")?.textContent, "3 times3");
  assert.equal(view.row(0).querySelector(".notice-title")?.textContent, "EID 10555001");
  assert.equal(view.row(0).querySelector(".notice-detail")?.textContent, "Person Lookup · CRM sign-in failed.");
  assert(view.row(0).textContent?.includes("Run failed: "), "the status icon's meaning is still read out");
  const storage = view.row(1);
  assert.equal(storage.querySelector(".notice-title")?.textContent, "Storage needs attention");
  assert.equal(storage.querySelector(".notice-count")?.textContent, "213 times213");
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
  assert.deepEqual(view.groups(), [["Needs you", 1], ["History", 1]]);
  assert.ok(view.row(1).querySelector(".notice-action") === null);
  await act(async () => view.row(1).querySelector<HTMLButtonElement>("button.notice-main")?.click());
  await act(async () => view.row(0).querySelector<HTMLButtonElement>('button[aria-label="Mark as read"]')?.click());
  assert.deepEqual(view.calls, [`open:${archivedId}`, `read:${localId}`]);
});

it("says a deleted run was deleted on its own row, which opens nothing and has no Dismiss", async () => {
  const view = await draw({ state: "ready", items: ITEMS, pinned: [] });
  const gone = view.row(3);
  assert.equal(gone.dataset.gone, "true");
  assert.equal(gone.querySelector(".notice-detail")?.textContent, "Person Lookup · This run was deleted.");
  assert.ok(gone.querySelector("button.notice-main") === null);
  assert.ok(document.querySelector('button[aria-label="Dismiss"]') === null);
});

it("opens with focus on the panel, so the All / Unread filter shows its selected option and no focus ring", async () => {
  await draw({ state: "ready", items: ITEMS, pinned: [] });
  assert.ok(document.activeElement === document.querySelector('[role="dialog"][aria-label="Notifications"]'), "the panel takes focus");
  const options = [...document.querySelectorAll<HTMLInputElement>('.ds-segment input[type="radio"]')];
  assert.deepEqual(options.map(option => [option.value, option.checked]), [["all", true], ["unread", false]]);
});

it("filters to unread and disables Mark all read when nothing is unread", async () => {
  const view = await draw({ state: "ready", items: ITEMS.map(entry => ({ ...entry, read: true })), pinned: [] }, "unread");
  assert.deepEqual(view.groups(), []);
  assert(document.body.textContent?.includes("No unread notifications"));
  assert.equal(document.querySelector<HTMLButtonElement>('button[aria-label="Mark all read"]')?.disabled, true);
  assert.equal(document.querySelector<HTMLButtonElement>('button[aria-label="Clear all"]')?.disabled, true);
});

it("names the header actions by icon only and offers Clear only on rows that can be cleared", async () => {
  const items = [item("failed"), item("waiting", { title: "Run waiting", tone: "warning", standing: true }), item("history", { read: true, readOnlyHistory: true })];
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
  assert.ok(document.activeElement === view.row(0).querySelector(".notice-main"), "focus lands on the row that took its place");
  assert.equal(view.row(0).dataset.id, "b");
  await act(async () => view.row(1).querySelector<HTMLButtonElement>('button[aria-label="Clear notification"]')?.click());
  await view.rerender({ state: "ready", items: [items[1]], pinned: [] });
  assert.ok(document.activeElement === view.row(0).querySelector(".notice-main"), "the last row falls back to the one before it");
  await act(async () => view.row(0).querySelector<HTMLButtonElement>('button[aria-label="Clear notification"]')?.click());
  await view.rerender({ state: "ready", items: [], pinned: [] });
  assert.ok(document.activeElement === document.querySelector("header.notice-popover-head"), "focus moves to the header");
  assert(document.body.textContent?.includes("No notifications"), "the empty state is the panel's own");
});

it("skips a deleted row when moving focus after a clear, and falls back to the header when only deleted rows remain", async () => {
  const items = [item("a"), item("gone", { gone: true }), item("c")];
  const view = await draw({ state: "ready", items, pinned: [] });
  await act(async () => view.row(0).querySelector<HTMLButtonElement>('button[aria-label="Clear notification"]')?.click());
  await view.rerender({ state: "ready", items: items.slice(1), pinned: [] });
  assert.ok(document.activeElement === view.row(1).querySelector("button.notice-main"), "focus skips the deleted row that cannot take it");
  await act(async () => view.row(1).querySelector<HTMLButtonElement>('button[aria-label="Clear notification"]')?.click());
  await view.rerender({ state: "ready", items: [items[1]], pinned: [] });
  assert.ok(document.activeElement === document.querySelector("header.notice-popover-head"), "no row can take focus, so the header does");
});

it("moves focus to the first row left after Clear all, or to the header when none is left", async () => {
  const items = [item("a"), item("waiting", { tone: "warning", standing: true })];
  const view = await draw({ state: "ready", items, pinned: [] });
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Clear all"]')?.click());
  assert.deepEqual(view.calls, ["clear-all"]);
  await view.rerender({ state: "ready", items: [items[1]], pinned: [] });
  assert.ok(document.activeElement === view.row(0).querySelector("button.notice-main"), "the standing row left takes focus");
  assert.equal(view.row(0).dataset.id, "waiting");
});

it("offers clears only on rows that are current, and restores focus past disabled rows", async () => {
  const items = [item("local-a"), item("served"), item("local-b")];
  const local = (id: string) => id.startsWith("local");
  const clearAll = () => document.querySelector<HTMLButtonElement>('button[aria-label="Clear all"]');
  const clearOf = (view: Awaited<ReturnType<typeof draw>>, index: number) => view.row(index).querySelector<HTMLButtonElement>('button[aria-label="Clear notification"]');
  const view = await draw({ state: "ready", items, pinned: [] });
  assert.equal(clearOf(view, 1)?.disabled, false);
  await view.rerender({ state: "ready", items, pinned: [] }, local);
  assert.equal(clearOf(view, 1)?.disabled, true, "a row whose inbox is not current cannot be cleared");
  assert.equal(clearAll()?.disabled, false, "Clear all still acts on the local rows");
  await act(async () => clearOf(view, 0)?.click());
  await view.rerender({ state: "ready", items: items.slice(1), pinned: [] }, local);
  assert.ok(document.activeElement === view.row(1).querySelector("button.notice-main"), "focus skips the disabled row");
  await act(async () => clearOf(view, 1)?.click());
  await view.rerender({ state: "ready", items: [items[1]], pinned: [] }, local);
  assert.ok(document.activeElement === document.querySelector("header.notice-popover-head"), "only a disabled row is left");
  assert.equal(clearAll()?.disabled, true, "nothing listed can be cleared");
});
