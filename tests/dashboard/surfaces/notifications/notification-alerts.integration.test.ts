// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import { ToastProvider } from "../../../../src/dashboard/ds/ui.js";
import { PersonPreferencesContext, type PersonPreferencesPort } from "../../../../src/dashboard/lib/person-preferences.js";
import type { InboxWiring } from "../../../../src/dashboard/state/inbox-wiring-adapter.js";
import { useNotificationRailModel, type NotificationReads } from "../../../../src/dashboard/surfaces/notifications/notification-rail-model.js";
import { useNotificationAlert } from "../../../../src/dashboard/surfaces/notifications/notifications-view.js";
import type { NotificationItem, NotificationsState } from "../../../../src/dashboard/surfaces/notifications/notifications-view-model.js";
import { NEUTRAL_PERSON_PREFERENCES, resolvePersonPreferences, type PersonPreferences } from "../../../../src/models/config/person-preferences.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined; host?.remove(); host = undefined;
});

const item = (id: string, title: string, tone: NotificationItem["tone"], read = false): NotificationItem => ({
  id, title, tone, subject: `Subject ${id}`, workflow: "Person Lookup", detail: `${title} detail.`, age: "Just now", read,
  action: "Open log", kind: "run", destination: { kind: "refused", reason: "target-unavailable" },
});
const ready = (...items: NotificationItem[]): NotificationsState => ({ state: "ready", items, pinned: [] });
const served = (state: NotificationsState): InboxWiring => ({ state, notice: "", control: async () => true, readAll: async () => undefined, open: () => undefined });
const preferencesPort = (notifications: Partial<PersonPreferences["notifications"]>): PersonPreferencesPort => {
  const snapshot = { value: resolvePersonPreferences({ notifications }), state: "ready" as const };
  return { snapshot: () => snapshot, subscribe: () => () => undefined, change: async () => true };
};

type Alert = { id: string; sound: boolean };
type Probe = { alerts: Alert[]; sounds: number; unread: number | undefined; listed: string[]; open: (next: boolean) => void };

/** Mounts the served rail model with its real alert delivery, then returns a `show` that swaps the served items. */
async function mount(initial: NotificationsState, notifications: Partial<PersonPreferences["notifications"]> = {}) {
  const probe: Probe = { alerts: [], sounds: 0, unread: undefined, listed: [], open: () => undefined };
  let setState: (next: NotificationsState) => void = () => undefined;
  function Harness() {
    const [state, set] = useState(initial); setState = set;
    const [open, setOpen] = useState(false);
    const [reads, setReads] = useState<NotificationReads>({});
    const deliver = useNotificationAlert(() => { probe.sounds += 1; });
    const model = useNotificationRailModel({ notifications: { state: "loading" }, reads, setReads, open, setOpen, setNotice: () => undefined, onOpenNotification: () => undefined, served: served(state),
      onAlert: (arrived, sound) => { probe.alerts.push({ id: arrived.id, sound }); deliver(arrived, sound); } });
    probe.unread = model.unread; probe.open = model.changeOpen;
    probe.listed = model.state.state === "ready" ? model.state.items.map(entry => entry.id) : [];
    return null;
  }
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const wrap = (children: ReactNode) => createElement(PersonPreferencesContext.Provider, { value: preferencesPort(notifications) }, createElement(ToastProvider, null, children));
  await act(async () => root?.render(wrap(createElement(Harness))));
  return { probe, show: async (next: NotificationsState) => { await act(async () => setState(next)); } };
}

describe("served notification alerts", () => {
  it("raises one Run completed toast for a newly arrived run while the list is closed, with its line", async () => {
    const before = item("old", "Run completed", "positive", true);
    const { probe, show } = await mount(ready(before));
    assert.deepEqual(probe.alerts, [], "items present at first load raise nothing");
    await show(ready(item("new", "Run completed", "positive"), before));
    await show(ready(item("new", "Run completed", "positive"), before));
    assert.deepEqual(probe.alerts, [{ id: "new", sound: true }]);
    assert.equal(probe.sounds, 1);
    assert.match(document.body.textContent ?? "", /Run completed/);
    assert.match(document.body.textContent ?? "", /Subject new · Person Lookup/);
  });

  it("raises nothing while the list is open, and not for the item that arrived meanwhile once it closes", async () => {
    const { probe, show } = await mount(ready());
    await act(async () => probe.open(true));
    await show(ready(item("during", "Run completed", "positive")));
    await act(async () => probe.open(false));
    await show(ready(item("during", "Run completed", "positive")));
    assert.deepEqual(probe.alerts, []);
  });

  it("raises nothing for an already read item or a notice no switch governs", async () => {
    const { probe, show } = await mount(ready());
    await show(ready(item("read", "Run completed", "positive", true), item("note", "Relay repaired a saved file", "info")));
    assert.deepEqual(probe.alerts, []);
  });

  for (const [label, off, tone, silenced] of [
    ["Run finished", { runFinished: "never" as const }, "positive", true],
    ["Needs you", { needsYou: false }, "warning", true],
    ["Failures", { failures: false }, "danger", true],
  ] as const) it(`${label} off silences only its alert`, async () => {
    const arrivals = [item("done", "Run completed", "positive"), item("wait", "Run waiting for you", "warning"), item("fail", "Run failed", "danger")];
    const { probe, show } = await mount(ready(), off);
    await show(ready(...arrivals));
    assert.deepEqual(probe.alerts.map(alert => alert.id).sort(), arrivals.filter(arrival => arrival.tone !== tone).map(arrival => arrival.id).sort());
    assert.equal(silenced, true);
    assert.equal(probe.unread, 3, "the bell counts every item whatever the switches say");
    assert.deepEqual(probe.listed, ["done", "wait", "fail"]);
  });

  it("Notification sound off silences the sound and keeps the toast", async () => {
    const { probe, show } = await mount(ready(), { sound: "none" });
    await show(ready(item("done", "Run completed", "positive")));
    assert.deepEqual(probe.alerts, [{ id: "done", sound: false }]);
    assert.equal(probe.sounds, 0);
    assert.match(document.body.textContent ?? "", /Run completed/);
  });

  it("leaves the unread count and list identical with every switch off", async () => {
    const arrivals = ready(item("done", "Run completed", "positive"), item("wait", "Run waiting for you", "warning"), item("fail", "Run failed", "danger"));
    const on = await mount(ready()); await on.show(arrivals);
    const reference = { unread: on.probe.unread, listed: on.probe.listed, alerts: on.probe.alerts.length };
    await act(async () => root?.unmount()); host?.remove();
    const off = await mount(ready(), { runFinished: "never", needsYou: false, failures: false, sound: "none" }); await off.show(arrivals);
    assert.deepEqual({ unread: off.probe.unread, listed: off.probe.listed }, { unread: reference.unread, listed: reference.listed });
    assert.equal(reference.alerts, 3);
    assert.deepEqual(off.probe.alerts, []);
    assert.equal(off.probe.sounds, 0);
    assert.equal(NEUTRAL_PERSON_PREFERENCES.notifications.sound, "default");
  });
});
