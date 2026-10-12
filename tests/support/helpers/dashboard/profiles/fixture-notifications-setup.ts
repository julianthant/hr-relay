import { DashboardDayWireSchema } from "../../../../../src/models/dashboard/projection.js";
import type * as FixtureIdentityTypes from "../../../fixtures/dashboard/fixture-identity.js";


export function createFixtureNotificationsSetup({ parkedSeverity, parkedTitle, completionTitle, at, uuidOf }: {
  parkedSeverity: "warning" | "error";
  parkedTitle: string;
  completionTitle: string;
  at: typeof FixtureIdentityTypes.at;
  uuidOf: typeof FixtureIdentityTypes.uuidOf;
}) {
  const FIXTURE_NOTIFICATIONS = DashboardDayWireSchema.shape.notifications.parse([
      {
        kind: "notification",
        notificationId: uuidOf(801),
        channel: "ping", count: 1, publicationId: "a".repeat(64), trigger: "write-parked", readState: "unread",
        actorId: "local-operator",
        severity: parkedSeverity,
        title: parkedTitle,
        state: "unread",
        context: { state: "unavailable" },
        occurredAt: at(45),
        revision: 1,
      },
      {
        kind: "notification",
        notificationId: uuidOf(802),
        channel: "inbox", count: 1, publicationId: "b".repeat(64), trigger: "verified-done", readState: "read",
        actorId: "local-operator",
        severity: "info",
        title: completionTitle,
        state: "read",
        context: { state: "unavailable" },
        occurredAt: at(18),
        revision: 1,
      },
    ]);

  const FIXTURE_BACKFILL_NOTIFICATIONS = DashboardDayWireSchema.shape.notifications.parse([
      ...[803, 804, 805, 806, 807, 808].map((seed, index) => ({
        kind: "backfill-gap",
        channel: "ping", count: 1, publicationId: seed.toString(16).padStart(64, "0"),
        notificationId: uuidOf(seed),
        actorId: "local-operator",
        severity: "error",
        title: "Notification history is incomplete",
        state: "pinned",
        occurredAt: at(47 + index),
      } as const)),
      ...FIXTURE_NOTIFICATIONS,
    ]);

  return { FIXTURE_NOTIFICATIONS, FIXTURE_BACKFILL_NOTIFICATIONS };
}
