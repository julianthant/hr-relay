// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { useWorkspaceNotifications } from "../../../../src/dashboard/surfaces/notifications/notifications-preview-model.js";
import type { NotificationsState } from "../../../../src/dashboard/surfaces/notifications/notifications-view-model.js";
import { FIXTURE_DAY_WIRE } from "../../../support/fixtures/dashboard/fixture-queue.js";
import { seedMockRuns } from "../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import type { QueueSurfaceWire } from "../../../../src/models/dashboard/projection.js";

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

it("preserves served ages, genuine future events and explicit mock event times", async () => {
  const runs = seedMockRuns();
  const workflowLabel = (id: string) => id;
  const source = FIXTURE_DAY_WIRE.queueSurfaces[0];
  const rows: readonly QueueSurfaceWire[] = [{ ...source, status: "done", endedAt: { state: "present", value: "2026-08-03T11:59:00.000Z" } }];
  const futureRows: readonly QueueSurfaceWire[] = [{ ...rows[0], endedAt: { state: "present", value: "2026-08-03T12:02:15.000Z" } }];
  const eventTimes = { "mock:emergency-contact:sample:ocr": "2026-08-03T12:01:45.000Z" };
  let value: NotificationsState | undefined;
  function Probe({ nowIso, rows, eventTimes }: { nowIso: string; rows: readonly QueueSurfaceWire[]; eventTimes?: Readonly<Record<string, string>> }) {
    value = useWorkspaceNotifications("normal", { day: FIXTURE_DAY_WIRE.day, nowIso, anchorIso: "2026-08-03T12:00:30.000Z", rows, runs, workflowLabel, eventTimes });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const render = async (nowIso: string, inputRows = rows, times?: Readonly<Record<string, string>>) => {
    await act(async () => root.render(createElement(Probe, { nowIso, rows: inputRows, eventTimes: times })));
    assert.equal(value?.state, "ready");
    if (value?.state !== "ready") throw new Error("Expected ready notifications");
    return value.items;
  };
  try {
    const first = await render("2026-08-03T12:01:00.000Z"); assert.equal(first[0].age, "2 min ago");
    assert.equal((await render("2026-08-03T12:01:59.000Z", futureRows))[0].age, "");
    const updated = await render("2026-08-03T12:01:59.000Z", rows, eventTimes);
    assert.deepEqual(updated.map(item => item.id), first.map(item => item.id));
    assert.equal(updated.find(item => item.destination.kind === "preview-run" && item.destination.runId === "mock:emergency-contact:sample:ocr")?.age, "Just now");
    const later = await render("2026-08-03T12:03:00.000Z", rows, eventTimes);
    assert.equal(later.find(item => item.destination.kind === "preview-run" && item.destination.runId === "mock:emergency-contact:sample:ocr")?.age, "1 min ago");
  } finally { await act(async () => root.unmount()); }
});

it("keeps seeded OCR ages visible from an exact bootstrap instant through minute ticks and anchor changes", async () => {
  const rows = FIXTURE_DAY_WIRE.queueSurfaces;
  const runs = seedMockRuns();
  const workflowLabel = (id: string) => id;
  const eventTimes = {};
  let value: NotificationsState | undefined;
  function Probe({ nowIso, anchorIso }: { nowIso: string; anchorIso: string }) {
    value = useWorkspaceNotifications("normal", { day: FIXTURE_DAY_WIRE.day, nowIso, anchorIso, rows, runs, workflowLabel, eventTimes });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const render = async (nowIso: string, anchorIso = "2026-08-03T12:00:30.000Z") => {
    await act(async () => root.render(createElement(Probe, { nowIso, anchorIso })));
    assert.equal(value?.state, "ready");
    if (value?.state !== "ready") throw new Error("Expected ready notifications");
    const item = value.items.find(item => item.destination.kind === "preview-run" && item.destination.runId === "mock:emergency-contact:sample:ocr");
    assert.ok(item);
    return item.age;
  };
  try {
    assert.equal(await render("2026-08-03T12:00:30.000Z"), "Just now"); const first = value;
    assert.equal(await render("2026-08-03T12:00:59.000Z"), "Just now"); assert.equal(value, first);
    assert.equal(await render("2026-08-03T12:01:00.000Z"), "Just now"); assert.notEqual(value, first);
    assert.equal(await render("2026-08-03T12:02:00.000Z"), "1 min ago"); const later = value;
    assert.equal(await render("2026-08-03T12:02:40.000Z", "2026-08-03T12:02:30.000Z"), "Just now"); assert.notEqual(value, later);
  } finally { await act(async () => root.unmount()); }
});
