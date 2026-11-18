// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { useWorkspaceNotifications } from "./notifications-preview.js";
import type { NotificationsState } from "../../../../src/dashboard/surfaces/notifications/notifications-view-model.js";
import { FIXTURE_DAY_WIRE } from "./fixture-queue.js";
import { QueueSurfaceWireSchema, type QueueSurfaceWire } from "../../../../src/models/dashboard/projection.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
it("keeps the private Inbox producer stable within a minute and exposes missing served authority", async () => {
  const rows = FIXTURE_DAY_WIRE.queueSurfaces;
  const workflowLabel = (id: string) => id;
  const eventTimes = {};
  let value: NotificationsState | undefined;
  function Probe({ nowIso, available, unavailable }: { nowIso: string; available: boolean; unavailable?: string }) {
    value = useWorkspaceNotifications("normal", { day: FIXTURE_DAY_WIRE.day, nowIso, anchorIso: "2026-08-03T12:00:00.000Z", rows: available ? rows : undefined, workflowLabel, eventTimes, unavailable });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const render = async (nowIso: string, available = true, unavailable?: string) => { await act(async () => root.render(createElement(Probe, { nowIso, available, unavailable }))); };
  try {
    await render("2026-08-03T12:00:01.000Z"); assert.equal(value?.state, "ready"); const first = value;
    await render("2026-08-03T12:00:59.000Z"); assert.equal(value, first);
    await render("2026-08-03T12:01:00.000Z"); assert.notEqual(value, first);
    await render("2026-08-03T12:01:00.000Z", false); assert.deepEqual(value, { state: "loading" });
    await render("2026-08-03T12:01:00.000Z", false, "Served day unavailable");
    assert.deepEqual(value, { state: "unavailable", reason: "Served day unavailable" });
  } finally { await act(async () => root.unmount()); }
});

it("preserves served ages and genuine future events", async () => {
  const workflowLabel = (id: string) => id;
  const source = FIXTURE_DAY_WIRE.queueSurfaces[0];
  const rows = [QueueSurfaceWireSchema.parse({ ...source, status: "done", endedAt: { state: "present", value: "2026-08-03T11:59:00.000Z" } })];
  const futureRows = [QueueSurfaceWireSchema.parse({ ...rows[0], endedAt: { state: "present", value: "2026-08-03T12:02:15.000Z" } })];
  let value: NotificationsState | undefined;
  function Probe({ nowIso, rows }: { nowIso: string; rows: readonly QueueSurfaceWire[] }) {
    value = useWorkspaceNotifications("normal", { day: FIXTURE_DAY_WIRE.day, nowIso, anchorIso: "2026-08-03T12:00:30.000Z", rows, workflowLabel });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const render = async (nowIso: string, inputRows = rows) => {
    await act(async () => root.render(createElement(Probe, { nowIso, rows: inputRows })));
    assert.equal(value?.state, "ready");
    if (value?.state !== "ready") throw new Error("Expected ready notifications");
    return value.items;
  };
  try {
    const first = await render("2026-08-03T12:01:00.000Z"); assert.equal(first[0].age, "2 min ago");
    assert.equal((await render("2026-08-03T12:01:59.000Z", futureRows))[0].age, "");
  } finally { await act(async () => root.unmount()); }
});
