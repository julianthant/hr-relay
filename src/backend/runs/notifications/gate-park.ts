
import { z } from "zod";
import { GateIdSchema, RunIdSchema, WorkflowIdSchema } from "../../../rules/identity/ids.js";
import type { NotificationInbox, NotificationPublishReport } from "./inbox.js";

// Gate triggers publish IDs and closed codes, never evidence-packet free text.
export const GateParkObservationSchema = z.strictObject({
  runId: RunIdSchema,
  workflowId: WorkflowIdSchema,
  gateId: GateIdSchema,
});
export type GateParkObservation = z.infer<typeof GateParkObservationSchema>;

const GateParkObservationSetSchema = z.array(GateParkObservationSchema);

type GateParkObservationReport = Readonly<{
  /** Parks whose durable row this observation wrote. */
  published: readonly Readonly<{ park: GateParkObservation; report: NotificationPublishReport }>[];
  /** Parks this notifier had already reported — deliberately re-published as nothing. */
  standing: readonly GateParkObservation[];

  released: readonly GateParkObservation[];
}>;

export interface GateParkNotifier {
  /** Takes `unknown` and parses: the observation set is the boundary. */
  observed(parks: unknown): Promise<GateParkObservationReport>;
}

/** `(runId, gateId)` — the same identity `deriveNotificationDedupeFingerprint` folds a `gate-opened` on. */
function memoryKey(park: GateParkObservation): string {
  return `${park.runId}\u0000${park.gateId}`;
}

export function createGateParkNotifier(
  dependencies: Readonly<{ inbox: Pick<NotificationInbox, "publish"> }>,
): GateParkNotifier {
  // A notifier restart reports still-parked runs again; durable inbox dedupe owns replay suppression.
  const reported = new Map<string, GateParkObservation>();

  return Object.freeze({
    async observed(input: unknown): Promise<GateParkObservationReport> {
      const parks = GateParkObservationSetSchema.parse(input);
      const published: { park: GateParkObservation; report: NotificationPublishReport }[] = [];
      const standing: GateParkObservation[] = [];
      const seen = new Set<string>();

      for (const park of parks) {
        const key = memoryKey(park);
        seen.add(key);
        if (reported.has(key)) {
          standing.push(park);
          continue;
        }
        const report = await dependencies.inbox.publish({
          kind: "gate-opened",
          runId: park.runId,
          workflowId: park.workflowId,
          gateId: park.gateId,
        });
        // AFTER the durable row commits (rule 2). A throw above leaves this key
        // absent, so the next observation retries this exact park.
        reported.set(key, park);
        published.push({ park, report });
      }

      const released: GateParkObservation[] = [];
      for (const [key, park] of reported) {
        if (seen.has(key)) continue;
        reported.delete(key);
        released.push(park);
      }

      return Object.freeze({
        published: Object.freeze(published),
        standing: Object.freeze(standing),
        released: Object.freeze(released),
      });
    },
  });
}
