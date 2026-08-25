/**
 * Track F A46: the resumable dashboard stream could not replay a requested
 * cursor range. This is protocol evidence, not a timeout or disconnect guess.
 *
 * A gap identity publishes once while this process is alive. Memory advances
 * only after the inbox commits the durable row, so a failed publish leaves the
 * same gap pending for the next resume attempt. Across a process restart the
 * inbox's authority dedupe returns the existing row byte-for-byte unchanged.
 * Reconnect and resnapshot never clear or mutate that record.
 */
import type { z } from "zod";
import {
  BackfillGapTriggerEventSchema,
  deriveNotificationDedupeFingerprint,
} from "../../domain/notification-triggers.js";
import type { NotificationInbox, NotificationPublishReport } from "./inbox.js";

export const BackfillGapObservationSchema = BackfillGapTriggerEventSchema;
export type BackfillGapObservation = z.infer<typeof BackfillGapObservationSchema>;

export type BackfillGapDetectionReport =
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
