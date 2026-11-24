import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createRowStore } from "../../../../src/dashboard/client/subscriptions/row-store.js";
import type { StreamRow } from "../../../../src/models/dashboard/subscription.js";

const RUN = "3b8f0a1e-2c4d-4e6f-8a9b-0c1d2e3f4a5b";
const panelAt = (rowRevision: number): StreamRow => ({ model: "run-panel", key: RUN, value: { state: "available", detail: { runId: RUN, rowRevision } } } as unknown as StreamRow);

describe("row store delivery", () => {
  it("marks only a panel delivered below the revision its day held for the run", () => {
    const rows = createRowStore();
    rows.open(RUN);
    rows.apply([panelAt(3)], () => 4);
    const below = rows.runPanel(RUN);
    assert.ok(below && rows.deliveredBehindRow(below));
    rows.apply([panelAt(4)], () => 4);
    const level = rows.runPanel(RUN);
    assert.ok(level && !rows.deliveredBehindRow(level));
    rows.apply([panelAt(3)]);
    const unknown = rows.runPanel(RUN);
    assert.ok(unknown && !rows.deliveredBehindRow(unknown), "no day row to compare with, nothing to mark");
  });

  it("does not mark a held panel when the day later moves ahead of it", () => {
    const rows = createRowStore();
    rows.open(RUN);
    rows.apply([panelAt(3)], () => 3);
    const held = rows.runPanel(RUN);
    assert.ok(held && !rows.deliveredBehindRow(held));
  });
});

describe("row store notification status", () => {
  const ready = { state: "ready", pending: 0 } as const;
  const failed = { state: "failed", code: "NOTIFICATION_OBSERVATION_FAILED", pending: 1 } as const;
  const error = { state: "error", code: "DASHBOARD_READ_FAILED", message: "Relay could not load this.", retryable: true } as const;
  const statusRow = (value: Extract<StreamRow, { model: "notification-status" }>["value"]): StreamRow => ({ model: "notification-status", key: "local-operator", value } as StreamRow);

  it("holds the delivered status whatever run is open, and keeps a good one when a read fails", () => {
    const rows = createRowStore();
    assert.equal(rows.notificationStatus(), undefined);
    let notified = 0;
    rows.subscribe(() => { notified += 1; });
    rows.apply([statusRow({ state: "unavailable", error })]);
    assert.deepEqual(rows.notificationStatus(), { unavailable: true }, "a first status that failed holds nothing to show");
    rows.apply([statusRow({ state: "available", value: ready })]);
    assert.deepEqual(rows.notificationStatus(), { status: ready, unavailable: false });
    rows.apply([statusRow({ state: "unavailable", error })]);
    assert.deepEqual(rows.notificationStatus(), { status: ready, unavailable: true }, "the good status stays, marked unavailable");
    rows.apply([statusRow({ state: "available", value: failed })]);
    assert.deepEqual(rows.notificationStatus(), { status: failed, unavailable: false });
    assert.equal(notified, 4);
    rows.reset();
    assert.equal(rows.notificationStatus(), undefined, "a reset drops it with the panels");
  });
});
