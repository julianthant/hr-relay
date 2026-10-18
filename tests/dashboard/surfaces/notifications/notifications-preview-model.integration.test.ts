// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { useWorkspaceNotifications } from "../../../../src/dashboard/surfaces/notifications/notifications-preview-model.js";
import type { NotificationsState } from "../../../../src/dashboard/surfaces/notifications/notifications-view-model.js";
import { FIXTURE_DAY_WIRE } from "../../../support/fixtures/dashboard/fixture-queue.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
it("keeps the private Inbox producer stable within a minute and exposes missing served authority", async () => {
  const rows = FIXTURE_DAY_WIRE.queueSurfaces;
  const runs: readonly never[] = [];
  const workflowLabel = (id: string) => id;
  const eventTimes = {};
  let value: NotificationsState | undefined;
  function Probe({ nowIso, available, unavailable }: { nowIso: string; available: boolean; unavailable?: string }) {
    value = useWorkspaceNotifications("normal", { day: FIXTURE_DAY_WIRE.day, nowIso, anchorIso: "2026-08-03T12:00:00.000Z", rows: available ? rows : undefined, runs, workflowLabel, eventTimes, unavailable });
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
