import { createDashboardModelFixtures } from "../../support/helpers/dashboard-model-fixtures.js";
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { DashboardStreamEnvelopeSchema } from "../../../src/models/dashboard/subscription.js";

const { RUN_1, RUN_2, HASH_A, QUEUE, DAY } = createDashboardModelFixtures();


describe("subscription snapshots, changes, and resets", () => {
  const snapshot = { topic: "dashboard-day", position: 4, payload: DAY, rows: [] };
  const change = { topic: "dashboard-day", after: "pc:1", position: 4, rows: [], day: { operation: "replace-queue-surface", target: { runId: RUN_1, rowRevision: 1 }, replacement: QUEUE } };

  it("parses the dashboard-day snapshot and change arms", () => {
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "snapshot", cursor: "pc:2", ...snapshot }).success, true);
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "change", cursor: "pc:2", ...change }).success, true);
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "change", topic: "dashboard-day", cursor: "pc:2", after: "pc:1", position: 0, rows: [] }).success, true,
      "a change without a day part or rows moves the cursor only");
    const hello = { type: "hello", wireVersion: 1, descriptorHash: HASH_A, projectionGeneration: 1, cursor: "pc:2" };
    assert.equal(DashboardStreamEnvelopeSchema.safeParse(hello).success, true);
    assert.equal(DashboardStreamEnvelopeSchema.safeParse(hello).success, true, "duplicate cursor delivery remains representable and idempotent");
    for (const reason of ["cursor-expired", "generation-changed", "descriptor-changed"]) {
      assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "reset-required", reason, cursor: "pc:2" }).success, true);
    }
    for (const state of ["live", "reconnecting", "degraded"]) {
      assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "health", state }).success, true);
    }
  });

  it("rejects topic/payload mismatches, wrong arms, and identity/revision drift", () => {
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "snapshot", topic: "run-detail", cursor: "pc:2", payload: DAY }).success, false);
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "change", cursor: "pc:2", ...change, day: DAY }).success, false);
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "patch", topic: "dashboard-day", cursor: "pc:2", payload: change.day }).success, false,
      "the patch envelope is gone");
    for (const missing of ["after", "position", "rows"] as const) {
      const { [missing]: _omitted, ...rest } = change;
      assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "change", cursor: "pc:2", ...rest }).success, false, `a change names its ${missing}`);
    }
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "snapshot", topic: "dashboard-day", cursor: "pc:2", payload: DAY, rows: [] }).success, false,
      "a snapshot names its position");
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "snapshot", topic: "dashboard-day", cursor: "pc:2", position: 4, payload: DAY }).success, false,
      "a snapshot names its rows");
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "reset-required", reason: "silent-drop", cursor: "pc:2" }).success, false);
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "snapshot", topic: "dashboard-day", position: 4, payload: DAY }).success, false);
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "change", cursor: "pc:2", ...change,
      day: { operation: "replace-queue-surface", target: { runId: RUN_2, rowRevision: 1 }, replacement: QUEUE } }).success, false);
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "change", cursor: "pc:2", ...change,
      day: { ...change.day, update: { runId: RUN_2 } } }).success, false);
  });

  it("carries a run panel row as a whole value, available or refused", () => {
    const refused = { model: "run-panel", key: RUN_1, value: { state: "refused", error: { state: "error", code: "SECTION_UNAVAILABLE", message: "not served", retryable: false } } };
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "change", cursor: "pc:2", ...change, rows: [refused] }).success, true);
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "snapshot", cursor: "pc:2", ...snapshot, rows: [refused] }).success, true);
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "change", cursor: "pc:2", ...change, rows: [{ ...refused, model: "run-logs" }] }).success, false,
      "only declared row models ride the stream");
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "change", cursor: "pc:2", ...change, rows: [{ ...refused, value: { state: "loading" } }] }).success, false);
  });

  it("carries the notification status row available or unavailable, never another value", () => {
    const available = { model: "notification-status", key: "local-operator", value: { state: "available", value: { state: "ready", pending: 0 } } };
    const unavailable = { model: "notification-status", key: "local-operator", value: { state: "unavailable", error: { state: "error", code: "DASHBOARD_READ_FAILED", message: "not read", retryable: true } } };
    for (const row of [available, unavailable]) {
      assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "snapshot", cursor: "pc:2", ...snapshot, rows: [row] }).success, true);
    }
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "snapshot", cursor: "pc:2", ...snapshot,
      rows: [{ ...available, value: { state: "available", value: { state: "unknown", pending: 0 } } }] }).success, false);
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "snapshot", cursor: "pc:2", ...snapshot, rows: [{ ...available, value: { state: "ready", pending: 0 } }] }).success, false,
      "the status is wrapped in its read state");
  });
});

describe("notification publications", () => {
  const notification = (notificationId: string, extra: Record<string, unknown> = {}) => ({ kind: "notification", notificationId, actorId: "local-operator", channel: "ping", count: 1,
    publicationId: "b".repeat(64), trigger: "storage", readState: "unread", state: "unread", severity: "warning", title: "Storage health degraded",
    occurredAt: "2026-08-03T17:00:00Z", revision: 1, context: { state: "storage", concern: "backup" }, sourceEvent: { state: "available", kind: "storage-degraded" }, ...extra });
  const A = "00000000-0000-4000-8000-0000000000a1", B = "00000000-0000-4000-8000-0000000000a2";
  const envelope = (listed: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ type: "notification-publication", cursor: "pc:3", day: "2026-08-03", descriptorHash: HASH_A, projectionGeneration: 1,
    publication: { sourceId: "a".repeat(64), actorId: "local-operator", durable: "created", notification: notification(A) }, listed, target: { kind: "storage" }, ...extra });

  it("carries its cursor, its target and the listed row that holds it", () => {
    assert.equal(DashboardStreamEnvelopeSchema.safeParse(envelope(notification(A))).success, true, "a row outside a group is listed as itself");
    const group = notification(B, { count: 3, group: { concern: "backup", members: [{ notificationId: A, revision: 1 }, { notificationId: B, revision: 1 }] } });
    assert.equal(DashboardStreamEnvelopeSchema.safeParse(envelope(group)).success, true, "a storage notice is listed inside its concern's group");
    for (const missing of ["cursor", "target", "listed"] as const) {
      const { [missing]: _omitted, ...rest } = envelope(notification(A));
      assert.equal(DashboardStreamEnvelopeSchema.safeParse(rest).success, false, `a publication names its ${missing}`);
    }
  });

  it("refuses a listed row that does not hold the published notification", () => {
    assert.equal(DashboardStreamEnvelopeSchema.safeParse(envelope(notification(B))).success, false);
    assert.equal(DashboardStreamEnvelopeSchema.safeParse(envelope(notification(A, { actorId: "other-operator" }))).success, false);
  });
});
