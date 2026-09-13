import { DashboardDayWireSchema } from "../../../src/domain/dashboard/projection.js";
import { at,uuidOf } from "./fixture-identity.js";
export const FIXTURE_NOTIFICATIONS = DashboardDayWireSchema.shape.notifications.parse([
    {
      kind: "notification",
      notificationId: uuidOf(801),
      actorId: "local-operator",
      severity: "warning",
      title: "A write to UCPath is parked pending proof",
      state: "unread",
      occurredAt: at(45),
      revision: 1,
    },
    {
      kind: "notification",
      notificationId: uuidOf(802),
      actorId: "local-operator",
      severity: "info",
      title: "Onboarding cohort — July stragglers completed",
      state: "read",
      occurredAt: at(18),
      revision: 1,
    },
  ]);
export const FIXTURE_BACKFILL_NOTIFICATIONS = DashboardDayWireSchema.shape.notifications.parse([
    ...[803, 804, 805, 806, 807, 808].map((seed, index) => ({
      kind: "backfill-gap",
      notificationId: uuidOf(seed),
      actorId: "local-operator",
      severity: "error",
      title: "Notification history is incomplete",
      state: "pinned",
      occurredAt: at(47 + index),
    } as const)),
    ...FIXTURE_NOTIFICATIONS,
  ]);
