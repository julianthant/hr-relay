import type { NotificationInbox } from "./inbox.js";
import { deriveNotificationDedupeFingerprint, type NotificationTriggerEvent } from "../../../rules/notifications/notification-triggers.js";
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
  const pendingBySource = new Map<string, NotificationObservation>();
  const queues = new Map<string, Set<NotificationObservation>>();
  const active = new Map<string, Promise<void>>();
  // A nonempty queue without a publisher is waiting to retry its first occurrence.
  const needsRetry = () => queues.size > active.size;

  const observeSources = (changed?: () => boolean): Promise<void> | undefined => {
    if (stopped) return;
    try {
      if (changed !== undefined && !changed() && !needsRetry() && diagnostics.length === 0) return;
      diagnostics = [];
      const read = deps.read();
      diagnostics = read.diagnostics;
      for (const item of read.observations) {
        const id = item.source.identity;
        const prior = pendingBySource.get(id);
        if (prior !== undefined) {
          if (canonicalJsonStringify(prior.event) !== canonicalJsonStringify(item.event)) throw new Error("NOTIFICATION_PENDING_SOURCE_CONFLICT");
          continue;
        }
        const key = deriveNotificationDedupeFingerprint(item.event);
        let queue = queues.get(key);
        if (queue === undefined) {
          queue = new Set();
          queues.set(key, queue);
        }
        queue.add(item);
        pendingBySource.set(id, item);
      }
    } catch { diagnostics = ["NOTIFICATION_OBSERVATION_FAILED"]; }
    for (const [key, queue] of queues) {
      if (active.has(key)) continue;
      active.set(key, Promise.resolve().then(async () => {
        for (const item of queue) {
          try { await deps.inbox.publish(item.event, item.source); }
          catch { break; }
          queue.delete(item);
          pendingBySource.delete(item.source.identity);
        }
        active.delete(key);
        if (queue.size === 0) queues.delete(key);
      }));
    }
    if (active.size > 0) return Promise.all(active.values()).then(() => {});
  };
  const observe = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (running !== undefined) return running;
    running = (async () => {
      const publications = observeSources();
      if (publications !== undefined) await publications;
      try { await deps.health(); healthFailure = undefined; } catch { healthFailure = "NOTIFICATION_OBSERVATION_FAILED"; }
    })().finally(() => { running = undefined; });
    return running;
  };
  const status = (): NotificationObservationStatus => {
    const pending = pendingBySource.size + diagnostics.length + Number(healthFailure !== undefined);
    const code = healthFailure ?? (needsRetry() ? "NOTIFICATION_OBSERVATION_FAILED" : diagnostics[0]);
    if (code !== undefined) return { state: "failed", code, pending };
    return { state: drained ? "stopped" : "ready", pending };
  };
  return Object.freeze({ observe, observeSources, status, async stop() {
    stopped = true;
    await Promise.all([running, ...active.values()]);
    drained = true;
  } });
}
