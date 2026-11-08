import { describe,expect,it } from "vitest";
import { createNotificationTargetQuery } from "../../../../src/backend/runs/queries/notifications.js";
import { failureRecordOf,notificationRecordOf,runRecordOf } from "../../../support/helpers/backend/dashboard-harness.js";

describe("notification destinations", () => {
  it("resolves the canonical run date, checks actor, and refuses a deletion between lookups", () => {
    const run = runRecordOf({ seed: 1, enqueuedAt: "2026-07-03T18:00:00.000Z" });
    const row = notificationRecordOf({ seed: 1, title: "private title", lastSeenAt: run.createdAt });
    let deleted = false;
    const query = createNotificationTargetQuery({ get: () => row, read: () => deleted ? { state: "absent", runId: run.envelope.runId } : { state: "present", disposition: "live", run }, failure: () => undefined });
    expect(query(row.notificationId, "another-actor")).toMatchObject({ kind: "refused", reason: "wrong-actor" });
    expect(query(row.notificationId, row.actorId)).toEqual({ kind: "run", runId: run.envelope.runId, day: "2026-07-03" });
    deleted = true;
    expect(query(row.notificationId, row.actorId)).toMatchObject({ kind: "refused", reason: "run-unavailable" });
    expect(() => query("malformed", row.actorId)).toThrow();
  });
  it("opens the host row for a hidden run", () => {
    const hidden = runRecordOf({ seed: 3, enqueuedAt: "2026-07-03T18:00:00.000Z" });
    const host = runRecordOf({ seed: 4, enqueuedAt: "2026-07-04T18:00:00.000Z" });
    const row = notificationRecordOf({ seed: 3, title: "Records ready", lastSeenAt: hidden.createdAt });
    const query = createNotificationTargetQuery({ get: () => row, read: () => ({ state: "present", disposition: "live", run: hidden }), failure: () => undefined,
      host: run => run === hidden ? host : undefined });
    expect(query(row.notificationId, row.actorId)).toEqual({ kind: "run", runId: host.envelope.runId, day: "2026-07-04" });
  });
  it("preserves exact failure identity and Storage", () => {
    const failure = failureRecordOf({ seed: 2, code: "TEST_FAILURE" });
    const run = runRecordOf({ seed: 2, enqueuedAt: failure.occurredAt, lifecycle: { state: "terminal", outcome: "failed", failureId: failure.failureId, endedAt: failure.occurredAt } });
    const row = notificationRecordOf({ seed: 2, title: "Failure", lastSeenAt: run.updatedAt });
    row.links = [{ kind: "failure", runId: run.envelope.runId, failureId: failure.failureId }];
    const query = createNotificationTargetQuery({ get: () => row, read: () => ({ state: "present", disposition: "live", run }), failure: () => failure });
    expect(query(row.notificationId, row.actorId)).toMatchObject({ kind: "failure", failureId: failure.failureId });
    row.links = [{ kind: "storage", diagnosticFingerprint: row.dedupeFingerprint }];
    expect(query(row.notificationId, row.actorId)).toEqual({ kind: "storage" });
  });
});
