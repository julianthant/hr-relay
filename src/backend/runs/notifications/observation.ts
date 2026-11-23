import type { NotificationInbox } from "./inbox.js";
import type { NotificationTriggerEvent } from "../../../rules/notifications/notification-triggers.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";

export type NotificationObservation = Readonly<{ event: NotificationTriggerEvent; source: { identity: string; occurredAt: string } }>;
export type NotificationSourceRead = Readonly<{ observations: readonly NotificationObservation[]; diagnostics: readonly "NOTIFICATION_RECEIPT_MISSING"[] }>;
export type NotificationObservationStatus = Readonly<{ state: "ready" | "failed" | "stopped"; code?: "NOTIFICATION_OBSERVATION_FAILED" | "NOTIFICATION_RECEIPT_MISSING"; pending: number }>;

/** Publications and health inspections each have a single owner; slow health reads do not delay new occurrences. */
export function createNotificationObserver(deps: {
  inbox: Pick<NotificationInbox, "publish">;
  read(): NotificationSourceRead;
  health(): Promise<void>;
}) {
  let stopped = false, drained = false;
  let healthFailure: NotificationObservationStatus["code"];
  let running: Promise<void> | undefined;
  let diagnostics: readonly NonNullable<NotificationObservationStatus["code"]>[] = [];
  const publishing = new Map<string, NotificationObservation>();
  let retry = new Map<string, NotificationObservation>();
  const batches = new Set<Promise<void>>();

  const observeSources = (changed?: () => boolean): Promise<void> | undefined => {
    if (stopped) return;
    const batch = retry;
    try {
      if (changed !== undefined && !changed() && retry.size === 0 && diagnostics.length === 0) return;
      diagnostics = [];
      const read = deps.read();
      diagnostics = read.diagnostics;
      for (const item of read.observations) {
        const id = item.source.identity;
        const prior = publishing.get(id) ?? batch.get(id);
        if (prior === undefined) batch.set(id, item);
        else if (canonicalJsonStringify(prior.event) !== canonicalJsonStringify(item.event)) throw new Error("NOTIFICATION_PENDING_SOURCE_CONFLICT");
      }
    } catch { diagnostics = ["NOTIFICATION_OBSERVATION_FAILED"]; }
    if (batch.size === 0) return;
    retry = new Map();
    // Claim the whole batch before publishing so overlapping scans only start new occurrences.
    for (const [id, item] of batch) publishing.set(id, item);
    const work = Promise.resolve().then(async () => {
      for (const [id, item] of batch) {
        try { await deps.inbox.publish(item.event, item.source); }
        catch { retry.set(id, item); }
        finally { publishing.delete(id); }
      }
    }).finally(() => { batches.delete(work); });
    batches.add(work);
    return work;
  };
  const observe = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (running !== undefined) return running;
    running = (async () => {
      void observeSources();
      if (batches.size > 0) await Promise.all(batches);
      try { await deps.health(); healthFailure = undefined; } catch { healthFailure = "NOTIFICATION_OBSERVATION_FAILED"; }
    })().finally(() => { running = undefined; });
    return running;
  };
  const status = (): NotificationObservationStatus => {
    const pending = publishing.size + retry.size + diagnostics.length + Number(healthFailure !== undefined);
    const code = healthFailure ?? (retry.size > 0 ? "NOTIFICATION_OBSERVATION_FAILED" : diagnostics[0]);
    if (code !== undefined) return { state: "failed", code, pending };
    return { state: drained ? "stopped" : "ready", pending };
  };
  return Object.freeze({ observe, observeSources, status, async stop() {
    stopped = true;
    await Promise.all([running, ...batches]);
    drained = true;
  } });
}
