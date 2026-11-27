// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import { ToastProvider } from "../../../../src/dashboard/ds/ui.js";
import { PersonPreferencesContext, type PersonPreferencesPort } from "../../../../src/dashboard/lib/person-preferences.js";
import type { InboxWiring } from "../../../../src/dashboard/state/inbox-wiring-adapter.js";
import { useNotificationAlert, useNotificationRailModel } from "../../../../src/dashboard/surfaces/notifications/notification-rail-model.js";
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
type Arrival = Parameters<Parameters<InboxWiring["onPublication"]>[0]>[0];
const served = (state: NotificationsState, listeners: Set<(arrival: Arrival) => void>): InboxWiring => ({ state, notice: "", control: async () => true, canAct: () => true, canClear: () => true, readAll: async () => undefined, clear: async () => true, clearAll: async () => undefined, open: () => undefined,
  onPublication: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; } });
const preferencesPort = (notifications: Partial<PersonPreferences["notifications"]>): PersonPreferencesPort => {
  const snapshot = { value: resolvePersonPreferences({ notifications }), state: "ready" as const };
  return { snapshot: () => snapshot, subscribe: () => () => undefined, change: async () => true };
};

type Alert = { id: string; sound: boolean };
type Probe = { alerts: Alert[]; sounds: number; unread: number | undefined; listed: string[]; open: (next: boolean) => void };

/** Mounts the served rail model with its real alert delivery; `show` swaps the served snapshot, `publish` delivers one publication. */
async function mount(initial: NotificationsState, notifications: Partial<PersonPreferences["notifications"]> = {}) {
  const probe: Probe = { alerts: [], sounds: 0, unread: undefined, listed: [], open: () => undefined };
  let setState: (next: NotificationsState) => void = () => undefined;
  const listeners = new Set<(arrival: Arrival) => void>();
  function Harness() {
    const [state, set] = useState(initial); setState = set;
    const [open, setOpen] = useState(false);
    const deliver = useNotificationAlert(() => { probe.sounds += 1; });
    const model = useNotificationRailModel({ open, setOpen, onRefused: () => undefined, onOpenNotification: () => undefined, served: served(state, listeners),
      onAlert: (arrived, sound) => { probe.alerts.push({ id: arrived.id, sound }); deliver(arrived, sound); } });
    probe.unread = model.unread; probe.open = model.changeOpen;
    probe.listed = model.state.state === "ready" ? model.state.items.map(entry => entry.id) : [];
    return null;
  }
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const wrap = (children: ReactNode) => createElement(PersonPreferencesContext.Provider, { value: preferencesPort(notifications) }, createElement(ToastProvider, null, children));
  await act(async () => root?.render(wrap(createElement(Harness))));
  return { probe, show: async (next: NotificationsState) => { await act(async () => setState(next)); },
    publish: async (arrival: NotificationItem, sourceId = arrival.id) => { await act(async () => { for (const listener of listeners) listener({ sourceId, item: arrival }); }); } };
}

