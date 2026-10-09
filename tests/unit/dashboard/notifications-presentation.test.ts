import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { notificationsSample } from "../../../src/dashboard/surfaces/notifications/notifications-fixture.js";
import { notificationView, updateNotification, type NotificationsState } from "../../../src/dashboard/surfaces/notifications/notifications-view-model.js";

function ready(state: NotificationsState) {
  assert.equal(state.state, "ready");
  if (state.state !== "ready") throw new Error("expected ready sample");
  return state;
}
describe("frontend notification state", () => {
  it("retires history gaps, with urgency independent of read state", () => {
    const state = notificationsSample("normal");
    const all = notificationView(state, "all");
    assert.equal(all.unread, 3);
    assert.deepEqual(all.shown.map(item => item.id), ["sample-verification", "sample-approval", "sample-review", "sample-completed"]);
    assert.deepEqual(all.pinned, []);
    for (const filter of ["all", "unread", "attention", "failed"] as const) assert.deepEqual(notificationView(state, filter).pinned, []);
    assert.deepEqual(notificationView(state, "unread").shown.map(item => item.id), ["sample-verification", "sample-approval", "sample-completed"]);
    assert.deepEqual(notificationView(state, "attention").shown.map(item => item.id), ["sample-verification", "sample-approval", "sample-review"]);
    assert.deepEqual(notificationView(state, "failed").shown.map(item => item.id), ["sample-verification"]);
  });
  it("marks only the selected item read, preserving peer identity and the fixture", () => {
    const state = notificationsSample("normal");
    const updated = updateNotification(state, "sample-verification", "read");
    assert.equal(notificationView(updated, "all").unread, 2);
    assert.equal(ready(updated).items[1], ready(state).items[1]);
    assert.equal(ready(updated).pinned, ready(state).pinned);
    assert.equal(ready(state).items[0].read, false);
    assert.equal(notificationView(updateNotification(updated, "sample-verification", "read"), "all").unread, 2);
    assert.equal(notificationView(updateNotification(updated, "sample-verification", "unread"), "all").unread, 3);
  });
  it("keeps failures needing attention after their updates are read", () => {
    const state = updateNotification(notificationsSample("normal"), "sample-verification", "read");
    assert.equal(ready(state).items[0].read, true);
    assert.equal(notificationView(state, "all").unread, 2);
    assert.deepEqual(notificationView(state, "failed").shown.map(item => item.id), ["sample-verification"]);
    assert.deepEqual(notificationView(state, "attention").shown.map(item => item.id), ["sample-verification", "sample-approval", "sample-review"]);
    assert.equal(notificationView(state, "unread").shown.length, 2);
  });
  it("intersects All/Unread with the separate category filter without resolving attention", () => {
    const state = updateNotification(notificationsSample("normal"), "sample-verification", "read");
    assert.deepEqual(notificationView(state, "all", "failed").shown.map(item => item.id), ["sample-verification"]);
    assert.deepEqual(notificationView(state, "unread", "failed").shown, []);
    assert.deepEqual(notificationView(state, "unread", "attention").shown.map(item => item.id), ["sample-approval"]);
    assert.equal(notificationView(state, "unread", "attention").unread, 2);
    assert.equal(notificationView(state, "all", "attention").shown.length, 3);
  });
  it("distinguishes loading and unavailable from a measured empty inbox", () => {
    for (const scenario of ["loading", "unavailable"]) {
      const state = notificationsSample(scenario);
      assert.equal(state.state, scenario);
      assert.equal(notificationView(state, "all").unread, undefined);
      assert.deepEqual(notificationView(state, "all").shown, []);
    }
    assert.equal(notificationView(notificationsSample("empty"), "all").unread, 0);
    assert.deepEqual(notificationView(notificationsSample("empty"), "all").pinned, []);
  });
  it("refuses unavailable actions, unknown items and actions on pinned notices", () => {
    assert.throws(() => updateNotification(notificationsSample("loading"), "sample-verification", "read"), /notification-preview-not-ready/);
    assert.throws(() => updateNotification(notificationsSample("normal"), "missing", "read"), /notification-preview-item-missing/);
    for (const control of ["read"] as const) assert.throws(() => updateNotification(notificationsSample("normal"), "sample-gap", control), /notification-preview-item-missing/);
    assert.throws(() => notificationsSample("unknown"), /notification-sample-missing/);
  });
});
