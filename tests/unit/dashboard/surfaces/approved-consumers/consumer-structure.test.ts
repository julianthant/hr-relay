import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { it } from "vitest";
import { ActivityView } from "../../../../../src/dashboard/surfaces/activity/activity-view.js";
import { NotificationsView } from "../../../../../src/dashboard/surfaces/notifications/notifications-view.js";
import { SessionsView } from "../../../../../src/dashboard/surfaces/sessions/sessions-view.js";

it("keeps the approved Activity action hierarchy and loading control state", () => {
  const markup = renderToStaticMarkup(createElement(ActivityView, {
    data: { state: "loading" }, range: { from: "2026-10-01", to: "2026-10-02" },
    today: "2026-10-02", period: "custom", onPreset: () => undefined,
    onRange: () => undefined, onExport: () => undefined,
  }));
  assert.match(markup, /Activity actions/);
  assert.match(markup, /Loading activity report/);
  assert.match(markup, /Export report/);
  assert.match(markup, /disabled=""/);
});

it("keeps the approved Notifications trigger states with identical supplied data", () => {
  const base = { filter: "all" as const, open: false, onFilter: () => undefined,
    onOpenChange: () => undefined, onControl: () => undefined,
    onOpen: () => undefined, notice: "", desktopStatus: "Desktop pings off", onEnable: () => undefined };
  const loading = renderToStaticMarkup(createElement(NotificationsView, { ...base, state: { state: "loading" } }));
  const ready = renderToStaticMarkup(createElement(NotificationsView, { ...base,
    state: { state: "ready", items: [], pinned: [] } }));
  assert.match(loading, /Notifications loading/);
  assert.match(ready, /Notifications, 0 unread/);
});

it("keeps the approved Sessions strip and disables Add workers until ready", () => {
  const base = { open: true, onOpenChange: () => undefined,
    onControl: () => undefined, onAdd: () => undefined, workflows: [{ id: "workflow", label: "Workflow" }] };
  const loading = renderToStaticMarkup(createElement(SessionsView, { ...base, data: { state: "loading" } }));
  const ready = renderToStaticMarkup(createElement(SessionsView, { ...base, data: { state: "ready", workers: [] } }));
  assert.match(loading, /Session actions/);
  assert.match(loading, /Loading sessions/);
  const addButton = [...loading.matchAll(/<button[^>]*>[\s\S]*?<\/button>/g)]
    .map(([button]) => button).find((button) => button.includes("Add workers"));
  assert.ok(addButton, "approved Add workers control remains present");
  assert.match(addButton, /disabled=""/, "Add workers is disabled while the resource loads");
  assert.match(ready, /No workers yet/);
});