describe("served notification alerts", () => {
  it("raises one Run completed toast per publication, however many snapshots carry the item, with its line", async () => {
    const before = item("old", "Run completed", "positive", true);
    const { probe, show, publish } = await mount(ready(before));
    assert.deepEqual(probe.alerts, [], "items present at first load raise nothing");
    const fresh = item("new", "Run completed", "positive");
    await show(ready(fresh, before));
    assert.deepEqual(probe.alerts, [], "a snapshot alone is not a publication");
    await publish(fresh);
    await show(ready(fresh, before));
    await show(ready(item("new", "Run completed", "positive"), before));
    assert.deepEqual(probe.alerts, [{ id: "new", sound: true }]);
    assert.equal(probe.sounds, 1);
    assert.match(document.body.textContent ?? "", /Run completed/);
    assert.match(document.body.textContent ?? "", /Subject new · Person Lookup/);
  });

  it("raises one alert for each distinct publication, including a later one for the same notice", async () => {
    const { probe, publish } = await mount(ready());
    const first = item("a", "Run failed", "danger");
    await publish(first, "source-1");
    await publish(first, "source-2");
    await publish(item("b", "Run failed", "danger"), "source-3");
    assert.deepEqual(probe.alerts.map(alert => alert.id), ["a", "a", "b"]);
  });

  it("raises nothing while the list is open, and not for the item that arrived meanwhile once it closes", async () => {
    const { probe, show, publish } = await mount(ready());
    await act(async () => probe.open(true));
    const during = item("during", "Run completed", "positive");
    await publish(during);
    await act(async () => probe.open(false));
    await show(ready(during));
    assert.deepEqual(probe.alerts, []);
  });

  it("announces a failure once, when it fails away from Logs", async () => {
    const { probe, show, publish } = await mount(ready());
    const failed = item("failed", "Run failed", "danger");
    await show(ready(failed));
    await publish(failed);
    assert.deepEqual(probe.alerts.map(alert => alert.id), ["failed"]);
    assert.equal(probe.unread, 1);
    assert.match(document.body.textContent ?? "", /Run failed/);
  });

  it("raises no failure notice for a cancelled run, which publishes nothing", async () => {
    const { probe, show } = await mount(ready());
    await show(ready());
    assert.deepEqual(probe.alerts, []);
    assert.equal(probe.unread, 0);
    assert.doesNotMatch(document.body.textContent ?? "", /failed|did not complete/i);
  });

  it("raises nothing for an already read item or a notice no switch governs", async () => {
    const { probe, publish } = await mount(ready());
    await publish(item("read", "Run completed", "positive", true));
    await publish(item("note", "Relay repaired a saved file", "info"));
    assert.deepEqual(probe.alerts, []);
  });

  for (const [label, off, tone, silenced] of [
    ["Run finished", { runFinished: "never" as const }, "positive", true],
    ["Needs you", { needsYou: false }, "warning", true],
    ["Failures", { failures: false }, "danger", true],
  ] as const) it(`${label} off silences only its alert`, async () => {
    const arrivals = [item("done", "Run completed", "positive"), item("wait", "Run waiting for you", "warning"), item("fail", "Run failed", "danger")];
    const { probe, show, publish } = await mount(ready(), off);
    await show(ready(...arrivals));
    for (const arrival of arrivals) await publish(arrival);
    assert.deepEqual(probe.alerts.map(alert => alert.id).sort(), arrivals.filter(arrival => arrival.tone !== tone).map(arrival => arrival.id).sort());
    assert.equal(silenced, true);
    assert.equal(probe.unread, 3, "the bell counts every item whatever the switches say");
    assert.deepEqual(probe.listed, ["done", "wait", "fail"]);
  });

  it("Notification sound off silences the sound and keeps the toast", async () => {
    const { probe, publish } = await mount(ready(), { sound: "none" });
    await publish(item("done", "Run completed", "positive"));
    assert.deepEqual(probe.alerts, [{ id: "done", sound: false }]);
    assert.equal(probe.sounds, 0);
    assert.match(document.body.textContent ?? "", /Run completed/);
  });

  it("leaves the unread count and list identical with every switch off", async () => {
    const arrivals = [item("done", "Run completed", "positive"), item("wait", "Run waiting for you", "warning"), item("fail", "Run failed", "danger")];
    const on = await mount(ready()); await on.show(ready(...arrivals)); for (const arrival of arrivals) await on.publish(arrival);
    const reference = { unread: on.probe.unread, listed: on.probe.listed, alerts: on.probe.alerts.length };
    await act(async () => root?.unmount()); host?.remove();
    const off = await mount(ready(), { runFinished: "never", needsYou: false, failures: false, sound: "none" }); await off.show(ready(...arrivals)); for (const arrival of arrivals) await off.publish(arrival);
    assert.deepEqual({ unread: off.probe.unread, listed: off.probe.listed }, { unread: reference.unread, listed: reference.listed });
    assert.equal(reference.alerts, 3);
    assert.deepEqual(off.probe.alerts, []);
    assert.equal(off.probe.sounds, 0);
    assert.equal(NEUTRAL_PERSON_PREFERENCES.notifications.sound, "default");
  });
});
