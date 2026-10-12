// A replay gap is explicit protocol evidence, not a timeout or disconnect.
import type { z } from "zod";
import {
  BackfillGapTriggerEventSchema,
  deriveNotificationDedupeFingerprint,
} from "../../../rules/notifications/notification-triggers.js";
import type { NotificationInbox, NotificationPublishReport } from "./inbox.js";

export const BackfillGapObservationSchema = BackfillGapTriggerEventSchema;
type BackfillGapObservation = z.infer<typeof BackfillGapObservationSchema>;

type BackfillGapDetectionReport =
  | Readonly<{ published: false; gap: BackfillGapObservation }>
  | Readonly<{
    published: true;
    gap: BackfillGapObservation;
    report: NotificationPublishReport;
  }>;

export interface BackfillGapNotifier {
  detected(input: unknown): Promise<BackfillGapDetectionReport>;
}

export function createBackfillGapNotifier(
  dependencies: Readonly<{ inbox: Pick<NotificationInbox, "publish"> }>,
): BackfillGapNotifier {
  const reported = new Set<string>();
  const inFlight = new Map<string, Promise<NotificationPublishReport>>();

  return Object.freeze({
    async detected(input: unknown): Promise<BackfillGapDetectionReport> {
      const gap = BackfillGapObservationSchema.parse(input);
      const identity = deriveNotificationDedupeFingerprint(gap);
      if (reported.has(identity)) return { published: false, gap };

      const pending = inFlight.get(identity);
      if (pending !== undefined) {
        await pending;
        return { published: false, gap };
      }

      const publication = dependencies.inbox.publish(gap);
      inFlight.set(identity, publication);
      try {
        const report = await publication;
        reported.add(identity);
        return report.durable === "created"
          ? { published: true, gap, report }
          : { published: false, gap };
      } finally {
        inFlight.delete(identity);
      }
    },
  });
}
